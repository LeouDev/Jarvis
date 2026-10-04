// Voice abstraction. v1 uses the browser's free built-in speech; add Google / OpenAI /
// ElevenLabs providers by implementing VoiceProvider and swapping it in useJarvis.

export interface VoiceProvider {
  readonly supportsInput: boolean;
  readonly supportsOutput: boolean;
  listen(opts: { onInterim?: (text: string) => void; lang?: string }): Promise<string>;
  stopListening(): void;
  /** Listens continuously for the wake word; calls onWake with whatever followed it. Returns a stop function. */
  listenForWakeWord(opts: { onWake: (command: string) => void; onError?: (message: string) => void }): () => void;
  speak(text: string, opts?: { voiceName?: string; rate?: number }): Promise<void>;
  stopSpeaking(): void;
  voices(): string[];
}

type Recognition = {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: (e: any) => void; onerror: (e: any) => void; onend: () => void;
  start(): void; stop(): void; abort(): void;
};

const RecognitionCtor: (new () => Recognition) | undefined =
  typeof window !== 'undefined' ? (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition : undefined;

// "Jarvis" plus the ways recognizers commonly mishear it; captures what follows ("Jarvis, open VS Code").
export const WAKE = /\b(jarvis|jarvas|javis|jervis)\b[\s,.!?]*(.*)$/i;

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

  listen({ onInterim, lang }: { onInterim?: (t: string) => void; lang?: string } = {}) {
    return new Promise<string>((resolve, reject) => {
      if (!RecognitionCtor) return reject(new Error('Voice input is not supported in this browser. Try Chrome or Safari.'));
      this.stopListening();
      const r = new RecognitionCtor();
      this.recognition = r;
      r.lang = lang || navigator.language || 'en-US';
      r.interimResults = true;
      r.continuous = false;
      let finalText = '';
      let silent = false;
      r.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          e.results[i].isFinal ? (finalText += t) : (interim += t);
        }
        onInterim?.(finalText + interim);
      };
      r.onerror = (e) => {
        if (e.error === 'no-speech') silent = true;
        if (e.error === 'no-speech' || e.error === 'aborted') return;
        reject(new Error(RECOGNITION_ERRORS[e.error] ?? `Voice input failed (${e.error}).`));
      };
      r.onend = () => {
        this.recognition = null;
        // The mic delivered audio but no speech: usually the wrong input device or a muted headset.
        if (silent && !finalText.trim()) reject(new NoSpeechError());
        else resolve(finalText.trim());
      };
      r.start();
    });
  }

  stopListening() {
    this.recognition?.stop();
  }

  listenForWakeWord({ onWake, onError }: { onWake: (command: string) => void; onError?: (message: string) => void }) {
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
      r.lang = navigator.language || 'en-US';
      r.continuous = true;
      r.interimResults = false;
      r.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const m = e.results[i].isFinal && e.results[i][0].transcript.match(WAKE);
          if (m && heard === null) {
            heard = m[2].trim();
            r.stop(); // hand the mic over only once this session has fully ended (see onend)
          }
        }
      };
      r.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') {
          stopped = true;
          onError?.(RECOGNITION_ERRORS[e.error]);
        }
      };
      r.onend = () => {
        if (heard !== null) return onWake(heard);
        if (stopped) return;
        // Browsers end long sessions on their own; restart, backing off if it keeps dying immediately.
        quickEnds = Date.now() - startedAt < 2000 ? quickEnds + 1 : 0;
        setTimeout(() => !stopped && start(), quickEnds > 3 ? 3000 : 150);
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
  async speak(text: string, { voiceName, rate = 1 }: { voiceName?: string; rate?: number } = {}) {
    if (!this.supportsOutput) return;
    this.stopSpeaking();
    const token = ++this.speakToken;
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
