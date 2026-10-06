// Speaking while the reply is still streaming: text is cut into sentences, each sentence is
// synthesized as soon as it's complete (natural voice: fetched in parallel, played in order),
// so JARVIS starts talking after the first sentence instead of after the whole answer.
import { supabase } from './supabase';
import { speakable, voice as browserVoice } from './voice';

const MAX_CHARS = 190; // Orpheus accepts ≤200 characters per request

/** Splits text longer than the TTS limit at a comma or space. */
export function splitLong(text: string, max = MAX_CHARS): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const cut = Math.max(rest.lastIndexOf(', ', max), rest.lastIndexOf(' ', max));
    const at = cut > max / 2 ? cut + 1 : max;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * Feeds streamed text in, emits speakable chunks: the first sentence immediately (fast start),
 * later sentences merged up to the TTS limit (fewer requests).
 */
export function sentenceChunker(emit: (chunk: string) => void, max = MAX_CHARS) {
  let buffer = '';
  let pending = '';
  let first = true;
  const add = (sentence: string) => {
    for (const part of splitLong(sentence, max)) {
      if (first) {
        first = false;
        emit(part);
      } else if (pending && pending.length + part.length + 1 > max) {
        emit(pending);
        pending = part;
      } else pending = pending ? `${pending} ${part}` : part;
    }
  };
  return {
    push(delta: string) {
      buffer += delta;
      let m: RegExpMatchArray | null;
      // A sentence ends at . ! ? (plus closing quotes/brackets) followed by whitespace, or at a newline.
      while ((m = buffer.match(/^([\s\S]*?(?:[.!?]["')\]]*(?=\s)|\n))\s*/)) && m[0].length < buffer.length) {
        if (m[1].trim()) add(m[1].trim());
        buffer = buffer.slice(m[0].length);
      }
    },
    flush() {
      if (buffer.trim()) add(buffer.trim());
      buffer = '';
      if (pending) emit(pending);
      pending = '';
    },
  };
}

/** `error`: natural voice unavailable (e.g. terms not accepted; shown in Settings). `pausedUntil`: rate-limit cool-down. */
export const naturalVoiceStatus = { error: '', pausedUntil: 0 };

async function fetchSpeech(text: string, voiceName: string, signal: AbortSignal): Promise<Blob | null> {
  if (naturalVoiceStatus.error || Date.now() < naturalVoiceStatus.pausedUntil) return null;
  const { data } = await supabase.auth.getSession();
  const res = await fetch('/api/speak', {
    method: 'POST',
    headers: { authorization: `Bearer ${data.session?.access_token ?? ''}`, 'content-type': 'application/json' },
    body: JSON.stringify({ text, voice: voiceName || undefined }),
    signal,
  });
  if (res.ok) return res.blob();
  const { error, retryAfter } = await res.json().catch(() => ({ error: '', retryAfter: 0 }));
  if (res.status === 409) naturalVoiceStatus.error = error; // stop asking until reload; Settings explains why
  // Free tier ≈100 clips/day: once limited, use the browser voice for as long as Groq says (at most 10 min).
  if (res.status === 429) naturalVoiceStatus.pausedUntil = Date.now() + Math.min((retryAfter || 600) * 1000, 10 * 60_000);
  return null;
}

export interface SpeakerOptions {
  natural: boolean;
  naturalVoice: string;
  browserVoice: string;
  rate: number;
  onStart?: () => void;
}

export interface Speaker {
  enqueue(text: string): void;
  /** Resolves when everything queued so far has been spoken (or stop() was called). */
  done(): Promise<void>;
  stop(): void;
}

export function createSpeaker(opts: SpeakerOptions): Speaker {
  const abort = new AbortController();
  let chain: Promise<void> = Promise.resolve();
  let stopped = false;
  let started = false;
  let audio: HTMLAudioElement | null = null;
  let finishCurrent: (() => void) | null = null;
  let fetching: Promise<Blob | null> = Promise.resolve(null);

  const playBlob = (blob: Blob) =>
    new Promise<void>((resolve) => {
      const url = URL.createObjectURL(blob);
      audio = new Audio(url);
      audio.playbackRate = opts.rate;
      const done = () => {
        finishCurrent = null;
        URL.revokeObjectURL(url);
        resolve();
      };
      finishCurrent = done; // stop() must release whoever awaits done()
      audio.onended = done;
      audio.onerror = done;
      audio.play().catch(done);
    });

  return {
    enqueue(text) {
      const line = speakable(text);
      if (!line || stopped) return;
      // Fetched ahead of playback, but one request at a time: Groq rejects bursts with 429.
      const clip = opts.natural
        ? (fetching = fetching.then(() => fetchSpeech(line, opts.naturalVoice, abort.signal).catch(() => null)))
        : Promise.resolve(null);
      chain = chain.then(async () => {
        const blob = await clip;
        if (stopped) return;
        if (!started) {
          started = true;
          opts.onStart?.();
        }
        if (blob) await playBlob(blob);
        else await browserVoice.speak(line, { voiceName: opts.browserVoice, rate: opts.rate, append: true });
      });
    },
    done: () => chain,
    stop() {
      stopped = true;
      abort.abort();
      audio?.pause();
      finishCurrent?.();
      browserVoice.stopSpeaking();
    },
  };
}
