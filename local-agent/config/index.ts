import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface AgentConfig {
  port: number;
  token: string;
  allowedDirectories: string[];
  allowedApps: string[];
  allowedOrigins: string[];
}

const HERE = dirname(fileURLToPath(import.meta.url));
export const CONFIG_FILE = join(HERE, 'agent.config.json');
const TOKEN_FILE = join(HERE, '..', '.agent-token');

const DEFAULT_APPS = [
  'Visual Studio Code', 'Cursor', 'Xcode', 'Terminal', 'Safari', 'Google Chrome', 'Finder', 'Notes', 'Calendar',
  'Reminders', 'Mail', 'Messages', 'Music', 'Spotify', 'Slack', 'Preview', 'Photos', 'Calculator', 'System Settings',
];

export const expandHome = (p: string) => p.replace(/^~(?=\/|$)/, homedir());

/** Reads local-agent/config/agent.config.json (created with detected defaults on first run) and the agent token. */
export function loadConfig(): AgentConfig {
  if (!existsSync(CONFIG_FILE)) {
    const defaults = {
      allowedDirectories: ['~/Development', '~/Documents', '~/Desktop', '/Volumes/Mac Storage/Development'],
      allowedApps: DEFAULT_APPS,
      allowedOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    };
    writeFileSync(CONFIG_FILE, `${JSON.stringify(defaults, null, 2)}\n`);
  }
  const file = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));

  let token = process.env.JARVIS_AGENT_TOKEN;
  if (!token) {
    if (!existsSync(TOKEN_FILE)) writeFileSync(TOKEN_FILE, randomBytes(24).toString('base64url'), { mode: 0o600 });
    token = readFileSync(TOKEN_FILE, 'utf8').trim();
  }
  return {
    port: Number(process.env.JARVIS_AGENT_PORT) || 3847,
    token,
    allowedDirectories: (file.allowedDirectories ?? []).map((d: string) => resolve(expandHome(d))),
    allowedApps: file.allowedApps ?? DEFAULT_APPS,
    allowedOrigins: file.allowedOrigins ?? [],
  };
}
