import type { SupabaseClient } from '@supabase/supabase-js';
import { UserFacingError } from '../lib/util.js';

// Speech-to-text via Whisper on Groq (free tier). Any OpenAI-compatible /audio/transcriptions
// endpoint works the same way, so swapping providers is a URL + key change.

// Whisper invents these on near-silent audio.
const HALLUCINATIONS = /^(thank you\.?|thanks for watching!?|thank you for watching\.?|you|bye\.?|\.+|okay\.?)$/i;

export async function transcribe(audio: Blob, opts: { prompt?: string; language?: string } = {}): Promise<string> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new UserFacingError('Whisper transcription needs GROQ_API_KEY on the server. Switch Settings → Voice → Speech engine to Browser.');
  const form = new FormData();
  form.append('file', audio, audio.type.includes('wav') ? 'speech.wav' : 'speech.webm');
  form.append('model', process.env.GROQ_STT_MODEL || 'whisper-large-v3-turbo');
  form.append('temperature', '0');
  form.append('response_format', 'json');
  if (opts.prompt) form.append('prompt', opts.prompt);
  if (opts.language) form.append('language', opts.language);
  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 429) throw new UserFacingError('Speech transcription is rate-limited right now. Try again in a minute.');
  if (!res.ok) {
    console.error('[stt]', res.status, (await res.text()).slice(0, 300));
    throw new UserFacingError("I couldn't transcribe that audio.");
  }
  const text = String((await res.json()).text ?? '').trim();
  return HALLUCINATIONS.test(text) ? '' : text;
}

/**
 * Whisper's prompt biases spelling toward words it has "seen": the assistant's name, the user's
 * name and their saved projects (e.g. "13C", "Kassix") stop being misheard.
 */
export async function vocabulary(db: SupabaseClient, name: string): Promise<string> {
  const { data } = await db
    .from('memories')
    .select('content')
    .in('category', ['projects', 'work', 'personal', 'technical'])
    .order('importance', { ascending: false })
    .limit(25);
  const facts = (data ?? []).map((m: { content: string }) => m.content).join(' ');
  return `Jarvis${name ? `, ${name}` : ''}. VS Code, GitHub, Facebook, Spotify, Vercel, Supabase. ${facts}`.slice(0, 800);
}

/** Browser language tag → Whisper language code. Speech is English unless Filipino is chosen. */
export const whisperLanguage = (lang: string) => (lang.toLowerCase().startsWith('fil') ? 'tl' : 'en');
