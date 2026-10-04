// Scores a model on evals/commands.ts.  npm run eval -- --provider=groq  [--model=openai/gpt-oss-120b] [--delay=2500]
import { PROVIDERS } from '../server/ai/AIManager.js';
import { systemPrompt } from '../server/memory/context.js';
import { selectTools, toAITool } from '../server/tools/index.js';
import { CASES, type Call, type Case } from './commands.js';

try {
  process.loadEnvFile('.env');
} catch {
  /* env may come from the shell */
}

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
const providerId = arg('provider') ?? 'gemini';
const provider = PROVIDERS[providerId];
if (!provider?.isConfigured()) throw new Error(`Provider "${providerId}" isn't configured`);
const modelEnv = { gemini: 'GEMINI_MODEL', groq: 'GROQ_MODEL', openrouter: 'OPENROUTER_MODEL', claude: 'ANTHROPIC_MODEL' }[providerId]!;
if (arg('model')) process.env[modelEnv] = arg('model');
const delay = Number(arg('delay') ?? (providerId === 'gemini' ? 4500 : 2500)); // stay under free-tier rate limits

const MEMORIES = [
  'Leou is building a project called JARVIS.',
  "Dicta is Leou's social quote app, located at /Volumes/Mac Storage/Development/dicta.",
  "13C is one of Leou's projects; its website is https://13c.online.",
  'Kassix is a POS app: 60 days free, then 149 pesos a month.',
];
const system = systemPrompt({ name: 'Leou', now: 'Monday, October 5, 2026 at 10:00 AM', tz: 'Asia/Manila', platform: 'facebook', memories: MEMORIES });

function judge(c: Case, calls: Call[]): string | null {
  const names = calls.map((x) => x.name);
  const bad = names.find((n) => c.forbid?.includes(n));
  if (bad) return `called forbidden ${bad}`;
  if (!names.length) return c.ok.includes('none') ? null : `no tool (expected ${c.ok.join('/')})`;
  const hit = calls.find((x) => c.ok.includes(x.name));
  if (!hit) return `called ${names.join(', ')} (expected ${c.ok.join('/')})`;
  if (c.args && !c.args(hit)) return `${hit.name} args off: ${JSON.stringify(hit.args).slice(0, 120)}`;
  return null;
}

console.log(`\nJARVIS eval · ${provider.label} · ${provider.model} · ${CASES.length} cases\n`);
const results: { ok: boolean; ms: number }[] = [];
const failures: string[] = [];
for (const c of CASES) {
  const tools = selectTools(c.say).map(toAITool);
  const started = Date.now();
  let verdict: string | null;
  try {
    const res = await provider.chat([{ role: 'system', content: system }, { role: 'user', content: c.say }], tools);
    const calls = res.toolCalls.map((t) => ({ name: t.function.name, args: JSON.parse(t.function.arguments || '{}') }));
    verdict = judge(c, calls);
  } catch (e) {
    verdict = `error: ${(e as Error).message.slice(0, 100)}`;
  }
  const ms = Date.now() - started;
  results.push({ ok: !verdict, ms });
  console.log(`${verdict ? '✗' : '✓'} ${String(ms).padStart(5)}ms  ${c.say}${verdict ? `  →  ${verdict}` : ''}`);
  if (verdict) failures.push(`${c.say} → ${verdict}`);
  await new Promise((r) => setTimeout(r, delay));
}
const sorted = results.map((r) => r.ms).sort((a, b) => a - b);
const passed = results.filter((r) => r.ok).length;
console.log(`\nScore ${passed}/${results.length} (${Math.round((passed / results.length) * 100)}%) · median ${sorted[Math.floor(sorted.length / 2)]}ms · p90 ${sorted[Math.floor(sorted.length * 0.9)]}ms`);
