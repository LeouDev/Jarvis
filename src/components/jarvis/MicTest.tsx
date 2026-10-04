import { Loader2, Mic } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { transcribeAudio } from '../../lib/api';
import { micLevel, recordSample } from '../../lib/whisper';

interface Result { url: string; device: string; inputRate: number; seconds: number; peak: number; heard?: string; error?: string }

/** Records 4 s through the same pipeline as voice commands, then plays it back and shows what Whisper heard. */
export function MicTest({ lang, whisper }: { lang: string; whisper: boolean }) {
  const [phase, setPhase] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const [result, setResult] = useState<Result | null>(null);
  const [level, setLevel] = useState(0);
  const raf = useRef(0);

  useEffect(() => {
    if (phase !== 'recording') return;
    const tick = () => {
      setLevel(micLevel.value);
      raf.current = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf.current);
  }, [phase]);

  useEffect(() => () => void (result && URL.revokeObjectURL(result.url)), [result]);

  const run = async () => {
    setResult(null);
    setPhase('recording');
    try {
      const s = await recordSample(4000);
      const r: Result = { url: URL.createObjectURL(s.wav), device: s.device, inputRate: s.inputRate, seconds: s.seconds, peak: s.peak };
      setResult(r);
      if (whisper) {
        setPhase('transcribing');
        r.heard = await transcribeAudio(s.wav, lang).catch((e: Error) => ((r.error = e.message), ''));
        setResult({ ...r });
      }
    } catch (e) {
      setResult({ url: '', device: '', inputRate: 0, seconds: 0, peak: 0, error: (e as Error).message });
    }
    setPhase('idle');
  };

  return (
    <div className="space-y-3 rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={run} disabled={phase !== 'idle'} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-white/85 ring-1 ring-line hover:bg-white/5 disabled:opacity-60">
          {phase === 'idle' ? <Mic className="size-4" /> : <Loader2 className="size-4 animate-spin" />}
          {phase === 'recording' ? 'Recording — say “Hey Jarvis, open VS Code”' : phase === 'transcribing' ? 'Transcribing…' : 'Test microphone'}
        </button>
        {phase === 'recording' && (
          <div className="h-2 w-40 overflow-hidden rounded-full bg-white/10" aria-label="Input level">
            <div className="h-full bg-glow transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
          </div>
        )}
      </div>
      {result && (
        <div className="space-y-2 text-xs text-dim">
          {result.device && (
            <p>
              Device: <span className="text-white/85">{result.device || 'unknown'}</span> · {result.inputRate} Hz · {result.seconds.toFixed(1)} s · peak{' '}
              <span className={result.peak < 0.02 ? 'text-danger' : 'text-ok'}>{result.peak.toFixed(2)}</span>
              {result.peak < 0.02 && ' — almost silent: wrong or muted microphone'}
            </p>
          )}
          {result.url && <audio controls src={result.url} className="h-8 w-full max-w-sm" />}
          {result.heard !== undefined && !result.error && <p>Whisper heard: <span className="text-white/90">“{result.heard || '(nothing)'}”</span></p>}
          {result.error && <p className="text-danger">{result.error}</p>}
        </div>
      )}
    </div>
  );
}
