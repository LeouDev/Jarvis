import { OpenAICompatibleProvider } from './AIProvider.js';

// Free tier: https://aistudio.google.com/apikey
export const GeminiProvider = new OpenAICompatibleProvider({
  id: 'gemini',
  label: 'Gemini',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  apiKeyEnv: 'GEMINI_API_KEY',
  modelEnv: 'GEMINI_MODEL',
  defaultModel: 'gemini-3.5-flash-lite', // ~1s on the free tier; full Flash models measured 12–15s
  keepToolCallExtras: true, // thought signatures must be sent back with tool calls
  extraBody: () => ({ reasoning_effort: process.env.GEMINI_REASONING_EFFORT || 'low' }),
});
