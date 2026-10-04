import type { Session } from '@supabase/supabase-js';
import { Component, useEffect, useState, type ReactNode } from 'react';
import { supabase } from './lib/supabase';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';

/** Keeps a UI bug from blanking the whole app. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-white/90">Something in the interface broke.</p>
        <p className="max-w-md font-mono text-xs text-faint">{this.state.error.message}</p>
        <button onClick={() => location.reload()} className="rounded-full bg-arc px-5 py-2.5 text-sm text-white">Reload</button>
      </main>
    );
  }
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return null;
  return <ErrorBoundary>{session ? <Dashboard session={session} /> : <Login />}</ErrorBoundary>;
}
