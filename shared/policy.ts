// Security policy shared by the web server and the local Mac agent.
// The agent enforces it independently: the server's classification is never trusted on its own.

export type Permission = 'read' | 'write' | 'dangerous';

const SECRET_VALUE =
  /(sk-[A-Za-z0-9_-]{20,}|sk_live_[A-Za-z0-9]{10,}|AIza[0-9A-Za-z_-]{30,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[baprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY)/;
const SECRET_PHRASE =
  /\b(password|passwd|passcode|api[ _-]?key|secret|access[ _-]?token|auth[ _-]?token|private[ _-]?key|pin code|credit card)\b\s*(is|:|=)/i;

/** True when text looks like a credential. Used to refuse memories and redact logs. */
export const looksLikeSecret = (text: string) => SECRET_VALUE.test(text) || SECRET_PHRASE.test(text);

const SECRET_KEY = /pass|secret|token|api.?key|authorization|cookie|credential/i;

/** Deep-copies a value with secret-looking keys/strings replaced by "[redacted]". */
export function redact(value: unknown): unknown {
  if (typeof value === 'string') return looksLikeSecret(value) ? '[redacted]' : value;
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? '[redacted]' : redact(v)]));
  return value;
}

/** Files JARVIS must never read, write, or pass to a command, even inside allowed directories. */
export const SENSITIVE_PATH =
  /(^|\/)(\.ssh|\.gnupg|\.aws|\.azure|\.kube|\.docker|\.netrc|\.npmrc|\.pgpass|\.git-credentials|Keychains)(\/|$)|(^|\/)\.env(?!\.example)(\.[\w-]+)?$|id_(rsa|dsa|ecdsa|ed25519)|\.(pem|p12|pfx|key|keychain-db)$|credentials/i;

export type CommandLevel = 'safe' | 'approval' | 'blocked';
export interface CommandVerdict { level: CommandLevel; argv: string[]; reason?: string }

// Read-only commands that may run without approval (if the user's settings allow it).
const SAFE: Record<string, (args: string[]) => boolean> = {
  pwd: () => true, ls: () => true, whoami: () => true, date: () => true, uptime: () => true, uname: () => true,
  sw_vers: () => true, hostname: () => true, df: () => true, which: () => true, echo: () => true,
  git: ([sub, ...rest]) =>
    ['status', 'log', 'diff', 'show', 'rev-parse'].includes(sub) ||
    (sub === 'branch' && rest.every((a) => ['-a', '-r', '-v', '-vv', '--list'].includes(a))) ||
    (sub === 'remote' && rest.every((a) => a === '-v')),
  node: (a) => a.length === 1 && ['-v', '--version'].includes(a[0]),
  npm: (a) => a.length === 1 && ['-v', '--version'].includes(a[0]),
  python3: (a) => a.length === 1 && a[0] === '--version',
};

const BLOCKED = new Set([
  'rm', 'srm', 'shred', 'sudo', 'su', 'doas', 'dd', 'diskutil', 'fdisk', 'newfs_apfs', 'newfs_hfs', 'shutdown',
  'reboot', 'halt', 'poweroff', 'launchctl', 'security', 'osascript', 'sh', 'bash', 'zsh', 'fish', 'dash', 'ksh',
  'csh', 'tcsh', 'eval', 'exec', 'env', 'xargs', 'nohup', 'chmod', 'chown', 'chgrp', 'chflags', 'kill', 'killall',
  'pkill', 'crontab', 'defaults', 'networksetup', 'scutil', 'pmset', 'systemsetup', 'csrutil', 'nvram', 'spctl',
  'tccutil', 'dscl', 'passwd', 'open',
]);
const INTERPRETERS = new Set(['python', 'python3', 'node', 'ruby', 'perl', 'php', 'deno', 'bun']);

/** Splits a command into argv, honouring simple quotes. Returns null on unbalanced quotes. */
export function splitArgs(command: string): string[] | null {
  const out: string[] = [];
  let cur = '', quote: string | null = null, started = false;
  for (const ch of command) {
    if (quote) ch === quote ? (quote = null) : (cur += ch);
    else if (ch === '"' || ch === "'") (quote = ch), (started = true);
    else if (/\s/.test(ch)) { if (started) out.push(cur), (cur = ''), (started = false); }
    else (cur += ch), (started = true);
  }
  if (quote) return null;
  if (started) out.push(cur);
  return out;
}

/** Classifies a shell command. Commands are executed without a shell (execFile), so no chaining is possible. */
export function classifyCommand(command: string): CommandVerdict {
  const blocked = (reason: string, argv: string[] = []): CommandVerdict => ({ level: 'blocked', argv, reason });
  if (!command.trim()) return blocked('Empty command.');
  if (command.length > 500) return blocked('Command is too long.');
  if (/[;&|`$<>(){}\\\n\r]/.test(command))
    return blocked('Pipes, chaining, redirection and substitution are not allowed.');
  const argv = splitArgs(command.trim());
  if (!argv?.length) return blocked('Could not parse the command.');
  const bin = argv[0].split('/').pop()!.toLowerCase();
  const args = argv.slice(1);
  if (BLOCKED.has(bin) || /^mkfs/.test(bin)) return blocked(`"${bin}" is blocked for safety.`, argv);
  if (INTERPRETERS.has(bin) && args.some((a) => /^(-c|-e|-p|--eval|--print|-r)$/.test(a)))
    return blocked('Inline interpreter code is blocked.', argv);
  if (bin === 'find' && args.some((a) => /^-(delete|exec|execdir|ok|okdir)$/.test(a)))
    return blocked('find with -delete/-exec is blocked.', argv);
  if (bin === 'git' && (args[0] === 'clean' || args.some((a) => ['--force', '-f', '--hard'].includes(a)) || args.some((a) => a.startsWith('--output'))))
    return blocked('Destructive git operations are blocked.', argv);
  if (argv.some((a) => SENSITIVE_PATH.test(a))) return blocked('Commands may not touch credential files.', argv);
  return { level: SAFE[bin]?.(args) ? 'safe' : 'approval', argv };
}
