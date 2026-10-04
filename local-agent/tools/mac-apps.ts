import { execFile, spawn } from 'node:child_process';
import { readFile, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { looksLikeSecret } from '../../shared/policy.js';
import type { AgentConfig } from '../config/index.js';
import { AgentError, resolveAllowedPath } from '../security/index.js';

// App "skills". Every AppleScript here is a fixed script; user text is only ever passed as argv
// (`on run argv`), never spliced into the script, so it can't inject commands.

const run = promisify(execFile);

async function applescript(lines: string[], args: string[] = []) {
  try {
    // Leading dashes would be read as osascript options.
    const argv = args.map((a) => a.replace(/^-+/, ''));
    const { stdout } = await run('osascript', [...lines.flatMap((l) => ['-e', l]), ...argv], { timeout: 20_000 });
    return stdout.trim();
  } catch (e: any) {
    // First use of each app shows a macOS "wants access to control …" prompt; osascript waits on it.
    if (e.killed)
      throw new AgentError(500, 'macOS is asking for permission to let JARVIS control that app. Look for the dialog, click OK, then ask again.');
    const msg = String(e.stderr ?? '');
    if (/-1743|not authori[sz]ed/i.test(msg))
      throw new AgentError(403, 'macOS blocked JARVIS from controlling that app. Allow it in System Settings → Privacy & Security → Automation (under Terminal), then try again.');
    throw new AgentError(500, `The Mac couldn't do that${msg ? `: ${msg.split('\n')[0].replace(/^.*?execution error: /, '').slice(0, 160)}` : '.'}`);
  }
}

export const EDITORS = ['Visual Studio Code', 'Cursor', 'Xcode', 'Finder', 'Terminal'] as const;

export async function openProject(path: string, app: string | undefined, cfg: AgentConfig) {
  const full = await resolveAllowedPath(path, cfg.allowedDirectories, true);
  if (!(await stat(full)).isDirectory()) throw new AgentError(400, 'That path is a file, not a project folder.');
  const target = app ?? 'Visual Studio Code';
  const allowed = EDITORS.filter((e) => cfg.allowedApps.includes(e));
  if (!allowed.includes(target as (typeof EDITORS)[number]))
    throw new AgentError(403, `${target} can't open projects here. Allowed: ${allowed.join(', ') || 'none'}.`);
  await run('open', ['-a', target, full], { timeout: 10_000 }).catch(() => {
    throw new AgentError(404, `${target} doesn't seem to be installed.`);
  });
  return `Opened ${full} in ${target}.`;
}

export const PLAYERS = ['Spotify', 'Music'] as const;
export const MEDIA_ACTIONS = ['play', 'pause', 'toggle', 'next', 'previous', 'status'] as const;

const isRunning = (app: string) => run('pgrep', ['-x', app]).then(() => true, () => false);

export async function media(action: (typeof MEDIA_ACTIONS)[number], app?: (typeof PLAYERS)[number]) {
  const player = app ?? ((await isRunning('Spotify')) ? 'Spotify' : 'Music');
  if (action === 'status') {
    if (!(await isRunning(player))) return `${player} isn't open.`;
    const now = await applescript([
      `tell application "${player}"`,
      'if player state is playing then',
      'return "Playing " & (name of current track) & " by " & (artist of current track)',
      'else',
      'return "Paused"',
      'end if',
      'end tell',
    ]);
    return `${player}: ${now}.`;
  }
  const verb = { play: 'play', pause: 'pause', toggle: 'playpause', next: 'next track', previous: 'previous track' }[action];
  await applescript([`tell application "${player}" to ${verb}`]);
  return `${player}: ${action === 'toggle' ? 'play/pause toggled' : action === 'previous' ? 'previous track' : action === 'next' ? 'next track' : action}.`;
}

export async function volume(level?: number, mute?: boolean) {
  if (typeof mute === 'boolean') await applescript([`set volume output muted ${mute}`]);
  if (typeof level === 'number') await applescript([`set volume output volume ${Math.round(Math.max(0, Math.min(100, level)))}`]);
  const [v, muted] = (await applescript(['set s to get volume settings', 'return (output volume of s as text) & "," & (output muted of s as text)'])).split(',');
  return `Volume is ${v}%${muted === 'true' ? ' (muted)' : ''}.`;
}

/** Local date-time → [year, month, day, hours, minutes] in the Mac's timezone. */
export function dateParts(when: string): string[] {
  const d = new Date(when);
  if (Number.isNaN(d.getTime())) throw new AgentError(400, `"${when}" isn't a date and time I understand.`);
  return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()].map(String);
}

