import { AnimatePresence, motion } from 'motion/react';
import { ShieldAlert } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { PendingAction } from '../../../shared/types';

const PLATFORM: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', x: 'X', linkedin: 'LinkedIn', tiktok: 'TikTok' };

function Body({ action }: { action: PendingAction }) {
  const i = action.input as Record<string, any>;
  if (action.tool === 'social_publish')
    return (
      <div className="space-y-4">
        <div>
          <div className="hud-label mb-1.5">Caption</div>
          <div className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-black/30 p-4 text-[15px] leading-relaxed text-white/90">{i.caption}</div>
        </div>
        <div>
          <div className="hud-label mb-1">Platform</div>
          <div className="text-white/90">{PLATFORM[i.platform] ?? i.platform}</div>
        </div>
      </div>
    );
  if (action.tool === 'runTerminal')
    return (
      <div className="space-y-2">
        <pre className="overflow-auto rounded-xl border border-line bg-black/40 p-3 font-mono text-sm text-glow">$ {i.command}</pre>
        <p className="text-xs text-faint">Runs on your Mac via the local agent{i.cwd ? ` in ${i.cwd}` : ''}. No shell: pipes and chaining are impossible.</p>
      </div>
    );
  if (action.tool === 'createFile')
    return (
      <div className="space-y-2">
        <div className="font-mono text-sm text-white/90">{i.path}{i.overwrite && <span className="ml-2 text-warn">(overwrite)</span>}</div>
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-black/40 p-3 font-mono text-xs text-white/70">{String(i.content).slice(0, 4000)}</pre>
      </div>
    );
  return <pre className="overflow-auto rounded-xl border border-line bg-black/40 p-3 font-mono text-xs text-white/70">{JSON.stringify(i, null, 2)}</pre>;
}

const VERB: Record<string, [string, string]> = {
  social_publish: ['Post preview', 'Publish'],
  runTerminal: ['Run this command?', 'Run'],
  createFile: ['Create this file?', 'Create'],
};

export function ApprovalDialog({ action, onDecide }: { action: PendingAction | null; onDecide: (approved: boolean) => void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!action) return;
    cancel.current?.focus(); // the safe choice has focus
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onDecide(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [action, onDecide]);

  const [title, verb] = (action && VERB[action.tool]) ?? [action?.summary ?? '', 'Approve'];
  return (
    <AnimatePresence>
      {action && (
        <motion.div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="approval-title"
            className="glass w-full max-w-lg !rounded-2xl !bg-ink/95 p-6 shadow-2xl"
            initial={{ y: 24, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 24, opacity: 0 }}
          >
            <div className="mb-4 flex items-center gap-2">
              <ShieldAlert className="size-4 text-warn" />
              <span className="hud-label !text-warn">Approval required · {action.permission}</span>
            </div>
            <h2 id="approval-title" className="mb-4 text-lg font-medium uppercase tracking-[0.18em] text-white">{title}</h2>
            <Body action={action} />
            <div className="mt-6 flex justify-end gap-3">
              <button ref={cancel} onClick={() => onDecide(false)} className="rounded-full px-5 py-2.5 text-sm text-white/80 ring-1 ring-line transition hover:bg-white/5">
                Cancel
              </button>
              <button onClick={() => onDecide(true)} className="rounded-full bg-arc px-5 py-2.5 text-sm font-medium text-white shadow-[0_0_24px_rgb(59_130_246/0.35)] transition hover:bg-arc/85">
                {verb}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
