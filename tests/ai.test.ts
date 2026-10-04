import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chat, providerOrder } from '../server/ai/AIManager';
import { GeminiProvider } from '../server/ai/GeminiProvider';

const sse = (...events: object[]) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n', { status: 200 });

const KEYS = ['AI_PROVIDER', 'AI_FALLBACK', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY'];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of KEYS) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]);
  vi.unstubAllGlobals();
});

describe('AI providers', () => {
  it('streams text and assembles tool calls (keeping Gemini thought signatures)', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const fetchMock = vi.fn().mockResolvedValue(
      sse(
        { choices: [{ delta: { content: 'Opening ' } }] },
        { choices: [{ delta: { content: 'VS Code.' } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'openApplication', arguments: '{"app":' } , extra_content: { google: { thought_signature: 'sig' } } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"Visual Studio Code"}' } }] } }] },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const deltas: string[] = [];
    const res = await GeminiProvider.chat([{ role: 'user', content: 'Open VS Code' }], [], (d) => deltas.push(d));
    expect(deltas.join('')).toBe('Opening VS Code.');
    expect(res.toolCalls).toEqual([
      { id: 'call_1', type: 'function', function: { name: 'openApplication', arguments: '{"app":"Visual Studio Code"}' }, extra_content: { google: { thought_signature: 'sig' } } },
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('generativelanguage.googleapis.com');
    expect(init.headers.authorization).toBe('Bearer test-key');
  });

  it('selects providers from env and skips unconfigured ones', () => {
    process.env.AI_PROVIDER = 'groq';
    process.env.GROQ_API_KEY = 'g';
    process.env.GEMINI_API_KEY = 'x';
    expect(providerOrder().map((p) => p.id)).toEqual(['groq']);
    process.env.AI_FALLBACK = 'gemini';
    expect(providerOrder().map((p) => p.id)).toEqual(['groq', 'gemini']);
    expect(providerOrder('gemini').map((p) => p.id)).toEqual(['gemini']);
  });

  it('falls back to Groq when Gemini fails, and says so', async () => {
    process.env.GEMINI_API_KEY = 'a';
    process.env.GROQ_API_KEY = 'b';
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('quota', { status: 429 }))
      .mockResolvedValueOnce(sse({ choices: [{ delta: { content: 'Hello.' } }] })));
    const notices: string[] = [];
    const res = await chat([{ role: 'user', content: 'Hello JARVIS' }], [], { onNotice: (m) => notices.push(m) });
    expect(res).toMatchObject({ text: 'Hello.', provider: 'groq' });
    expect(notices).toEqual(['Gemini is currently unavailable. Trying Groq.']);
  });

  it('gives an actionable error without a fallback or a key', async () => {
    await expect(chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(/GEMINI_API_KEY/);
    process.env.GEMINI_API_KEY = 'a';
    process.env.AI_FALLBACK = '';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('down', { status: 503 })));
    await expect(chat([{ role: 'user', content: 'hi' }])).rejects.toThrow('Gemini is currently unavailable. Configure a fallback provider');
  });

  it('strips provider-specific tool-call fields for other providers', async () => {
    process.env.AI_PROVIDER = 'groq';
    process.env.GROQ_API_KEY = 'b';
    const fetchMock = vi.fn().mockResolvedValue(sse({ choices: [{ delta: { content: 'ok' } }] }));
    vi.stubGlobal('fetch', fetchMock);
    await chat([{ role: 'assistant', content: null, tool_calls: [{ id: '1', type: 'function', function: { name: 'x', arguments: '{}' }, extra_content: { a: 1 } }] }]);
    expect(fetchMock.mock.calls[0][1].body).not.toContain('extra_content');
  });
});

describe('slow providers', () => {
  it('falls back when the primary does not start streaming in time', async () => {
    process.env.GEMINI_API_KEY = 'a';
    process.env.GROQ_API_KEY = 'b';
    process.env.AI_FIRST_CHUNK_TIMEOUT_MS = '50';
    const hang = (_url: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)));
    vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(hang).mockResolvedValueOnce(sse({ choices: [{ delta: { content: 'Fast.' } }] })));
    const notices: string[] = [];
    const res = await chat([{ role: 'user', content: 'hi' }], [], { onNotice: (m) => notices.push(m) });
    expect(res).toMatchObject({ text: 'Fast.', provider: 'groq' });
    expect(notices).toEqual(['Gemini is responding slowly. Trying Groq.']);
    delete process.env.AI_FIRST_CHUNK_TIMEOUT_MS;
  });
});
