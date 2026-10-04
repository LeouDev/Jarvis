import { useCallback, useEffect, useState } from 'react';
import { agentHealth, agentRequest, type AgentHealth } from '../lib/agent';

export interface AgentMetrics { cpu: number; memory: number | null; disk: number | null; networkMs: number | null }

/** Polls the local Mac agent for health and live system metrics. */
export function useAgent(intervalMs = 8000) {
  const [health, setHealth] = useState<AgentHealth | 'checking'>('checking');
  const [metrics, setMetrics] = useState<AgentMetrics | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const h = await agentHealth();
      if (!alive) return;
      setHealth(h);
      if (h !== 'online') return setMetrics(null);
      const s = await agentRequest<{ ok: boolean; data: AgentMetrics }>('/system/status', {}).catch(() => null);
      if (alive && s?.ok) setMetrics(s.data);
    };
    tick();
    const t = setInterval(tick, intervalMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [intervalMs, nonce]);

  return { health, metrics, refresh: useCallback(() => setNonce((n) => n + 1), []) };
}
