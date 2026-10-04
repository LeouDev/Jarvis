import { describe, expect, it, vi } from 'vitest';
import { saveMemory } from '../server/memory/memory';
import { friendlyError, resolveAction } from '../server/routes/chat';
import { app } from '../server/app';
import { AIUnavailableError } from '../server/ai/AIManager';
import { UserFacingError } from '../server/lib/util';

describe('approval resolution', () => {
  const server = { run_on: 'server' as const, needs_approval: true };
  const agent = { run_on: 'agent' as const, needs_approval: true };

  it('server actions (e.g. publishing) execute only after explicit approval', () => {
    expect(resolveAction(server, { id: 'x', approved: false })).toBe('reject');
    expect(resolveAction(server, { id: 'x', approved: true })).toBe('execute');
  });

  it('agent actions are recorded only when approved and actually run', () => {
    expect(resolveAction(agent, { id: 'x', approved: true, result: { ok: true, output: '/Users/me' } })).toBe('record');
    expect(resolveAction(agent, { id: 'x', approved: true })).toBe('reject');
    expect(resolveAction(agent, { id: 'x', approved: false, result: { ok: true, output: '' } })).toBe('reject');
  });
});

describe('memory safety', () => {
  it('never writes credentials to the database', async () => {
    const insert = vi.fn();
    const db = { from: () => ({ insert }) } as any;
    await expect(saveMemory(db, { content: 'my password is hunter2' })).rejects.toThrow(/can't store/);
    await expect(saveMemory(db, { content: 'key sk-abcdefghijklmnopqrstuvwxyz123456' })).rejects.toThrow(/can't store/);
    expect(insert).not.toHaveBeenCalled();
  });

  it('stores explicit memories with category and importance', async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: 'm1', content: 'Dicta is my social quote app', category: 'projects', importance: 4 }, error: null });
    const insert = vi.fn(() => ({ select: () => ({ single }) }));
    const db = { from: () => ({ insert }) } as any;
    const m = await saveMemory(db, { content: ' Dicta is my social quote app ', category: 'projects', importance: 4 });
    expect(m.id).toBe('m1');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ content: 'Dicta is my social quote app', category: 'projects', importance: 4 }));
  });
});

describe('API', () => {
  it('health is public, everything else needs a session', async () => {
    expect((await app.request('/api/health')).status).toBe(200);
    expect((await app.request('/api/chat', { method: 'POST', body: '{}' })).status).toBe(401);
    expect((await app.request('/api/config')).status).toBe(401);
  });

  it('error messages are user-safe', () => {
    expect(friendlyError(new AIUnavailableError('Gemini is currently unavailable.'))).toBe('Gemini is currently unavailable.');
    expect(friendlyError(new UserFacingError("Facebook isn't connected yet."))).toBe("Facebook isn't connected yet.");
    expect(friendlyError(new Error('ECONNRESET at db.internal:5432 password=...'))).not.toMatch(/ECONNRESET|password/);
  });
});
