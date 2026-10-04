import { CheckCircle2, Cpu, GitBranch, Loader2, Share2 } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { ServerConfig } from '../../hooks/useSettings';
import { agentRequest, agentSettings, type AgentHealth } from '../../lib/agent';
import { api } from '../../lib/api';
import { supabase } from '../../lib/supabase';

const field = 'w-full rounded-lg border border-line bg-black/30 px-3 py-2 text-sm text-white placeholder:text-faint focus:border-glow/50 focus:outline-none';

function Card({ icon, title, status, children }: { icon: ReactNode; title: string; status: ReactNode; children: ReactNode }) {
  return (
    <section className="glass p-5">
      <header className="mb-4 flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-lg bg-white/[0.05] text-glow">{icon}</span>
        <h3 className="flex-1 font-medium text-white">{title}</h3>
        {status}
      </header>
      {children}
    </section>
  );
}

const Badge = ({ ok, children }: { ok: boolean; children: ReactNode }) => (
  <span className={`rounded-full px-2.5 py-0.5 text-[11px] ring-1 ${ok ? 'bg-ok/10 text-ok ring-ok/25' : 'bg-white/5 text-dim ring-line'}`}>{children}</span>
);

function MacAgent({ health, onChange }: { health: AgentHealth | 'checking'; onChange: () => void }) {
  const [url, setUrl] = useState(agentSettings.url);
  const [token, setToken] = useState(agentSettings.token);
  const [cfg, setCfg] = useState<{ allowedDirectories: { path: string; exists: boolean }[]; allowedApps: string[] } | null>(null);

  useEffect(() => {
    if (health === 'online') agentRequest('/config').then((c) => c.ok && setCfg(c)).catch(() => setCfg(null));
  }, [health]);

  const save = (e: FormEvent) => {
    e.preventDefault();
    agentSettings.save(url, token);
    onChange();
  };

  const label = { online: 'Connected', unauthorized: 'Wrong token', offline: 'Offline', checking: 'Checking…' }[health];
  return (
    <Card icon={<Cpu className="size-4" />} title="Mac agent" status={<Badge ok={health === 'online'}>{label}</Badge>}>
      <p className="mb-3 text-sm text-dim">
        Run <code className="font-mono text-glow">npm run agent</code> on your Mac and paste the token it prints. The token stays in this browser.
      </p>
      <form onSubmit={save} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input className={field} value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Agent URL" />
        <input className={field} type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Agent token" aria-label="Agent token" />
        <button className="rounded-lg bg-arc px-4 py-2 text-sm font-medium text-white hover:bg-arc/85">Save & test</button>
      </form>
      {cfg && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <div className="hud-label mb-1.5">Allowed directories</div>
            <ul className="space-y-1 font-mono text-xs">
              {cfg.allowedDirectories.map((d) => (
                <li key={d.path} className={d.exists ? 'text-white/80' : 'text-faint line-through'} title={d.exists ? '' : 'Not found on this Mac'}>{d.path}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="hud-label mb-1.5">Allowed apps</div>
            <p className="text-xs leading-relaxed text-white/70">{cfg.allowedApps.join(' · ')}</p>
          </div>
          <p className="text-[11px] text-faint sm:col-span-2">Edit local-agent/config/agent.config.json to change these, then restart the agent.</p>
        </div>
      )}
    </Card>
  );
}

function FacebookConnection({ encryption }: { encryption: boolean }) {
  const [account, setAccount] = useState<{ id: string; account_name: string } | null | undefined>(undefined);
  const [pageId, setPageId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => supabase.from('connected_accounts').select('id, account_name').eq('provider', 'facebook').maybeSingle().then(({ data }) => setAccount(data));
  useEffect(() => void load(), []);

  const connect = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/accounts/facebook', { method: 'POST', body: JSON.stringify({ pageId: pageId.trim(), accessToken: accessToken.trim() }) });
      setAccessToken('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  };

  const disconnect = async () => {
    if (!account) return;
    await supabase.from('connected_accounts').delete().eq('id', account.id);
    setAccount(null);
  };

  return (
    <Card icon={<Share2 className="size-4" />} title="Facebook Page" status={<Badge ok={!!account}>{account ? 'Connected' : 'Not connected'}</Badge>}>
      {account ? (
        <div className="flex items-center gap-3 text-sm">
          <CheckCircle2 className="size-4 text-ok" />
          <span className="flex-1 text-white/90">{account.account_name}</span>
          <button onClick={disconnect} className="rounded-lg px-3 py-1.5 text-dim ring-1 ring-line hover:text-danger">Disconnect</button>
        </div>
      ) : (
        <form onSubmit={connect} className="space-y-2">
          <p className="text-sm text-dim">
            Uses the official Graph API with a Page access token (<code className="font-mono text-xs">pages_manage_posts</code>). Get one from the{' '}
            <a className="text-glow underline underline-offset-2" href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer">Graph API Explorer</a>.
            It's encrypted on the server before storage.
          </p>
          {!encryption && <p className="text-xs text-warn">The server has no TOKEN_ENCRYPTION_KEY yet, so connecting is disabled.</p>}
          <div className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
            <input className={field} value={pageId} onChange={(e) => setPageId(e.target.value)} placeholder="Page ID" inputMode="numeric" aria-label="Facebook Page ID" />
            <input className={field} type="password" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} placeholder="Page access token" aria-label="Page access token" />
            <button disabled={busy || !encryption || !pageId || !accessToken} className="flex items-center justify-center gap-2 rounded-lg bg-arc px-4 py-2 text-sm font-medium text-white hover:bg-arc/85 disabled:opacity-40">
              {busy && <Loader2 className="size-3.5 animate-spin" />}Connect
            </button>
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
        </form>
      )}
    </Card>
  );
}

export function ConnectionManager({ health, config, onAgentChange }: { health: AgentHealth | 'checking'; config: ServerConfig | null; onAgentChange: () => void }) {
  return (
    <div className="space-y-4">
      <MacAgent health={health} onChange={onAgentChange} />
      <FacebookConnection encryption={!!config?.encryption} />
      <Card
        icon={<GitBranch className="size-4" />}
        title="GitHub (read-only)"
        status={<Badge ok={!!(config?.github.token || config?.github.username)}>{config?.github.token ? 'Token' : config?.github.username ? 'Public' : 'Not set'}</Badge>}
      >
        <p className="text-sm text-dim">
          {config?.github.username ? `Account: ${config.github.username}. ` : ''}Set <code className="font-mono text-xs">GITHUB_USERNAME</code> and optionally a read-only{' '}
          <code className="font-mono text-xs">GITHUB_TOKEN</code> in the server .env.
        </p>
      </Card>
      <p className="px-1 text-xs text-faint">Instagram, X, LinkedIn and TikTok plug into the same SocialProvider interface and aren't implemented yet.</p>
    </div>
  );
}
