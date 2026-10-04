import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, mergeSettings, type Settings } from '../../shared/types';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';

export interface ServerConfig {
  providers: { id: string; label: string; model: string; configured: boolean; default: boolean }[];
  webSearch: string;
  github: { token: boolean; username: string | null };
  embeddings: boolean;
  encryption: boolean;
}

/** User preferences (Supabase, RLS) + server capabilities + profile name. */
export function useSettings(userId: string) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [displayName, setDisplayName] = useState('');

  useEffect(() => {
    supabase.from('preferences').select('settings').maybeSingle().then(({ data }) => setSettings(mergeSettings(data?.settings)));
    supabase.from('users').select('display_name').maybeSingle().then(({ data }) => setDisplayName(data?.display_name ?? ''));
    api<ServerConfig>('/config').then(setConfig).catch(() => setConfig(null));
  }, [userId]);

  const update = useCallback(
    (patch: (s: Settings) => Settings) =>
      setSettings((prev) => {
        const next = patch(prev);
        supabase.from('preferences').upsert({ user_id: userId, settings: next, updated_at: new Date().toISOString() }).then(({ error }) => {
          if (error) console.error('Saving settings failed:', error.message);
        });
        return next;
      }),
    [userId],
  );

  const saveDisplayName = useCallback(
    async (name: string) => {
      setDisplayName(name);
      await supabase.from('users').update({ display_name: name.trim() || null }).eq('id', userId);
    },
    [userId],
  );

  return { settings, update, config, displayName, saveDisplayName };
}
