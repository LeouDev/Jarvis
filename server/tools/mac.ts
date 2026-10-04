import { z } from 'zod';
import { classifyCommand } from '../../shared/policy.js';
import type { JarvisTool } from './types.js';

// Executed by the browser through the local Mac agent, which re-validates everything itself.

export const openApplication: JarvisTool<{ app: string }> = {
  name: 'openApplication', group: 'mac', permission: 'write', runOn: 'agent',
  description: 'Open a macOS application from the allowlist (e.g. "Visual Studio Code", "Safari", "Terminal").',
  schema: z.object({ app: z.string().min(1).max(80) }),
  summary: (i) => `Open ${i.app}`,
};

export const openWebsite: JarvisTool<{ url: string }> = {
  name: 'openWebsite', group: 'mac', permission: 'write', runOn: 'agent',
  description: "Open a website in the user's default browser.",
  schema: z.object({ url: z.url({ protocol: /^https?$/ }) }),
  summary: (i) => `Open ${i.url}`,
};

export const runTerminal: JarvisTool<{ command: string; cwd?: string }> = {
  name: 'runTerminal', group: 'mac', permission: 'dangerous', runOn: 'agent',
  description:
    'Run ONE terminal command on the Mac (no pipes, chaining or redirection). Read-only commands like pwd, ls, git status are preferred. Destructive commands are blocked.',
  schema: z.object({ command: z.string().min(1).max(500), cwd: z.string().max(500).optional() }),
  summary: (i) => `Run \`${i.command}\``,
  approval({ command }, settings) {
    const v = classifyCommand(command);
    if (v.level === 'blocked') return { decision: 'block', reason: v.reason };
    if (v.level === 'approval') return { decision: 'approve', reason: 'This command can change your system.' };
    return { decision: settings.approvals.terminal ? 'approve' : 'auto' };
  },
};

export const readFile: JarvisTool<{ path: string }> = {
  name: 'readFile', group: 'mac', permission: 'read', runOn: 'agent',
  description: 'Read a text file inside the allowed directories.',
  schema: z.object({ path: z.string().min(1).max(1000) }),
  summary: (i) => `Read ${i.path}`,
};

export const searchFiles: JarvisTool<{ query: string; directory?: string }> = {
  name: 'searchFiles', group: 'mac', permission: 'read', runOn: 'agent',
  description: 'Find files or folders by name inside the allowed directories (Spotlight).',
  schema: z.object({ query: z.string().min(1).max(200), directory: z.string().max(1000).optional() }),
  summary: (i) => `Searched files for "${i.query}"`,
};

export const createFile: JarvisTool<{ path: string; content: string; overwrite?: boolean }> = {
  name: 'createFile', group: 'mac', permission: 'write', runOn: 'agent',
  description: 'Create a text file inside the allowed directories. Set overwrite only if the user asked to replace an existing file.',
  schema: z.object({ path: z.string().min(1).max(1000), content: z.string().max(200_000), overwrite: z.boolean().optional() }),
  summary: (i) => `${i.overwrite ? 'Overwrite' : 'Create'} ${i.path}`,
  approval: (_, settings) => ({ decision: settings.approvals.files ? 'approve' : 'auto' }),
};

export const systemStatus: JarvisTool<{}> = {
  name: 'systemStatus', group: 'mac', permission: 'read', runOn: 'agent',
  description: "Get the Mac's CPU, memory, disk and network status.",
  schema: z.object({}),
  summary: () => 'Checked system status',
};
