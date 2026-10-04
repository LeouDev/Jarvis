import type { Context } from 'hono';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import * as ai from '../ai/AIManager.js';
import { describeImage } from '../ai/vision.js';
import type { AIMessage, AIToolCall } from '../ai/AIProvider.js';
import type { Env } from '../lib/auth.js';
import { loadSettings, logActivity, truncate, UserFacingError } from '../lib/util.js';
import { buildContext, maybeSummarize } from '../memory/context.js';
import { searchMemories } from '../memory/memory.js';
import { getTool, planToolCall, selectTools, toAITool, untrustedSinceUser } from '../tools/index.js';
import type { JarvisTool, ToolContext, ToolResult } from '../tools/types.js';
import { redact } from '../../shared/policy.js';
import type { ActionResolution, ChatEvent, ExecutionStatus, PendingAction } from '../../shared/types.js';

const MAX_STEPS = 5;

const Body = z
  .object({
    conversationId: z.uuid().optional(),
    message: z.string().trim().min(1).max(8000).optional(),
    resolutions: z
      .array(z.object({ id: z.uuid(), approved: z.boolean(), result: z.object({ ok: z.boolean(), output: z.string().max(100_000), image: z.string().max(4_000_000).optional() }).optional() }))
      .max(20)
      .optional(),
    timezone: z.string().max(64).optional(),
  })
  .refine((b) => b.message || b.resolutions?.length, 'message or resolutions required');

type Send = (ev: ChatEvent) => void;
interface ExecutionRow {
  id: string; tool: string; tool_call_id: string; input: Record<string, unknown>; summary: string;
  run_on: 'server' | 'agent'; needs_approval: boolean;
}

/** What to do with the browser's answer to a pending action. Server tools only ever run after explicit approval. */
export function resolveAction(ex: Pick<ExecutionRow, 'run_on' | 'needs_approval'>, r: ActionResolution): 'reject' | 'record' | 'execute' {
  if (!r.approved) return 'reject';
  if (ex.run_on === 'agent') return r.result ? 'record' : 'reject';
  return 'execute';
}

export function friendlyError(err: unknown): string {
  if (err instanceof ai.AIUnavailableError || err instanceof UserFacingError) return err.message;
  return 'Something went wrong on my side. Please try again.';
}

const validTz = (tz?: string) => {
  try {
    return tz ? (new Intl.DateTimeFormat('en-US', { timeZone: tz }), tz) : 'UTC';
  } catch {
    return 'UTC';
  }
};

async function insertMessages(db: SupabaseClient, conversationId: string, msgs: AIMessage[]) {
  const { error } = await db.from('messages').insert(
    msgs.map((m) => ({ conversation_id: conversationId, role: m.role, content: m.content ?? '', tool_calls: m.tool_calls ?? null, tool_call_id: m.tool_call_id ?? null })),
  );
  if (error) throw new Error(`messages insert: ${error.message}`);
}

async function runServerTool(tool: JarvisTool, input: unknown, ctx: ToolContext): Promise<ToolResult> {
  try {
    return await tool.execute!(input, ctx);
  } catch (err) {
    console.error(`[tool] ${tool.name}:`, err);
    return { ok: false, output: err instanceof UserFacingError ? err.message : `${tool.name} failed unexpectedly.` };
  }
}

const toolMessage = (call: Pick<AIToolCall, 'id'> & { name: string }, content: string): AIMessage => ({
  role: 'tool', tool_call_id: call.id, name: call.name, content: truncate(content, 4000),
});

export async function chatRoute(c: Context<Env>) {
  const parsed = Body.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Invalid request.' }, 400);
  const { db } = c.var;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send: Send = (ev) => controller.enqueue(encoder.encode(`${JSON.stringify(ev)}\n`));
      try {
        await runChat(db, parsed.data, send);
      } catch (err) {
        console.error('[chat]', err);
        send({ type: 'error', message: friendlyError(err) });
      }
      send({ type: 'done' });
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' } });
}

