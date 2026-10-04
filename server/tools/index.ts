import { z } from 'zod';
import type { AITool, AIToolCall } from '../ai/AIProvider.js';
import type { Settings } from '../../shared/types.js';
import { completeTask, createTask, deleteMemory, getCurrentTime, listTasks, saveMemory, searchMemory } from './core.js';
import { createFile, openApplication, openWebsite, readFile, runTerminal, searchFiles, systemStatus } from './mac.js';
import { github, socialGetAccount, socialPublish, webSearch } from './services.js';
import type { ApprovalDecision, JarvisTool } from './types.js';

export const TOOLS: JarvisTool[] = [
  getCurrentTime, searchMemory, saveMemory, deleteMemory, createTask, listTasks, completeTask,
  webSearch, github, socialGetAccount, socialPublish,
  openApplication, openWebsite, runTerminal, readFile, searchFiles, createFile, systemStatus,
];

export const getTool = (name: string) => TOOLS.find((t) => t.name === name);

// Dynamic tool loading: only tool groups that match the request are sent to the model (memory is always on).
const INTENTS: [JarvisTool['group'], RegExp][] = [
  ['time', /\b(time|date|day|today|tonight|tomorrow|yesterday|week|month|clock|schedule)\b/i],
  ['web', /\b(search|look up|lookup|google|news|latest|current|weather|who is|what is|price|web|online|find out)\b/i],
  ['tasks', /\b(tasks?|to-?dos?|remind|reminders?)\b/i],
  ['mac', /\b(open|launch|start|run|command|terminal|shell|directory|folder|files?|read|create|write|save|cpu|memory usage|system|status|mac|computer|apps?|website|url|disk)\b/i],
  ['github', /\b(github|repo|repos|repository|repositories|commits?|pull requests?|prs?|issues?|branch(es)?)\b/i],
  ['social', /\b(post|posts|facebook|instagram|tweet|linkedin|tiktok|publish|caption|social)\b/i],
];

export function selectTools(text: string): JarvisTool[] {
  const groups = new Set<string>(['memory']);
  for (const [group, re] of INTENTS) if (re.test(text)) groups.add(group);
  return TOOLS.filter((t) => groups.has(t.group));
}

export function decideApproval(tool: JarvisTool, input: unknown, settings: Settings): ApprovalDecision {
  return tool.approval?.(input, settings) ?? { decision: tool.permission === 'dangerous' ? 'approve' : 'auto' };
}

export type ToolPlan =
  | { kind: 'invalid'; error: string }
  | { kind: 'blocked'; tool: JarvisTool; input: any; reason: string }
  | { kind: 'execute'; tool: JarvisTool; input: any }
  | { kind: 'pending'; tool: JarvisTool; input: any; needsApproval: boolean };

/** Decides what happens to a model tool call. Tool parameters are never trusted: they are schema-validated first. */
export function planToolCall(call: AIToolCall, settings: Settings): ToolPlan {
  const tool = getTool(call.function.name);
  if (!tool) return { kind: 'invalid', error: `Unknown tool "${call.function.name}".` };
  let args: unknown;
  try {
    args = JSON.parse(call.function.arguments || '{}');
  } catch {
    return { kind: 'invalid', error: 'Tool arguments were not valid JSON.' };
  }
  const parsed = tool.schema.safeParse(args);
  if (!parsed.success) return { kind: 'invalid', error: `Invalid arguments: ${z.prettifyError(parsed.error)}` };
  const input = parsed.data;
  const { decision, reason } = decideApproval(tool, input, settings);
  if (decision === 'block') return { kind: 'blocked', tool, input, reason: reason ?? 'Not allowed.' };
  if (tool.runOn === 'server' && decision === 'auto') return { kind: 'execute', tool, input };
  return { kind: 'pending', tool, input, needsApproval: decision === 'approve' };
}

/** JSON Schema for the model, minus keys some providers (Gemini) reject. */
export function toAITool(tool: JarvisTool): AITool {
  const strip = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(strip)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== '$schema' && k !== 'additionalProperties').map(([k, x]) => [k, strip(x)]))
      : v;
  return { name: tool.name, description: tool.description, parameters: strip(z.toJSONSchema(tool.schema, { io: 'input' })) as Record<string, unknown> };
}
