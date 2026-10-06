// Voice activity detection with Silero VAD (neural, ~1 ms per frame, runs in the browser).
// Replaces the loudness threshold for commands: knows speech from noise, keeps a 400 ms pre-roll
// so the first word isn't clipped, ignores sounds under 250 ms (coughs, clicks), and ends the
// turn after a configurable pause. Loaded lazily: nothing is downloaded until voice is used.
import type { MicVAD } from '@ricky0123/vad-web';

/** Live speech probability (0–1) for the visualizer. */
export const micLevel = { value: 0 };

/** Silence that ends your turn. Too short cuts you off mid-thought; too long feels sluggish. */
export const TURN_PAUSE_MS = { short: 800, normal: 1300, long: 2000 } as const;
export type TurnPause = keyof typeof TURN_PAUSE_MS;

const micError = (err: unknown) => {
  const name = (err as DOMException)?.name;
  return new Error(
    name === 'NotAllowedError' ? 'Microphone access was denied. Allow it for this site in your browser settings.'
    : name === 'NotFoundError' ? 'No microphone was found.'
    : 'Voice detection could not start.',
  );
};

let session: { onStart?: () => void; onRealStart?: () => void; onEnd?: (audio: Float32Array) => void } = {};
let vadPromise: Promise<MicVAD> | null = null;
let active: { finish: (audio: Float32Array | null) => void } | null = null;

function loadVAD(): Promise<MicVAD> {
  vadPromise ??= import('@ricky0123/vad-web')
    .then(({ MicVAD }) =>
      MicVAD.new({
        model: 'v5',
        baseAssetPath: '/vad/', // served from our origin (scripts/copy-vad-assets.mjs)
        onnxWASMBasePath: '/vad/',
        startOnLoad: false,
        submitUserSpeechOnPause: true, // Stop / barge-in hand over what was said so far
        preSpeechPadMs: 400,
        minSpeechMs: 250,
        getStream: () =>
          navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }),
        onSpeechStart: () => session.onStart?.(),
        onSpeechRealStart: () => session.onRealStart?.(), // longer than minSpeechMs: real speech, not a click
        onSpeechEnd: (audio) => session.onEnd?.(audio),
        onFrameProcessed: (p) => void (micLevel.value = p.isSpeech),
      }),
    )
    .catch((err) => {
      vadPromise = null;
      throw micError(err);
    });
  return vadPromise;
}

/**
 * Records one utterance (pre-roll included, 16 kHz). Resolves null if nothing is said within
 * `noSpeechMs`. `strict` (barge-in) needs a clearer, longer voice so the assistant's own audio
 * doesn't interrupt itself.
 */
export async function captureUtterance(o: {
  pauseMs: number;
  noSpeechMs?: number;
  maxMs?: number;
  strict?: boolean;
  /** Fires once the sound has lasted minSpeechMs, i.e. it is speech and not a cough or click. */
  onSpeech?: () => void;
  /** Ends this capture only — never one that started after it. */
  signal?: AbortSignal;
}) {
  const vad = await loadVAD();
  await stopCapture();
  vad.setOptions({
    redemptionMs: o.pauseMs,
    positiveSpeechThreshold: o.strict ? 0.8 : 0.5,
    negativeSpeechThreshold: o.strict ? 0.6 : 0.35,
    minSpeechMs: o.strict ? 300 : 250, // strict still catches a short "stop" (~350 ms), not a cough
  });
  return new Promise<Float32Array | null>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const me = {
      finish: (audio: Float32Array | null) => {
        if (active !== me) return;
        active = null;
        session = {};
        clearTimeout(timer);
        micLevel.value = 0;
        void vad.pause();
        resolve(audio);
      },
    };
    active = me;
    session = {
      onStart: () => {
        clearTimeout(timer);
        timer = setTimeout(() => void stopCapture(), o.maxMs ?? 30_000); // cap very long monologues
      },
      onRealStart: () => o.onSpeech?.(),
      onEnd: (audio) => me.finish(audio),
    };
    if (o.noSpeechMs !== undefined) timer = setTimeout(() => me.finish(null), o.noSpeechMs);
    o.signal?.addEventListener('abort', () => active === me && void stopCapture(), { once: true });
    void vad.start();
  });
}

/** Ends the current capture; speech in progress is submitted, otherwise the capture resolves null. */
export async function stopCapture() {
  const current = active;
  if (!current || !vadPromise) return;
  const vad = await vadPromise;
  await vad.pause(); // fires onSpeechEnd synchronously if you were mid-sentence
  current.finish(null);
}
