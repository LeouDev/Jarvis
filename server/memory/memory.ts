import type { SupabaseClient } from '@supabase/supabase-js';
import { looksLikeSecret } from '../../shared/policy.js';
import { UserFacingError } from '../lib/util.js';

export const MEMORY_CATEGORIES = ['personal', 'projects', 'preferences', 'work', 'goals', 'routines', 'technical', 'other'] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export interface Memory { id: string; content: string; category: MemoryCategory; importance: number }

/** 768-dim Gemini embedding, or null when Gemini isn't configured / fails (text search still works). */
export async function embed(text: string): Promise<number[] | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const started = Date.now();
  try {
    const model = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ content: { parts: [{ text }] }, outputDimensionality: 768 }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const values = (await res.json()).embedding?.values ?? null;
    console.log(`[embed] ${Date.now() - started}ms`);
    return values;
  } catch {
    return null;
  }
}

export async function saveMemory(
  db: SupabaseClient,
  m: { content: string; category?: MemoryCategory; importance?: number },
): Promise<Memory> {
  const content = m.content.trim();
  if (!content) throw new UserFacingError('There is nothing to remember.');
  if (looksLikeSecret(content))
    throw new UserFacingError("I can't store passwords, API keys, tokens or other credentials in memory.");
  const { data, error } = await db
    .from('memories')
    .insert({ content, category: m.category ?? 'other', importance: m.importance ?? 3, embedding: await embed(content) })
    .select('id, content, category, importance')
    .single();
  if (error) throw new UserFacingError(`I couldn't save that memory: ${error.message}`);
  return data;
}

/** Hybrid retrieval: vector similarity (when embeddings exist) OR full-text match, best first. */
export async function searchMemories(db: SupabaseClient, query: string, limit = 5): Promise<Memory[]> {
  const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!words.length) return [];
  const { data, error } = await db.rpc('match_memories', {
    query_text: words.join(' or '),
    query_embedding: await embed(query),
    match_count: limit,
  });
  if (error) {
    console.error('[memory] search failed:', error.message);
    return [];
  }
  return data ?? [];
}
