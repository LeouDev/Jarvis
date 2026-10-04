import { AIProviderError, type AIMessage, type AIProvider, type AIResponse, type AITool } from './AIProvider.js';
import { GeminiProvider } from './GeminiProvider.js';
import { GroqProvider } from './GroqProvider.js';
import { OpenRouterProvider } from './OpenRouterProvider.js';
import { ClaudeProvider } from './ClaudeProvider.js';

export const PROVIDERS: Record<string, AIProvider> = {
  gemini: GeminiProvider,
  groq: GroqProvider,
  openrouter: OpenRouterProvider,
  claude: ClaudeProvider,
};

export class AIUnavailableError extends Error {}

const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

/** Primary provider (user preference if configured, else AI_PROVIDER) followed by configured fallbacks. */
export function providerOrder(preferred?: string): AIProvider[] {
  const primary = preferred && PROVIDERS[preferred]?.isConfigured() ? preferred : (process.env.AI_PROVIDER || 'gemini').toLowerCase();
  const fallbacks = process.env.AI_FALLBACK === undefined ? ['groq', 'openrouter'] : list(process.env.AI_FALLBACK);
  return [...new Set([primary, ...fallbacks])].map((id) => PROVIDERS[id]).filter((p) => p?.isConfigured());
}

export function describeProviders() {
  const primary = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
  return Object.values(PROVIDERS).map((p) => ({ id: p.id, label: p.label, model: p.model, configured: p.isConfigured(), default: p.id === primary }));
}

export async function chat(
  messages: AIMessage[],
  tools: AITool[] = [],
  opts: { preferred?: string; onText?: (d: string) => void; onNotice?: (m: string) => void } = {},
): Promise<AIResponse> {
  const order = providerOrder(opts.preferred);
  if (!order.length) {
    const wanted = PROVIDERS[(process.env.AI_PROVIDER || 'gemini').toLowerCase()];
    throw new AIUnavailableError(
      wanted
        ? `${wanted.label} isn't configured. Add its API key to .env (e.g. GEMINI_API_KEY) and restart.`
        : `Unknown AI_PROVIDER "${process.env.AI_PROVIDER}". Use gemini, groq, openrouter or claude.`,
    );
  }
  for (const [i, provider] of order.entries()) {
    let streamed = false;
    const started = Date.now();
    // With a fallback available, don't wait on a provider that's slow to start (free tiers queue).
    const firstChunkTimeoutMs = order[i + 1] ? Number(process.env.AI_FIRST_CHUNK_TIMEOUT_MS) || 6000 : undefined;
    try {
      const res = await provider.chat(
        messages,
        tools,
        (d) => {
          streamed = true;
          opts.onText?.(d);
        },
        { firstChunkTimeoutMs },
      );
      console.log(`[ai] ${provider.id}/${provider.model} ${Date.now() - started}ms${res.toolCalls.length ? ` → ${res.toolCalls.map((c) => c.function.name).join(', ')}` : ''}`);
      return res;
    } catch (err) {
      console.error(`[ai] ${provider.id} failed:`, (err as Error).message);
      const next = order[i + 1];
      // A half-streamed answer can't be retried cleanly on another provider.
      if (streamed) throw new AIUnavailableError(`${provider.label} stopped responding mid-answer. Please try again.`);
      if (!next) {
        throw new AIUnavailableError(
          i > 0
            ? `${order[0].label} is currently unavailable and the fallback providers failed too. Please try again shortly.`
            : `${provider.label} is currently unavailable. Configure a fallback provider (e.g. GROQ_API_KEY) and I can try it.`,
        );
      }
      const slow = err instanceof AIProviderError && err.status === 504;
      opts.onNotice?.(`${provider.label} is ${slow ? 'responding slowly' : 'currently unavailable'}. Trying ${next.label}.`);
    }
  }
  throw new AIUnavailableError('No AI provider responded.');
}
