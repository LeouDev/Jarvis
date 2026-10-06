// Types shared by the browser and the server.
import type { Permission } from './policy.js';

export interface Settings {
  /** Preferred AI provider id; empty = server default (AI_PROVIDER). */
  provider: string;
  /** followUp: keep listening briefly after a spoken reply. wakeWord: always listen for "Jarvis" while open. */
  /** engine: 'whisper' (server, more accurate, knows your project names) or 'browser' (Chrome/Safari built-in). */
  /** output: 'natural' (Orpheus on Groq) or 'browser' speechSynthesis; naturalVoice: Orpheus voice name. */
  /** turnPause: silence that ends your turn. bargeIn: talking over JARVIS interrupts it. */
  voice: { speak: boolean; voiceName: string; rate: number; followUp: boolean; wakeWord: boolean; lang: string; engine: 'whisper' | 'browser'; output: 'natural' | 'browser'; naturalVoice: string; turnPause: 'short' | 'normal' | 'long'; bargeIn: boolean };
  /** suggest: propose memories from conversation for the user to keep or dismiss. */
  memory: { autoRecall: boolean; suggest: boolean };
  /** Posting and sending messages always require approval; these three are user-adjustable. */
  approvals: { files: boolean; terminal: boolean; browser: boolean };
  social: { defaultPlatform: string };
}

export const DEFAULT_SETTINGS: Settings = {
  provider: '',
  voice: { speak: true, voiceName: '', rate: 1, followUp: true, wakeWord: false, lang: '', engine: 'whisper', output: 'natural', naturalVoice: 'troy', turnPause: 'normal', bargeIn: true }, // lang '' = browser language
  memory: { autoRecall: true, suggest: true },
  approvals: { files: true, terminal: true, browser: true },
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
  /** Why approval is needed, when it isn't obvious from the tool. */
  reason?: string;
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
  /** `image`: a screenshot (data URL) for lookAtScreen; the server turns it into text and never stores it. */
  result?: { ok: boolean; output: string; image?: string };
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
