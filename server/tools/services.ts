import { z } from 'zod';
import { github as runGithub, GITHUB_ACTIONS, type GithubAction } from '../github/github.js';
import { loadConnection, SOCIAL_PROVIDERS } from '../social/index.js';
import { webSearchProvider } from '../web/search.js';
import { fail, ok, type JarvisTool } from './types.js';

const PLATFORMS = Object.keys(SOCIAL_PROVIDERS) as [string, ...string[]];
const label = (p: string) => SOCIAL_PROVIDERS[p]?.label ?? p;

export const webSearch: JarvisTool<{ query: string; limit: number }> = {
  name: 'webSearch', group: 'web', permission: 'read', runOn: 'server',
  description: 'Search the web for current information. Summarize the results for the user; do not dump them.',
  schema: z.object({ query: z.string().min(1).max(300), limit: z.number().int().min(1).max(8).default(5) }),
  summary: (i) => `Searched the web for "${i.query}"`,
  async execute({ query, limit }) {
    const provider = webSearchProvider();
    const results = await provider.search(query, limit);
    if (!results.length) return ok('No results.');
    return ok(`Source: ${provider.id}\n` + results.map((r) => `• ${r.title} (${r.url})\n  ${r.snippet}`).join('\n'));
  },
};

export const github: JarvisTool<{ action: GithubAction; repo?: string; limit?: number }> = {
  name: 'github', group: 'github', permission: 'read', runOn: 'server',
  description: "Read the user's GitHub: list repos, inspect a repo, branches, commits, issues, pull requests, recent activity.",
  schema: z.object({
    action: z.enum(GITHUB_ACTIONS),
    repo: z.string().max(140).optional().describe('"owner/name", or just "name" for the user\'s own repos'),
    limit: z.number().int().min(1).max(30).optional(),
  }),
  summary: (i) => `GitHub: ${i.action}${i.repo ? ` ${i.repo}` : ''}`,
  execute: async (input) => ok(await runGithub(input)),
};

export const socialGetAccount: JarvisTool<{ platform: string }> = {
  name: 'social_getAccount', group: 'social', permission: 'read', runOn: 'server',
  description: 'Check which social account is connected for a platform.',
  schema: z.object({ platform: z.enum(PLATFORMS) }),
  summary: (i) => `Checked ${label(i.platform)} connection`,
  async execute({ platform }, { db }) {
    const conn = await loadConnection(db, platform);
    return conn ? ok(`${label(platform)} is connected as "${conn.name}".`) : ok(`${label(platform)} isn't connected yet. It can be connected in Settings → Accounts.`);
  },
};

export const socialPublish: JarvisTool<{ platform: string; caption: string }> = {
  name: 'social_publish', group: 'social', permission: 'dangerous', runOn: 'server',
  description:
    'Prepare a social media post. The user sees a POST PREVIEW with Publish / Cancel; it is published ONLY if they click Publish. Use this whenever the user asks to create, draft or post something.',
  schema: z.object({ platform: z.enum(PLATFORMS), caption: z.string().min(1).max(5000) }),
  summary: (i) => `Publish ${label(i.platform)} post`,
  approval: () => ({ decision: 'approve' }), // never bypassed, regardless of settings
  async execute({ platform, caption }, { db }) {
    const provider = SOCIAL_PROVIDERS[platform];
    const draft = provider.createDraft(caption);
    const conn = await loadConnection(db, platform);
    if (!conn) return fail(`${provider.label} isn't connected yet. Connect your account in Settings.`);
    const post = await provider.publishPost(conn.token, conn.externalId, draft);
    return ok(`Published to ${provider.label} (${conn.name}). Post id ${post.id}${post.url ? ` — ${post.url}` : ''}`);
  },
};
