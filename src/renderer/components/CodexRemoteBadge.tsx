import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store';
import { codexRemotePresentation, useCodexRemote } from '../codex-remote-store';
import { Icon } from './Icon';

export function CodexRemoteBadge(): React.JSX.Element {
  const { t } = useTranslation();
  const { snapshot, busy, error, run } = useCodexRemote();
  const status = codexRemotePresentation(snapshot, busy, error);
  useEffect(() => {
    const refresh = (): void => { if (!document.hidden) void run('status'); };
    refresh();
    const timer = setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [run]);
  return <button type="button" className={`codex-remote-badge remote-${status}`}
    title={t('settings.smartphone.open')} aria-label={t('settings.smartphone.open')}
    onClick={() => {
      useStore.getState().setSettingsOpen(true, 'agents');
      requestAnimationFrame(() => document.getElementById('codex-smartphone-access')?.scrollIntoView({ block: 'nearest' }));
    }}>
    <Icon name="smartphone" size={14} />
    <span className="codex-remote-dot" aria-hidden="true" />
    <span>{t('settings.smartphone.badge', { status: t(`settings.smartphone.short.${status}`) })}</span>
  </button>;
}
