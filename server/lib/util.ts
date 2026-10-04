import type { SupabaseClient } from '@supabase/supabase-js';
import { looksLikeSecret, redact } from '../../shared/policy.js';
import { mergeSettings, type Settings } from '../../shared/types.js';

/** An error whose message is safe and useful to show the user. */
export class UserFacingError extends Error {}

export const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}… [truncated]` : s);

export async function loadSettings(db: SupabaseClient): Promise<Settings> {
  const { data } = await db.from('preferences').select('settings').maybeSingle();
  return mergeSettings(data?.settings);
}

export interface ActivityEntry {
  actor: 'jarvis' | 'user';
  action: string;
  tool?: string;
  status: string;
  approved?: boolean | null;
  input?: unknown;
  result?: string;
}

/** Records a human-readable activity entry. Inputs/results are redacted; failures never break the request. */
export async function logActivity(db: SupabaseClient, e: ActivityEntry) {
  const { error } = await db.from('activity_logs').insert({
    actor: e.actor,
    action: truncate(e.action, 200),
    tool: e.tool ?? null,
    status: e.status,
    approved: e.approved ?? null,
    input: e.input === undefined ? null : redact(e.input),
    result_summary: e.result === undefined ? null : looksLikeSecret(e.result) ? '[redacted]' : truncate(e.result, 500),
  });
  if (error) console.error('[activity]', error.message);
}