/** AppleScript that builds date `v` from argv items i…i+4 (day reset first so month changes can't overflow). */
const setDate = (v: string, i: number) => [
  `set ${v} to current date`,
  `set day of ${v} to 1`,
  `set year of ${v} to (item ${i} of argv as integer)`,
  `set month of ${v} to (item ${i + 1} of argv as integer)`,
  `set day of ${v} to (item ${i + 2} of argv as integer)`,
  `set hours of ${v} to (item ${i + 3} of argv as integer)`,
  `set minutes of ${v} to (item ${i + 4} of argv as integer)`,
  `set seconds of ${v} to 0`,
];

const human = (when: string) => new Date(when).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

export async function reminder(title: string, due?: string) {
  const parts = due ? dateParts(due) : [];
  await applescript(
    [
      'on run argv',
      ...(due ? setDate('d', 2) : []),
      'tell application "Reminders"',
      'set r to make new reminder with properties {name:(item 1 of argv)}',
      ...(due ? ['set due date of r to d', 'set remind me date of r to d'] : []),
      'end tell',
      'end run',
    ],
    [title, ...parts],
  );
  return `Reminder added: "${title}"${due ? ` for ${human(due)}` : ''}.`;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function note(title: string, body: string) {
  const html = `<h1>${escapeHtml(title)}</h1>${escapeHtml(body).replace(/\n/g, '<br>')}`;
  await applescript(['on run argv', 'tell application "Notes" to make new note with properties {body:(item 1 of argv)}', 'end run'], [html]);
  return `Note created: "${title}".`;
}

export async function calendarEvent(title: string, start: string, durationMinutes = 60) {
  const calendar = await applescript(
    [
      'on run argv',
      ...setDate('s', 2),
      'set e to s + ((item 7 of argv) as integer) * minutes',
      'tell application "Calendar"',
      'set c to first calendar whose writable is true',
      'make new event at end of events of c with properties {summary:(item 1 of argv), start date:s, end date:e}',
      'return name of c',
      'end tell',
      'end run',
    ],
    [title, ...dateParts(start), String(Math.round(durationMinutes))],
  );
  return `Added "${title}" to your ${calendar} calendar on ${human(start)} (${durationMinutes} min).`;
}

/** Main display as a downscaled JPEG data URL. */
export async function screenshot() {
  const file = join(tmpdir(), `jarvis-screen-${process.pid}-${Date.now()}.jpg`);
  try {
    await run('screencapture', ['-x', '-m', '-t', 'jpg', file], { timeout: 15_000 });
    await run('sips', ['-Z', '1600', '-s', 'formatOptions', '70', file], { timeout: 15_000 });
    return `data:image/jpeg;base64,${(await readFile(file)).toString('base64')}`;
  } catch {
    throw new AgentError(500, "I couldn't capture the screen. Allow Screen Recording for Terminal (or node) in System Settings → Privacy & Security.");
  } finally {
    await unlink(file).catch(() => {});
  }
}

export async function clipboard(action: 'read' | 'write', text = '') {
  if (action === 'read') {
    const { stdout } = await run('pbpaste', [], { timeout: 5_000, maxBuffer: 1 << 20 });
    if (!stdout.trim()) return 'The clipboard is empty (or holds an image or file).';
    if (looksLikeSecret(stdout)) return "The clipboard holds something that looks like a password or key, so I won't read it.";
    return stdout.length > 5000 ? `${stdout.slice(0, 5000)}\n… [truncated]` : stdout;
  }
  await new Promise<void>((resolve, reject) => {
    const p = spawn('pbcopy');
    p.on('error', reject);
    p.on('close', () => resolve());
    p.stdin.end(text);
  });
  return 'Copied to the clipboard.';
}
