import { describe, expect, it } from 'vitest';
import { decide, extractFacts, mightHoldFacts, parseJson } from '../server/memory/consolidate';

const reply = (text: string) => async () => text;
const existing = [{ id: 'm1', content: 'Kassix runs on Firebase.' }];

describe('memory consolidation (mem0-style)', () => {
  it('adds without asking the model when nothing similar exists', async () => {
    let asked = false;
    expect(await decide('Leou likes Tailwind.', [], async () => ((asked = true), ''))).toEqual({ action: 'add' });
    expect(asked).toBe(false);
  });

  it('follows the model: update, replace or already known', async () => {
    expect(await decide('Kassix moved to Supabase.', existing, reply('```json\n{"action":"update","id":"m1","content":"Kassix runs on Supabase (moved from Firebase)."}\n```')))
      .toEqual({ action: 'update', id: 'm1', content: 'Kassix runs on Supabase (moved from Firebase).' });
    expect(await decide('Kassix runs on Supabase.', existing, reply('{"action":"replace","id":"m1"}'))).toEqual({ action: 'replace', id: 'm1' });
    expect(await decide('Kassix uses Firebase.', existing, reply('{"action":"none","id":"m1"}'))).toEqual({ action: 'none', id: 'm1' });
  });

  it('falls back to a plain add on anything unexpected', async () => {
    expect(await decide('x is y', existing, reply('not json'))).toEqual({ action: 'add' });
    expect(await decide('x is y', existing, reply('{"action":"update","id":"someone-elses-id","content":"z"}'))).toEqual({ action: 'add' });
    expect(await decide('x is y', existing, reply('{"action":"update","id":"m1","content":"my password is hunter2"}'))).toEqual({ action: 'add' });
    expect(await decide('x is y', existing, async () => { throw new Error('rate limited'); })).toEqual({ action: 'add' });
  });

  it('only spends a model call on statements about yourself', () => {
    expect(mightHoldFacts("I'm launching 13C in December with my brother.")).toBe(true);
    expect(mightHoldFacts('We switched Kassix to Supabase last week.')).toBe(true);
    for (const t of ['Open VS Code.', 'What time is it?', 'Remember that I like tea.', 'hello there', 'Remind me to call my mom.'])
      expect(mightHoldFacts(t)).toBe(false);
  });

  it('extracts at most three clean facts and never secrets', async () => {
    const facts = await extractFacts('x', '', 'Leou', reply(JSON.stringify({ facts: [
      { content: 'Leou is launching 13C in December.', category: 'projects', importance: 4 },
      { content: "Leou's password is hunter2.", category: 'personal', importance: 5 },
      { content: 'Leou prefers short replies.', category: 'not-a-category', importance: 9 },
    ] })));
    expect(facts).toEqual([
      { content: 'Leou is launching 13C in December.', category: 'projects', importance: 4 },
      { content: 'Leou prefers short replies.', category: 'other', importance: 3 },
    ]);
    expect(parseJson('Sure! {"facts":[]} hope that helps')).toEqual({ facts: [] });
  });
});
