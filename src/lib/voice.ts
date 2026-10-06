// Voice abstraction. v1 uses the browser's free built-in speech; add Google / OpenAI /
// ElevenLabs providers by implementing VoiceProvider and swapping it in useJarvis.

export interface VoiceProvider {
  readonly supportsInput: boolean;
  readonly supportsOutput: boolean;
  /** Records one utterance. onEnd fires when recording stops (before any server-side transcription). */
  listen(opts: { onInterim?: (text: string) => void; lang?: string; onEnd?: () => void; pauseMs?: number }): Promise<string>;
  stopListening(): void;
  /** Listens continuously for the wake word; calls onWake with whatever followed it. Returns a stop function. */
  listenForWakeWord(opts: WakeOptions): () => void;
  /** append: queue after what's already playing instead of interrupting it. */
  speak(text: string, opts?: { voiceName?: string; rate?: number; append?: boolean }): Promise<void>;
  stopSpeaking(): void;
  voices(): string[];
}

export interface WakeOptions {
  onWake: (command: string) => void;
  /** The wake word was recognised (fires early, from interim results). */
  onArmed?: () => void;
  /** Live transcript of what the mic is hearing, for feedback. */
  onHeard?: (text: string) => void;
  /** The command after the name was probably mis-heard. */
  onUnclear?: () => void;
  onError?: (message: string) => void;
  lang?: string;
  /** Silence that ends the command after the name. */
  pauseMs?: number;
}

type Recognition = {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  onresult: (e: any) => void; onerror: (e: any) => void; onend: () => void;
  start(): void; stop(): void; abort(): void;
};

const RecognitionCtor: (new () => Recognition) | undefined =
  typeof window !== 'undefined' ? (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition : undefined;

// "Jarvis" plus the ways recognizers commonly mishear it (incl. b/v swaps); captures what follows.
const NAMES = 'jarvis|jarvas|jarvys|jarves|javis|jervis|jarbis|jarbes|jarvi';
export const WAKE = new RegExp(`\\b(${NAMES})\\b[\\s,.!?]*(.*)$`, 'i');
/** Same, but only when the utterance *starts* with the name ("Hey Jarvis, …"). */
const LEADING_WAKE = new RegExp(`^\\s*(?:(?:hey|hi|ok|okay)[\\s,]+)?(${NAMES})\\b[\\s,.!?]*(.*)$`, 'i');

/** Strips a leading "(hey) Jarvis" from a captured command. Returns '' when only the name was said. */
export const stripWake = (text: string) => text.match(LEADING_WAKE)?.[2].trim() ?? text.trim();

/** The command after the wake word in the first alternative that contains it, or null. */
export function findWake(alternatives: string[]): string | null {
  for (const t of alternatives) {
    const m = t.match(WAKE);
    if (m) return m[2].trim();
  }
  return null;
}

const alternativesOf = (result: ArrayLike<{ transcript: string }>) => Array.from(result, (a) => a.transcript);

// Capture timing: stop after this pause once you've started speaking; give up if nothing is said.
const PAUSE_MS = 2000;
const NO_SPEECH_MS = 8000;

const RECOGNITION_ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone access was denied. Allow it for this site in your browser settings.',
  'audio-capture': 'No microphone was found.',
  'service-not-allowed': 'Speech recognition is blocked in this browser. Try Chrome or Safari.',
  network: "Speech recognition couldn't reach its service. Check your connection.",
};

export class NoSpeechError extends Error {
  constructor() {
    super("I couldn't hear any speech. Check which microphone the browser uses (click the icon left of the address bar → Microphone, or your OS sound input) and that your headset isn't muted.");
  }
}

export class UnclearSpeechError extends Error {
  constructor() {
    super("Didn't catch that clearly — say it again.");
  }
}

/** "Stop", "never mind", "thanks"… — ends the exchange without asking the model anything. */
export const isStopPhrase = (text: string) =>
  /^(?:(?:ok(?:ay)?|no|hey)[\s,]+)?(?:stop|cancel|never ?mind|shut up|be quiet|quiet|enough|that'?s (?:enough|all|it)|thanks?|thank you)(?:[\s,]+(?:jarvis|thanks|thank you))?[.!]*$/i.test(text.trim());

/** Short rising tone confirming the wake word was heard. */
export function chime() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.exponentialRampToValueAtTime(1320, t + 0.12);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.3);
    osc.onended = () => ctx.close();
  } catch {
    /* audio unavailable: the orb still shows LISTENING */
  }
}

