// Whisper speech input: the browser records 16 kHz mono PCM, an energy-based voice detector decides
// when you've finished, and the server transcribes with Whisper (Groq). The browser recognizer is
// still used to spot the wake word cheaply; the command itself is re-transcribed from recorded audio.
import { transcribeAudio } from './api';
import { BrowserVoiceProvider, NoSpeechError, stripWake, type WakeOptions } from './voice';
import { captureUtterance, micLevel, stopCapture, TURN_PAUSE_MS } from './vad';

export { micLevel };

const RATE = 16_000;
const RING_SECONDS = 30;
const NO_SPEECH_MS = 8000;
const MAX_MS = 30_000;


/** Block-average resampling (e.g. 48 kHz → 16 kHz). */
export function downsample(input: Float32Array, ratio: number): Float32Array {
  if (ratio <= 1) return input.slice();
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = sum / (end - start);
  }
  return out;
}

/** 16-bit PCM mono WAV. */
export function encodeWav(samples: Float32Array, rate = RATE): Blob {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (offset: number, s: string) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((x, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x)) * 0x7fff, true));
  return new Blob([view.buffer], { type: 'audio/wav' });
}

const micError = (err: unknown) => {
  const name = (err as DOMException)?.name;
  return new Error(
    name === 'NotAllowedError'
      ? 'Microphone access was denied. Allow it for this site in your browser settings.'
      : name === 'NotFoundError'
        ? 'No microphone was found.'
        : 'The microphone could not be started.',
  );
};

/** Shared microphone: a ring buffer of the last 30 s plus a simple voice-activity detector. Times are sample indices. */
class Mic {
  /** Which input device the browser gave us, and its native rate (for diagnostics). */
  device = '';
  inputRate = 0;
  total = 0;
  lastVoice = -1;
  speechStart = -1;
  private users = 0;
  private floor = 0.01;
  private ring = new Float32Array(RATE * RING_SECONDS);
  private starting?: Promise<void>;
  private teardown?: () => void;

  async acquire(): Promise<() => void> {
    this.users++;
    try {
      await (this.starting ??= this.start());
    } catch (err) {
      this.users--;
      this.starting = undefined;
      throw micError(err);
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--this.users === 0) this.stop();
    };
  }

  private async start() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    const ctx = new AudioContext();
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    // Started without a click (e.g. wake word on page load): browsers keep audio paused until the first interaction.
    if (ctx.state === 'suspended') {
      const resume = () => void ctx.resume();
      window.addEventListener('pointerdown', resume, { once: true });
      window.addEventListener('keydown', resume, { once: true });
    }
    this.device = stream.getAudioTracks()[0]?.label ?? '';
    this.inputRate = ctx.sampleRate;
    const source = ctx.createMediaStreamSource(stream);
    const node = ctx.createScriptProcessor(4096, 1, 1); // ponytail: deprecated but universal; AudioWorklet if it ever goes away
    const ratio = ctx.sampleRate / RATE;
    this.total = 0;
    this.lastVoice = -1;
    this.speechStart = -1;
    node.onaudioprocess = (e) => {
      const chunk = downsample(e.inputBuffer.getChannelData(0), ratio);
      let energy = 0;
      for (const x of chunk) energy += x * x;
      const rms = Math.sqrt(energy / Math.max(1, chunk.length));
      const at = this.total;
      for (const x of chunk) this.ring[this.total++ % this.ring.length] = x;
      if (rms > Math.max(this.floor * 3, 0.006)) {
        if (this.lastVoice < 0 || at - this.lastVoice > RATE * 0.6) this.speechStart = at;
        this.lastVoice = this.total;
      } else {
        this.floor = this.floor * 0.95 + rms * 0.05; // adapt to the room's background noise
      }
      micLevel.value = Math.min(1, rms * 12);
    };
    source.connect(node);
    node.connect(ctx.destination); // a ScriptProcessor only runs while connected; it outputs silence
    this.teardown = () => {
      node.disconnect();
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    };
  }

  private stop() {
    this.teardown?.();
    this.teardown = undefined;
    this.starting = undefined;
    micLevel.value = 0;
  }

  /** Recorded PCM between two sample indices, clamped to what the ring still holds. */
  slice(from: number, to: number) {
    const start = Math.max(0, from, to - this.ring.length);
    const out = new Float32Array(Math.max(0, to - start));
    for (let i = 0; i < out.length; i++) out[i] = this.ring[(start + i) % this.ring.length];
    return out;
  }
}

