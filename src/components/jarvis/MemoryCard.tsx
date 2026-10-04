import { Trash2 } from 'lucide-react';

export interface MemoryRow { id: string; content: string; category: string; importance: number; created_at: string }

export function MemoryCard({ memory, onDelete }: { memory: MemoryRow; onDelete: (id: string) => void }) {
  return (
    <div className="glass group flex items-start gap-4 !rounded-xl p-4">
      <div className="min-w-0 flex-1">
        <p className="text-[15px] leading-relaxed text-white/90">{memory.content}</p>
        <div className="mt-2 flex items-center gap-3">
          <span className="rounded-full bg-arc/10 px-2 py-0.5 text-[11px] text-arc ring-1 ring-arc/20">{memory.category}</span>
          <span className="flex gap-0.5" title={`Importance ${memory.importance}/5`} aria-label={`Importance ${memory.importance} of 5`}>
            {Array.from({ length: 5 }, (_, i) => <span key={i} className={`size-1.5 rounded-full ${i < memory.importance ? 'bg-glow' : 'bg-white/10'}`} />)}
          </span>
          <span className="text-[11px] text-faint">{new Date(memory.created_at).toLocaleDateString()}</span>
        </div>
      </div>
      <button onClick={() => onDelete(memory.id)} aria-label="Delete memory" className="rounded-lg p-2 text-faint opacity-60 transition hover:bg-danger/10 hover:text-danger group-hover:opacity-100">
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}
