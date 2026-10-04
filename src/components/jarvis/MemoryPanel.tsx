import { Plus, Search } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { MemoryCard, type MemoryRow } from './MemoryCard';

const CATEGORIES = ['personal', 'projects', 'preferences', 'work', 'goals', 'routines', 'technical', 'other'];
const field = 'rounded-lg border border-line bg-black/30 px-3 py-2 text-sm text-white placeholder:text-faint focus:border-glow/50 focus:outline-none';

export function MemoryPanel({ version }: { version: number }) {
  const [memories, setMemories] = useState<MemoryRow[] | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [draft, setDraft] = useState({ content: '', category: 'projects', importance: 3 });
  const [error, setError] = useState('');

  const load = () =>
    supabase
      .from('memories')
      .select('id, content, category, importance, created_at')
      .order('importance', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(500)
      .then(({ data }) => setMemories(data ?? []));
  useEffect(() => void load(), [version]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api('/memories', { method: 'POST', body: JSON.stringify(draft) });
      setDraft((d) => ({ ...d, content: '' }));
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = async (id: string) => {
    await supabase.from('memories').delete().eq('id', id);
    setMemories((ms) => ms?.filter((m) => m.id !== id) ?? null);
  };

  const shown = (memories ?? []).filter((m) => (category === 'all' || m.category === category) && m.content.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="space-y-5">
      <form onSubmit={add} className="glass space-y-3 p-4">
        <div className="hud-label">Teach JARVIS something</div>
        <input className={`${field} w-full`} value={draft.content} maxLength={500} onChange={(e) => setDraft({ ...draft, content: e.target.value })} placeholder="e.g. Dicta is my social quote app" aria-label="Memory" />
        <div className="flex flex-wrap gap-2">
          <select className={field} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} aria-label="Category">
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select className={field} value={draft.importance} onChange={(e) => setDraft({ ...draft, importance: Number(e.target.value) })} aria-label="Importance">
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>Importance {n}</option>)}
          </select>
          <button disabled={!draft.content.trim()} className="ml-auto flex items-center gap-1.5 rounded-lg bg-arc px-4 py-2 text-sm font-medium text-white hover:bg-arc/85 disabled:opacity-40">
            <Plus className="size-4" /> Remember
          </button>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
      </form>

      <div className="flex flex-wrap gap-2">
        <label className="relative min-w-48 flex-1">
          <Search className="absolute top-2.5 left-3 size-4 text-faint" />
          <input className={`${field} w-full pl-9`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search memories" aria-label="Search memories" />
        </label>
        <select className={field} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter category">
          <option value="all">All categories</option>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>

      {memories === null ? (
        <p className="text-sm text-faint">Loading…</p>
      ) : shown.length ? (
        <div className="space-y-2">{shown.map((m) => <MemoryCard key={m.id} memory={m} onDelete={remove} />)}</div>
      ) : (
        <p className="text-sm text-faint">{memories.length ? 'No memories match.' : 'Nothing remembered yet. Say "Remember that…"'}</p>
      )}
    </div>
  );
}