async function runChat(db: SupabaseClient, body: z.infer<typeof Body>, send: Send) {
  const timezone = validTz(body.timezone);
  // Start the memory lookup (embedding + search, ~200 ms) now instead of after the other queries.
  const recall = body.message ? searchMemories(db, body.message, 5).catch(() => []) : null;
  const [settings, profile] = await Promise.all([loadSettings(db), db.from('users').select('display_name').maybeSingle()]);
  const ctx: ToolContext = { db, settings, timezone };

  let conversationId = body.conversationId;
  if (conversationId) {
    const { data } = await db.from('conversations').select('id').eq('id', conversationId).maybeSingle();
    if (!data) throw new UserFacingError('That conversation no longer exists.');
  } else {
    if (!body.message) throw new UserFacingError('Nothing to continue.');
    const { data, error } = await db.from('conversations').insert({ title: truncate(body.message, 60) }).select('id').single();
    if (error) throw new Error(`conversation insert: ${error.message}`);
    conversationId = data.id as string;
  }
  send({ type: 'conversation', id: conversationId });

  if (body.resolutions?.length) await applyResolutions(ctx, conversationId, body.resolutions, send);
  await cancelUnresolved(db, conversationId);
  if (body.message) {
    await insertMessages(db, conversationId, [{ role: 'user', content: body.message }]);
    await db.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId);
  }

  const { messages, lastUserText } = await buildContext(db, conversationId, {
    settings, timezone, recall, name: profile.data?.display_name || 'there',
  });
  const tools = selectTools(lastUserText).map(toAITool);

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await ai.chat(messages, tools, {
      preferred: settings.provider,
      onText: (delta) => send({ type: 'text', delta }),
      onNotice: (message) => send({ type: 'notice', message }),
    });
    const assistant: AIMessage = { role: 'assistant', content: res.text || null, ...(res.toolCalls.length ? { tool_calls: res.toolCalls } : {}) };
    messages.push(assistant);
    await insertMessages(db, conversationId, [assistant]);
    if (!res.toolCalls.length) break;

    const results: AIMessage[] = [];
    const pending: PendingAction[] = [];
    for (const call of res.toolCalls) {
      const name = call.function.name;
      const plan = planToolCall(call, settings, untrustedSinceUser([...messages, ...results]), lastUserText);
      if (plan.kind === 'invalid') {
        results.push(toolMessage({ id: call.id, name }, plan.error));
      } else if (plan.kind === 'blocked') {
        const summary = plan.tool.summary(plan.input);
        await logActivity(db, { actor: 'jarvis', action: summary, tool: name, status: 'blocked', input: plan.input, result: plan.reason });
        send({ type: 'tool', execution: { id: call.id, tool: name, summary, status: 'blocked', output: plan.reason } });
        results.push(toolMessage({ id: call.id, name }, `Blocked by JARVIS safety policy: ${plan.reason}`));
      } else if (plan.kind === 'execute') {
        const summary = plan.tool.summary(plan.input);
        send({ type: 'tool', execution: { id: call.id, tool: name, summary, status: 'running' } });
        const r = await runServerTool(plan.tool, plan.input, ctx);
        const status: ExecutionStatus = r.ok ? 'succeeded' : 'failed';
        await logActivity(db, { actor: 'jarvis', action: summary, tool: name, status, input: plan.input, result: r.output });
        send({ type: 'tool', execution: { id: call.id, tool: name, summary, status, output: truncate(r.output, 2000) } });
        results.push(toolMessage({ id: call.id, name }, r.output));
      } else {
        const summary = plan.tool.summary(plan.input);
        const { data, error } = await db
          .from('tool_executions')
          .insert({
            conversation_id: conversationId, tool_call_id: call.id, tool: name, summary, input: plan.input,
            permission: plan.tool.permission, run_on: plan.tool.runOn, needs_approval: plan.needsApproval, status: 'pending',
          })
          .select('id')
          .single();
        if (error) throw new Error(`tool_executions insert: ${error.message}`);
        pending.push({ id: data.id, tool: name, summary, input: plan.input, permission: plan.tool.permission, runOn: plan.tool.runOn, needsApproval: plan.needsApproval, reason: plan.reason });
      }
    }
    if (results.length) {
      messages.push(...results);
      await insertMessages(db, conversationId, results);
    }
    if (pending.length) {
      // The browser approves/executes these and calls back with `resolutions`; the loop resumes there.
      send({ type: 'actions', actions: pending });
      return;
    }
    if (step === MAX_STEPS - 1) send({ type: 'notice', message: 'Stopped after several tool steps. Ask me to continue if needed.' });
  }
  await maybeSummarize(db, conversationId, settings.provider).catch((err) => console.error('[summary]', err));
}

async function applyResolutions(ctx: ToolContext, conversationId: string, resolutions: ActionResolution[], send: Send) {
  const { db } = ctx;
  for (const r of resolutions) {
    const { data } = await db
      .from('tool_executions')
      .select('id, tool, tool_call_id, input, summary, run_on, needs_approval')
      .eq('id', r.id)
      .eq('conversation_id', conversationId)
      .eq('status', 'pending')
      .maybeSingle();
    const ex = data as ExecutionRow | null;
    const tool = ex && getTool(ex.tool);
    if (!ex || !tool) continue;

    const outcome = resolveAction(ex, r);
    let status: ExecutionStatus;
    let output: string;
    if (outcome === 'reject') {
      status = 'rejected';
      output = 'The user declined this action. It was not performed.';
    } else if (outcome === 'record') {
      status = r.result!.ok ? 'succeeded' : 'failed';
      output = r.result!.output;
      if (ex.tool === 'lookAtScreen' && r.result!.image)
        output = await describeImage(r.result!.image, String(ex.input.question ?? "What's on the screen?"));
    } else {
      const res = await runServerTool(tool, ex.input, ctx);
      status = res.ok ? 'succeeded' : 'failed';
      output = res.output;
    }

    await db
      .from('tool_executions')
      .update({ status, approved: ex.needs_approval ? r.approved : null, result: truncate(String(redact(output)), 4000), updated_at: new Date().toISOString() })
      .eq('id', ex.id);
    await insertMessages(db, conversationId, [toolMessage({ id: ex.tool_call_id, name: ex.tool }, output)]);
    if (ex.needs_approval)
      await logActivity(db, { actor: 'user', action: `${r.approved ? 'Approved' : 'Declined'}: ${ex.summary}`, tool: ex.tool, status: r.approved ? 'approved' : 'rejected', approved: r.approved });
    if (outcome !== 'reject')
      await logActivity(db, { actor: 'jarvis', action: ex.summary, tool: ex.tool, status, approved: ex.needs_approval ? true : null, input: ex.input, result: output });
    send({ type: 'tool', execution: { id: ex.id, tool: ex.tool, summary: ex.summary, status, output: truncate(output, 2000) } });
  }
}

/** Any action the user never answered is cancelled, so the model always sees a result for every tool call. */
async function cancelUnresolved(db: SupabaseClient, conversationId: string) {
  const { data } = await db
    .from('tool_executions')
    .update({ status: 'rejected', result: 'Cancelled: no response.', updated_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('status', 'pending')
    .select('tool, tool_call_id');
  if (data?.length)
    await insertMessages(db, conversationId, data.map((d) => toolMessage({ id: d.tool_call_id, name: d.tool }, 'Cancelled: the user moved on without approving.')));
}
