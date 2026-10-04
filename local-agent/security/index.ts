import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { SENSITIVE_PATH } from '../../shared/policy.js';
import { expandHome } from '../config/index.js';

export class AgentError extends Error {
  constructor(public status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 500, message: string) {
    super(message);
  }
}

/** Constant-time bearer token check. */
export function tokenMatches(header: string | undefined, token: string): boolean {
  const given = header?.match(/^Bearer (.+)$/)?.[1];
  if (!given) return false;
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(given), digest(token));
}

/** Rejects DNS-rebinding: only requests addressed to the loopback host are served. */
export const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * Resolves a path (following symlinks) and guarantees it sits inside an allowed directory
 * and isn't a credential file. Works for files that don't exist yet (for writes).
 */
export async function resolveAllowedPath(input: string, allowed: string[], mustExist: boolean): Promise<string> {
  const abs = resolve(expandHome(input));
  if (SENSITIVE_PATH.test(abs)) throw new AgentError(403, 'That file is protected (it may contain credentials).');

  let probe = abs;
  const missing: string[] = [];
  let real: string | null = null;
  while (real === null) {
    try {
      real = await realpath(probe);
    } catch {
      const parent = dirname(probe);
      if (parent === probe) throw new AgentError(404, 'That path does not exist.');
      missing.unshift(basename(probe));
      probe = parent;
    }
  }
  const full = join(real, ...missing);
  const roots = await Promise.all(allowed.filter((d) => existsSync(d)).map((d) => realpath(d)));
  if (!roots.some((r) => full === r || full.startsWith(r + sep)))
    throw new AgentError(403, 'That path is outside the allowed directories. Add it in local-agent/config/agent.config.json.');
  if (SENSITIVE_PATH.test(full)) throw new AgentError(403, 'That file is protected (it may contain credentials).');
  // Existence is only revealed after the containment check, so outside paths can't be probed.
  if (mustExist && missing.length) throw new AgentError(404, 'That file or folder does not exist.');
  return full;
}
