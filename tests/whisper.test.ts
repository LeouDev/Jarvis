import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractTerms, isLooping, looksLikeBleed, transcribe, vocabulary, whisperLanguage } from '../server/voice/transcribe';
import { downsample, encodeWav } from '../src/lib/whisper';

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GROQ_API_KEY;
});

describe('audio encoding', () => {
  it('downsamples by averaging blocks', () => {
    expect(Array.from(downsample(new Float32Array([1, 3, 5, 7, 9, 11]), 3))).toEqual([3, 9]);
  });

  it('writes a valid 16 kHz mono 16-bit WAV', async () => {
    const wav = encodeWav(new Float32Array([0, 1, -1]));
    const v = new DataView(await wav.arrayBuffer());
    const tag = (o: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => v.getUint8(o + i)));
    expect([tag(0), tag(8), tag(12), tag(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect([v.getUint16(22, true), v.getUint32(24, true), v.getUint16(34, true), v.getUint32(40, true)]).toEqual([1, 16000, 16, 6]);
    expect([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true)]).toEqual([0, 32767, -32767]);
    expect(wav.type).toBe('audio/wav');
  });
});

describe('Whisper transcription', () => {
  const audio = new Blob([new Uint8Array(8000)], { type: 'audio/wav' });

  it('sends model, vocabulary prompt and language to Groq', async () => {
    process.env.GROQ_API_KEY = 'test';
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ text: ' Open 13C in VS Code. ', segments: [{ avg_logprob: -0.3 }] }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await transcribe(audio, { prompt: 'Jarvis, Leou. 13C', language: 'en' })).toEqual({ text: 'Open 13C in VS Code.', unclear: false });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    const form = init.body as FormData;
    expect([form.get('model'), form.get('prompt'), form.get('language')]).toEqual(['whisper-large-v3-turbo', 'Jarvis, Leou. 13C', 'en']);
  });

  it('drops Whisper silence hallucinations and explains failures', async () => {
    process.env.GROQ_API_KEY = 'test';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ text: 'Thank you.' })));
    expect((await transcribe(audio)).text).toBe('');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('slow down', { status: 429 })));
    await expect(transcribe(audio)).rejects.toThrow(/rate-limited/);
    delete process.env.GROQ_API_KEY;
    await expect(transcribe(audio)).rejects.toThrow(/GROQ_API_KEY/);
  });

  it('builds a terms-only vocabulary from saved memories and maps languages', async () => {
    const limit = vi.fn().mockResolvedValue({ data: [{ content: "Kassix POS: 60 days free, then 149 pesos a month." }, { content: "13C's website is 13c.online. AIR/Rally too." }] });
    const projects = [{ name: 'Dicta', aliases: ['dikta'], website: 'https://dicta.app/' }];
    const db = {
      from: (table: string) =>
        table === 'projects'
          ? { select: () => ({ order: () => ({ limit: async () => ({ data: projects, error: null }) }) }) }
          : { select: () => ({ in: () => ({ order: () => ({ limit }) }) }) },
    } as any;
    const vocab = await vocabulary(db, 'Leou');
    expect(vocab).toBe('Jarvis, VS Code, GitHub, Facebook, Spotify, Vercel, Supabase, Leou, Dicta, dikta, dicta.app, Kassix, POS, 13C, 13c.online, AIR/Rally');
    expect(vocab).not.toMatch(/days|pesos|60|149/); // no sentences or numbers for Whisper to copy
    expect([whisperLanguage('en-PH'), whisperLanguage(''), whisperLanguage('fil-PH')]).toEqual(['en', 'en', 'tl']);
  });

  it('detects hint echoes and loops, and retries without the hint', async () => {
    expect(extractTerms(['Remember that Dicta is my social quote app'])).toEqual(['Dicta']);
    expect(looksLikeBleed('14C.online. VS Code', 'Jarvis, VS Code, 14C.online')).toBe(true);
    expect(looksLikeBleed('Open VS Code', 'Jarvis, VS Code')).toBe(false);
    expect(looksLikeBleed('3c.online, Dicta', 'Jarvis, 13c.online, Dicta')).toBe(true); // partial copies too
    expect(isLooping('60 days free. 60 days. 60 days. 60 days.')).toBe(true);
    expect(isLooping('Open VS Code. Then open Safari.')).toBe(false);

    process.env.GROQ_API_KEY = 'test';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ text: '60 days free, then 149 pesos. 60 days. 60 days. 60 days.' }))
      .mockResolvedValueOnce(Response.json({ text: "Hey Jarvis, let's go." }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await transcribe(audio, { prompt: 'Jarvis, Kassix', language: 'en' })).text).toBe("Hey Jarvis, let's go.");
    expect((fetchMock.mock.calls[1][1].body as FormData).get('prompt')).toBeNull();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ text: 'Kassix.' })).mockResolvedValueOnce(Response.json({ text: '.' })));
    expect((await transcribe(audio, { prompt: 'Jarvis, Kassix' })).text).toBe(''); // noise: echo, then nothing
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ text: '1' })));
    expect((await transcribe(audio, { prompt: 'Jarvis' })).text).toBe('');

    // Garbled audio (calibrated: clear speech ≈ -0.3…-0.6, noise-drowned ≈ -1.2) → ask to repeat.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ text: 'Open the cash at the project, VFO. RPE.', segments: [{ avg_logprob: -1.16 }] })));
    expect(await transcribe(audio)).toEqual({ text: 'Open the cash at the project, VFO. RPE.', unclear: true });
  });
});
