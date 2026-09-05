import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store';
import { ConfirmDialog } from './ConfirmDialog';

export function AgentStatus({ paneId, remote }: { paneId: string; remote: boolean }): React.JSX.Element {
  const { t } = useTranslation();
  const state = useStore(s => s.agentStates[paneId]);
  const [provider, setProvider] = useState<'claude' | 'codex'>('claude');
  const [pending, setPending] = useState(false);
  const [dialog, setDialog] = useState<{ command?: string; error?: boolean } | null>(null);
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

  const openSetup = async (next: 'claude' | 'codex' = provider): Promise<void> => {
    if (remote) { setDialog({}); return; }
    setPending(true);
    try {
      const setup = await window.api.prepareAgentStatus(paneId, next);
      setDialog({ command: setup.command });
    } catch { setDialog({ error: true }); }
    finally { setPending(false); }
  };
  const status = state?.status ?? 'unknown';
  return <>
    <button type="button" className={`pane-agent-status agent-${status}`}
      aria-label={t('agent.title')} disabled={pending}
      title={state ? t('agent.lastReported', { state: t(`agent.state.${status}`), time: new Date(state.updatedAt).toLocaleTimeString() }) : t('agent.unknownHint')}
      onMouseDown={e => e.stopPropagation()} onClick={() => void openSetup()}>
      {state ? `${state.provider === 'codex' ? 'Codex' : 'Claude'} · ${t(`agent.state.${status}`)}` : t('agent.short')}
    </button>
    {dialog && createPortal(<ConfirmDialog
      title={t('agent.title')}
      message={<>
        {!remote && <label className="agent-help">{t('agent.provider')} <select aria-label={t('agent.provider')} value={provider} disabled={pending}
          onChange={e => { const next = e.target.value as 'claude' | 'codex'; setProvider(next); setDialog({}); void openSetup(next); }}>
          <option value="claude">Claude</option><option value="codex">Codex</option>
        </select></label>}
        <span className="agent-help">{t(remote ? 'agent.remoteHint' : dialog.error ? 'agent.setupError' : provider === 'codex' ? 'agent.codexHint' : 'agent.setupHint')}</span>
        {dialog.command && <code className="agent-command">{dialog.command}</code>}
        {!remote && !dialog.error && <span className="agent-help">{t('agent.limitations')}{provider === 'codex' && <> {t('agent.codexLimits')}</>}</span>}
      </>}
      confirmLabel={t(dialog.command ? 'agent.copy' : 'common.close')}
      cancelLabel={t('common.close')}
      onCancel={() => setDialog(null)}
      onConfirm={() => { if (dialog.command) window.api.clipboardWrite(dialog.command); setDialog(null); }}
    />, document.body)}
  </>;
}
