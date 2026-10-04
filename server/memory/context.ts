import type { SupabaseClient } from '@supabase/supabase-js';
import type { AIMessage, AIToolCall } from '../ai/AIProvider.js';
import * as ai from '../ai/AIManager.js';
import type { Settings } from '../../shared/types.js';
import { truncate } from '../lib/util.js';
import { searchMemories } from './memory.js';

const WINDOW = 16; // recent messages sent verbatim
const SUMMARIZE_AFTER = 30; // unsummarized messages before older ones get folded into the summary
const KEEP_AFTER_SUMMARY = 12;

interface Row { seq: number; role: AIMessage['role']; content: string; tool_calls: AIToolCall[] | null; tool_call_id: string | null }

const prompt = (o: { name: string; now: string; tz: string; platform: string; memories: string[]; summary?: string | null }) =>
  `You are JARVIS, ${o.name}'s personal AI assistant with access to their Mac (via a local agent) and connected services.
Style: calm, concise, professional, slightly witty. Replies are often spoken aloud: keep them short, no emojis, no markdown tables.
Rules:
- Act through tools. Never claim something happened unless a tool result confirms it. A draft is not a published post.
- Relevant memories are listed below; call searchMemory only if they don't answer the question. Save memories only when the user explicitly asks you to remember something. Never store passwords, keys, tokens or credentials.
- Some tool calls need the user's approval; they see Approve/Cancel. Briefly say what you prepared and that it awaits approval.
- Social posts: write the caption and call social_publish (it only shows a preview). Ask which platform if unclear; default ${o.platform}.
- If a tool fails, explain plainly and suggest the fix, without technical internals. Be honest about limitations.
Now: ${o.now} (${o.tz}).` +
  (o.memories.length ? `\nRelevant memories:\n${o.memories.map((m) => `- ${m}`).join('\n')}` : '') +
  (o.summary ? `\nEarlier in this conversation: ${o.summary}` : '');

/** Recent window + rolling summary + relevant memories, instead of the whole history. */
export async function buildContext(
  db: SupabaseClient,
  conversationId: string,
  o: { settings: Settings; name: string; timezone: string },
): Promise<{ messages: AIMessage[]; lastUserText: string }> {
  const { data: conv } = await db.from('conversations').select('summary, summarized_seq').eq('id', conversationId).single();
  const { data } = await db
    .from('messages')
    .select('seq, role, content, tool_calls, tool_call_id')
    .eq('conversation_id', conversationId)
    .gt('seq', conv?.summarized_seq ?? 0)
    .order('seq', { ascending: false })
    .limit(WINDOW);
  const rows = ((data ?? []) as Row[]).reverse();
  while (rows.length > 1 && rows[0].role !== 'user') rows.shift(); // never start with orphaned tool results

  const toolNames = new Map(rows.flatMap((r) => (r.tool_calls ?? []).map((c) => [c.id, c.function.name] as const)));
  const lastUserText = rows.findLast((r) => r.role === 'user')?.content ?? '';
  const memories =
    o.settings.memory.autoRecall && lastUserText ? (await searchMemories(db, lastUserText, 5)).map((m) => m.content) : [];
  const now = new Date().toLocaleString('en-US', { timeZone: o.timezone, dateStyle: 'full', timeStyle: 'short' });

  const messages: AIMessage[] = [
    { role: 'system', content: prompt({ name: o.name, now, tz: o.timezone, platform: o.settings.social.defaultPlatform, memories, summary: conv?.summary }) },
    ...rows.map((r): AIMessage =>
      r.role === 'tool'
        ? { role: 'tool', tool_call_id: r.tool_call_id!, name: toolNames.get(r.tool_call_id!) ?? 'tool', content: truncate(r.content, 2000) }
        : r.tool_calls?.length
          ? { role: 'assistant', content: r.content || null, tool_calls: r.tool_calls }
          : { role: r.role, content: r.content },
    ),
  ];
  return { messages, lastUserText };
}

/** Folds older messages into conversations.summary so the window stays small. */
export async function maybeSummarize(db: SupabaseClient, conversationId: string, preferred: string) {
  const { data: conv } = await db.from('conversations').select('summary, summarized_seq').eq('id', conversationId).single();
  if (!conv) return;
  const { data } = await db
    .from('messages')
    .select('seq, role, content')
    .eq('conversation_id', conversationId)
    .gt('seq', conv.summarized_seq ?? 0)
    .order('seq');
  const rows = (data ?? []) as Row[];
  if (rows.length <= SUMMARIZE_AFTER) return;
  let cut = rows.length - KEEP_AFTER_SUMMARY;
  while (cut > 0 && rows[cut].role !== 'user') cut--;
  const old = rows.slice(0, cut);
  if (!old.length) return;
  const transcript = old
    .map((r) => (r.role === 'tool' ? `[tool result] ${r.content.slice(0, 200)}` : `${r.role}: ${r.content.slice(0, 800)}`))
    .join('\n');
  const res = await ai.chat(
    [
      { role: 'system', content: 'Summarize this conversation for your own future reference in under 150 words. Keep facts, decisions, names and open items.' },
      { role: 'user', content: `${conv.summary ? `Previous summary: ${conv.summary}\n\n` : ''}${transcript}` },
    ],
    [],
    { preferred },
  );
  await db.from('conversations').update({ summary: res.text.trim(), summarized_seq: old.at(-1)!.seq }).eq('id', conversationId);
}
