import type { ReactNode } from 'react';
import type { UIMessage } from '../../hooks/useJarvis';
import { ToolExecutionCard } from './ToolExecutionCard';

// Tiny, safe markdown: **bold**, `code`, [links](https://…) and "- " bullets. No HTML injection.
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i} className="font-semibold text-white">{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i} className="rounded bg-white/10 px-1 font-mono text-[0.85em] text-glow">{part.slice(1, -1)}</code>;
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
    if (link) return <a key={i} href={link[2]} target="_blank" rel="noreferrer" className="text-glow underline decoration-glow/30 underline-offset-2">{link[1]}</a>;
    return part;
  });
}

function Markdownish({ text }: { text: string }) {
  return (
    <div className="space-y-1.5">
      {text.split('\n').map((line, i) =>
        /^\s*[-*•]\s+/.test(line) ? (
          <div key={i} className="flex gap-2 pl-1"><span className="text-glow/70">•</span><span>{inline(line.replace(/^\s*[-*•]\s+/, ''))}</span></div>
        ) : line.trim() ? (
          <p key={i}>{inline(line.replace(/^#+\s*/, ''))}</p>
        ) : null,
      )}
    </div>
  );
}

export function MessageBubble({ message, streaming }: { message: UIMessage; streaming?: boolean }) {
  if (message.role === 'user')
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md border border-arc/25 bg-arc/10 px-4 py-2.5 text-[15px] text-white/90">{message.content}</div>
      </div>
    );
  return (
    <div className="max-w-[92%] space-y-2">
      <div className="hud-label text-glow/80">Jarvis</div>
      {message.notices.map((n, i) => <p key={i} className="text-xs italic text-warn/90">{n}</p>)}
      {message.content && (
        <div className={`text-[15px] leading-relaxed ${message.error ? 'text-danger/90' : 'text-white/85'}`}>
          <Markdownish text={message.content} />
          {streaming && <span className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse bg-glow/70" />}
        </div>
      )}
      {message.executions.map((e) => <ToolExecutionCard key={e.id} execution={e} />)}
    </div>
  );
}
