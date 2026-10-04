import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { createMiddleware } from 'hono/factory';

export type Env = { Variables: { db: SupabaseClient; user: User } };

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
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return c.json({ error: 'Your session has expired. Please sign in again.' }, 401);
  c.set('db', db);
  c.set('user', data.user);
  await next();
});
