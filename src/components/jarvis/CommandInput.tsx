import { ArrowUp, Mic, Square } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import type { JarvisState } from '../../hooks/useJarvis';

interface Props {
  state: JarvisState;
  interim: string;
  busy: boolean;
  voiceSupported: boolean;
  /** Shown while listening so it's obvious which speech engine is active. */
  engine?: string;
  onSend: (text: string) => void;
  onListen: () => void;
}

export function CommandInput({ state, interim, busy, voiceSupported, engine, onSend, onListen }: Props) {
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const listening = state === 'listening';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    onSend(text);
    setText('');
  };

  return (
    <form onSubmit={submit} className="glass flex items-center gap-2 !rounded-full p-1.5 pl-1.5">
      <button
        type="button"
        onClick={onListen}
        disabled={!voiceSupported || (busy && !listening)}
        title={voiceSupported ? (listening ? 'Stop listening' : 'Speak (click the orb works too)') : 'Voice input needs Chrome or Safari'}
        className={`flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-medium transition disabled:opacity-40 ${
          listening ? 'bg-glow text-void shadow-[0_0_24px_rgb(34_211_238/0.5)]' : 'bg-white/[0.06] text-white/85 hover:bg-white/10'
        }`}
      >
        {listening ? <Square className="size-3.5 fill-current" /> : <Mic className="size-4" />}
        <span className="hidden sm:inline">{listening ? 'Stop' : 'Speak'}</span>
      </button>
      <input
        ref={input}
        value={listening ? interim : text}
        onChange={(e) => setText(e.target.value)}
        readOnly={listening}
        placeholder={listening ? `Listening${engine ? ` · ${engine}` : ''}…` : state === 'processing' && engine === 'Whisper' ? 'Transcribing…' : 'Type a command…'}
        aria-label="Message JARVIS"
        className="min-w-0 flex-1 bg-transparent px-2 text-[15px] text-white placeholder:text-faint focus:outline-none"
      />
      <button
        type="submit"
        disabled={!text.trim() || busy || listening}
        aria-label="Send"
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-arc text-white transition hover:bg-arc/85 disabled:bg-white/[0.06] disabled:text-faint"
      >
        <ArrowUp className="size-4" />
      </button>
    </form>
  );
}
