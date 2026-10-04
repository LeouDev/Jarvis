import type { Session } from '@supabase/supabase-js';
import { Activity, Brain, History, Link2, MessageSquare, Plus, Settings as SettingsIcon, Volume2, VolumeX, Wrench } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityLog } from '../components/jarvis/ActivityLog';
import { ApprovalDialog } from '../components/jarvis/ApprovalDialog';
import { CommandInput } from '../components/jarvis/CommandInput';
import { ConnectionManager } from '../components/jarvis/ConnectionManager';
import { ConversationPanel } from '../components/jarvis/ConversationPanel';
import { JarvisOrb } from '../components/jarvis/JarvisOrb';
import { MemoryPanel } from '../components/jarvis/MemoryPanel';
import { SettingsPanel } from '../components/jarvis/SettingsPanel';
import { SystemStatus } from '../components/jarvis/SystemStatus';
import { ToolsPanel } from '../components/jarvis/ToolsPanel';
import { VoiceVisualizer } from '../components/jarvis/VoiceVisualizer';
import { useAgent } from '../hooks/useAgent';
import { useJarvis, type JarvisState } from '../hooks/useJarvis';
import { useSettings } from '../hooks/useSettings';
import { supabase } from '../lib/supabase';
import { voice } from '../lib/voice';

type Section = 'conversation' | 'memory' | 'tools' | 'accounts' | 'activity' | 'settings';

const NAV: [Section, string, typeof MessageSquare][] = [
  ['conversation', 'Conversation', MessageSquare],
  ['memory', 'Memory', Brain],
  ['tools', 'Tools', Wrench],
  ['accounts', 'Accounts', Link2],
  ['activity', 'Activity', Activity],
  ['settings', 'Settings', SettingsIcon],
];

const STATE_LABEL: Record<JarvisState, string> = {
  idle: 'Online', listening: 'Listening', processing: 'Processing', thinking: 'Thinking', speaking: 'Speaking', executing: 'Executing',
};

const greeting = (name: string) => {
  const h = new Date().getHours();
  return `Good ${h < 5 ? 'evening' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'}${name ? `, ${name}` : ''}.`;
};

function Conversations({ version, activeId, onOpen, onNew }: { version: number; activeId: string | null; onOpen: (id: string) => void; onNew: () => void }) {
  const [rows, setRows] = useState<{ id: string; title: string; updated_at: string }[]>([]);
  useEffect(() => {
    supabase.from('conversations').select('id, title, updated_at').order('updated_at', { ascending: false }).limit(30).then(({ data }) => setRows(data ?? []));
  }, [version]);
  return (
    <div className="space-y-1">
      <button onClick={onNew} className="mb-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-glow ring-1 ring-glow/25 hover:bg-glow/5">
        <Plus className="size-4" /> New conversation
      </button>
      {rows.map((c) => (
        <button key={c.id} onClick={() => onOpen(c.id)} className={`block w-full truncate rounded-lg px-3 py-2 text-left text-sm transition ${c.id === activeId ? 'bg-white/[0.06] text-white' : 'text-dim hover:bg-white/[0.03] hover:text-white/90'}`}>
          {c.title}
        </button>
      ))}
    </div>
  );
}

