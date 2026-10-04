import { useEffect, useState } from 'react';
import type { ToolExecutionView } from '../../../shared/types';
import { api } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { ToolExecutionCard } from './ToolExecutionCard';

interface ToolInfo { name: string; description: string; permission: 'read' | 'write' | 'dangerous'; runOn: 'server' | 'agent'; group: string }
interface Task { id: string; title: string; status: 'open' | 'done'; due_at: string | null }

const BADGE = { read: 'text-ok ring-ok/25 bg-ok/10', write: 'text-arc ring-arc/25 bg-arc/10', dangerous: 'text-warn ring-warn/25 bg-warn/10' };

export function ToolsPanel({ version }: { version: number }) {
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [runs, setRuns] = useState<ToolExecutionView[]>([]);

  useEffect(() => {
    api<ToolInfo[]>('/tools').then(setTools).catch(() => setTools([]));
  }, []);
  useEffect(() => {
    supabase.from('tasks').select('id, title, status, due_at').order('status').order('created_at', { ascending: false }).limit(50).then(({ data }) => setTasks(data ?? []));
    supabase
      .from('tool_executions')
      .select('id, tool, summary, status, result')
      .order('created_at', { ascending: false })
      .limit(15)
      .then(({ data }) => setRuns((data ?? []).map((r) => ({ id: r.id, tool: r.tool, summary: r.summary, status: r.status, output: r.result ?? undefined }))));
  }, [version]);

  const toggle = async (t: Task) => {
    const status = t.status === 'done' ? 'open' : 'done';
    setTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, status } : x)));
    await supabase.from('tasks').update({ status, updated_at: new Date().toISOString() }).eq('id', t.id);
  };

  const groups = [...new Set(tools.map((t) => t.group))];
  return (
    <div className="space-y-8">
      <section>
        <h2 className="hud-label mb-3">Tasks</h2>
        {tasks.length ? (
          <ul className="glass divide-y divide-line">
            {tasks.map((t) => (
              <li key={t.id}>
                <label className="flex cursor-pointer items-center gap-3 px-4 py-3">
                  <input type="checkbox" checked={t.status === 'done'} onChange={() => toggle(t)} className="size-4 accent-glow" />
                  <span className={`flex-1 text-sm ${t.status === 'done' ? 'text-faint line-through' : 'text-white/90'}`}>{t.title}</span>
                  {t.due_at && <span className="text-[11px] text-faint">{new Date(t.due_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>}
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-faint">No tasks. Try "Remind me to call the bank tomorrow."</p>
        )}
      </section>

      <section>
        <h2 className="hud-label mb-3">Recent executions</h2>
        {runs.length ? <div className="space-y-2">{runs.map((r) => <ToolExecutionCard key={r.id} execution={r} />)}</div> : <p className="text-sm text-faint">Nothing has run yet.</p>}
      </section>

      <section>
        <h2 className="hud-label mb-3">Available tools</h2>
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g}>
              <div className="mb-1.5 text-xs capitalize text-dim">{g}</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {tools.filter((t) => t.group === g).map((t) => (
                  <div key={t.name} className="glass !rounded-xl p-3">
                    <div className="flex items-center gap-2">
                      <span className="flex-1 font-mono text-[13px] text-white/90">{t.name}</span>
                      {t.runOn === 'agent' && <span className="text-[10px] text-faint">MAC</span>}
                      <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase ring-1 ${BADGE[t.permission]}`}>{t.permission}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-dim">{t.description}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
