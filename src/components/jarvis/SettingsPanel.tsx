import { Lock, LogOut, Volume2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { Settings } from '../../../shared/types';
import type { ServerConfig } from '../../hooks/useSettings';
import { supabase } from '../../lib/supabase';
import { voice } from '../../lib/voice';
import { MicTest } from './MicTest';
import { createSpeaker, naturalVoiceStatus } from '../../lib/speech';
import { ProviderSelector } from './ProviderSelector';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="glass space-y-4 p-5">
      <h3 className="hud-label">{title}</h3>
      {children}
    </section>
  );
}

function Toggle({ label, hint, checked, onChange, locked }: { label: string; hint?: string; checked: boolean; onChange?: (v: boolean) => void; locked?: boolean }) {
  return (
    <label className={`flex items-center gap-4 ${locked ? 'opacity-70' : 'cursor-pointer'}`}>
      <div className="flex-1">
        <div className="flex items-center gap-1.5 text-sm text-white/90">{label}{locked && <Lock className="size-3 text-faint" />}</div>
        {hint && <div className="text-xs text-faint">{hint}</div>}
      </div>
      <input type="checkbox" className="peer sr-only" checked={checked} disabled={locked} onChange={(e) => onChange?.(e.target.checked)} />
      <span className="relative h-6 w-10 rounded-full bg-white/10 transition peer-checked:bg-arc peer-focus-visible:ring-2 peer-focus-visible:ring-glow after:absolute after:top-1 after:left-1 after:size-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4" />
    </label>
  );
}

interface Props {
  settings: Settings;
  update: (patch: (s: Settings) => Settings) => void;
  config: ServerConfig | null;
  email: string;
  displayName: string;
  onDisplayName: (name: string) => void;
  onActivityCleared: () => void;
}

