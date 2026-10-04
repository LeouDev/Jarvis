import { useEffect, useRef } from 'react';
import type { JarvisState, UIMessage } from '../../hooks/useJarvis';
import { MessageBubble } from './MessageBubble';

export function ConversationPanel({ messages, state }: { messages: UIMessage[]; state: JarvisState }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); // may return a Promise in newer browsers; must not be returned
  }, [messages]);
  const streaming = state === 'thinking' || state === 'processing';
  return (
    <div className="space-y-5" aria-live="polite">
      {messages.map((m, i) => (
        <MessageBubble key={m.id} message={m} streaming={streaming && i === messages.length - 1 && m.role === 'assistant'} />
      ))}
      <div ref={end} />
    </div>
  );
}
