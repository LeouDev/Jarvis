import { motion } from 'motion/react';
import type { JarvisState } from '../../hooks/useJarvis';

// Each state has its own rhythm: ring spin speed, core pulse, glow strength and hue.
const LOOK: Record<JarvisState, { spin: number; pulse: number[]; dur: number; glow: number; hue: string }> = {
  idle: { spin: 48, pulse: [1, 1.025, 1], dur: 4.5, glow: 0.35, hue: '#3b82f6' },
  listening: { spin: 16, pulse: [1, 1.07, 1], dur: 1.3, glow: 0.75, hue: '#22d3ee' },
  processing: { spin: 6, pulse: [1, 1.03, 1], dur: 1, glow: 0.5, hue: '#60a5fa' },
  thinking: { spin: 3.2, pulse: [1, 1.045, 1], dur: 1.8, glow: 0.55, hue: '#60a5fa' },
  speaking: { spin: 10, pulse: [1, 1.09, 0.99, 1.06, 1], dur: 0.9, glow: 0.85, hue: '#22d3ee' },
  executing: { spin: 1.6, pulse: [1, 1.02, 1], dur: 0.6, glow: 0.6, hue: '#f5b454' },
};

export function JarvisOrb({ state, size = 220, onClick }: { state: JarvisState; size?: number; onClick?: () => void }) {
  const l = LOOK[state];
  const loop = (duration: number) => ({ duration, repeat: Infinity, ease: 'easeInOut' as const });
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`JARVIS is ${state}. Click to ${state === 'speaking' ? 'interrupt' : 'talk'}.`}
      className="relative shrink-0 cursor-pointer rounded-full transition-[width,height] duration-500"
      style={{ width: size, height: size }}
    >
      <motion.div
        className="absolute -inset-[18%] rounded-full blur-3xl"
        style={{ background: `radial-gradient(circle, ${l.hue}55, transparent 65%)` }}
        animate={{ opacity: [l.glow * 0.55, l.glow, l.glow * 0.55], scale: l.pulse }}
        transition={loop(l.dur)}
      />
      <motion.svg className="absolute inset-0" viewBox="0 0 100 100" animate={{ rotate: 360 }} transition={{ duration: l.spin, repeat: Infinity, ease: 'linear' }}>
        <circle cx="50" cy="50" r="48" fill="none" stroke={l.hue} strokeOpacity="0.55" strokeWidth="0.5" strokeDasharray="1.5 3 14 3" />
      </motion.svg>
      <motion.svg className="absolute inset-0" viewBox="0 0 100 100" animate={{ rotate: -360 }} transition={{ duration: l.spin * 1.7, repeat: Infinity, ease: 'linear' }}>
        <circle cx="50" cy="50" r="42" fill="none" stroke="#fff" strokeOpacity="0.16" strokeWidth="0.35" strokeDasharray="28 6 2 6" />
        {Array.from({ length: 24 }, (_, i) => (
          <line key={i} x1="50" y1="11.5" x2="50" y2={i % 6 === 0 ? 14 : 12.6} stroke={l.hue} strokeOpacity="0.5" strokeWidth="0.4" transform={`rotate(${i * 15} 50 50)`} />
        ))}
      </motion.svg>
      <motion.div
        className="absolute rounded-full"
        style={{
          inset: '24%',
          background: `radial-gradient(circle at 36% 30%, #e6fbff 0%, ${l.hue} 42%, #0a1a48 100%)`,
          boxShadow: `0 0 ${size / 5}px ${l.hue}77, inset 0 0 ${size / 12}px rgb(255 255 255 / 0.25)`,
        }}
        animate={{ scale: l.pulse }}
        transition={loop(l.dur)}
      />
    </button>
  );
}
