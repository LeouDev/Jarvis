import type { SupabaseClient } from '@supabase/supabase-js';
import { UserFacingError } from '../lib/util.js';
import { listProjects } from '../memory/projects.js';

// Speech-to-text via Whisper on Groq (free tier). Any OpenAI-compatible /audio/transcriptions
// endpoint works the same way, so swapping providers is a URL + key change.

// Whisper invents these on near-silent audio.
const HALLUCINATIONS = /^(thank you\.?|thanks for watching!?|thank you for watching\.?|you|bye\.?|\.+|okay\.?)$/i;

async function whisper(audio: Blob, prompt: string, language?: string): Promise<string> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new UserFacingError('Whisper transcription needs GROQ_API_KEY on the server. Switch Settings → Voice → Speech engine to Browser.');
  const form = new FormData();
  form.append('file', audio, audio.type.includes('wav') ? 'speech.wav' : 'speech.webm');
  form.append('model', process.env.GROQ_STT_MODEL || 'whisper-large-v3-turbo');
  form.append('temperature', '0');
  form.append('response_format', 'json');
  if (prompt) form.append('prompt', prompt);
  if (language) form.append('language', language);
  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 429) throw new UserFacingError('Speech transcription is rate-limited right now. Try again in a minute.');
  if (!res.ok) {
    console.error('[stt]', res.status, (await res.text()).slice(0, 300));
    throw new UserFacingError("I couldn't transcribe that audio.");
  }
  return String((await res.json()).text ?? '').trim();
}

const words = (s: string) => s.toLowerCase().match(/[a-z0-9]+(?:[./][a-z0-9]+)*/g) ?? [];

/** Whisper copying its hint instead of transcribing: every word is (part of) the vocabulary prompt. */
export const looksLikeBleed = (text: string, prompt: string) => {
  const heard = words(text);
  const hint = prompt.toLowerCase();
  return heard.length > 0 && heard.every((w) => hint.includes(w));
};

/** Whisper stuck in a loop ("60 days. 60 days. 60 days."). */
export const isLooping = (text: string) => {
  const counts = new Map<string, number>();
  for (const part of text.toLowerCase().split(/[.!?]+/).map((p) => p.trim()).filter(Boolean))
    counts.set(part, (counts.get(part) ?? 0) + 1);
  return [...counts.values()].some((n) => n >= 3);
};

export async function transcribe(audio: Blob, opts: { prompt?: string; language?: string } = {}): Promise<string> {
  let text = await whisper(audio, opts.prompt ?? '', opts.language);
  // Unclear audio + a hint can make Whisper echo the hint; without it, noise transcribes as nothing.
  if (opts.prompt && (looksLikeBleed(text, opts.prompt) || isLooping(text))) text = await whisper(audio, '', opts.language);
  // Fewer than two letters ("1", ".", "S.") is noise, not a command.
  return HALLUCINATIONS.test(text) || isLooping(text) || (text.match(/\p{L}/gu)?.length ?? 0) < 2 ? '' : text;
}

const BASE_TERMS = ['Jarvis', 'VS Code', 'GitHub', 'Facebook', 'Spotify', 'Vercel', 'Supabase'];
const COMMON = new Set(['i', 'the', 'a', 'an', 'my', 'it', 'is', 'this', 'that', 'he', 'she', 'they', 'we', 'you', 'and', 'or', 'but', 'remember']);

/** Proper nouns, product codes and domains from saved facts ("13C", "13c.online", "Kassix", "AIR/Rally"). */
export function extractTerms(texts: string[]): string[] {
  const terms = new Map<string, string>();
  for (const text of texts)
    for (const raw of text.split(/\s+/)) {
      const w = raw.replace(/^[^\w]+|[^\w]+$/g, '').replace(/'s$/i, '');
      if (w.length < 2 || COMMON.has(w.toLowerCase()) || !/[a-z]/i.test(w)) continue;
      if (/[A-Z]/.test(w) || /\d/.test(w) || /\w[./]\w/.test(w)) terms.set(w.toLowerCase(), w);
    }
  return [...terms.values()];
}

/**
 * Whisper's prompt biases spelling toward words it has "seen". Only bare terms are sent — whole
 * sentences get copied into the transcript when the audio is unclear.
 */
export async function vocabulary(db: SupabaseClient, name: string): Promise<string> {
  const [{ data }, projects] = await Promise.all([
    db.from('memories').select('content').in('category', ['projects', 'work', 'personal', 'technical']).order('importance', { ascending: false }).limit(40),
    listProjects(db),
  ]);
  const projectTerms = projects.flatMap((p) => [p.name, ...p.aliases, ...(p.website ? [p.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')] : [])]);
  const terms = new Map<string, string>();
  for (const t of [...BASE_TERMS, ...(name ? [name] : []), ...projectTerms, ...extractTerms((data ?? []).map((m: { content: string }) => m.content))])
    terms.set(t.toLowerCase(), t);
  return [...terms.values()].join(', ').slice(0, 600);
}

/** Browser language tag → Whisper language code. Speech is English unless Filipino is chosen. */
export const whisperLanguage = (lang: string) => (lang.toLowerCase().startsWith('fil') ? 'tl' : 'en');
