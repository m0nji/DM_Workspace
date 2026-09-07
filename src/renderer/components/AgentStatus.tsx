import { AGENT_NAMES, type AgentProvider } from '../../shared/agent-state';
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store';
import { ConfirmDialog } from './ConfirmDialog';
import { focusTerminal } from '../terminal-registry';
import { collectPaneIds } from '../../shared/layout-tree';

export function AgentStatus({ paneId, remote }: { paneId: string; remote: boolean }): React.JSX.Element {
  const { t } = useTranslation();
  const state = useStore(s => s.agentStates[paneId]);
  const shell = useStore(s => s.paneShell[paneId]);
  const connected = !!state && (!!state.sessionId || shell === 'running' || state.event === 'interrupted');
  const [provider, setProvider] = useState<AgentProvider>('claude');
  const [showDetails, setShowDetails] = useState(false);
  const [pending, setPending] = useState(false);
  const [dialog, setDialog] = useState<{ command?: string; error?: 'stopError' | 'setupError' | 'promptRequired' | `startErrors.${'missing-cli' | 'missing-node' | 'unsupported-shell' | 'check-failed'}` } | null>(null);
  const operation = useRef(0);
  const busy = useRef(false);
  const cwd = useStore(s => s.paneCwd[paneId] ?? s.workspaces.find(w => collectPaneIds(w.layout).includes(paneId))?.cwd ?? '');
  const close = (): void => { operation.current++; busy.current = false; setPending(false); setDialog(null); };
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
    if (busy.current) return;
    busy.current = true;
    const ticket = ++operation.current;
    setPending(true);
    try {
      const setup = await window.api.prepareAgentStatus(paneId, provider);
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
  const start = async (): Promise<void> => {
    if (busy.current || remote) return;
    busy.current = true;
    const ticket = ++operation.current;
    setPending(true);
    setDialog({});
    try {
      if (useStore.getState().paneShell[paneId] !== 'atPrompt') { setDialog({ error: 'promptRequired' }); return; }
      const result = await window.api.checkAgentStart(paneId, provider, cwd);
      if (ticket !== operation.current) return;
      if (result !== 'ready') { setDialog({ error: `startErrors.${result}` }); return; }
      const setup = await window.api.prepareAgentStatus(paneId, provider);
      if (ticket !== operation.current) return;
      if (!useStore.getState().startAgentInPane(paneId, setup.launchCommand, setup.inputPrefix)) { setDialog({ error: 'promptRequired' }); return; }
      close();
      requestAnimationFrame(() => focusTerminal(paneId));
    } catch { if (ticket === operation.current) setDialog({ error: 'startErrors.check-failed' }); }
    finally { if (ticket === operation.current) { busy.current = false; setPending(false); } }
  };
  const status = state?.status ?? 'unknown';
  return <>
    <button type="button" className={`pane-agent-status agent-${status}`}
      aria-label={t('agent.title')} disabled={pending}
      title={state ? t('agent.lastReported', { state: t(`agent.state.${status}`), time: new Date(state.updatedAt).toLocaleTimeString() }) : t('agent.unknownHint')}
      onMouseDown={e => e.stopPropagation()} onClick={() => { setProvider(state?.provider ?? provider); setShowDetails(false); setDialog({}); }}>
      {state ? `${AGENT_NAMES[state.provider]} · ${t(`agent.state.${status}`)}` : t('agent.short')}
    </button>
    {dialog && createPortal(<ConfirmDialog
      title={t('agent.title')}
      message={<>
        {connected && <span className="agent-help">{AGENT_NAMES[state.provider]} · {t(`agent.state.${state.status}`)}<br />{t('agent.sessionHint')}</span>}
        {!remote && !connected && <label className="agent-help">{t('agent.provider')} <select aria-label={t('agent.provider')} value={provider} disabled={pending}
          onChange={e => { setProvider(e.target.value as AgentProvider); setDialog({}); }}>
          <option value="claude">Claude Code</option><option value="codex">Codex</option><option value="opencode">OpenCode</option>
        </select></label>}
        {!connected && <span className="agent-help">{t(remote ? 'agent.remoteHint' : provider === 'opencode' ? 'agent.opencodeHint' : provider === 'codex' ? 'agent.codexHint' : 'agent.setupHint')}</span>}
        {!remote && !connected && <span className="agent-help agent-folder">{t('agent.startFolder', { cwd })}</span>}
        {dialog.error && <span className="agent-help" role="status">{t(`agent.${dialog.error}`)}</span>}
        {!remote && !connected && <button type="button" className="confirm-btn agent-secondary-action" disabled={pending} onClick={() => void prepareCopy()}>{t('agent.showCommand')}</button>}
        {dialog.command && <><code className="agent-command">{dialog.command}</code>
          <button type="button" className="confirm-btn agent-secondary-action" disabled={pending} onClick={() => { window.api.clipboardWrite(dialog.command!); close(); }}>{t('agent.copy')}</button></>}
        {!remote && state && <><span className="agent-help">{t('agent.stopHint')}</span>
          <button type="button" className="confirm-btn agent-secondary-action" disabled={pending} onClick={() => void stop()}>{t('agent.stop')}</button></>}
        {!remote && provider !== 'opencode' && !dialog.error && <><button type="button" className="confirm-btn agent-secondary-action" aria-expanded={showDetails} onClick={() => setShowDetails(!showDetails)}>{t('agent.details')}</button>{showDetails && <span className="agent-help">{t('agent.limitations')}{provider === 'codex' && <> {t('agent.codexLimits')}</>}</span>}</>}
      </>}
      confirmLabel={t(remote ? 'common.close' : connected ? 'agent.goToTerminal' : pending ? 'agent.checking' : 'agent.start')}
      confirmDisabled={pending}
      cancelLabel={t('common.close')}
      onCancel={close}
      onConfirm={() => { if (remote) close(); else if (connected) { close(); useStore.getState().setFocusedPane(paneId); requestAnimationFrame(() => focusTerminal(paneId)); } else void start(); }}
    />, document.querySelector('.root') ?? document.body)}
  </>;
}