export function SettingsPanel({ settings, update, config, email, displayName, onDisplayName, onActivityCleared }: Props) {
  const [voices, setVoices] = useState<string[]>(voice.voices());
  useEffect(() => {
    if (!voice.supportsOutput) return;
    const load = () => setVoices(voice.voices());
    speechSynthesis.addEventListener('voiceschanged', load);
    return () => speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  const natural = settings.voice.output === 'natural' && Boolean(config?.tts);
  const [voiceError, setVoiceError] = useState('');
  const testVoice = () => {
    const speaker = createSpeaker({ natural, naturalVoice: settings.voice.naturalVoice, browserVoice: settings.voice.voiceName, rate: settings.voice.rate });
    speaker.enqueue('Good evening. All systems are operational.');
    speaker.done().then(() => setVoiceError(naturalVoiceStatus.error));
  };

  const clearActivity = async () => {
    if (!confirm('Delete your entire activity history? This cannot be undone.')) return;
    await supabase.from('activity_logs').delete().gte('created_at', '1970-01-01');
    onActivityCleared();
  };

  const select = 'rounded-lg border border-line bg-black/30 px-3 py-2 text-sm text-white focus:border-glow/50 focus:outline-none';

  return (
    <div className="space-y-4">
      <Section title="You">
        <label className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-white/90">
          <span className="min-w-40 flex-1">Your name <span className="block text-xs text-faint">How JARVIS greets and addresses you</span></span>
          <input
            className={`${select} w-full sm:w-48`}
            defaultValue={displayName}
            maxLength={60}
            placeholder="e.g. Leou"
            onBlur={(e) => e.target.value !== displayName && onDisplayName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            aria-label="Your name"
          />
        </label>
      </Section>

      <Section title="AI provider">
        <ProviderSelector config={config} value={settings.provider} onChange={(provider) => update((s) => ({ ...s, provider }))} />
        <p className="text-xs text-faint">If the chosen provider fails, JARVIS tries the configured fallbacks (AI_FALLBACK) and tells you.</p>
      </Section>

      <Section title="Voice">
        <Toggle label="Speak responses" hint="JARVIS starts talking after the first sentence, while the rest is still being written" checked={settings.voice.speak} onChange={(speak) => update((s) => ({ ...s, voice: { ...s.voice, speak } }))} />
        <Toggle
          label="Keep listening after I reply"
          hint="After answering something you said, JARVIS listens for a follow-up. Stays quiet if you don't speak."
          checked={settings.voice.followUp}
          onChange={(followUp) => update((s) => ({ ...s, voice: { ...s.voice, followUp } }))}
        />
        <label className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-white/90">
          <span className="min-w-40 flex-1">
            Pause before JARVIS replies
            <span className="block text-xs text-faint">How long you can pause mid-sentence before JARVIS takes its turn.</span>
          </span>
          <select className={`${select} w-full sm:w-56`} value={settings.voice.turnPause} onChange={(e) => update((s) => ({ ...s, voice: { ...s.voice, turnPause: e.target.value as 'short' | 'normal' | 'long' } }))} aria-label="Pause before reply">
            <option value="short">Short (0.8 s)</option>
            <option value="normal">Normal (1.3 s)</option>
            <option value="long">Long (2 s) — I think while I talk</option>
          </select>
        </label>
        <Toggle
          label="Interrupt by talking"
          hint="Start speaking while JARVIS talks and it stops to listen. Works best with headphones; needs the Whisper speech engine."
          checked={settings.voice.bargeIn}
          onChange={(bargeIn) => update((s) => ({ ...s, voice: { ...s.voice, bargeIn } }))}
        />
        <Toggle
          label="Wake word: “Jarvis”"
          hint="Hands-free while this tab is open, e.g. “Jarvis, open VS Code”. The browser keeps the microphone on and its speech service (Google in Chrome) processes audio continuously."
          checked={settings.voice.wakeWord}
          onChange={(wakeWord) => update((s) => ({ ...s, voice: { ...s.voice, wakeWord } }))}
        />
        <div className="flex flex-wrap items-center gap-3">
          <select
            className={select}
            value={natural ? 'natural' : 'browser'}
            disabled={!config?.tts}
            onChange={(e) => update((s) => ({ ...s, voice: { ...s.voice, output: e.target.value as 'natural' | 'browser' } }))}
            aria-label="Voice engine"
          >
            <option value="natural">Natural (Orpheus)</option>
            <option value="browser">Browser built-in</option>
          </select>
          {natural ? (
            <>
              <input
                className={`${select} w-32`}
                list="orpheus-voices"
                defaultValue={settings.voice.naturalVoice}
                onBlur={(e) => update((s) => ({ ...s, voice: { ...s.voice, naturalVoice: e.target.value.trim().toLowerCase() || 'troy' } }))}
                aria-label="Natural voice name"
              />
              <datalist id="orpheus-voices">
                {['troy', 'hannah', 'austin', 'autumn', 'diana', 'daniel'].map((v) => <option key={v} value={v} />)}
              </datalist>
            </>
          ) : (
            <select className={`${select} min-w-0 flex-1`} value={settings.voice.voiceName} onChange={(e) => update((s) => ({ ...s, voice: { ...s.voice, voiceName: e.target.value } }))} aria-label="Voice">
              <option value="">System default voice</option>
              {voices.map((v) => <option key={v}>{v}</option>)}
            </select>
          )}
          <label className="flex items-center gap-2 text-sm text-dim">
            Rate
            <input type="range" min={0.7} max={1.4} step={0.05} value={settings.voice.rate} onChange={(e) => update((s) => ({ ...s, voice: { ...s.voice, rate: Number(e.target.value) } }))} className="accent-glow" />
            <span className="w-8 font-mono text-xs tabular-nums">{settings.voice.rate.toFixed(2)}</span>
          </label>
          <button onClick={testVoice} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-white/80 ring-1 ring-line hover:bg-white/5">
            <Volume2 className="size-4" /> Test
          </button>
        </div>
        {natural && voiceError && <p className="text-xs text-warn">{voiceError} Until then JARVIS uses the browser voice.</p>}
        <label className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-white/90">
          <span className="min-w-40 flex-1">
            Speech engine
            <span className="block text-xs text-faint">
              Whisper is far more accurate with accents and knows your project names from memory. {config?.stt ? '' : 'Needs GROQ_API_KEY on the server.'}
            </span>
          </span>
          <select
            className={`${select} w-full sm:w-56`}
            value={config?.stt ? settings.voice.engine : 'browser'}
            disabled={!config?.stt}
            onChange={(e) => update((s) => ({ ...s, voice: { ...s.voice, engine: e.target.value as 'whisper' | 'browser' } }))}
            aria-label="Speech engine"
          >
            <option value="whisper">Whisper (Groq)</option>
            <option value="browser">Browser built-in</option>
          </select>
        </label>
        <label className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-white/90">
          <span className="min-w-40 flex-1">
            Speech recognition language
            <span className="block text-xs text-faint">Match your accent. English (Philippines) often hears Filipino-accented English better.</span>
          </span>
          <select className={`${select} w-full sm:w-56`} value={settings.voice.lang} onChange={(e) => update((s) => ({ ...s, voice: { ...s.voice, lang: e.target.value } }))} aria-label="Speech recognition language">
            <option value="">Browser default ({typeof navigator === 'undefined' ? '' : navigator.language})</option>
            <option value="en-PH">English (Philippines)</option>
            <option value="en-US">English (US)</option>
            <option value="en-GB">English (UK)</option>
            <option value="en-AU">English (Australia)</option>
            <option value="en-IN">English (India)</option>
            <option value="fil-PH">Filipino</option>
          </select>
        </label>
        <MicTest lang={settings.voice.lang} whisper={Boolean(config?.stt)} />
        {!voice.supportsInput && <p className="text-xs text-warn">This browser has no speech recognition. Voice input works in Chrome and Safari.</p>}
      </Section>

      <Section title="Memory">
        <Toggle
          label="Recall relevant memories automatically"
          hint={`Adds the most relevant saved memories to each request${config?.embeddings ? ' (semantic search on)' : ' (keyword search; add GEMINI_API_KEY for semantic search)'}`}
          checked={settings.memory.autoRecall}
          onChange={(autoRecall) => update((s) => ({ ...s, memory: { autoRecall } }))}
        />
        <p className="text-xs text-faint">JARVIS only saves a memory when you explicitly ask, and refuses passwords, keys and tokens.</p>
      </Section>

      <Section title="Require approval before">
        <Toggle label="Publishing social posts" checked locked hint="Always required" />
        <Toggle label="Sending messages" checked locked hint="Always required" />
        <Toggle label="Creating or modifying files" checked={settings.approvals.files} onChange={(files) => update((s) => ({ ...s, approvals: { ...s.approvals, files } }))} />
        <Toggle
          label="Running terminal commands"
          hint="When off, only read-only commands (pwd, ls, git status…) skip the prompt. Anything else always asks; destructive commands are blocked."
          checked={settings.approvals.terminal}
          onChange={(terminal) => update((s) => ({ ...s, approvals: { ...s.approvals, terminal } }))}
        />
      </Section>

      <Section title="Social">
        <label className="flex items-center gap-4 text-sm text-white/90">
          <span className="flex-1">Default platform</span>
          <select className={select} value={settings.social.defaultPlatform} onChange={(e) => update((s) => ({ ...s, social: { defaultPlatform: e.target.value } }))}>
            <option value="facebook">Facebook</option>
          </select>
        </label>
      </Section>

      <Section title="Activity history & account">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex-1 text-sm text-dim">{email}</span>
          <button onClick={clearActivity} className="rounded-lg px-3 py-2 text-sm text-dim ring-1 ring-line hover:text-danger">Clear activity</button>
          <button onClick={() => supabase.auth.signOut()} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-white/80 ring-1 ring-line hover:bg-white/5">
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      </Section>
    </div>
  );
}
