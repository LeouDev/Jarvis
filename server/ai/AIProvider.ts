// Provider-neutral chat types. Messages use the OpenAI chat format, which Gemini, Groq,
// OpenRouter and Anthropic all accept through their OpenAI-compatible endpoints.

export interface AIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
  /** Provider extras that must round-trip (e.g. Gemini thought signatures). */
  extra_content?: unknown;
}

export interface AIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: AIToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface AITool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AIResponse {
  text: string;
  toolCalls: AIToolCall[];
  provider: string;
  model: string;
}

export interface AIProvider {
  id: string;
  label: string;
  readonly model: string;
  isConfigured(): boolean;
  /** Streams text through onText when given; always resolves with the full response. */
  chat(messages: AIMessage[], tools?: AITool[], onText?: (delta: string) => void, opts?: ChatOptions): Promise<AIResponse>;
}

export interface ChatOptions {
  /** Abort if the provider hasn't started streaming by then (lets the manager fall back quickly). */
  firstChunkTimeoutMs?: number;
}

export class AIProviderError extends Error {
  constructor(public provider: string, public status: number, detail: string) {
    super(`${provider} request failed (${status}): ${detail.slice(0, 300)}`);
  }
}

interface CompatConfig {
  id: string;
  label: string;
  baseUrl: string;
  apiKeyEnv: string;
  modelEnv: string;
  defaultModel: string;
  headers?: Record<string, string>;
  extraBody?: () => Record<string, unknown>;
  /** Keep provider-specific fields on tool calls (only the provider that produced them understands them). */
  keepToolCallExtras?: boolean;
}

export class OpenAICompatibleProvider implements AIProvider {
  constructor(private cfg: CompatConfig) {}

  get id() { return this.cfg.id; }
  get label() { return this.cfg.label; }
  get model() { return process.env[this.cfg.modelEnv] || this.cfg.defaultModel; }
  isConfigured() { return Boolean(process.env[this.cfg.apiKeyEnv]); }

  async chat(messages: AIMessage[], tools: AITool[] = [], onText?: (delta: string) => void, opts: ChatOptions = {}): Promise<AIResponse> {
    const body = {
      model: this.model,
      stream: true,
      messages: this.cfg.keepToolCallExtras ? messages : messages.map(stripExtras),
      ...(tools.length ? { tools: tools.map((t) => ({ type: 'function', function: t })) } : {}),
      ...this.cfg.extraBody?.(),
    };
    const slow = new AbortController();
    const firstChunkTimer = opts.firstChunkTimeoutMs
      ? setTimeout(() => slow.abort(new AIProviderError(this.label, 504, 'no response within the first-chunk timeout')), opts.firstChunkTimeoutMs)
      : undefined;
    let text = '';
    const calls: AIToolCall[] = [];
    try {
      const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${process.env[this.cfg.apiKeyEnv]}`,
          'content-type': 'application/json',
          ...this.cfg.headers,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.any([slow.signal, AbortSignal.timeout(90_000)]),
      });
      if (!res.ok || !res.body) throw new AIProviderError(this.label, res.status, await res.text().catch(() => ''));

      for await (const data of sseData(res.body)) {
        clearTimeout(firstChunkTimer);
        if (data === '[DONE]') break;
        const chunk = JSON.parse(data);
        if (chunk.error) throw new AIProviderError(this.label, 500, JSON.stringify(chunk.error));
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.content) {
          text += delta.content;
          onText?.(delta.content);
        }
        for (const tc of delta.tool_calls ?? []) {
          const i = tc.index ?? calls.length;
          const cur = (calls[i] ??= { id: '', type: 'function', function: { name: '', arguments: '' } });
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.function.name += tc.function.name;
          if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
          if (tc.extra_content) cur.extra_content = tc.extra_content;
        }
      }
    } catch (err) {
      throw slow.signal.aborted ? slow.signal.reason : err;
    } finally {
      clearTimeout(firstChunkTimer);
    }
    const toolCalls = calls.filter(Boolean).map((c, i) => ({
      ...c,
      id: c.id || `call_${Date.now().toString(36)}_${i}`,
      function: { ...c.function, arguments: c.function.arguments || '{}' },
    }));
    return { text, toolCalls, provider: this.id, model: this.model };
  }
}

function stripExtras(m: AIMessage): AIMessage {
  return m.tool_calls ? { ...m, tool_calls: m.tool_calls.map(({ id, type, function: fn }) => ({ id, type, function: fn })) } : m;
}

/** Yields the payload of each `data:` line of a server-sent-events stream. */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop()!;
    for (const line of lines) if (line.startsWith('data:')) yield line.slice(5).trim();
  }
  if (buffer.startsWith('data:')) yield buffer.slice(5).trim();
}
