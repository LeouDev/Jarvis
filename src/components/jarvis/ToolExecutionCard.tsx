import { Ban, CheckCircle2, CircleDashed, Loader2, ShieldAlert, XCircle } from 'lucide-react';
import type { ToolExecutionView } from '../../../shared/types';

const STATUS = {
  pending: { icon: CircleDashed, color: 'text-dim', label: 'Awaiting approval' },
  running: { icon: Loader2, color: 'text-glow', label: 'Running' },
  succeeded: { icon: CheckCircle2, color: 'text-ok', label: 'Done' },
  failed: { icon: XCircle, color: 'text-danger', label: 'Failed' },
  rejected: { icon: Ban, color: 'text-dim', label: 'Cancelled' },
  blocked: { icon: ShieldAlert, color: 'text-warn', label: 'Blocked' },
} as const;

export function ToolExecutionCard({ execution: e, compact }: { execution: ToolExecutionView; compact?: boolean }) {
  const s = STATUS[e.status];
  const Icon = s.icon;
  return (
    <div className="glass overflow-hidden !rounded-xl text-sm">
      <div className="flex items-center gap-3 px-3.5 py-2.5">
        <Icon className={`size-4 shrink-0 ${s.color} ${e.status === 'running' ? 'animate-spin' : ''}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="truncate text-white/85">{e.summary}</div>
          {!compact && <div className="font-mono text-[11px] text-faint">{e.tool}</div>}
        </div>
        <span className={`hud-label !tracking-[0.12em] ${s.color}`}>{s.label}</span>
      </div>
      {e.output && !compact && (
        <details className="group border-t border-line">
          <summary className="cursor-pointer select-none px-3.5 py-1.5 text-[11px] text-faint hover:text-dim">Output</summary>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words px-3.5 pb-3 font-mono text-xs text-white/70">{e.output}</pre>
        </details>
      )}
    </div>
  );
}
