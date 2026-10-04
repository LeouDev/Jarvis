import { describe, expect, it } from 'vitest';
import { findWake, speakable, WAKE } from '../src/lib/voice';

const command = (heard: string) => heard.match(WAKE)?.[2].trim() ?? null;

describe('wake word', () => {
  it('extracts the command after "Jarvis"', () => {
    expect(command('Jarvis, open VS Code')).toBe('open VS Code');
    expect(command('hey Jarvis what time is it')).toBe('what time is it');
    expect(command('OK javis. remember that Dicta is my quote app')).toBe('remember that Dicta is my quote app');
  });

  it('wakes with an empty command when only the name is said', () => {
    expect(command('Jarvis')).toBe('');
    expect(command('hey Jarvis?')).toBe('');
  });

  it('checks every recognizer alternative and common mishearings', () => {
    expect(findWake(['service open VS Code', 'Jarvis open VS Code'])).toBe('open VS Code');
    expect(findWake(['hey Jarbis what time is it'])).toBe('what time is it');
    expect(findWake(['open the door', 'open the drawer'])).toBeNull();
  });

  it('ignores speech without the wake word', () => {
    expect(command('I told Travis about the project')).toBeNull();
    expect(command('open VS Code')).toBeNull();
  });
});

describe('speech text', () => {
  it('strips markdown and links before speaking', () => {
    expect(speakable('**Done.** See [the docs](https://x.dev) or https://y.dev')).toBe('Done. See the docs or link');
  });
});
