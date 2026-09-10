import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store';
import type { CodexRemoteResult } from '../../shared/types';

export function AgentSettingsSection(): React.JSX.Element {
  const { t } = useTranslation();
  const remote = useStore(s => s.settings.agentRemoteControl);
  const update = useStore(s => s.updateSettings);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CodexRemoteResult | null>(null);
  const [expired, setExpired] = useState(false);
  const mounted = useRef(true);
  const pending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (result?.status !== 'paired-code') return;
    const timer = setTimeout(() => setExpired(true), Math.max(0, Date.parse(result.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [result]);
  async function run(action: 'status' | 'pair'): Promise<void> {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setResult(null); setExpired(false);
    try {
      const response = await window.api.codexRemote(action);
      if (mounted.current) setResult(response);
    } catch {
      if (mounted.current) setResult({ status: 'error', reason: 'unavailable' });
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return <div>
    <p className="modal-hint">{t('settings.agents.scope')}</p>
    <div className="settings-group">
      <div className="modal-section-label">Codex</div>
      <div className="setting-row">
        <label htmlFor="codex-remote">{t('settings.agents.autoRemote')}</label>
        <input id="codex-remote" type="checkbox" checked={remote?.codex ?? false}
          onChange={e => update({ agentRemoteControl: { ...remote, codex: e.target.checked } })} />
      </div>
      <p className="modal-hint">{t('settings.agents.codexHint')}</p>
      <div className="setting-row">
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => void run('pair')}>{t('settings.agents.pair')}</button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => void run('status')}>{t('settings.agents.check')}</button>
      </div>
      <div aria-live="polite">
        {busy && <p>{t('settings.agents.working')}</p>}
        {result?.status === 'running' && <p className="modal-hint">{t('settings.agents.running')}</p>}
        {result?.status === 'stopped' && <p className="modal-hint">{t('settings.agents.stopped')}</p>}
        {result?.status === 'error' && <p className="setting-error">{t(`settings.agents.error.${result.reason}`)}</p>}
        {result?.status === 'paired-code' && (expired ? <p>{t('settings.agents.expired')}</p> : <>
          <p>{t('settings.agents.pairInstructions')}</p>
          <p><strong className="agent-pairing-code">{result.code}</strong></p>
          <p className="modal-hint">{t('settings.agents.expires', { time: new Date(result.expiresAt).toLocaleTimeString() })}</p>
        </>)}
      </div>
      <details className="agent-remote-help"><summary>{t('settings.agents.help')}</summary>
        <p className="modal-hint">{t('settings.agents.codexTroubleshooting')}</p>
      </details>
    </div>
    <div className="settings-group">
      <div className="modal-section-label">Claude Code</div>
      <div className="setting-row">
        <label htmlFor="claude-remote">{t('settings.agents.autoRemote')}</label>
        <input id="claude-remote" type="checkbox" checked={remote?.claude ?? false}
          onChange={e => update({ agentRemoteControl: { ...remote, claude: e.target.checked } })} />
      </div>
      <p className="modal-hint">{t('settings.agents.claudeHint')}</p>
      <button type="button" className="btn-secondary" onClick={() => window.api.openExternal('https://claude.ai/code')}>{t('settings.agents.openClaude')}</button>
    </div>
    <div className="settings-group">
      <div className="modal-section-label">OpenCode</div>
      <p className="modal-hint">{t('settings.agents.opencodeHint')}</p>
      <button type="button" className="btn-secondary" onClick={() => window.api.openExternal('https://opencode.ai/docs/web/')}>{t('settings.agents.openGuide')}</button>
    </div>
  </div>;
}
