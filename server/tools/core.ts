import { z } from 'zod';
import { MEMORY_CATEGORIES, saveMemory as save, searchMemories } from '../memory/memory.js';
import { fail, ok, type JarvisTool } from './types.js';

export const getCurrentTime: JarvisTool<{}> = {
  name: 'getCurrentTime', group: 'time', permission: 'read', runOn: 'server',
  description: "Get the current date and time in the user's timezone.",
  schema: z.object({}),
  summary: () => 'Checked the time',
  execute: async (_, { timezone }) =>
    ok(`${new Date().toLocaleString('en-US', { timeZone: timezone, dateStyle: 'full', timeStyle: 'short' })} (${timezone})`),
};

export const searchMemory: JarvisTool<{ query: string }> = {
  name: 'searchMemory', group: 'memory', permission: 'read', runOn: 'server',
  description: "Search the user's saved memories (projects, preferences, personal facts).",
  schema: z.object({ query: z.string().min(1).max(300) }),
  summary: (i) => `Searched memory for "${i.query}"`,
  async execute({ query }, { db }) {
    const found = await searchMemories(db, query, 8);
    return ok(found.length ? found.map((m) => `- [${m.id}] (${m.category}) ${m.content}`).join('\n') : 'No matching memories.');
  },
};

export const saveMemory: JarvisTool<{ content: string; category: (typeof MEMORY_CATEGORIES)[number]; importance: number }> = {
  name: 'saveMemory', group: 'memory', permission: 'write', runOn: 'server',
  description:
    'Save a fact to long-term memory. Use ONLY when the user explicitly asks you to remember something. Never store passwords, keys, tokens or credentials. Write the fact in third person, e.g. "Leou is building a project called JARVIS."',
  schema: z.object({
    content: z.string().min(1).max(500),
    category: z.enum(MEMORY_CATEGORIES).default('other'),
    importance: z.number().int().min(1).max(5).default(3).describe('1 = trivia, 5 = core fact'),
  }),
  summary: (i) => `Saved memory: ${i.content}`,
  async execute(input, { db }) {
    const m = await save(db, input);
    return ok(`Saved memory ${m.id}.`);
  },
};

export const deleteMemory: JarvisTool<{ id: string }> = {
  name: 'deleteMemory', group: 'memory', permission: 'write', runOn: 'server',
  description: 'Delete a memory by id when the user asks you to forget something. Search first to find the id.',
  schema: z.object({ id: z.uuid() }),
  summary: () => 'Deleted a memory',
  async execute({ id }, { db }) {
    const { data, error } = await db.from('memories').delete().eq('id', id).select('id');
    return error || !data?.length ? fail('That memory was not found.') : ok('Memory deleted.');
  },
};

export const createTask: JarvisTool<{ title: string; notes?: string; due?: string }> = {
  name: 'createTask', group: 'tasks', permission: 'write', runOn: 'server',
  description: "Add an item to JARVIS's own to-do list (no alerts). For 'remind me…' prefer createReminder, which alerts on the Mac.",
  schema: z.object({
    title: z.string().min(1).max(200),
    notes: z.string().max(2000).optional(),
    due: z.string().max(40).optional().describe('ISO 8601 date or datetime'),
  }),
  summary: (i) => `Created task: ${i.title}`,
  async execute({ title, notes, due }, { db }) {
    const dueAt = due && !Number.isNaN(Date.parse(due)) ? new Date(due).toISOString() : null;
    const { data, error } = await db.from('tasks').insert({ title, notes, due_at: dueAt }).select('id').single();
    return error ? fail(`Could not create the task: ${error.message}`) : ok(`Task created (${data.id}).`);
  },
};

export const listTasks: JarvisTool<{ status: 'open' | 'done' | 'all' }> = {
  name: 'listTasks', group: 'tasks', permission: 'read', runOn: 'server',
  description: "List the user's tasks.",
  schema: z.object({ status: z.enum(['open', 'done', 'all']).default('open') }),
  summary: () => 'Listed tasks',
  async execute({ status }, { db }) {
    let q = db.from('tasks').select('id, title, status, due_at').order('created_at', { ascending: false }).limit(30);
    if (status !== 'all') q = q.eq('status', status);
    const { data } = await q;
    return ok(data?.length ? data.map((t) => `- [${t.id}] ${t.title}${t.due_at ? ` (due ${t.due_at.slice(0, 16)})` : ''} — ${t.status}`).join('\n') : 'No tasks.');
  },
};

export const completeTask: JarvisTool<{ id: string }> = {
  name: 'completeTask', group: 'tasks', permission: 'write', runOn: 'server',
  description: 'Mark a task as done.',
  schema: z.object({ id: z.uuid() }),
  summary: () => 'Completed a task',
  async execute({ id }, { db }) {
    const { data } = await db.from('tasks').update({ status: 'done', updated_at: new Date().toISOString() }).eq('id', id).select('title');
    return data?.length ? ok(`Marked "${data[0].title}" done.`) : fail('Task not found.');
  },
};
