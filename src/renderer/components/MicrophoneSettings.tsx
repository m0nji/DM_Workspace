import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MicrophoneAccess } from '../../shared/types';

export function MicrophoneSettings(): React.JSX.Element {
  const { t } = useTranslation();
  const [access, setAccess] = useState<MicrophoneAccess | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const mounted = useRef(false);
  const pending = useRef(false);
  const supported = window.api.platform === 'darwin' || window.api.platform === 'win32';
  const run = useCallback(async (action: 'status' | 'request' | 'settings'): Promise<void> => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setFailed(false);
    try {
      const next = await window.api.microphoneAccess(action);
      if (mounted.current) setAccess(next);
    } catch {
      if (mounted.current) setFailed(true);
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void run('status');
    const onFocus = (): void => { void run('status'); };
    window.addEventListener('focus', onFocus);
    return () => { mounted.current = false; window.removeEventListener('focus', onFocus); };
  }, [run]);

  return <div className="settings-group">
    <div className="modal-section-label">{t('settings.microphone.title')}</div>
    <p className="modal-hint">{t('settings.microphone.hint')}</p>
    <div aria-live="polite">
      {access && <p className={access === 'denied' || access === 'restricted' ? 'setting-error' : 'modal-hint'}>
        {t(`settings.microphone.status.${access}`)}</p>}
      {failed && <p className="setting-error">{t('settings.microphone.error')}</p>}
    </div>
    {supported && <>
      <div className="setting-row">
        {window.api.platform === 'darwin' && access === 'not-determined' &&
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => void run('request')}>
            {t('settings.microphone.allow')}</button>}
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => void run('status')}>
          {t('settings.microphone.check')}</button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => void run('settings')}>
          {t('settings.microphone.settings')}</button>
      </div>
      <p className="modal-hint">{t(window.api.platform === 'win32'
        ? 'settings.microphone.windows' : 'settings.microphone.mac')}</p>
    </>}
  </div>;
}