/** Turns markdown-ish replies into something pleasant to hear. */
export const speakable = (text: string) =>
  text
    .replace(/```[\s\S]*?```/g, ' (code omitted) ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'link')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export class BrowserVoiceProvider implements VoiceProvider {
  private recognition: Recognition | null = null;
  private speakToken = 0;

  get supportsInput() { return Boolean(RecognitionCtor); }
  get supportsOutput() { return typeof window !== 'undefined' && 'speechSynthesis' in window; }

  listen({ onInterim, lang, pauseMs = PAUSE_MS }: { onInterim?: (t: string) => void; lang?: string; pauseMs?: number } = {}) {
    return new Promise<string>((resolve, reject) => {
      if (!RecognitionCtor) return reject(new Error('Voice input is not supported in this browser. Try Chrome or Safari.'));
      this.stopListening();
      const r = new RecognitionCtor();
      this.recognition = r;
      r.lang = lang || navigator.language || 'en-US';
      r.interimResults = true;
      // Continuous mode + our own end-of-speech timer: Chrome's one-shot mode often cuts people off at the first pause.
      r.continuous = true;
      let finalText = '';
      let spoke = false;
      let lastHeard = Date.now();
      let failed = false;
      const watchdog = setInterval(() => Date.now() - lastHeard > (spoke ? pauseMs : NO_SPEECH_MS) && r.stop(), 200);
      r.onresult = (e) => {
        let interim = '';
        finalText = '';
        for (let i = 0; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          e.results[i].isFinal ? (finalText += t) : (interim += t);
        }
        spoke = true;
        lastHeard = Date.now();
        onInterim?.(finalText + interim);
      };
      r.onerror = (e) => {
        if (e.error === 'no-speech' || e.error === 'aborted') return;
        failed = true;
        reject(new Error(RECOGNITION_ERRORS[e.error] ?? `Voice input failed (${e.error}).`));
      };
      r.onend = () => {
        clearInterval(watchdog);
        if (this.recognition === r) this.recognition = null;
        if (failed) return;
        // Nothing recognised: usually the wrong input device, a muted headset, or a blocked mic.
        const text = finalText.trim();
        text ? resolve(text) : reject(new NoSpeechError());
      };
      r.start();
    });
  }

  stopListening() {
    this.recognition?.stop();
  }

  listenForWakeWord({ onWake, onArmed, onHeard, onError, lang, pauseMs = PAUSE_MS }: WakeOptions) {
    if (!RecognitionCtor) {
      onError?.('Wake word needs speech recognition (Chrome or Safari).');
      return () => {};
    }
    let stopped = false;
    let heard: string | null = null;
    let quickEnds = 0;
    let current: Recognition | null = null;

    const start = () => {
      const r = new RecognitionCtor();
      current = r;
      const startedAt = Date.now();
      // After the name is heard, collect every following phrase until the speaker actually stops.
      let wakeAt = -1; // index of the result that contained the name
      const parts = new Map<number, string>();
      let lastHeard = 0;
      let ending = false;
      const finish = () => {
        if (ending) return;
        ending = true;
        heard = [...parts.entries()].sort(([a], [b]) => a - b).map(([, t]) => t).join(' ').trim();
        r.stop(); // hand the mic over only once this session has fully ended (see onend)
      };
      const watchdog = setInterval(() => {
        if (wakeAt < 0 || ending) return;
        const quiet = Date.now() - lastHeard;
        // Short pause ends the command; a longer one is allowed right after the name ("Jarvis… open VS Code").
        if (quiet > (parts.size && [...parts.values()].some(Boolean) ? pauseMs : NO_SPEECH_MS)) finish();
      }, 200);
      r.lang = lang || navigator.language || 'en-US';
      r.continuous = true;
      r.interimResults = true;
      r.maxAlternatives = 5; // "Jarvis" is often the 2nd or 3rd guess
      r.onresult = (e) => {
        lastHeard = Date.now();
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const result = e.results[i];
          const alts = alternativesOf(result);
          onHeard?.(alts[0] ?? '');
          if (wakeAt < 0) {
            if (findWake(alts) === null) continue;
            wakeAt = i;
            onArmed?.();
          }
          if (i === wakeAt) parts.set(i, findWake(alts) ?? ''); // text after the name in the wake phrase
          else if (i > wakeAt) parts.set(i, (alts[0] ?? '').trim()); // interim text counts too, finals overwrite it
        }
      };
      r.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') {
          stopped = true;
          onError?.(RECOGNITION_ERRORS[e.error]);
        }
      };
      r.onend = () => {
        clearInterval(watchdog);
        if (wakeAt >= 0 && !ending && !stopped) finish(); // session ended on its own mid-command
        if (heard) return onWake(heard);
        heard = null; // only the name, then silence: keep listening for the name
        if (stopped) return;
        // Browsers end long sessions on their own; restart, backing off if it keeps dying immediately.
        quickEnds = Date.now() - startedAt < 2000 ? quickEnds + 1 : 0;
        setTimeout(() => !stopped && start(), quickEnds > 3 ? 3000 : 100);
      };
      try {
        r.start();
      } catch {
        setTimeout(() => !stopped && start(), 500);
      }
    };
    start();
    return () => {
      stopped = true;
      heard = null;
      current?.abort();
    };
  }

  voices() {
    return this.supportsOutput ? speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en')).map((v) => v.name) : [];
  }

  /** Speaks sentence by sentence (Chrome cuts off long utterances). Resolves when finished or interrupted. */
  async speak(text: string, { voiceName, rate = 1, append = false }: { voiceName?: string; rate?: number; append?: boolean } = {}) {
    if (!this.supportsOutput) return;
    if (!append) this.stopSpeaking();
    const token = this.speakToken;
    const voice = speechSynthesis.getVoices().find((v) => v.name === voiceName);
    const sentences = speakable(text).match(/[^.!?]+[.!?]*/g) ?? [];
    for (const sentence of sentences) {
      if (token !== this.speakToken) return;
      await new Promise<void>((done) => {
        const u = new SpeechSynthesisUtterance(sentence.trim());
        if (voice) u.voice = voice;
        u.rate = rate;
        u.onend = u.onerror = () => done();
        speechSynthesis.speak(u);
      });
    }
  }

  stopSpeaking() {
    this.speakToken++;
    if (this.supportsOutput) speechSynthesis.cancel();
  }
}

export const voice: VoiceProvider = new BrowserVoiceProvider();
