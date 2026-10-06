import { Hono } from 'hono';
import { z } from 'zod';
import { describeProviders } from './ai/AIManager.js';
import { requireUser, type Env } from './lib/auth.js';
import { encrypt } from './lib/crypto.js';
import { UserFacingError } from './lib/util.js';
import { MEMORY_CATEGORIES, saveMemory } from './memory/memory.js';
import { chatRoute } from './routes/chat.js';
import { FacebookProvider } from './social/index.js';
import { TOOLS } from './tools/index.js';
import { transcribe, vocabulary, whisperLanguage } from './voice/transcribe.js';
import { SpeechUnavailableError, synthesize } from './voice/speak.js';
import { webSearchProvider } from './web/search.js';

export const app = new Hono<Env>().basePath('/api');

app.onError((err, c) => {
  if (err instanceof UserFacingError) return c.json({ error: err.message }, 400);
  console.error('[api]', err);
  return c.json({ error: 'Something went wrong on the server.' }, 500);
});

app.get('/health', (c) => c.json({ ok: true }));

// Everything below requires a signed-in user. Plain reads/updates (conversations, memories list,
// tasks, activity, preferences) go straight from the browser to Supabase under RLS.
app.use('*', requireUser);

app.get('/config', (c) =>
  c.json({
    providers: describeProviders(),
    webSearch: webSearchProvider().id,
    github: { token: Boolean(process.env.GITHUB_TOKEN), username: process.env.GITHUB_USERNAME ?? null },
    embeddings: Boolean(process.env.GEMINI_API_KEY),
    stt: Boolean(process.env.GROQ_API_KEY),
    tts: Boolean(process.env.GROQ_API_KEY),
    encryption: Boolean(process.env.TOKEN_ENCRYPTION_KEY),
  }),
);

app.get('/tools', (c) =>
  c.json(TOOLS.map(({ name, description, permission, runOn, group }) => ({ name, description, permission, runOn, group }))),
);

app.post('/chat', chatRoute);

// Whisper's spelling hints change rarely; rebuild them at most every 5 minutes per user.
const vocabCache = new Map<string, { value: string; until: number }>();
async function cachedVocabulary(db: Env['Variables']['db'], userId: string) {
  const hit = vocabCache.get(userId);
  if (hit && hit.until > Date.now()) return hit.value;
  const { data: profile } = await db.from('users').select('display_name').maybeSingle();
  const value = await vocabulary(db, profile?.display_name ?? '');
  vocabCache.set(userId, { value, until: Date.now() + 5 * 60_000 });
  return value;
}

const SpeakBody = z.object({ text: z.string().trim().min(1).max(200), voice: z.string().regex(/^[a-z]{2,20}$/).default('troy') });

// One sentence in, WAV out. 409/429 tell the browser to fall back to its built-in voice.
app.post('/speak', async (c) => {
  const body = SpeakBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'Send up to 200 characters of text.' }, 400);
  try {
    const audio = await synthesize(body.data.text, body.data.voice);
    return new Response(audio, { headers: { 'content-type': 'audio/wav', 'cache-control': 'no-store' } });
  } catch (err) {
    if (err instanceof SpeechUnavailableError) return c.json({ error: err.message }, err.status);
    throw err;
  }
});

// Raw audio in (WAV from the browser), text out. Short commands only.
app.post('/transcribe', async (c) => {
  const type = c.req.header('content-type') ?? '';
  if (!type.startsWith('audio/')) return c.json({ error: 'Send an audio recording.' }, 415);
  const audio = await c.req.arrayBuffer();
  if (audio.byteLength > 4_000_000) return c.json({ error: 'That recording is too long.' }, 413);
  if (audio.byteLength < 4_000) return c.json({ text: '', unclear: false });
  const result = await transcribe(new Blob([audio], { type }), {
    language: whisperLanguage(c.req.query('lang') ?? ''),
    prompt: await cachedVocabulary(c.var.db, c.var.user.id),
  });
  return c.json(result);
});

const MemoryBody = z.object({
  content: z.string().trim().min(1).max(500),
  category: z.enum(MEMORY_CATEGORIES).default('other'),
  importance: z.number().int().min(1).max(5).default(3),
});

// Memories are created server-side so they get embeddings and the secret filter.
app.post('/memories', async (c) => {
  const body = MemoryBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'Invalid memory.' }, 400);
  return c.json(await saveMemory(c.var.db, body.data), 201);
});

const FacebookBody = z.object({ pageId: z.string().regex(/^\d{5,25}$/, 'Page ID is numeric'), accessToken: z.string().min(20).max(1000) });

app.post('/accounts/facebook', async (c) => {
  const body = FacebookBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'Enter a numeric Page ID and a Page access token.' }, 400);
  const account = await FacebookProvider.getAccount(body.data.accessToken, body.data.pageId);
  const { error } = await c.var.db.from('connected_accounts').upsert(
    { provider: 'facebook', external_id: account.id, account_name: account.name, token_encrypted: encrypt(body.data.accessToken), scopes: ['pages_manage_posts'] },
    { onConflict: 'user_id,provider' },
  );
  if (error) throw new Error(error.message);
  return c.json({ provider: 'facebook', name: account.name });
});
