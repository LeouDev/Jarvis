import { createClient } from '@supabase/supabase-js';

export const supabaseConfigured = Boolean(import.meta.env.SUPABASE_URL && import.meta.env.SUPABASE_ANON_KEY);

// Anon key + the user's session: every query is constrained by Row Level Security.
export const supabase = createClient(
  import.meta.env.SUPABASE_URL || 'http://localhost:54321',
  import.meta.env.SUPABASE_ANON_KEY || 'missing-anon-key',
);
