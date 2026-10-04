import { OpenAICompatibleProvider } from './AIProvider.js';

// Optional. Uses Anthropic's OpenAI-compatible endpoint; swap for the native Messages API
// (prompt caching, extended thinking) when Claude becomes a primary provider.
export const ClaudeProvider = new OpenAICompatibleProvider({
  id: 'claude',
  label: 'Claude',
  baseUrl: 'https://api.anthropic.com/v1',
  apiKeyEnv: 'ANTHROPIC_API_KEY',
  modelEnv: 'ANTHROPIC_MODEL',
  defaultModel: 'claude-sonnet-5-5',
});
