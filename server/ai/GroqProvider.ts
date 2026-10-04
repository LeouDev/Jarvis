import { OpenAICompatibleProvider } from './AIProvider.js';

// Free tier: https://console.groq.com/keys
export const GroqProvider = new OpenAICompatibleProvider({
  id: 'groq',
  label: 'Groq',
  baseUrl: 'https://api.groq.com/openai/v1',
  apiKeyEnv: 'GROQ_API_KEY',
  modelEnv: 'GROQ_MODEL',
  defaultModel: 'openai/gpt-oss-120b',
});
