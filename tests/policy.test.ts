import { describe, expect, it } from 'vitest';
import { classifyCommand, looksLikeSecret, redact, SENSITIVE_PATH } from '../shared/policy';

describe('command validation', () => {
  it.each(['pwd', 'ls -la', 'git status', 'git log --oneline', 'whoami', 'node --version', 'echo "hello world"'])(
    'allows safe command %s',
    (cmd) => expect(classifyCommand(cmd).level).toBe('safe'),
  );

  it.each(['npm install', 'git pull', 'mkdir test', 'cat notes.txt', 'curl https://example.com', 'git branch -D main'])(
    'requires approval for %s',
    (cmd) => expect(classifyCommand(cmd).level).toBe('approval'),
  );

  it.each([
    'rm -rf /', '/bin/rm -rf ~', 'sudo ls', 'mkfs.apfs /dev/disk2', 'diskutil eraseDisk APFS X disk2', 'shutdown -h now',
    'reboot', 'security dump-keychain', 'security find-generic-password -wa x', 'ls; rm -rf ~', 'echo $(whoami)', 'ls | sh',
    'cat ~/.ssh/id_rsa', 'cat .env', 'python3 -c "import os"', 'node -e "1"', 'bash script.sh', 'find . -delete',
    'git push --force', 'git reset --hard', 'git clean -fd', 'osascript -e "x"', 'echo hi > file', 'open -a Calculator',
    'env rm x', 'xargs rm', 'ls\nrm x', '',
  ])('blocks %j', (cmd) => expect(classifyCommand(cmd).level).toBe('blocked'));

  it('parses quoted arguments', () => {
    expect(classifyCommand(`echo "a b" 'c'`).argv).toEqual(['echo', 'a b', 'c']);
    expect(classifyCommand('echo "unterminated').level).toBe('blocked');
  });
});

describe('secrets', () => {
  it.each([
    'my password is hunter2', 'API key: abc', 'sk-abcdefghijklmnopqrstuvwxyz123456', 'AIzaSyA1234567890abcdefghijklmnopqrstu',
    'ghp_abcdefghijklmnopqrstuvwxyz0123456789', '-----BEGIN RSA PRIVATE KEY-----',
  ])('detects %s', (s) => expect(looksLikeSecret(s)).toBe(true));

  it.each(['Dicta is my social quote app', 'I need to reset my password tomorrow', 'I am building a project called JARVIS'])(
    'allows %s',
    (s) => expect(looksLikeSecret(s)).toBe(false),
  );

  it('redacts secret keys and values deeply', () => {
    expect(redact({ command: 'pwd', token: 'x', nested: [{ apiKey: 'y', note: 'password: z' }] })).toEqual({
      command: 'pwd', token: '[redacted]', nested: [{ apiKey: '[redacted]', note: '[redacted]' }],
    });
  });

  it('protects credential paths', () => {
    for (const p of ['/Users/a/.ssh/id_ed25519', '/x/.env', '/x/.env.local', '/x/cert.pem', '/Users/a/Library/Keychains/login.keychain-db'])
      expect(SENSITIVE_PATH.test(p)).toBe(true);
    for (const p of ['/x/.env.example', '/x/src/app.ts', '/x/README.md']) expect(SENSITIVE_PATH.test(p)).toBe(false);
  });
});
