import { useEffect, useRef } from 'react';
import type { JarvisState } from '../../hooks/useJarvis';

const PARAMS: Record<JarvisState, { amp: number; speed: number; flutter: number }> = {
  idle: { amp: 0.06, speed: 0.5, flutter: 0 },
  listening: { amp: 0.5, speed: 2.4, flutter: 0.35 },
  processing: { amp: 0.18, speed: 1.8, flutter: 0 },
  thinking: { amp: 0.24, speed: 1.2, flutter: 0.1 },
  speaking: { amp: 0.72, speed: 3.2, flutter: 0.45 },
  executing: { amp: 0.28, speed: 4.5, flutter: 0 },
};

const STROKES = ['rgba(34,211,238,0.95)', 'rgba(59,130,246,0.6)', 'rgba(255,255,255,0.22)'];

/** Layered waveform whose amplitude and tempo ease towards the current state. */
export function VoiceVisualizer({ state, width = 320, height = 56 }: { state: JarvisState; width?: number; height?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    el.width = width * dpr;
    el.height = height * dpr;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0, t = 0, amp = 0.06;

    const draw = () => {
      const p = PARAMS[stateRef.current];
      amp += (p.amp - amp) * 0.07;
      t += 0.016 * p.speed;
      const w = el.width, h = el.height;
      const level = amp * (1 + p.flutter * Math.sin(t * 5.3) * Math.sin(t * 2.1));
      ctx.clearRect(0, 0, w, h);
      STROKES.forEach((stroke, layer) => {
        ctx.beginPath();
        for (let x = 0; x <= w; x += 2 * dpr) {
          const nx = x / w;
          const taper = Math.sin(Math.PI * nx) ** 1.5;
          const y = h / 2 + Math.sin(nx * (7 + layer * 3) + t * (1 + layer * 0.35) + layer * 1.7) * taper * level * h * 0.45 * (1 - layer * 0.22);
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.strokeStyle = stroke;
        ctx.lineWidth = (layer === 0 ? 1.6 : 1) * dpr;
        ctx.stroke();
      });
      if (!still) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [width, height]);

  return <canvas ref={canvas} style={{ width, height }} className="max-w-full" aria-hidden />;
}
