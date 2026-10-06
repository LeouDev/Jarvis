import { describe, expect, it, vi } from 'vitest';

// Fake Silero VAD: records the callbacks so the test can "speak".
const callbacks: Record<string, any> = {};
const fakeVAD = { start: vi.fn(), pause: vi.fn(async () => {}), setOptions: vi.fn() };
vi.mock('@ricky0123/vad-web', () => ({
  MicVAD: { new: vi.fn(async (opts: object) => (Object.assign(callbacks, opts), fakeVAD)) },
}));
const { captureUtterance } = await import('../src/lib/vad');
const { watchForBargeIn } = await import('../src/lib/whisper');

describe('voice capture sessions', () => {
  it('a barge-in listener shutting down late never kills the follow-up listen', async () => {
    const stopBargeIn = watchForBargeIn({ onInterrupt: vi.fn(), onCommand: vi.fn() });
    await vi.waitFor(() => expect(fakeVAD.start).toHaveBeenCalledTimes(1));

    // JARVIS finished speaking: the follow-up listen starts and takes over the microphone…
    const followUp = captureUtterance({ pauseMs: 1300, noSpeechMs: 8000 });
    await vi.waitFor(() => expect(fakeVAD.start).toHaveBeenCalledTimes(2));

    // …then React runs the barge-in effect's cleanup.
    stopBargeIn();
    await new Promise((r) => setTimeout(r, 0));

    // The user speaks their next request: it must still be captured.
    const speech = new Float32Array([0.1, -0.2, 0.3]);
    callbacks.onSpeechStart();
    callbacks.onSpeechRealStart();
    callbacks.onSpeechEnd(speech);
    expect(await followUp).toBe(speech);
  });
});
