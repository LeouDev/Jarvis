// Browser → local Mac agent (http://localhost:3847). The browser can reach localhost even when
// the web app is deployed on Vercel; the agent authenticates every call with its own token.

const URL_KEY = 'jarvis.agent.url';
const TOKEN_KEY = 'jarvis.agent.token';

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};

export const agentSettings = {
  get url() {
    return (read(URL_KEY) || import.meta.env.JARVIS_LOCAL_AGENT_URL || 'http://localhost:3847').replace(/\/$/, '');
  },
  get token() {
    return read(TOKEN_KEY) ?? '';
  },
  save(url: string, token: string) {
    try {
      localStorage.setItem(URL_KEY, url.trim());
      localStorage.setItem(TOKEN_KEY, token.trim());
    } catch {
      /* storage unavailable: settings last for this page only */
    }
  },
};

export const AGENT_OFFLINE = "I can't control your Mac because the JARVIS local agent isn't running. Start it with `npm run agent`.";

/** GET without a body, POST with one. */
export async function agentRequest<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${agentSettings.url}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${agentSettings.token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  // An agent started before a skill was added answers its route with a plain-text 404.
  if (res.status === 404) return { ok: false, error: 'Your Mac agent is out of date. Restart it with npm run agent.' } as T;
  return res.json();
}

export type AgentHealth = 'offline' | 'unauthorized' | 'online';

export async function agentHealth(): Promise<AgentHealth> {
  try {
    const h = await agentRequest<{ authenticated: boolean }>('/health');
    return h.authenticated ? 'online' : 'unauthorized';
  } catch {
    return 'offline';
  }
}

const ENDPOINTS: Record<string, string> = {
  openApplication: '/open-app',
  openWebsite: '/open-url',
  runTerminal: '/terminal',
  readFile: '/file/read',
  createFile: '/file/write',
  searchFiles: '/file/search',
  systemStatus: '/system/status',
  openProject: '/open-project',
  mediaControl: '/media',
  setVolume: '/volume',
  createReminder: '/reminders',
  createNote: '/notes',
  createCalendarEvent: '/calendar',
  lookAtScreen: '/screenshot',
  clipboard: '/clipboard',
};

/** Executes an agent tool. `confirmed` tells the agent the user approved it in the dialog. */
export async function runAgentTool(tool: string, input: Record<string, unknown>, confirmed: boolean): Promise<{ ok: boolean; output: string; image?: string }> {
  const path = ENDPOINTS[tool];
  if (!path) return { ok: false, output: `The Mac agent doesn't support ${tool}.` };
  try {
    const res = await agentRequest<{ ok: boolean; output?: string; error?: string; image?: string }>(path, { ...input, confirmed });
    return res.ok ? { ok: true, output: res.output ?? 'Done.', image: res.image } : { ok: false, output: res.error ?? 'The Mac agent refused.' };
  } catch {
    return { ok: false, output: AGENT_OFFLINE };
  }
}
