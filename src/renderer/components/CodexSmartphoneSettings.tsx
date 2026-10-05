import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { CodexRemoteAction, CodexRemoteResult } from '../../shared/types';
import { resolveAgentProfiles } from '../../shared/agent-profiles';
import { useStore } from '../store';
import { useAgentProfiles } from '../use-agent-profiles';
import { codexRemotePresentation, useCodexRemote } from '../codex-remote-store';
import { ConfirmDialog } from './ConfirmDialog';
import { Icon } from './Icon';
import { Switch } from './Switch';

export function CodexSmartphoneSettings(): React.JSX.Element {
  const { t } = useTranslation();
  const id = useId();
  const profiles = useAgentProfiles();
  const { snapshot, busy, error, run } = useCodexRemote();
  const [pairing, setPairing] = useState<Extract<CodexRemoteResult, { status: 'paired-code' }> | null>(null);
  const [expired, setExpired] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const generation = useRef(0);
  const status = codexRemotePresentation(snapshot, busy, error);
  const enabled = snapshot?.remoteEnabled === true;
  const codex = profiles.find(profile => profile.id === 'codex')!;

  useEffect(() => { void run('status'); }, [run]);
  useEffect(() => {
    if (!pairing) return;
    const timer = setTimeout(() => setExpired(true), Math.max(0, Date.parse(pairing.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [pairing]);
  // An operation belongs to the shared service store. A closed settings dialog
  // must not retain a subsequently returned pairing credential.
  useEffect(() => () => { generation.current++; }, []);
  async function act(action: CodexRemoteAction): Promise<void> {
    const current = generation.current;
    const result = await run(action);
    if (!result || current !== generation.current) return;
    if (result.status === 'paired-code') { setExpired(false); setPairing(result); }
    if (action === 'disable') setPairing(null);
  }
  const portal = document.querySelector('.root') ?? document.body;
  return <section id="codex-smartphone-access" className="codex-smartphone-settings settings-group">
    <div className="modal-section-label">{t('settings.smartphone.section')}</div>
    <div className="codex-smartphone-card">
      <div className="codex-smartphone-header">
        <span className="codex-smartphone-icon"><Icon name="smartphone" size={22} /></span>
        <div><label htmlFor={`${id}-access`} className="codex-smartphone-title">{t('settings.smartphone.title')}</label>
          <p className="modal-hint">{t('settings.smartphone.subtitle')}</p></div>
        <Switch id={`${id}-access`} checked={enabled} disabled={!!busy} onChange={checked => void act(checked ? 'enable' : 'disable')} />
      </div>
      <div className={`codex-smartphone-status remote-${status}`} role="status" aria-live="polite">
        <strong><span className="codex-remote-dot" aria-hidden="true" />{t(`settings.smartphone.status.${status}`)}</strong>
        <p className="modal-hint">{error ? t(`settings.agents.error.${error}`) : t(`settings.smartphone.hint.${status}`)}</p>
      </div>
      <dl className="codex-smartphone-facts">
        <div><dt>Codex</dt><dd>{snapshot?.cliVersion ?? t('settings.smartphone.versionUnknown')}</dd></div>
        <div><dt>{t('settings.smartphone.service')}</dt><dd>{t(`settings.smartphone.serviceState.${snapshot?.status ?? 'unknown'}`)}</dd></div>
        <div><dt>{t('settings.smartphone.phoneConnection')}</dt><dd>{t(enabled ? 'settings.smartphone.checkOnPhone' : 'settings.smartphone.notEnabled')}</dd></div>
      </dl>
      <div className="codex-smartphone-actions">
        <button type="button" className="btn-primary" disabled={!!busy || !enabled || snapshot?.status !== 'running'} onClick={() => void act('pair')}>{t('settings.agents.pair')}</button>
        <button type="button" className="btn-secondary" disabled={!!busy} onClick={() => void act('status')}>{t('settings.agents.check')}</button>
        {enabled && (snapshot?.status === 'stopped' || error) && <button type="button" className="btn-secondary" disabled={!!busy} onClick={() => void act('enable')}>{t('settings.smartphone.retry')}</button>}
      </div>
      {busy && <p className="modal-hint" role="status">{t(`settings.smartphone.operation.${busy}`)}</p>}
      <div className="codex-smartphone-auto setting-row">
        <div><label htmlFor={`${id}-auto`}>{t('settings.smartphone.auto')}</label><p className="modal-hint">{t('settings.smartphone.autoHint')}</p></div>
        <Switch id={`${id}-auto`} checked={codex.remoteControl === true} disabled={!!busy || !enabled}
          onChange={checked => {
            const store = useStore.getState();
            store.setAgentProfiles(resolveAgentProfiles(store.settings).map(profile => profile.id === 'codex' ? { ...profile, remoteControl: checked } : profile));
          }} />
      </div>
      <p className="modal-hint codex-smartphone-awake">{t('settings.smartphone.awake')}</p>
      <details className="agent-remote-help"><summary>{t('settings.smartphone.advanced')}</summary>
        <p className="modal-hint">{t('settings.smartphone.disableHint')}</p>
        <p className="modal-hint">{t('settings.smartphone.lifecycle')}</p>
        <p className="modal-hint">{t('settings.agents.codexTroubleshooting')}</p>
        <button type="button" className="btn-secondary btn-danger" disabled={!!busy || snapshot?.status !== 'running'} onClick={() => setConfirmStop(true)}>{t('settings.smartphone.stop')}</button>
      </details>
    </div>
    {confirmStop && createPortal(<ConfirmDialog tone="danger" title={t('settings.smartphone.stopTitle')}
      message={t('settings.smartphone.stopMessage')} confirmLabel={t('settings.smartphone.stopConfirm')}
      onCancel={() => setConfirmStop(false)} onConfirm={() => { setConfirmStop(false); void act('stop'); }} />, portal)}
    {pairing && createPortal(<ConfirmDialog title={t('settings.smartphone.pairTitle')} cancelLabel={null}
      confirmLabel={t('common.close')} onCancel={() => setPairing(null)} onConfirm={() => setPairing(null)}
      message={<>
        <span>{t('settings.agents.pairInstructions')}</span>
        {expired ? <span className="codex-pairing-expired">{t('settings.agents.expired')}</span> : <>
          <strong className="agent-pairing-code codex-pairing-code">{pairing.code}</strong>
          <span>{t('settings.agents.expires', { time: new Date(pairing.expiresAt).toLocaleTimeString() })}</span>
        </>}
        {expired && <button type="button" className="btn-secondary" disabled={!!busy} onClick={() => void act('pair')}>{t('settings.smartphone.newCode')}</button>}
        <span className="codex-pairing-note">{t('settings.smartphone.pairNote')}</span>
      </>} />, portal)}
  </section>;
}
