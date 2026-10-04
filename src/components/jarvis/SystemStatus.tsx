import type { AgentMetrics } from '../../hooks/useAgent';
import type { AgentHealth } from '../../lib/agent';

const HINT: Record<string, string> = {
  checking: 'Connecting to Mac agent…',
  offline: 'Mac agent offline · run npm run agent',
  unauthorized: 'Mac agent running · add its token in Accounts',
};

export function SystemStatus({ health, metrics }: { health: AgentHealth | 'checking'; metrics: AgentMetrics | null }) {
  const items: [string, string, number | null][] = [
    ['CPU', metrics ? `${metrics.cpu}%` : '—', metrics?.cpu ?? null],
    ['Memory', metrics?.memory != null ? `${metrics.memory}%` : '—', metrics?.memory ?? null],
    ['Network', metrics?.networkMs != null ? `${metrics.networkMs}ms` : metrics ? 'offline' : '—', null],
  ];
  return (
    <div className="w-full max-w-sm">
      <div className="grid grid-cols-3 gap-6 text-center">
        {items.map(([label, value, pct]) => (
          <div key={label}>
            <div className="hud-label">{label}</div>
            <div className="mt-1 text-lg font-light tabular-nums text-white/90">{value}</div>
            <div className="mx-auto mt-1.5 h-px w-12 bg-white/10">
              <div className="h-px bg-glow transition-all duration-700" style={{ width: `${pct ?? (metrics ? 100 : 0)}%`, opacity: pct === null ? 0.4 : 1 }} />
            </div>
          </div>
        ))}
      </div>
      {health !== 'online' && <p className="mt-3 text-center text-[11px] text-faint">{HINT[health]}</p>}
    </div>
  );
}
