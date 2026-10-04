import { Loader2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { JarvisOrb } from '../components/jarvis/JarvisOrb';
import { supabase, supabaseConfigured } from '../lib/supabase';

const field = 'w-full rounded-xl border border-line bg-black/30 px-4 py-3 text-[15px] text-white placeholder:text-faint focus:border-glow/50 focus:outline-none';

export default function Login() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [googleEnabled, setGoogleEnabled] = useState(false);

  // Only offer Google when it's enabled in Supabase (otherwise the redirect lands on a raw error page).
  useEffect(() => {
    if (!supabaseConfigured) return;
    fetch(`${import.meta.env.SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: import.meta.env.SUPABASE_ANON_KEY } })
      .then((r) => r.json())
      .then((s) => setGoogleEnabled(Boolean(s.external?.google)))
      .catch(() => setGoogleEnabled(false));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const { data, error } =
      mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
    if (error) setMessage({ text: error.message, error: true });
    else if (mode === 'signup' && !data.session) setMessage({ text: 'Check your email to confirm your account, then sign in.' });
    setBusy(false);
  };

  const google = async () => {
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
    if (error) setMessage({ text: `Google sign-in isn't available: ${error.message}`, error: true });
  };

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-6">
          <JarvisOrb state="idle" size={120} />
          <h1 className="pl-[0.6em] text-xl font-light tracking-[0.6em] text-white">JARVIS</h1>
        </div>
        {!supabaseConfigured ? (
          <div className="glass p-6 text-sm text-dim">
            Add <code className="text-glow">SUPABASE_URL</code> and <code className="text-glow">SUPABASE_ANON_KEY</code> to <code>.env</code> and restart <code>npm run dev</code>. See the README.
          </div>
        ) : (
          <form onSubmit={submit} className="glass space-y-3 p-6">
            <input className={field} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" aria-label="Email" />
            <input className={field} type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" aria-label="Password" />
            <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-arc py-3 text-[15px] font-medium text-white transition hover:bg-arc/85 disabled:opacity-50">
              {busy && <Loader2 className="size-4 animate-spin" />}
              {mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
            {googleEnabled && (
              <button type="button" onClick={google} className="w-full rounded-xl py-3 text-[15px] text-white/85 ring-1 ring-line transition hover:bg-white/5">
                Continue with Google
              </button>
            )}
            {message && <p className={`text-sm ${message.error ? 'text-danger' : 'text-ok'}`}>{message.text}</p>}
            <p className="pt-1 text-center text-sm text-faint">
              {mode === 'signin' ? 'New here? ' : 'Have an account? '}
              <button type="button" className="text-glow hover:underline" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
                {mode === 'signin' ? 'Create an account' : 'Sign in'}
              </button>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
