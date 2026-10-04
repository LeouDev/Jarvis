import type { ChatEvent, ChatRequest } from '../../shared/types';
import { supabase } from './supabase';

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  return { authorization: `Bearer ${data.session?.access_token ?? ''}`, 'content-type': 'application/json' };
}

/** JSON call to the JARVIS server. Throws an Error carrying the server's user-facing message. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, { ...init, headers: { ...(await authHeaders()), ...init.headers } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json as T;
}

/** Streams NDJSON chat events. */
export async function* streamChat(body: ChatRequest): AsyncGenerator<ChatEvent> {
  const res = await fetch('/api/chat', { method: 'POST', headers: await authHeaders(), body: JSON.stringify(body) });
  if (!res.ok || !res.body) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error ?? "I can't reach the JARVIS server right now.");
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split('\n');
    buffer = lines.pop()!;
    for (const line of lines) if (line.trim()) yield JSON.parse(line) as ChatEvent;
  }
  if (buffer.trim()) yield JSON.parse(buffer) as ChatEvent;
}
