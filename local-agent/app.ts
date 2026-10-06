import { existsSync } from 'node:fs';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AgentConfig } from './config/index.js';
import { AgentError, LOCAL_HOST, tokenMatches } from './security/index.js';
import * as tools from './tools/index.js';
import * as apps from './tools/mac-apps.js';
import * as web from './tools/browser.js';

async function body<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  const r = schema.safeParse(await c.req.json().catch(() => null));
  if (!r.success) throw new AgentError(400, 'Invalid request.');
  return r.data;
}

const confirmed = z.boolean().optional().default(false);

export function createAgentApp(cfg: AgentConfig) {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof AgentError) return c.json({ ok: false, error: err.message }, err.status);
    console.error('[agent]', err);
    return c.json({ ok: false, error: 'The local agent hit an unexpected error.' }, 500);
  });

  // Loopback host + browser origin allowlist (+ Private Network Access preflight).
  app.use('*', async (c, next) => {
    if (!LOCAL_HOST.test(c.req.header('host') ?? new URL(c.req.url).host)) return c.json({ ok: false, error: 'Forbidden host.' }, 403);
    const origin = c.req.header('origin');
    if (origin) {
      if (!cfg.allowedOrigins.includes(origin))
        return c.json({ ok: false, error: `Origin ${origin} is not allowed. Add it to allowedOrigins in local-agent/config/agent.config.json.` }, 403);
      c.header('access-control-allow-origin', origin);
      c.header('vary', 'origin');
    }
    if (c.req.method === 'OPTIONS')
      return c.body(null, 204, {
        'access-control-allow-methods': 'GET, POST',
        'access-control-allow-headers': 'authorization, content-type',
        'access-control-allow-private-network': 'true',
        'access-control-max-age': '600',
      });
    await next();
  });

  app.get('/health', (c) =>
    c.json({ ok: true, name: 'jarvis-local-agent', version: '0.1.0', authenticated: tokenMatches(c.req.header('authorization'), cfg.token) }),
  );

  app.use('*', async (c, next) => {
    if (!tokenMatches(c.req.header('authorization'), cfg.token)) return c.json({ ok: false, error: 'Invalid or missing agent token.' }, 401);
    await next();
  });

  app.get('/config', (c) =>
    c.json({
      ok: true,
      allowedDirectories: cfg.allowedDirectories.map((path) => ({ path, exists: existsSync(path) })),
      allowedApps: cfg.allowedApps,
    }),
  );

  app.post('/open-app', async (c) => {
    const { app: name } = await body(c, z.object({ app: z.string().min(1).max(80) }));
    return c.json({ ok: true, output: await tools.openApp(name, cfg) });
  });

  app.post('/open-url', async (c) => {
    const { url } = await body(c, z.object({ url: z.string().max(2000) }));
    return c.json({ ok: true, output: await tools.openUrl(url) });
  });

  app.post('/terminal', async (c) => {
    const i = await body(c, z.object({ command: z.string().min(1).max(500), cwd: z.string().max(1000).optional(), confirmed }));
    const r = await tools.runCommand(i.command, i.cwd, i.confirmed, cfg);
    return c.json({ ok: true, output: `$ ${i.command}  (in ${r.cwd}, exit ${r.exitCode})\n${r.output}`, exitCode: r.exitCode });
  });

  app.post('/file/read', async (c) => {
    const { path } = await body(c, z.object({ path: z.string().min(1).max(1000) }));
    return c.json({ ok: true, output: await tools.readPath(path, cfg) });
  });

  app.post('/file/write', async (c) => {
    const i = await body(c, z.object({ path: z.string().min(1).max(1000), content: z.string().max(1_000_000), overwrite: z.boolean().optional() }));
    return c.json({ ok: true, output: await tools.writePath(i.path, i.content, i.overwrite ?? false, cfg) });
  });

  app.post('/file/search', async (c) => {
    const i = await body(c, z.object({ query: z.string().min(1).max(200), directory: z.string().max(1000).optional() }));
    return c.json({ ok: true, output: await tools.searchFiles(i.query, i.directory, cfg) });
  });

  app.post('/system/status', async (c) => c.json({ ok: true, ...(await tools.systemStatus()) }));

  const when = z.string().min(8).max(40);

  app.post('/open-project', async (c) => {
    const i = await body(c, z.object({ path: z.string().min(1).max(1000), app: z.enum(apps.EDITORS).optional() }));
    return c.json({ ok: true, output: await apps.openProject(i.path, i.app, cfg) });
  });

  app.post('/media', async (c) => {
    const i = await body(c, z.object({ action: z.enum(apps.MEDIA_ACTIONS), app: z.enum(apps.PLAYERS).optional() }));
    return c.json({ ok: true, output: await apps.media(i.action, i.app) });
  });

  app.post('/volume', async (c) => {
    const i = await body(c, z.object({ level: z.number().int().min(0).max(100).optional(), mute: z.boolean().optional() }));
    return c.json({ ok: true, output: await apps.volume(i.level, i.mute) });
  });

  app.post('/reminders', async (c) => {
    const i = await body(c, z.object({ title: z.string().min(1).max(300), due: when.optional() }));
    return c.json({ ok: true, output: await apps.reminder(i.title, i.due) });
  });

  app.post('/notes', async (c) => {
    const i = await body(c, z.object({ title: z.string().min(1).max(200), body: z.string().max(20_000).default('') }));
    return c.json({ ok: true, output: await apps.note(i.title, i.body) });
  });

  app.post('/calendar', async (c) => {
    const i = await body(c, z.object({ title: z.string().min(1).max(300), start: when, durationMinutes: z.number().int().min(5).max(1440).optional() }));
    return c.json({ ok: true, output: await apps.calendarEvent(i.title, i.start, i.durationMinutes) });
  });

  app.post('/screenshot', async (c) => c.json({ ok: true, output: 'Captured the main display.', image: await apps.screenshot() }));

  app.post('/browser/read', async (c) => {
    const i = await body(c, z.object({ url: z.string().max(2000), question: z.string().min(1).max(500) }));
    return c.json({ ok: true, output: await web.readPage(i.url, i.question, cfg.browserHeadless) });
  });

  app.post('/browser/act', async (c) => {
    // Whether to ask first is the user's setting in JARVIS; the agent still refuses purchases, payments and passwords.
    const i = await body(c, z.object({ task: z.string().min(1).max(1000), url: z.string().max(2000).optional() }));
    return c.json({ ok: true, output: await web.runTask(i.task, i.url, cfg.browserHeadless) });
  });

  app.post('/clipboard', async (c) => {
    const i = await body(c, z.object({ action: z.enum(['read', 'write']), text: z.string().max(100_000).optional() }));
    return c.json({ ok: true, output: await apps.clipboard(i.action, i.text) });
  });

  return app;
}