export default function Dashboard({ session }: { session: Session }) {
  const [section, setSection] = useState<Section>('conversation');
  const [version, setVersion] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const { settings, update, config, displayName, saveDisplayName } = useSettings(session.user.id);
  const agent = useAgent();
  const j = useJarvis(settings, bump);
  const name = displayName || session.user.email?.split('@')[0] || '';
  const hasMessages = j.messages.length > 0;
  const stateLabel = j.approval ? 'Awaiting approval' : STATE_LABEL[j.state];

  const onOrb = () => (j.state === 'speaking' ? j.interrupt() : j.listen());
  const toggleSpeech = () => {
    if (settings.voice.speak) j.interrupt();
    update((s) => ({ ...s, voice: { ...s.voice, speak: !s.voice.speak } }));
  };

  const panels: Record<Exclude<Section, 'conversation'>, [string, ReactNode]> = {
    memory: ['Memory', <MemoryPanel version={version} />],
    tools: ['Tools & tasks', <ToolsPanel version={version} />],
    accounts: ['Connected accounts', <ConnectionManager health={agent.health} config={config} onAgentChange={agent.refresh} />],
    activity: ['Activity', <div className="glass p-3"><ActivityLog version={version} /></div>],
    settings: ['Settings', <SettingsPanel key={displayName} settings={settings} update={update} config={config} email={session.user.email ?? ''} displayName={displayName} onDisplayName={saveDisplayName} onActivityCleared={bump} />],
  };

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Navigation: left rail on desktop, bottom bar on phones */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-line bg-void/90 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:static md:w-56 md:flex-col md:justify-start md:gap-1 md:border-t-0 md:border-r md:bg-transparent md:p-4">
        <div className="hidden px-3 pt-2 pb-8 text-sm font-light tracking-[0.5em] text-white md:block">JARVIS</div>
        {NAV.map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setSection(id)}
            aria-current={section === id ? 'page' : undefined}
            className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-1 py-2.5 text-[10px] transition md:flex-none md:flex-row md:gap-3 md:px-3 md:text-sm ${
              section === id ? 'text-glow md:bg-white/[0.05]' : 'text-dim hover:text-white'
            }`}
          >
            <Icon className="size-5 shrink-0 md:size-4" />
            <span className="max-w-full truncate">{label}</span>
          </button>
        ))}
      </nav>

      <main className="min-w-0 flex-1">
        {section === 'conversation' ? (
          <div className="flex h-full">
            <div className="relative flex min-w-0 flex-1 flex-col">
              <header className="flex items-center gap-2 px-4 pt-4 md:px-6">
                {hasMessages && (
                  <div className="flex items-center gap-3">
                    <JarvisOrb state={j.state} size={40} onClick={onOrb} />
                    <div>
                      <div className="text-xs font-light tracking-[0.45em] text-white">JARVIS</div>
                      <div className="hud-label !text-[10px] !text-glow">◉ {stateLabel}</div>
                    </div>
                  </div>
                )}
                <div className="ml-auto flex items-center gap-1">
                  <button onClick={toggleSpeech} title={settings.voice.speak ? 'Mute voice' : 'Unmute voice'} className="rounded-lg p-2 text-dim hover:bg-white/5 hover:text-white">
                    {settings.voice.speak ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
                  </button>
                  <button onClick={() => setShowHistory((v) => !v)} title="Conversations" className="rounded-lg p-2 text-dim hover:bg-white/5 hover:text-white xl:hidden">
                    <History className="size-4" />
                  </button>
                  <button onClick={j.newConversation} title="New conversation" className="rounded-lg p-2 text-dim hover:bg-white/5 hover:text-white">
                    <Plus className="size-4" />
                  </button>
                </div>
                {showHistory && (
                  <div className="glass absolute top-14 right-4 z-30 max-h-[60vh] w-72 overflow-y-auto !bg-ink/95 p-3 xl:hidden">
                    <Conversations version={version} activeId={j.conversationId} onOpen={(id) => (setShowHistory(false), j.openConversation(id))} onNew={() => (setShowHistory(false), j.newConversation())} />
                  </div>
                )}
              </header>

              <div className="flex-1 overflow-y-auto px-4 md:px-6">
                {hasMessages ? (
                  <div className="mx-auto max-w-3xl py-6">
                    <ConversationPanel messages={j.messages} state={j.state} />
                  </div>
                ) : (
                  <div className="flex min-h-full flex-col items-center justify-center gap-6 py-8 text-center">
                    <h1 className="pl-[0.6em] text-lg font-light tracking-[0.6em] text-white">JARVIS</h1>
                    <div className="hud-label !text-glow">◉ {stateLabel}</div>
                    <JarvisOrb state={j.state} size={210} onClick={onOrb} />
                    <p className="text-2xl font-light text-white/90">“{greeting(name)}”</p>
                    <VoiceVisualizer state={j.state} />
                    <SystemStatus health={agent.health} metrics={agent.metrics} />
                  </div>
                )}
              </div>

              <div className="px-4 pt-2 pb-24 md:px-6 md:pb-6">
                <div className="mx-auto max-w-3xl space-y-2">
                  {hasMessages && (
                    <div className="flex justify-center">
                      <VoiceVisualizer state={j.state} width={220} height={28} />
                    </div>
                  )}
                  <CommandInput state={j.state} interim={j.interim} busy={j.busy} voiceSupported={voice.supportsInput} onSend={j.send} onListen={j.listen} />
                  {j.error && <p className="text-center text-xs text-danger">{j.error}</p>}
                </div>
              </div>
            </div>

            <aside className="hidden w-80 shrink-0 flex-col gap-6 overflow-y-auto border-l border-line p-5 xl:flex">
              {hasMessages && <SystemStatus health={agent.health} metrics={agent.metrics} />}
              <div>
                <h2 className="hud-label mb-3">Conversations</h2>
                <Conversations version={version} activeId={j.conversationId} onOpen={j.openConversation} onNew={j.newConversation} />
              </div>
              <div>
                <h2 className="hud-label mb-2">Recent activity</h2>
                <ActivityLog version={version} limit={8} compact />
              </div>
            </aside>
          </div>
        ) : (
          <div className="h-full overflow-y-auto">
            <div className="mx-auto max-w-3xl px-4 pt-8 pb-28 md:px-8 md:pb-10">
              <h1 className="mb-6 text-xl font-light tracking-wide text-white">{panels[section][0]}</h1>
              {panels[section][1]}
            </div>
          </div>
        )}
      </main>

      <ApprovalDialog action={j.approval} onDecide={j.decide} />
    </div>
  );
}
