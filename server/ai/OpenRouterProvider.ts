import { OpenAICompatibleProvider } from './AIProvider.js';

// Free models end in ":free": https://openrouter.ai/models?max_price=0
export const OpenRouterProvider = new OpenAICompatibleProvider({
  id: 'openrouter',
  label: 'OpenRouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKeyEnv: 'OPENROUTER_API_KEY',
  modelEnv: 'OPENROUTER_MODEL',
  defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
  headers: { 'X-Title': 'JARVIS' },
});
