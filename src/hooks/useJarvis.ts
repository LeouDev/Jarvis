import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActionResolution, ChatRequest, PendingAction, Settings, ToolExecutionView } from '../../shared/types';
import { runAgentTool } from '../lib/agent';
import { streamChat } from '../lib/api';
import { supabase } from '../lib/supabase';
import { chime, NoSpeechError, stripWake, voice } from '../lib/voice';
import { whisperVoice } from '../lib/whisper';
import { createSpeaker, sentenceChunker, type Speaker } from '../lib/speech';

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
export function useJarvis(settings: Settings, onTurnComplete: () => void, whisperAvailable = false, naturalVoiceAvailable = false) {
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
  // Speech input engine: Whisper when the server has a Groq key, else the browser's recognizer.
  const stt = settings.voice.engine === 'whisper' && whisperAvailable ? whisperVoice : voice;
  const sttRef = useRef(stt);
  sttRef.current = stt;
  /** The current turn started by voice: reply → keep listening for a follow-up. */
  const voiceTurn = useRef(false);

  const patchLast = (fn: (m: UIMessage) => UIMessage) => setMessages((ms) => ms.map((m, i) => (i === ms.length - 1 ? fn(m) : m)));

  /** Updates an execution card wherever it lives, or adds it to the current reply. */
  const upsertExecution = (ex: ToolExecutionView) =>
    setMessages((ms) => {
      if (ms.some((m) => m.executions.some((e) => e.id === ex.id)))
        return ms.map((m) => ({ ...m, executions: m.executions.map((e) => (e.id === ex.id ? { ...e, ...ex } : e)) }));
      return ms.map((m, i) => (i === ms.length - 1 ? { ...m, executions: [...m.executions, ex] } : m));
    });

  const naturalRef = useRef(naturalVoiceAvailable);
  naturalRef.current = naturalVoiceAvailable;
  const speakerRef = useRef<Speaker | null>(null);
  const stopSpeaking = useCallback(() => {
    speakerRef.current?.stop();
    speakerRef.current = null;
    voice.stopSpeaking();
  }, []);

  /** A fresh speaker for this reply (sentences are spoken as they stream in), or null when voice is off. */
  const newSpeaker = () => {
    stopSpeaking();
    const v = settingsRef.current.voice;
    if (!v.speak) return null;
    speakerRef.current = createSpeaker({
      natural: v.output === 'natural' && naturalRef.current,
      naturalVoice: v.naturalVoice,
      browserVoice: v.voiceName,
      rate: v.rate,
      onStart: () => setState((s) => (s === 'listening' || s === 'executing' ? s : 'speaking')),
    });
    return speakerRef.current;
  };

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
    const speaker = newSpeaker();
    const chunker = sentenceChunker((chunk) => speaker?.enqueue(chunk));
    let actions: PendingAction[] = [];
    try {
      for await (const ev of streamChat({ ...body, timezone })) {
        if (ev.type === 'conversation') {
          convRef.current = ev.id;
          setConversationId(ev.id);
        } else if (ev.type === 'text') {
          setState((s) => (s === 'speaking' ? s : 'thinking'));
          chunker.push(ev.delta);
          patchLast((m) => ({ ...m, content: m.content + ev.delta }));
        } else if (ev.type === 'notice') patchLast((m) => ({ ...m, notices: [...m.notices, ev.message] }));
        else if (ev.type === 'tool') upsertExecution(ev.execution);
        else if (ev.type === 'actions') actions = ev.actions;
        else if (ev.type === 'error') {
          chunker.push(` ${ev.message}`);
          patchLast((m) => ({ ...m, content: m.content ? `${m.content}\n\n${ev.message}` : ev.message, error: true }));
        }
      }
    } catch (err) {
      const message = (err as Error).message || "I can't reach the JARVIS server right now.";
      chunker.push(message);
      patchLast((m) => ({ ...m, content: message, error: true }));
    }
    chunker.flush();
    if (!actions.length) {
      // Drop a reply bubble that ended up with nothing in it.
      setMessages((ms) => ms.filter((m, i) => i !== ms.length - 1 || m.content || m.executions.length || m.notices.length));
      onTurnComplete();
      await speaker?.done();
      if (speakerRef.current === speaker) speakerRef.current = null;
      setState((s) => (s === 'speaking' || s === 'thinking' || s === 'processing' ? 'idle' : s));
      // Conversation mode: after answering a spoken request, listen again without a click.
      if (voiceTurn.current && settingsRef.current.voice.followUp) return capture(true);
      return;
    }
    // Keep talking ("I need your approval…") while the dialog is up.
    const resolutions: ActionResolution[] = [];
    for (const action of actions) {
      const approved = action.needsApproval ? await askApproval(action) : true;
      stopSpeaking();
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

  const send = async (text: string, viaVoice = false) => {
    const message = text.trim();
    if (!message || busy) return;
    voiceTurn.current = viaVoice;
    stopSpeaking();
    setMessages((ms) => [...ms, { id: uid(), role: 'user', content: message, executions: [], notices: [] }]);
    await run({ conversationId: convRef.current ?? undefined, message });
  };

  /** Records one utterance and sends it. `quiet` = silence just ends listening (follow-ups, wake word). */
  const capture = async (quiet: boolean) => {
    stopSpeaking();
    setError('');
    setInterim('');
    setState('listening');
    try {
      const heard = await sttRef.current.listen({ onInterim: setInterim, lang: settingsRef.current.voice.lang, onEnd: () => setState('processing') });
      setInterim('');
      const command = stripWake(heard); // "Jarvis, open VS Code" → "open VS Code"
      if (heard && !command) {
        chime(); // only the name was said: keep listening for the instruction
        return capture(true);
      }
      if (command) return send(command, true);
      setState('idle');
      if (!quiet) setError("I didn't hear anything. Check that this site may use your microphone (voice works in Chrome and Safari), or type instead.");
    } catch (err) {
      setInterim('');
      setState('idle');
      if (!(quiet && err instanceof NoSpeechError)) setError((err as Error).message);
    }
  };

  const listen = async () => {
    if (state === 'listening') return stt.stopListening();
    if (busy) return;
    return capture(false);
  };

  /** Interrupt: stop talking/listening immediately (and don't auto-listen afterwards). */
  const interrupt = useCallback(() => {
    voiceTurn.current = false;
    stopSpeaking();
    sttRef.current.stopListening();
    setState((s) => (s === 'speaking' || s === 'listening' ? 'idle' : s));
  }, []);

  // What the always-on mic last heard, shown briefly so you can tell "not heard" from "mis-heard".
  const [heard, setHeard] = useState('');
  const heardTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const showHeard = useCallback((text: string) => {
    setHeard(text);
    clearTimeout(heardTimer.current);
    heardTimer.current = setTimeout(() => setHeard(''), 3000);
  }, []);

  // Wake word: while idle, listen for "Jarvis…" and act on whatever follows it.
  const latest = useRef({ send, capture });
  latest.current = { send, capture };
  const wakeWord = settings.voice.wakeWord && voice.supportsInput; // spotting "Jarvis" always uses the browser recognizer
  const lang = settings.voice.lang;
  useEffect(() => {
    if (!wakeWord || state !== 'idle' || approval) return;
    return stt.listenForWakeWord({
      lang,
      onArmed: chime,
      onHeard: showHeard,
      onWake: (command) => {
        setHeard('');
        if (command) void latest.current.send(command, true); // name alone + silence: just keep waiting
      },
      onError: setError,
    });
  }, [wakeWord, state, approval, lang, showHeard, stt]);

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

  return { messages, state, interim, error, approval, decide, send, listen, interrupt, busy, conversationId, newConversation, openConversation, wakeWord, heard, engine: stt === whisperVoice ? 'Whisper' : 'Browser' };
}
