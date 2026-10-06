// Natural speech via Orpheus on Groq (OpenAI-compatible /audio/speech). Orpheus takes ≤200
// characters per request, so the browser sends one sentence (or a few short ones) at a time.

export class SpeechUnavailableError extends Error {
  constructor(message: string, public status: 409 | 429 | 502, public retryAfter?: number) {
    super(message);
  }
}

export const ORPHEUS_TERMS_URL = 'https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english';

export async function synthesize(text: string, voice: string, retried = false): Promise<ArrayBuffer> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new SpeechUnavailableError('Natural voice needs GROQ_API_KEY on the server.', 409);
  const res = await fetch('https://api.groq.com/openai/v1/audio/speech', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.GROQ_TTS_MODEL || 'canopylabs/orpheus-v1-english', input: text, voice, response_format: 'wav' }),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.ok) return res.arrayBuffer();
  const detail = await res.text();
  if (detail.includes('model_terms_required'))
    throw new SpeechUnavailableError(`Natural voice is off until the Orpheus terms are accepted on your Groq account: ${ORPHEUS_TERMS_URL}`, 409);
  if (res.status === 429) {
    // A burst limit clears in seconds: wait it out once instead of dropping to the browser voice.
    const wait = Number(res.headers.get('retry-after'));
    if (!retried && wait > 0 && wait <= 5) {
      await new Promise((r) => setTimeout(r, wait * 1000));
      return synthesize(text, voice, true);
    }
    throw new SpeechUnavailableError('Natural voice is rate-limited right now.', 429, wait || undefined);
  }
  console.error('[tts]', res.status, detail.slice(0, 300));
  throw new SpeechUnavailableError(res.status === 400 && detail.includes('voice') ? `Unknown voice "${voice}".` : 'Natural voice failed.', 502);
}
