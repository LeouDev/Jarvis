import { Bot, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

interface Entry { id: string; actor: 'jarvis' | 'user'; action: string; tool: string | null; status: string; result_summary: string | null; created_at: string }

const COLOR: Record<string, string> = { succeeded: 'text-ok', failed: 'text-danger', blocked: 'text-warn', rejected: 'text-dim', approved: 'text-glow' };

/** Every tool execution and approval, newest first. `version` changes trigger a refresh. */
export function ActivityLog({ version, limit = 100, compact }: { version: number; limit?: number; compact?: boolean }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  useEffect(() => {
    supabase
      .from('activity_logs')
      .select('id, actor, action, tool, status, result_summary, created_at')
      .order('created_at', { ascending: false })
      .limit(limit)
      .then(({ data }) => setEntries(data ?? []));
  }, [version, limit]);

  if (!entries) return <p className="text-sm text-faint">Loading…</p>;
  if (!entries.length) return <p className="text-sm text-faint">No activity yet. Ask JARVIS to do something.</p>;
  return (
    <ol className="space-y-1">
      {entries.map((e) => (
        <li key={e.id} className="flex gap-3 rounded-lg px-2 py-2 hover:bg-white/[0.03]">
          <time className="w-16 shrink-0 pt-0.5 font-mono text-[11px] tabular-nums text-faint">
            {new Date(e.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </time>
          {e.actor === 'jarvis' ? <Bot className="mt-0.5 size-3.5 shrink-0 text-glow" /> : <User className="mt-0.5 size-3.5 shrink-0 text-arc" />}
          <div className="min-w-0 flex-1">
            <div className="hud-label !text-[10px]">{e.actor}</div>
            <div className={`text-sm text-white/85 ${compact ? 'truncate' : ''}`}>{e.action}</div>
            {!compact && e.result_summary && <div className="mt-0.5 line-clamp-2 font-mono text-[11px] text-faint">{e.result_summary}</div>}
          </div>
          <span className={`shrink-0 pt-0.5 text-[11px] ${COLOR[e.status] ?? 'text-dim'}`}>{e.status}</span>
        </li>
      ))}
    </ol>
  );
}
