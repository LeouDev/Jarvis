import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { createMiddleware } from 'hono/factory';

export type Env = { Variables: { db: SupabaseClient; user: User } };

/** JARVIS_ALLOWED_EMAILS (comma-separated) keeps strangers who sign up from spending your AI quota. Unset = anyone signed in. */
export function isAllowedEmail(email: string | undefined, allowList = process.env.JARVIS_ALLOWED_EMAILS ?? '') {
  const allowed = allowList.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return !allowed.length || allowed.includes((email ?? '').toLowerCase());
}

// token → user, until the token expires (max 5 min). Saves an auth round trip on every request
// (chat, speech, transcription) when the function instance is reused.
const verified = new Map<string, { user: User; until: number }>();
const tokenExpiry = (token: string) => {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).exp * 1000;
  } catch {
    return 0;
  }
};

/**
 * Verifies the Supabase access token and gives the route a client that acts *as the user*,
 * so Row Level Security applies to every query. The service-role key is never used.
 */
export const requireUser = createMiddleware<Env>(async (c, next) => {
  const token = c.req.header('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return c.json({ error: 'Not signed in.' }, 401);
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return c.json({ error: 'Supabase is not configured on the server.' }, 500);
  const db = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let user = (verified.get(token)?.until ?? 0) > Date.now() ? verified.get(token)!.user : null;
  if (!user) {
    const { data, error } = await db.auth.getUser(token);
    if (error || !data.user) return c.json({ error: 'Your session has expired. Please sign in again.' }, 401);
    user = data.user;
    if (verified.size > 500) verified.clear();
    verified.set(token, { user, until: Math.min(tokenExpiry(token), Date.now() + 5 * 60_000) });
  }
  if (!isAllowedEmail(user.email)) return c.json({ error: 'This JARVIS is private to its owner.' }, 403);
  c.set('db', db);
  c.set('user', user);
  await next();
});
