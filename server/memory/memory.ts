import type { SupabaseClient } from '@supabase/supabase-js';
import { looksLikeSecret } from '../../shared/policy.js';
import { UserFacingError } from '../lib/util.js';
import { decide, type Complete } from './consolidate.js';

import { MEMORY_CATEGORIES } from './consolidate.js';

export { MEMORY_CATEGORIES };
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

export type SaveOutcome = 'added' | 'updated' | 'replaced' | 'known';

/** Stored memories about the same thing (vector similarity ≥ 0.75), for consolidation. */
export async function similarMemories(db: SupabaseClient, content: string, embedding: number[] | null): Promise<Memory[]> {
  if (!embedding) return [];
  const words = content.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const { data } = await db.rpc('match_memories', { query_text: words.join(' or ') || content, query_embedding: embedding, match_count: 5 });
  return ((data ?? []) as (Memory & { score: number })[]).filter((m) => m.score >= 0.75);
}

const FIELDS = 'id, content, category, importance';

/**
 * Saves an explicitly requested memory, keeping the store current: an existing memory on the same
 * subject is updated or replaced, and an already-known fact is not stored twice.
 */
export async function saveMemory(
  db: SupabaseClient,
  m: { content: string; category?: MemoryCategory; importance?: number },
  complete?: Complete,
): Promise<{ memory: Memory; outcome: SaveOutcome }> {
  const content = m.content.trim();
  if (!content) throw new UserFacingError('There is nothing to remember.');
  if (looksLikeSecret(content))
    throw new UserFacingError("I can't store passwords, API keys, tokens or other credentials in memory.");
  // Models sometimes repeat a saveMemory call; keep one copy of each fact.
  const { data: same } = await db.from('memories').select(FIELDS).eq('content', content).limit(1);
  if (same?.length) return { memory: same[0], outcome: 'known' };

  const embedding = await embed(content);
  const similar = complete ? await similarMemories(db, content, embedding) : [];
  const d = complete ? await decide(content, similar, complete) : ({ action: 'add' } as const);
  const target = d.action === 'add' ? undefined : similar.find((x) => x.id === d.id)!;

  if (d.action === 'none') return { memory: target!, outcome: 'known' };
  if (d.action === 'update') {
    const { data, error } = await db
      .from('memories')
      .update({ content: d.content, embedding: await embed(d.content), updated_at: new Date().toISOString() })
      .eq('id', d.id)
      .select(FIELDS)
      .single();
    if (error) throw new UserFacingError(`I couldn't update that memory: ${error.message}`);
    return { memory: data, outcome: 'updated' };
  }
  if (d.action === 'replace') await db.from('memories').delete().eq('id', d.id);
  const { data, error } = await db
    .from('memories')
    .insert({ content, category: m.category ?? 'other', importance: m.importance ?? 3, embedding })
    .select(FIELDS)
    .single();
  if (error) throw new UserFacingError(`I couldn't save that memory: ${error.message}`);
  return { memory: data, outcome: d.action === 'replace' ? 'replaced' : 'added' };
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
