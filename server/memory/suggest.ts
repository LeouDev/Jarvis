import type { SupabaseClient } from '@supabase/supabase-js';
import { completeWith, decide, extractFacts, mightHoldFacts } from './consolidate.js';
import { embed, similarMemories } from './memory.js';

/**
 * Learns from conversation without saving silently: facts worth remembering become *suggestions*
 * (status 'suggested') that the user keeps or dismisses in the Memory tab. Runs after the reply.
 */
export async function suggestMemories(db: SupabaseClient, userText: string, reply: string, name: string, preferred?: string) {
  if (!mightHoldFacts(userText)) return;
  const complete = completeWith(preferred);
  for (const fact of await extractFacts(userText, reply, name, complete)) {
    const embedding = await embed(fact.content);
    const similar = await similarMemories(db, fact.content, embedding);
    const d = await decide(fact.content, similar, complete);
    if (d.action === 'none') continue; // already known
    const content = d.action === 'update' ? d.content : fact.content;
    const { data: pending } = await db.from('memories').select('id').eq('status', 'suggested').eq('content', content).limit(1);
    if (pending?.length) continue;
    const { error } = await db.from('memories').insert({
      content,
      category: fact.category,
      importance: fact.importance,
      embedding: d.action === 'update' ? await embed(content) : embedding,
      status: 'suggested',
      replaces: d.action === 'add' ? null : d.id,
    });
    if (error) return console.error('[suggest]', error.message); // e.g. migration not run yet: stop quietly
  }
}
