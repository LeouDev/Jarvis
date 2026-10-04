import { describe, expect, it, vi } from 'vitest';
import { PROJECTS_SETUP, projectLine, saveProject } from '../server/memory/projects';

const p13c = { id: 'p1', name: '13C', aliases: ['thirteen c'], path: '/Dev/13c', website: 'https://13c.online', repo: 'LeouDev/13c', description: 'Event app' };

/** Minimal stand-in for the Supabase query builder. */
function fakeDb(existing: object[] | null, findError?: { message: string; code: string }) {
  const writes: { op: string; row: any }[] = [];
  const result = { select: () => ({ single: async () => ({ data: { ...p13c, ...writes.at(-1)?.row }, error: null }) }) };
  const db = {
    from: () => ({
      select: () => ({ ilike: async () => ({ data: existing, error: findError ?? null }) }),
      insert: (row: object) => (writes.push({ op: 'insert', row }), result),
      update: (row: object) => (writes.push({ op: 'update', row }), { eq: () => result }),
    }),
  } as any;
  return { db, writes };
}

describe('projects', () => {
  it('renders one compact prompt line', () => {
    expect(projectLine(p13c)).toBe('13C (aka thirteen c) · Event app · folder /Dev/13c · site https://13c.online · repo LeouDev/13c');
  });

  it('creates new projects and updates only the given fields of existing ones', async () => {
    const created = fakeDb([]);
    await saveProject(created.db, { name: ' Dicta ', path: '/Dev/dicta', website: '' });
    expect(created.writes).toEqual([{ op: 'insert', row: { name: 'Dicta', path: '/Dev/dicta' } }]);

    const updated = fakeDb([p13c]);
    await saveProject(updated.db, { name: '13c', repo: 'LeouDev/13c-web' });
    expect(updated.writes[0].op).toBe('update');
    expect(updated.writes[0].row).toMatchObject({ name: '13c', repo: 'LeouDev/13c-web' });
    expect(updated.writes[0].row).not.toHaveProperty('path');
  });

  it('explains the one-time setup when the table is missing', async () => {
    const { db } = fakeDb(null, { message: "Could not find the table 'public.projects'", code: 'PGRST205' });
    await expect(saveProject(db, { name: '13C' })).rejects.toThrow(PROJECTS_SETUP);
  });
});
