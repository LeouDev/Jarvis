import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { cpus, homedir, hostname, totalmem, uptime } from 'node:os';
import { dirname, sep } from 'node:path';
import { promisify } from 'node:util';
import { classifyCommand, SENSITIVE_PATH } from '../../shared/policy.js';
import type { AgentConfig } from '../config/index.js';
import { AgentError, resolveAllowedPath } from '../security/index.js';

const run = promisify(execFile);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n… [truncated]` : s);
const SAFE_ENV = () => ({ PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: homedir(), LANG: 'en_US.UTF-8' });

const ALIASES: Record<string, string> = {
  'vs code': 'Visual Studio Code', vscode: 'Visual Studio Code', code: 'Visual Studio Code',
  chrome: 'Google Chrome', settings: 'System Settings', 'system preferences': 'System Settings',
};

/** Opens an allowlisted app with `open -a`. No shell, no arbitrary arguments. */
export async function openApp(name: string, cfg: AgentConfig) {
  const wanted = name.trim().replace(/\.app$/i, '').toLowerCase();
  const target = (ALIASES[wanted] ?? wanted).toLowerCase();
  const app = cfg.allowedApps.find((a) => a.toLowerCase() === target);
  if (!app) throw new AgentError(403, `"${name}" isn't in the allowed applications list.`);
  try {
    await run('open', ['-a', app], { timeout: 10_000 });
  } catch {
    throw new AgentError(404, `${app} doesn't seem to be installed.`);
  }
  return `Opened ${app}.`;
}

export async function openUrl(url: string) {
  const u = new URL(url);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new AgentError(400, 'Only http(s) links can be opened.');
  await run('open', [u.toString()], { timeout: 10_000 });
  return `Opened ${u.toString()}.`;
}

/** Runs one validated command via execFile (no shell). Blocked commands never run; risky ones need `confirmed`. */
export async function runCommand(command: string, cwd: string | undefined, confirmed: boolean, cfg: AgentConfig) {
  const verdict = classifyCommand(command);
  if (verdict.level === 'blocked') throw new AgentError(403, verdict.reason ?? 'Command blocked.');
  if (verdict.level === 'approval' && !confirmed) throw new AgentError(403, 'This command needs your approval in JARVIS first.');
  const dir = cwd ? await resolveAllowedPath(cwd, cfg.allowedDirectories, true) : homedir();
  const [bin, ...args] = verdict.argv;
  try {
    const { stdout, stderr } = await run(bin, args, { cwd: dir, timeout: 20_000, maxBuffer: 1 << 20, env: SAFE_ENV() });
    return { output: clip(`${stdout}${stderr}`.trim() || '(no output)', 8000), exitCode: 0, cwd: dir };
  } catch (e: any) {
    if (e.code === 'ENOENT') throw new AgentError(404, `Command not found: ${bin}`);
    const out = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim() || e.message;
    return { output: clip(out, 8000), exitCode: typeof e.code === 'number' ? e.code : 1, cwd: dir };
  }
}

const IGNORED = /(^|\/)(node_modules|\.git|\.next|dist|build|\.venv|__pycache__)(\/|$)/;

/** Reads a text file, or lists a directory (project structure). */
export async function readPath(path: string, cfg: AgentConfig) {
  const full = await resolveAllowedPath(path, cfg.allowedDirectories, true);
  const info = await stat(full);
  if (info.isDirectory()) {
    const entries = await readdir(full, { withFileTypes: true });
    const lines = entries
      .filter((e) => !IGNORED.test(e.name) && !SENSITIVE_PATH.test(`${full}/${e.name}`))
      .slice(0, 200)
      .map((e) => `${e.name}${e.isDirectory() ? '/' : ''}`);
    return `${full}${sep}\n${lines.join('\n') || '(empty)'}`;
  }
  if (info.size > 256 * 1024) throw new AgentError(413, 'That file is larger than 256 KB.');
  const buf = await readFile(full);
  if (buf.includes(0)) throw new AgentError(415, "That's a binary file; I can only read text.");
  return clip(buf.toString('utf8'), 50_000);
}

export async function writePath(path: string, content: string, overwrite: boolean, cfg: AgentConfig) {
  const full = await resolveAllowedPath(path, cfg.allowedDirectories, false);
  if (existsSync(full) && !overwrite) throw new AgentError(409, 'That file already exists. Ask me to overwrite it if you mean to replace it.');
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content, 'utf8');
  return `Wrote ${Buffer.byteLength(content)} bytes to ${full}.`;
}

/** Spotlight name search limited to allowed directories. */
export async function searchFiles(query: string, directory: string | undefined, cfg: AgentConfig) {
  const dirs = directory
    ? [await resolveAllowedPath(directory, cfg.allowedDirectories, true)]
    : cfg.allowedDirectories.filter((d) => existsSync(d));
  const found: string[] = [];
  for (const dir of dirs) {
    const { stdout } = await run('mdfind', ['-onlyin', dir, '-name', query], { timeout: 10_000, maxBuffer: 4 << 20 }).catch(() => ({ stdout: '' }));
    found.push(...stdout.split('\n').filter((p) => p && !IGNORED.test(p) && !SENSITIVE_PATH.test(p)));
    if (found.length >= 30) break;
  }
  return found.slice(0, 30).join('\n') || 'No matching files.';
}

async function cpuPercent() {
  const sample = () => cpus().map((c) => ({ idle: c.times.idle, total: Object.values(c.times).reduce((a, b) => a + b, 0) }));
  const a = sample();
  await new Promise((r) => setTimeout(r, 250));
  const b = sample();
  const idle = b.reduce((s, c, i) => s + c.idle - a[i].idle, 0);
  const total = b.reduce((s, c, i) => s + c.total - a[i].total, 0);
  return total ? Math.round((1 - idle / total) * 100) : 0;
}

/** "Memory used" like Activity Monitor: app (active) + wired + compressed pages. */
async function memoryPercent() {
  try {
    const { stdout } = await run('vm_stat');
    const page = Number(stdout.match(/page size of (\d+)/)?.[1] ?? 4096);
    const pages = (label: string) => Number(stdout.match(new RegExp(`${label}:\\s+(\\d+)`))?.[1] ?? 0);
    const used = (pages('Pages active') + pages('Pages wired down') + pages('Pages occupied by compressor')) * page;
    return Math.round((used / totalmem()) * 100);
  } catch {
    return null;
  }
}

async function diskPercent() {
  try {
    const { stdout } = await run('df', ['-k', '/System/Volumes/Data']);
    return Number(stdout.trim().split('\n')[1]?.match(/(\d+)%/)?.[1] ?? NaN) || null;
  } catch {
    return null;
  }
}

async function networkMs() {
  const start = performance.now();
  try {
    await fetch('https://www.gstatic.com/generate_204', { method: 'HEAD', signal: AbortSignal.timeout(3000) });
    return Math.round(performance.now() - start);
  } catch {
    return null;
  }
}

export async function systemStatus() {
  const [cpu, memory, disk, network] = await Promise.all([cpuPercent(), memoryPercent(), diskPercent(), networkMs()]);
  const data = { cpu, memory, disk, networkMs: network, hostname: hostname(), uptimeHours: Math.round(uptime() / 360) / 10 };
  const output = `CPU ${cpu}% · Memory ${memory ?? '?'}% · Disk ${disk ?? '?'}% · Network ${network === null ? 'offline' : `${network} ms`} · ${data.hostname}, up ${data.uptimeHours} h`;
  return { output, data };
}
