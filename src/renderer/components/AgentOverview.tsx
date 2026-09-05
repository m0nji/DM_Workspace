import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store';
import { agentOverview } from '../agent-overview';
import { paneDisplayName } from '../pane-display-name';
import { ConfirmDialog } from './ConfirmDialog';
import { Icon } from './Icon';

export function AgentOverview(): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const workspaces = useStore(s => s.workspaces);
  const states = useStore(s => s.agentStates);
  const titles = useStore(s => s.paneAutoTitles);
  const cwd = useStore(s => s.paneCwd);
  const rows = agentOverview(workspaces, states);
  const attention = rows.filter(row => row.state.status === 'needs-input' || row.state.status === 'error').length;
  const close = (): void => setOpen(false);
  return <>
    <button type="button" className={`icon-btn agent-overview-trigger ${attention ? 'has-attention' : ''}`}
      aria-label={t('agent.overview.title')} aria-haspopup="dialog" aria-expanded={open}
      title={t('agent.overview.attention', { count: attention })} onClick={() => setOpen(true)}>
      <Icon name="agents" />
      {attention > 0 && <span className="agent-attention-count">{attention}</span>}
    </button>
    {open && createPortal(<ConfirmDialog title={t('agent.overview.title')}
      message={<>
        <span className="agent-help">{t(rows.length ? 'agent.overview.hint' : 'agent.overview.empty')}</span>
        <span className="agent-overview-list">
          {rows.map(({ workspace, paneId, position, state }) => <button type="button" key={`${workspace.id}:${paneId}`}
            className={`agent-overview-row agent-${state.status}`} onClick={() => {
              close();
              useStore.getState().revealPane(workspace.id, paneId);
            }}>
            <span className="agent-overview-name">{paneDisplayName(workspace.paneTitles?.[paneId] || titles[paneId] || '', cwd[paneId] ?? workspace.cwd) || t('palette.paneNumber', { number: position })}</span>
            <span>{workspace.name} · {t('palette.paneNumber', { number: position })}</span>
            <span className="agent-overview-state">{state.provider === 'codex' ? 'Codex' : 'Claude'} · {t(`agent.state.${state.status}`)}</span>
            <span>{t('agent.overview.reported', { time: new Date(state.updatedAt).toLocaleTimeString() })}</span>
          </button>)}
        </span>
      </>}
      confirmLabel={t('common.close')} cancelLabel={null} onConfirm={close} onCancel={close}
    />, document.querySelector('.root') ?? document.body)}
  </>;
}
