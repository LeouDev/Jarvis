// Types shared by the browser and the server.
import type { Permission } from './policy.js';

export interface Settings {
  /** Preferred AI provider id; empty = server default (AI_PROVIDER). */
  provider: string;
  voice: { speak: boolean; voiceName: string; rate: number };
  memory: { autoRecall: boolean };
  /** Posting and sending messages always require approval; these two are user-adjustable. */
  approvals: { files: boolean; terminal: boolean };
  social: { defaultPlatform: string };
}

export const DEFAULT_SETTINGS: Settings = {
  provider: '',
  voice: { speak: true, voiceName: '', rate: 1 },
  memory: { autoRecall: true },
  approvals: { files: true, terminal: true },
  social: { defaultPlatform: 'facebook' },
};

export function mergeSettings(stored: Partial<Settings> | null | undefined): Settings {
  const s = stored ?? {};
  return {
    provider: s.provider ?? DEFAULT_SETTINGS.provider,
    voice: { ...DEFAULT_SETTINGS.voice, ...s.voice },
    memory: { ...DEFAULT_SETTINGS.memory, ...s.memory },
    approvals: { ...DEFAULT_SETTINGS.approvals, ...s.approvals },
    social: { ...DEFAULT_SETTINGS.social, ...s.social },
  };
}

export type ExecutionStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'rejected' | 'blocked';

/** A tool call waiting on the browser: approval and/or execution through the local Mac agent. */
export interface PendingAction {
  id: string;
  tool: string;
  summary: string;
  input: Record<string, unknown>;
  permission: Permission;
  runOn: 'server' | 'agent';
  needsApproval: boolean;
}

export interface ToolExecutionView {
  id: string;
  tool: string;
  summary: string;
  status: ExecutionStatus;
  output?: string;
}

/** Browser's answer to a PendingAction. `result` is required for agent actions that were run. */
export interface ActionResolution {
  id: string;
  approved: boolean;
  result?: { ok: boolean; output: string };
}

export type ChatEvent =
  | { type: 'conversation'; id: string }
  | { type: 'text'; delta: string }
  | { type: 'notice'; message: string }
  | { type: 'tool'; execution: ToolExecutionView }
  | { type: 'actions'; actions: PendingAction[] }
  | { type: 'error'; message: string }
  | { type: 'done' };

export interface ChatRequest {
  conversationId?: string;
  message?: string;
  resolutions?: ActionResolution[];
  timezone?: string;
}
