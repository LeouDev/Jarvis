import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAgentApp } from '../local-agent/app';

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'jarvis-agent-')));
writeFileSync(join(dir, 'notes.txt'), 'hello');
writeFileSync(join(dir, '.env'), 'SECRET=1');
const token = 'test-token-not-a-secret';
const app = createAgentApp({ port: 0, token, allowedDirectories: [dir], allowedApps: ['Calculator'], allowedOrigins: ['http://localhost:5173'], browserHeadless: true });

const post = (path: string, body: object, headers: Record<string, string> = { authorization: `Bearer ${token}` }) =>
  app.request(`http://localhost:3847${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('local agent security', () => {
  it('requires the token', async () => {
    expect((await post('/terminal', { command: 'pwd' }, {})).status).toBe(401);
    expect((await post('/terminal', { command: 'pwd' }, { authorization: 'Bearer wrong' })).status).toBe(401);
    expect(await (await app.request('http://localhost:3847/health')).json()).toMatchObject({ ok: true, authenticated: false });
  });

  it('rejects foreign hosts and origins', async () => {
    expect((await app.request('http://evil.example/health')).status).toBe(403);
    expect((await post('/terminal', { command: 'pwd' }, { authorization: `Bearer ${token}`, origin: 'https://evil.example' })).status).toBe(403);
    const ok = await post('/terminal', { command: 'pwd', cwd: dir }, { authorization: `Bearer ${token}`, origin: 'http://localhost:5173' });
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });

  it('runs safe commands, blocks dangerous ones, and requires confirmation for the rest', async () => {
    const res = await (await post('/terminal', { command: 'pwd', cwd: dir })).json();
    expect(res.output).toContain(dir);
    expect((await post('/terminal', { command: 'rm -rf /' })).status).toBe(403);
    expect((await post('/terminal', { command: 'sudo ls' })).status).toBe(403);
    expect((await post('/terminal', { command: 'ls; rm x' })).status).toBe(403);
    expect((await post('/terminal', { command: 'cat notes.txt', cwd: dir })).status).toBe(403);
    const confirmed = await (await post('/terminal', { command: 'cat notes.txt', cwd: dir, confirmed: true })).json();
    expect(confirmed.output).toContain('hello');
    expect((await post('/terminal', { command: 'pwd', cwd: '/etc' })).status).toBe(403);
  });

  it('confines file access to allowed directories and protects credentials', async () => {
    expect((await (await post('/file/read', { path: join(dir, 'notes.txt') })).json()).output).toBe('hello');
    expect((await post('/file/read', { path: '/etc/hosts' })).status).toBe(403);
    expect((await post('/file/read', { path: join(dir, '..', '..', 'etc', 'hosts') })).status).toBe(403);
    expect((await post('/file/read', { path: join(dir, '.env') })).status).toBe(403);
    expect((await post('/file/write', { path: join(dir, 'new', 'a.md'), content: '# hi' })).status).toBe(200);
    expect((await post('/file/write', { path: join(dir, 'notes.txt'), content: 'x' })).status).toBe(409);
    expect((await post('/file/write', { path: '/tmp/outside.txt', content: 'x' })).status).toBe(403);
  });

  it('only opens allowlisted apps and http(s) URLs', async () => {
    expect((await post('/open-app', { app: 'Terminal' })).status).toBe(403);
    expect((await post('/open-url', { url: 'file:///etc/passwd' })).status).toBe(400);
  });
});

describe('local agent app skills (validation only — nothing is actually run)', () => {
  it('opens only folders inside allowed directories, in allowed editors', async () => {
    expect((await post('/open-project', { path: '/etc' })).status).toBe(403);
    expect((await post('/open-project', { path: join(dir, 'notes.txt') })).status).toBe(400);
    expect((await post('/open-project', { path: dir, app: 'Visual Studio Code' })).status).toBe(403); // not in this test allowlist
    expect((await post('/open-project', { path: dir, app: 'Activity Monitor' })).status).toBe(400);
  });

  it('rejects malformed skill requests before touching the Mac', async () => {
    expect((await post('/media', { action: 'shuffle-everything' })).status).toBe(400);
    expect((await post('/media', { action: 'play', app: 'Winamp' })).status).toBe(400);
    expect((await post('/volume', { level: 150 })).status).toBe(400);
    expect((await post('/reminders', { title: 'Call Mark', due: 'next blue moon' })).status).toBe(400);
    expect((await post('/calendar', { title: 'Standup' })).status).toBe(400);
    expect((await post('/clipboard', { action: 'erase' })).status).toBe(400);
    expect((await post('/screenshot', {}, {})).status).toBe(401);
  });
});

describe('local agent browser skill (guards only — no browser is started)', () => {
  it('needs approval, refuses money/password tasks, validates input', async () => {
    expect((await post('/browser/act', { task: 'check my latest deployment' })).status).toBe(403); // not confirmed
    const buy = await post('/browser/act', { task: 'buy the pro plan', confirmed: true });
    expect(buy.status).toBe(403);
    expect((await buy.json()).error).toMatch(/never makes purchases/);
    expect((await post('/browser/act', { task: 'log in with my password hunter2', confirmed: true })).status).toBe(403);
    expect((await post('/browser/read', { url: 'https://example.com' })).status).toBe(400); // no question
    expect((await post('/browser/read', { url: 'https://example.com', question: 'x' }, {})).status).toBe(401);
  });
});
