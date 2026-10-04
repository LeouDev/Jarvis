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

const EDITORS = ['Visual Studio Code', 'Cursor', 'Xcode', 'Finder', 'Terminal'] as const;
const localTime = z.string().min(8).max(40).describe('Local date-time without timezone, e.g. 2026-10-06T17:00');

export const openProject: JarvisTool<{ path: string; app?: (typeof EDITORS)[number] }> = {
  name: 'openProject', group: 'mac', permission: 'write', runOn: 'agent',
  description:
    "Open a project folder in an editor (VS Code by default), Finder or Terminal. Needs the folder's full path: use a remembered path (searchMemory) or find it with searchFiles first.",
  schema: z.object({ path: z.string().min(1).max(1000), app: z.enum(EDITORS).optional() }),
  summary: (i) => `Open ${i.path.split('/').filter(Boolean).pop() ?? i.path} in ${i.app ?? 'Visual Studio Code'}`,
};

export const mediaControl: JarvisTool<{ action: 'play' | 'pause' | 'toggle' | 'next' | 'previous' | 'status'; app?: 'Spotify' | 'Music' }> = {
  name: 'mediaControl', group: 'macApps', permission: 'write', runOn: 'agent',
  description: "Control music in Spotify or Apple Music: play, pause, toggle, next, previous, or status (what's playing). Without app, uses Spotify if it's open.",
  schema: z.object({ action: z.enum(['play', 'pause', 'toggle', 'next', 'previous', 'status']), app: z.enum(['Spotify', 'Music']).optional() }),
  summary: (i) => (i.action === 'status' ? "Checked what's playing" : `Music: ${i.action}`),
};

export const setVolume: JarvisTool<{ level?: number; mute?: boolean }> = {
  name: 'setVolume', group: 'macApps', permission: 'write', runOn: 'agent',
  description: "Set the Mac's output volume (0–100) and/or mute. Call with no arguments to read the current volume.",
  schema: z.object({ level: z.number().int().min(0).max(100).optional(), mute: z.boolean().optional() }),
  summary: (i) => (i.level !== undefined ? `Set volume to ${i.level}%` : i.mute !== undefined ? (i.mute ? 'Muted the Mac' : 'Unmuted the Mac') : 'Checked the volume'),
};

export const createReminder: JarvisTool<{ title: string; due?: string }> = {
  name: 'createReminder', group: 'macApps', permission: 'write', runOn: 'agent',
  description: "Create a macOS Reminder that alerts the user at the due time. Use this for 'remind me…'.",
  schema: z.object({ title: z.string().min(1).max(300), due: localTime.optional() }),
  summary: (i) => `Reminder: ${i.title}`,
};

export const createNote: JarvisTool<{ title: string; body: string }> = {
  name: 'createNote', group: 'macApps', permission: 'write', runOn: 'agent',
  description: 'Create a note in Apple Notes.',
  schema: z.object({ title: z.string().min(1).max(200), body: z.string().max(20_000) }),
  summary: (i) => `Note: ${i.title}`,
};

export const createCalendarEvent: JarvisTool<{ title: string; start: string; durationMinutes?: number }> = {
  name: 'createCalendarEvent', group: 'macApps', permission: 'write', runOn: 'agent',
  description: 'Add an event to the macOS Calendar (first writable calendar).',
  schema: z.object({ title: z.string().min(1).max(300), start: localTime, durationMinutes: z.number().int().min(5).max(1440).optional() }),
  summary: (i) => `Calendar: ${i.title}`,
};

export const lookAtScreen: JarvisTool<{ question: string }> = {
  name: 'lookAtScreen', group: 'macApps', permission: 'read', runOn: 'agent',
  description: "Take a screenshot of the Mac's main display and answer a question about it (e.g. what's on screen, read an error). Always asks the user first.",
  schema: z.object({ question: z.string().min(1).max(500) }),
  summary: () => 'Look at your screen',
  approval: () => ({ decision: 'approve', reason: 'The screenshot is sent to the AI provider for analysis.' }), // screens hold private info
};

export const clipboard: JarvisTool<{ action: 'read' | 'write'; text?: string }> = {
  name: 'clipboard', group: 'macApps', permission: 'write', runOn: 'agent',
  description: "Read the Mac clipboard text, or copy text to it. Won't read passwords or keys.",
  schema: z.object({ action: z.enum(['read', 'write']), text: z.string().max(100_000).optional() }),
  summary: (i) => (i.action === 'read' ? 'Read the clipboard' : 'Copied text to the clipboard'),
};
