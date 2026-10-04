// Voice abstraction. v1 uses the browser's free built-in speech; add Google / OpenAI /
// ElevenLabs providers by implementing VoiceProvider and swapping it in useJarvis.

export interface VoiceProvider {
  readonly supportsInput: boolean;
  readonly supportsOutput: boolean;
  listen(opts: { onInterim?: (text: string) => void; lang?: string }): Promise<string>;
  stopListening(): void;
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
      r.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          e.results[i].isFinal ? (finalText += t) : (interim += t);
        }
        onInterim?.(finalText + interim);
      };
      r.onerror = (e) => {
        if (e.error === 'no-speech' || e.error === 'aborted') return;
        const reasons: Record<string, string> = {
          'not-allowed': 'Microphone access was denied. Allow it for this site in your browser settings.',
          'audio-capture': 'No microphone was found.',
          'service-not-allowed': 'Speech recognition is blocked in this browser. Try Chrome or Safari.',
          network: "Speech recognition couldn't reach its service. Check your connection.",
        };
        reject(new Error(reasons[e.error] ?? `Voice input failed (${e.error}).`));
      };
      r.onend = () => {
        this.recognition = null;
        resolve(finalText.trim());
      };
      r.start();
    });
  }

  stopListening() {
    this.recognition?.stop();
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
