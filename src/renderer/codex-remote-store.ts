import { create } from 'zustand';
import type { CodexRemoteAction, CodexRemoteResult, CodexRemoteSnapshot } from '../shared/types';
import { useStore } from './store';
import { resolveAgentProfiles } from '../shared/agent-profiles';

interface CodexRemoteState {
  snapshot: CodexRemoteSnapshot | null;
  busy: CodexRemoteAction | null;
  error: Extract<CodexRemoteResult, { status: 'error' }>['reason'] | null;
  run: (action: CodexRemoteAction) => Promise<CodexRemoteResult | null>;
}

// Runtime evidence is shared by the card and titlebar; pairing codes stay with
// the mounted settings dialog and never enter either persistent store.
export const useCodexRemote = create<CodexRemoteState>((set, get) => ({
  snapshot: null, busy: null, error: null,
  run: async action => {
    if (get().busy) return null;
    set({ busy: action, error: null });
    try {
      const result = await window.api.codexRemote(action);
      if (result.status === 'error') set({ error: result.reason });
      else if (result.status === 'running' || result.status === 'stopped') {
        set({ snapshot: { ...result, cliVersion: result.cliVersion ?? get().snapshot?.cliVersion } });
        const store = useStore.getState();
        if (result.remoteEnabled !== null && store.settings.codexRemoteAccess !== result.remoteEnabled) {
          store.updateSettings({ codexRemoteAccess: result.remoteEnabled });
        }
        if (action === 'enable' && result.remoteEnabled) {
          const latest = resolveAgentProfiles(useStore.getState().settings);
          if (latest.find(profile => profile.id === 'codex')?.remoteControl === undefined) {
            store.setAgentProfiles(latest.map(profile => profile.id === 'codex' ? { ...profile, remoteControl: true } : profile));
          }
        }
      }
      return result;
    } catch {
      set({ error: 'unavailable' });
      return { status: 'error', reason: 'unavailable' };
    } finally { set({ busy: null }); }
  }
}));

export function codexRemotePresentation(snapshot: CodexRemoteSnapshot | null, busy: CodexRemoteAction | null, error: string | null): 'unknown' | 'off' | 'connecting' | 'connected' | 'running' | 'stopped' | 'error' {
  if (busy === 'enable') return 'connecting';
  if (error) return 'error';
  if (!snapshot || snapshot.remoteEnabled === null) return 'unknown';
  if (!snapshot.remoteEnabled) return 'off';
  if (snapshot.status === 'stopped') return 'stopped';
  return snapshot.connected ? 'connected' : 'running';
}
