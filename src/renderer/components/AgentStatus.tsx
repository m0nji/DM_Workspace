import { agentPhase, agentLabelKey } from '../../shared/agent-presentation';
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store';
import { ConfirmDialog } from './ConfirmDialog';
import { focusTerminal, endAgentSession } from '../terminal-registry';
import { collectPaneIds } from '../../shared/layout-tree';
import { startProfileInPane } from '../agent-start';
import { useAgentProfiles } from '../use-agent-profiles';

export function AgentStatus({ paneId, remote }: { paneId: string; remote: boolean }): React.JSX.Element {
  const { t } = useTranslation();
  const state = useStore(s => s.agentStates[paneId]);
  const shell = useStore(s => s.paneShell[paneId]);
  const phase = state ? agentPhase(state, shell) : null;
  const connected = !!state && phase !== 'ended' && (!!state.sessionId || shell === 'running' || phase === 'ending');
  const [confirmEnd, setConfirmEnd] = useState<string | null>(null);
  const runningWithoutStatus = !remote && !connected && shell === 'running';
  const canShowStart = !connected && !runningWithoutStatus;
  const profiles = useAgentProfiles();
  const [profileId, setProfileId] = useState('claude');
  // A deleted profile is not silently replaced by another one: the snapshot
  // only carries name and icon, so a restart needs an explicit choice.
  const profile = profiles.find(p => p.id === profileId);
  const [showDetails, setShowDetails] = useState(false);
  const [pending, setPending] = useState(false);
  const [dialog, setDialog] = useState<{ command?: string; error?: 'endError' | 'reconnectError' | 'stopError' | 'setupError' | 'promptRequired' | `startErrors.${'missing-cli' | 'missing-node' | 'unsupported-shell' | 'unsupported-argument' | 'check-failed'}` } | null>(null);
  const operation = useRef(0);
  const busy = useRef(false);
  const cwd = useStore(s => s.paneCwd[paneId] ?? s.workspaces.find(w => collectPaneIds(w.layout).includes(paneId))?.cwd ?? '');
  const close = (): void => { operation.current++; busy.current = false; setPending(false); setConfirmEnd(null); setDialog(null); };
  useEffect(() => () => { operation.current++; }, []);
  useEffect(() => {
    if (remote) return;
    let disposed = false;
    let received = false;
    const off = window.api.onAgentState(paneId, next => {
      received = true;
      useStore.getState().setAgentState(paneId, next);
    });
    void window.api.getAgentState(paneId).then(next => {
      if (!disposed && !received) useStore.getState().setAgentState(paneId, next);
    }).catch(() => { /* no evidence remains unknown */ });
    return () => { disposed = true; off(); useStore.getState().setAgentState(paneId, null); };
  }, [paneId, remote]);

  const prepareCopy = async (): Promise<void> => {
    if (busy.current || !profile) return;
    busy.current = true;
    const ticket = ++operation.current;
    setPending(true);
    try {
      const setup = await window.api.prepareAgentStatus(paneId, profile);
      if (ticket === operation.current) setDialog({ command: setup.command });
    } catch { if (ticket === operation.current) setDialog({ error: 'setupError' }); }
    finally { if (ticket === operation.current) { busy.current = false; setPending(false); } }
  };
  const stop = async (): Promise<void> => {
    if (busy.current) return;
    busy.current = true;
    const ticket = ++operation.current;
    setPending(true);
    try {
      await window.api.stopAgentStatus(paneId);
      if (ticket === operation.current) close();
    } catch { if (ticket === operation.current) setDialog({ error: 'stopError' }); }
    finally { if (ticket === operation.current) { busy.current = false; setPending(false); } }
  };
  const reconnect = async (): Promise<void> => {
    if (busy.current) return;
    busy.current = true;
    const ticket = ++operation.current;
    setPending(true);
    try { await window.api.reconnectAgentStatus(paneId); if (ticket === operation.current) setDialog({}); }
    catch { if (ticket === operation.current) setDialog({ error: 'reconnectError' }); }
    finally { if (ticket === operation.current) { busy.current = false; setPending(false); } }
  };
  const end = async (): Promise<void> => {
    if (busy.current || !confirmEnd) return;
    busy.current = true;
    const ticket = ++operation.current;
    const generation = confirmEnd;
    setPending(true);
    try { await endAgentSession(paneId, generation); if (ticket === operation.current) close(); }
    catch { if (ticket === operation.current) { setConfirmEnd(null); setDialog({ error: 'endError' }); } }
    finally { if (ticket === operation.current) { busy.current = false; setPending(false); } }
  };
  const start = async (): Promise<void> => {
    if (busy.current || remote || !profile) return;
    busy.current = true;
    const ticket = ++operation.current;
    setPending(true);
    setDialog({});
    try {
      const result = await startProfileInPane(paneId, profile, cwd, () => ticket === operation.current);
      if (result === 'cancelled') return;
      if (result === 'started') { close(); requestAnimationFrame(() => focusTerminal(paneId)); return; }
      // 'ready' is unreachable here: startProfileInPane only returns it as part of
      // AgentCheck's type, never as an actual result (a 'ready' check moves on to
      // prepare/start instead). Narrow it away so the dialog's error type — which
      // only lists the real failure codes — still matches.
      if (result === 'ready') return;
      setDialog({ error: result === 'prompt-required' ? 'promptRequired' : result === 'setup-error' ? 'setupError' : `startErrors.${result}` });
    } catch { if (ticket === operation.current) setDialog({ error: 'startErrors.check-failed' }); }
    finally { if (ticket === operation.current) { busy.current = false; setPending(false); } }
  };
  const status = phase === 'live' ? state!.status : 'unknown';
  const label = state ? t(agentLabelKey(state, shell)) : t('agent.short');
  return <>
    <button type="button" className={`pane-agent-status agent-${status}`}
      aria-label={t('agent.title')} disabled={pending}
      title={state ? t('agent.lastReported', { state: label, time: new Date(state.updatedAt).toLocaleTimeString() }) : t('agent.unknownHint')}
      onMouseDown={e => e.stopPropagation()} onClick={() => { setProfileId(state?.profileId ?? profileId); setShowDetails(false); setDialog({}); }}>
      {state ? label : t('agent.short')}
    </button>
    {dialog && createPortal(<ConfirmDialog key={confirmEnd ? 'end' : 'status'}
      title={t(confirmEnd ? 'agent.endTitle' : 'agent.title')}
      tone={confirmEnd ? 'danger' : 'brand'}
      message={confirmEnd ? t('agent.endConfirm') : <>
        {connected && <span className="agent-help">{state.profileName} · {label}<br />{t(`agent.hint.${phase ?? 'waiting'}`)}{phase === 'live' && state.status === 'unknown' && <><br />{t(state.event === 'PermissionRequest' ? 'agent.approvalUnknown' : 'agent.evidenceUnknown')}</>}</span>}
        {!remote && canShowStart && <label className="agent-help">{t('agent.provider')} <select aria-label={t('agent.provider')} value={profile?.id ?? ''} disabled={pending}
          onChange={e => { setProfileId(e.target.value); setDialog({}); }}>
          {!profile && <option value="" disabled>{t('agent.chooseProfile')}</option>}
          {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></label>}
        {!remote && canShowStart && !profile && <span className="agent-help" role="status">{t('agent.profileMissing', { name: state?.profileName ?? profileId })}</span>}
        {canShowStart && (remote || profile) && <span className="agent-help">{t(remote ? 'agent.remoteHint' : profile!.adapter === 'generic' ? 'agent.genericHint' : profile!.adapter === 'opencode' ? 'agent.opencodeHint' : profile!.adapter === 'codex' ? 'agent.codexHint' : 'agent.setupHint')}</span>}
        {!remote && canShowStart && <span className="agent-help agent-folder">{t('agent.startFolder', { cwd })}</span>}
        {runningWithoutStatus && <span className="agent-help" role="status">{t('agent.runningWithoutStatus')}</span>}
        {dialog.error && <span className="agent-help" role="status">{t(`agent.${dialog.error}`, { command: profile?.command ?? '' })}</span>}
        {!remote && canShowStart && profile && <button type="button" className="confirm-btn agent-secondary-action" disabled={pending} onClick={() => void prepareCopy()}>{t('agent.showCommand')}</button>}
        {dialog.command && <><code className="agent-command">{dialog.command}</code>
          <button type="button" className="confirm-btn agent-secondary-action" disabled={pending} onClick={() => { window.api.clipboardWrite(dialog.command!); close(); }}>{t('agent.copy')}</button></>}
        {phase === 'ended' && <span className="agent-help">{t('agent.hint.ended')}</span>}
        {!remote && connected && phase === 'paused' && <button type="button" className="confirm-btn agent-secondary-action" disabled={pending} onClick={() => void reconnect()}>{t('agent.reconnect')}</button>}
        {!remote && connected && phase !== 'paused' && phase !== 'ending' && <><span className="agent-help">{t('agent.stopHint')}</span>
          <button type="button" className="confirm-btn agent-secondary-action" disabled={pending} onClick={() => void stop()}>{t('agent.stop')}</button></>}
        {!remote && connected && state.generation && <button type="button" className="confirm-btn agent-secondary-action" disabled={pending} onClick={() => setConfirmEnd(state.generation!)}>{t('agent.end')}</button>}
        {!remote && !runningWithoutStatus && (profile?.adapter === 'claude' || profile?.adapter === 'codex') && !dialog.error && <><button type="button" className="confirm-btn agent-secondary-action" aria-expanded={showDetails} onClick={() => setShowDetails(!showDetails)}>{t('agent.details')}</button>{showDetails && <span className="agent-help">{t('agent.limitations')}{profile.adapter === 'codex' && <> {t('agent.codexLimits')}</>}</span>}</>}
      </>}
      confirmLabel={t(confirmEnd ? (pending ? 'agent.ending' : 'agent.end') : remote ? 'common.close' : (connected || runningWithoutStatus) ? 'agent.goToTerminal' : pending ? 'agent.checking' : phase === 'ended' ? 'agent.restart' : 'agent.start')}
      confirmDisabled={pending || (!confirmEnd && !remote && !connected && !runningWithoutStatus && !profile)}
      cancelLabel={remote ? null : t(confirmEnd ? 'common.cancel' : 'common.close')}
      onCancel={() => { if (confirmEnd) setConfirmEnd(null); else close(); }}
      onConfirm={() => { if (confirmEnd) void end(); else if (remote) close(); else if (connected || runningWithoutStatus) { close(); useStore.getState().setFocusedPane(paneId); requestAnimationFrame(() => focusTerminal(paneId)); } else void start(); }}
    />, document.querySelector('.root') ?? document.body)}
  </>;
}