export const mic = new Mic();

/** Loudest sample; near-zero means the wrong or a muted microphone. */
const peak = (samples: Float32Array) => samples.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
const MIN_PEAK = 0.02;

/** Settings → Test microphone: record a few seconds exactly like a command, for playback + transcription. */
export async function recordSample(ms = 4000) {
  const release = await mic.acquire();
  try {
    const from = mic.total;
    await new Promise((r) => setTimeout(r, ms));
    const samples = mic.slice(from, mic.total);
    return { wav: encodeWav(samples), device: mic.device, inputRate: mic.inputRate, seconds: samples.length / RATE, peak: peak(samples) };
  } finally {
    release();
  }
}

export class WhisperVoiceProvider extends BrowserVoiceProvider {

  get supportsInput() {
    return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  }

  /** One command: Silero VAD finds where your speech starts and ends, Whisper transcribes it. */
  async listen({ lang, onEnd, pauseMs }: { onInterim?: (t: string) => void; lang?: string; onEnd?: () => void; pauseMs?: number } = {}) {
    const audio = await captureUtterance({ pauseMs: pauseMs ?? TURN_PAUSE_MS.normal, noSpeechMs: NO_SPEECH_MS, maxMs: MAX_MS });
    if (!audio || peak(audio) < MIN_PEAK) throw new NoSpeechError(); // don't let Whisper hallucinate on silence
    onEnd?.();
    const text = await transcribeAudio(encodeWav(audio), lang);
    if (!text) throw new NoSpeechError();
    return text;
  }

  stopListening() {
    void stopCapture();
  }

  /** Barge-in: while JARVIS talks, a clear voice interrupts it; returns what you said. */
  async listenForInterruption({ lang, pauseMs, onInterrupt }: { lang?: string; pauseMs?: number; onInterrupt: () => void }) {
    const audio = await captureUtterance({ pauseMs: pauseMs ?? TURN_PAUSE_MS.normal, strict: true, maxMs: MAX_MS, onSpeechStart: onInterrupt });
    if (!audio || peak(audio) < MIN_PEAK) return '';
    return transcribeAudio(encodeWav(audio), lang).catch(() => '');
  }

  /** Browser recognizer spots "Jarvis"; Whisper re-transcribes that whole utterance from the recorded audio. */
  listenForWakeWord(opts: WakeOptions) {
    let release: (() => void) | null = null;
    let stopped = false;
    let utteranceStart = -1;
    mic.acquire().then((r) => (stopped ? r() : (release = r))).catch(() => {}); // without audio we fall back to the browser text

    const stopBrowser = super.listenForWakeWord({
      ...opts,
      onArmed: () => {
        const recent = mic.speechStart >= 0 && mic.total - mic.speechStart < 10 * RATE;
        utteranceStart = Math.max(0, (recent ? mic.speechStart : mic.total - 2 * RATE) - 0.3 * RATE);
        opts.onArmed?.();
      },
      onWake: (command) => {
        const audio = release && utteranceStart >= 0 ? mic.slice(utteranceStart, mic.total) : null;
        if (!audio || audio.length < RATE / 2 || peak(audio) < MIN_PEAK) return opts.onWake(command);
        transcribeAudio(encodeWav(audio), opts.lang)
          .then((text) => opts.onWake(stripWake(text) || command))
          .catch(() => opts.onWake(command));
      },
    });
    return () => {
      stopped = true;
      stopBrowser();
      release?.();
    };
  }
}

export const whisperVoice = new WhisperVoiceProvider();
