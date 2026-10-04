import type { ServerConfig } from '../../hooks/useSettings';

/** Lists providers the server knows about; only those with an API key on the server can be chosen. */
export function ProviderSelector({ config, value, onChange }: { config: ServerConfig | null; value: string; onChange: (id: string) => void }) {
  if (!config) return <p className="text-sm text-faint">Server configuration unavailable.</p>;
  const options = [{ id: '', label: 'Server default', model: config.providers.find((p) => p.default)?.label ?? 'AI_PROVIDER', configured: true }, ...config.providers];
  return (
    <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="AI provider">
      {options.map((p) => (
        <button
          key={p.id || 'default'}
          role="radio"
          aria-checked={value === p.id}
          disabled={!p.configured}
          onClick={() => onChange(p.id)}
          className={`rounded-xl border px-4 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${
            value === p.id ? 'border-glow/60 bg-glow/[0.07]' : 'border-line hover:bg-white/[0.03]'
          }`}
        >
          <div className="text-sm text-white">{p.label}</div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-faint">{p.configured ? p.model : 'no API key on server'}</div>
        </button>
      ))}
    </div>
  );
}
