import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActionResolution, ChatRequest, PendingAction, Settings, ToolExecutionView } from '../../shared/types';
import { runAgentTool } from '../lib/agent';
import { streamChat } from '../lib/api';
import { supabase } from '../lib/supabase';
import { voice } from '../lib/voice';

export type JarvisState = 'idle' | 'listening' | 'processing' | 'thinking' | 'speaking' | 'executing';

export interface UIMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  executions: ToolExecutionView[];
  notices: string[];
  error?: boolean;
}

const uid = () => crypto.randomUUID();
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * The conversation state machine:
 * IDLE → LISTENING → PROCESSING → THINKING → (EXECUTING ↔ approval) → SPEAKING → IDLE
 */
export function useJarvis(settings: Settings, onTurnComplete: () => void) {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [state, setState] = useState<JarvisState>('idle');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState('');
  const [approval, setApproval] = useState<PendingAction | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const convRef = useRef<string | null>(null);
  const approvalResolver = useRef<((ok: boolean) => void) | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const patchLast = (fn: (m: UIMessage) => UIMessage) => setMessages((ms) => ms.map((m, i) => (i === ms.length - 1 ? fn(m) : m)));

  /** Updates an execution card wherever it lives, or adds it to the current reply. */
  const upsertExecution = (ex: ToolExecutionView) =>
    setMessages((ms) => {
      if (ms.some((m) => m.executions.some((e) => e.id === ex.id)))
        return ms.map((m) => ({ ...m, executions: m.executions.map((e) => (e.id === ex.id ? { ...e, ...ex } : e)) }));
      return ms.map((m, i) => (i === ms.length - 1 ? { ...m, executions: [...m.executions, ex] } : m));
    });

  const speak = useCallback(async (text: string) => {
    const { voice: v } = settingsRef.current;
    if (!v.speak || !text.trim() || !voice.supportsOutput) return setState('idle');
    setState('speaking');
    await voice.speak(text, { voiceName: v.voiceName, rate: v.rate });
    setState((s) => (s === 'speaking' ? 'idle' : s));
  }, []);

  const askApproval = (action: PendingAction) =>
    new Promise<boolean>((resolve) => {
      approvalResolver.current = resolve;
      setApproval(action);
    });

  const decide = useCallback((ok: boolean) => {
    approvalResolver.current?.(ok);
    approvalResolver.current = null;
    setApproval(null);
  }, []);

  const run = async (body: ChatRequest): Promise<void> => {
    setState('processing');
    setError('');
    setMessages((ms) => [...ms, { id: uid(), role: 'assistant', content: '', executions: [], notices: [] }]);
    let text = '';
    let actions: PendingAction[] = [];
    try {
      for await (const ev of streamChat({ ...body, timezone })) {
        if (ev.type === 'conversation') {
          convRef.current = ev.id;
          setConversationId(ev.id);
        } else if (ev.type === 'text') {
          setState('thinking');
          text += ev.delta;
          patchLast((m) => ({ ...m, content: m.content + ev.delta }));
        } else if (ev.type === 'notice') patchLast((m) => ({ ...m, notices: [...m.notices, ev.message] }));
        else if (ev.type === 'tool') upsertExecution(ev.execution);
        else if (ev.type === 'actions') actions = ev.actions;
        else if (ev.type === 'error') {
          text += ` ${ev.message}`;
          patchLast((m) => ({ ...m, content: m.content ? `${m.content}\n\n${ev.message}` : ev.message, error: true }));
        }
      }
    } catch (err) {
      const message = (err as Error).message || "I can't reach the JARVIS server right now.";
      text = message;
      patchLast((m) => ({ ...m, content: message, error: true }));
    }
    if (!actions.length) {
      // Drop a reply bubble that ended up with nothing in it.
      setMessages((ms) => ms.filter((m, i) => i !== ms.length - 1 || m.content || m.executions.length || m.notices.length));
      onTurnComplete();
      return speak(text);
    }
    if (text.trim()) void speak(text);
    const resolutions: ActionResolution[] = [];
    for (const action of actions) {
      const approved = action.needsApproval ? await askApproval(action) : true;
      voice.stopSpeaking();
      if (!approved) {
        resolutions.push({ id: action.id, approved: false });
        upsertExecution({ id: action.id, tool: action.tool, summary: action.summary, status: 'rejected' });
        continue;
      }
      setState('executing');
      if (action.runOn === 'agent') {
        upsertExecution({ id: action.id, tool: action.tool, summary: action.summary, status: 'running' });
        const result = await runAgentTool(action.tool, action.input, action.needsApproval);
        upsertExecution({ id: action.id, tool: action.tool, summary: action.summary, status: result.ok ? 'succeeded' : 'failed', output: result.output });
        resolutions.push({ id: action.id, approved: true, result });
      } else {
        upsertExecution({ id: action.id, tool: action.tool, summary: action.summary, status: 'running' });
        resolutions.push({ id: action.id, approved: true });
      }
    }
    return run({ conversationId: convRef.current ?? undefined, resolutions });
  };

  const busy = state === 'processing' || state === 'thinking' || state === 'executing' || approval !== null;

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    voice.stopSpeaking();
    setMessages((ms) => [...ms, { id: uid(), role: 'user', content: message, executions: [], notices: [] }]);
    await run({ conversationId: convRef.current ?? undefined, message });
  };

  const listen = async () => {
    if (state === 'listening') return voice.stopListening();
    if (busy) return;
    voice.stopSpeaking();
    setError('');
    setInterim('');
    setState('listening');
    try {
      const heard = await voice.listen({ onInterim: setInterim });
      setInterim('');
      if (heard) await send(heard);
      else setState('idle');
    } catch (err) {
      setInterim('');
      setError((err as Error).message);
      setState('idle');
    }
  };

  /** Interrupt: stop talking/listening immediately. */
  const interrupt = useCallback(() => {
    voice.stopSpeaking();
    voice.stopListening();
    setState((s) => (s === 'speaking' || s === 'listening' ? 'idle' : s));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && interrupt();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [interrupt]);

  const newConversation = () => {
    interrupt();
    convRef.current = null;
    setConversationId(null);
    setMessages([]);
  };

  const openConversation = async (id: string) => {
    interrupt();
    const { data } = await supabase
      .from('messages')
      .select('id, role, content')
      .eq('conversation_id', id)
      .in('role', ['user', 'assistant'])
      .neq('content', '')
      .order('seq')
      .limit(200);
    convRef.current = id;
    setConversationId(id);
    setMessages((data ?? []).map((m) => ({ id: m.id, role: m.role, content: m.content, executions: [], notices: [] })));
  };

  return { messages, state, interim, error, approval, decide, send, listen, interrupt, busy, conversationId, newConversation, openConversation };
}
