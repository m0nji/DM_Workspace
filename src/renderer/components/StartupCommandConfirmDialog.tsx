import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store';
import { Icon } from './Icon';

// Shown before creating a workspace from a template that carries startup
// commands (when the template asks for confirmation). Lets the user run the
// commands, skip them, or cancel entirely.
export function StartupCommandConfirmDialog(): React.JSX.Element | null {
  const { t } = useTranslation();
  const pending = useStore((s) => s.pendingTemplateLaunch);
  const setPending = useStore((s) => s.setPendingTemplateLaunch);
  const templates = useStore((s) => s.workspaceTemplates ?? []);
  const confirmLaunch = useStore((s) => s.confirmPendingTemplateLaunch);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); setPending(null); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pending, setPending]);

  if (!pending) return null;
  const tpl = templates.find((item) => item.id === pending.templateId);
  if (!tpl) return null;

  const commands = tpl.startupCommands ?? {};
  const entries = Object.entries(commands);
  const close = (): void => setPending(null);
  const createWith = (): void => { confirmLaunch(true); };
  const createWithout = (): void => { confirmLaunch(false); };

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal startup-confirm" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>{t('dialog.startup.title')}</span>
          <button className="modal-close" title={t('common.close')} onClick={close}><Icon name="close" size={16} /></button>
        </div>
        <p className="modal-hint" style={{ marginTop: 0 }}>
          <strong>{tpl.name}</strong> {t('dialog.startup.body')}
        </p>
        <div className="startup-cmd-list">
          {entries.map(([paneId, cmd]) => (
            <div className="startup-cmd-row" key={paneId}>
              <span className="startup-cmd-pane">{tpl.paneTitles?.[paneId] ?? paneId}</span>
              <code className="startup-cmd-code">{cmd}</code>
            </div>
          ))}
        </div>
        <div className="confirm-actions">
          <button className="confirm-btn" onClick={close}>{t('common.cancel')}</button>
          <button className="confirm-btn" onClick={createWithout}>{t('dialog.startup.skip')}</button>
          <button className="confirm-btn primary" onClick={createWith} autoFocus>{t('dialog.startup.run')}</button>
        </div>
      </div>
    </div>
  );
}
