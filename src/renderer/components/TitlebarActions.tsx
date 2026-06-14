import React from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store';
import { Icon } from './Icon';
import { UpdateBadge } from './UpdateBadge';

export function TitlebarActions(): React.JSX.Element {
  const { t } = useTranslation();
  const togglePreview = useStore((s) => s.togglePreview);
  const previewOpen = useStore((s) => s.previewPanel.open);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const setCommandPaletteOpen = useStore((s) => s.setCommandPaletteOpen);
  const taskView = useStore((s) => s.taskView);
  const openTaskView = useStore((s) => s.openTaskView);
  const closeTaskView = useStore((s) => s.closeTaskView);
  // The board toggle only exists when the active workspace has tasks enabled.
  const tasksEnabled = useStore((s) => s.activeWorkspace()?.tasksEnabled ?? false);

  return (
    <div className="titlebar-actions">
      <UpdateBadge />
      {tasksEnabled && (
        <div className="view-toggle" role="tablist" aria-label={t('titlebar.view')}>
          <button type="button" role="tab" aria-selected={!taskView}
                  className={`view-toggle-btn ${!taskView ? 'active' : ''}`}
                  onClick={closeTaskView}>{t('titlebar.terminals')}</button>
          <button type="button" role="tab" aria-selected={taskView}
                  className={`view-toggle-btn ${taskView ? 'active' : ''}`}
                  onClick={() => void openTaskView()}>{t('titlebar.tasks')}</button>
        </div>
      )}
      <button type="button" className="icon-btn" title={t('titlebar.commandPalette')} onClick={() => setCommandPaletteOpen(true)}>
        <Icon name="command-palette" />
      </button>
      <button type="button" className={`icon-btn ${previewOpen ? 'active' : ''}`} title={t('titlebar.togglePreview')} aria-pressed={previewOpen} onClick={togglePreview}>
        <Icon name="preview" />
      </button>
      <button type="button" className="icon-btn" title={t('settings.title')} onClick={() => setSettingsOpen(true)}>
        <Icon name="settings" />
      </button>
    </div>
  );
}
