// mem0-style memory maintenance (https://github.com/mem0ai/mem0, Apache-2.0): a new fact is compared
// with similar stored memories and becomes an ADD, an UPDATE of one of them, a replacement of a
// contradicted one, or nothing (already known) — so memory stays current instead of piling up.
import { z } from 'zod';
import * as ai from '../ai/AIManager.js';
import { looksLikeSecret } from '../../shared/policy.js';

export const MEMORY_CATEGORIES = ['personal', 'projects', 'preferences', 'work', 'goals', 'routines', 'technical', 'other'] as const;

export type Decision = { action: 'add' } | { action: 'none'; id: string } | { action: 'update'; id: string; content: string } | { action: 'replace'; id: string };

/** Sends a prompt, returns the model's text. Injected so the logic is testable without a model. */
export type Complete = (system: string, user: string) => Promise<string>;

export const completeWith = (preferred?: string): Complete => async (system, user) =>
  (await ai.chat([{ role: 'system', content: system }, { role: 'user', content: user }], [], { preferred })).text;

/** First JSON object in a model reply (tolerates ```json fences and chatter). */
export function parseJson(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  try {
    return match ? JSON.parse(match[0]) : null;
  } catch {
    return null;
  }
}

const DECIDE = `You maintain a personal memory store. Compare the NEW fact with the EXISTING memories and reply with JSON only:
{"action":"none","id":"<id>"} — it is already known (same meaning as that memory)
{"action":"update","id":"<id>","content":"<merged fact>"} — same subject as that memory, with new or changed details; write the merged, current version in third person
{"action":"replace","id":"<id>"} — it contradicts that memory, which is now obsolete
{"action":"add"} — it is new information`;

const DecisionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add') }),
  z.object({ action: z.literal('none'), id: z.string() }),
  z.object({ action: z.literal('update'), id: z.string(), content: z.string().min(1).max(500) }),
  z.object({ action: z.literal('replace'), id: z.string() }),
]);

export async function decide(fact: string, existing: { id: string; content: string }[], complete: Complete): Promise<Decision> {
  if (!existing.length) return { action: 'add' };
  const reply = await complete(DECIDE, JSON.stringify({ existing, new: fact })).catch(() => '');
  const parsed = DecisionSchema.safeParse(parseJson(reply));
  // Anything unexpected (bad JSON, an id that isn't one of the candidates, a secret) falls back to a plain add.
  if (!parsed.success) return { action: 'add' };
  const d = parsed.data;
  if (d.action !== 'add' && !existing.some((m) => m.id === d.id)) return { action: 'add' };
  if (d.action === 'update' && looksLikeSecret(d.content)) return { action: 'add' };
  return d;
}

const EXTRACT = (name: string) => `From the user's message (JARVIS's reply is context only), extract at most 3 durable facts about ${name} worth remembering for future conversations: their projects, goals, plans, preferences, routines, people, tools and setup, decisions.
Skip: requests and commands, questions, temporary states, small talk, facts about JARVIS, passwords, keys, account numbers or other sensitive identifiers.
Write each fact as one short sentence in third person. Reply with JSON only:
{"facts":[{"content":"...","category":"${MEMORY_CATEGORIES.join('|')}","importance":1-5}]} or {"facts":[]}`;

const FactsSchema = z.object({
  facts: z.array(z.object({ content: z.string().min(3).max(300), category: z.enum(MEMORY_CATEGORIES).catch('other'), importance: z.number().int().min(1).max(5).catch(3) })).max(3),
});

/** Cheap gate before spending a model call: statements about oneself, not commands or questions. */
export const mightHoldFacts = (text: string) =>
  text.split(/\s+/).length >= 5 &&
  /\b(i|i'm|im|i've|i'll|my|we|we're|our|me)\b/i.test(text) &&
  !/\?\s*$/.test(text.trim()) &&
  !/\bremember\b/i.test(text) && // explicit requests are saved by the saveMemory tool
  !/^\s*(please\s+)?(open|close|play|pause|stop|set|turn|run|show|find|search|create|make|add|remind|post|publish|send|delete)\b/i.test(text);

export async function extractFacts(userText: string, reply: string, name: string, complete: Complete) {
  const raw = await complete(EXTRACT(name), JSON.stringify({ user: userText, jarvis: reply.slice(0, 600) })).catch(() => '');
  const parsed = FactsSchema.safeParse(parseJson(raw));
  return parsed.success ? parsed.data.facts.filter((f) => !looksLikeSecret(f.content)) : [];
}
