import { describe, expect, it } from 'vitest';
import { sentenceChunker, splitLong } from '../src/lib/speech';

const chunks = (deltas: string[], max?: number) => {
  const out: string[] = [];
  const c = sentenceChunker((x) => out.push(x), max);
  deltas.forEach((d) => c.push(d));
  const beforeFlush = [...out];
  c.flush();
  return { beforeFlush, all: out };
};

describe('speaking while streaming', () => {
  it('emits the first sentence as soon as it is complete', () => {
    const { beforeFlush } = chunks(['Certainly', ', Leou. Opening', ' VS Code now.', ' It should appear shortly.']);
    expect(beforeFlush[0]).toBe('Certainly, Leou.');
  });

  it('merges later sentences up to the TTS limit and never loses text', () => {
    const text = 'One. Two is here. Three follows! Four? Five ends it.';
    const { all } = chunks(text.split(/(?<=\s)/), 30);
    expect(all.join(' ')).toBe(text);
    expect(all.every((c) => c.length <= 30)).toBe(true);
    expect(all.length).toBeLessThan(5);
  });

  it('does not split decimals, versions or domains', () => {
    const { all } = chunks(['Version 3.5 is live at 13c.online today. Done.']);
    expect(all[0]).toBe('Version 3.5 is live at 13c.online today.');
  });

  it('splits overlong sentences at commas or spaces, within the limit', () => {
    const long = `${'word '.repeat(60)}end.`;
    const parts = splitLong(long, 190);
    expect(parts.every((p) => p.length <= 190)).toBe(true);
    expect(parts.join(' ')).toBe(long.trim());
  });
});
