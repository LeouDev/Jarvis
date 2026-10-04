import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';
import type { Permission } from '../../shared/policy.js';
import type { Settings } from '../../shared/types.js';

export interface ToolContext { db: SupabaseClient; settings: Settings; timezone: string }
export interface ToolResult { ok: boolean; output: string }

/** auto = run now · approve = ask the user first · block = refuse */
export type ApprovalDecision = { decision: 'auto' | 'approve' | 'block'; reason?: string };

export interface JarvisTool<T = any> {
  name: string;
  description: string;
  permission: Permission;
  /** Intent group used for dynamic tool loading. */
  group: 'memory' | 'time' | 'web' | 'tasks' | 'mac' | 'macApps' | 'github' | 'social';
  /** 'agent' tools are executed by the browser through the local Mac agent (it can reach localhost; Vercel can't). */
  runOn: 'server' | 'agent';
  schema: z.ZodType<T>;
  /** Human-readable one-liner for the activity log and approval dialog. */
  summary(input: T): string;
  /** Overrides the default rule (dangerous → approve, otherwise auto). */
  approval?(input: T, settings: Settings): ApprovalDecision;
  /** Returns text from outside the user's control (web, files, screen…) that could carry injected instructions. */
  untrustedOutput?: boolean;
  execute?(input: T, ctx: ToolContext): Promise<ToolResult>;
}

export const ok = (output: string): ToolResult => ({ ok: true, output });
export const fail = (output: string): ToolResult => ({ ok: false, output });
