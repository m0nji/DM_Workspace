import React from 'react';
import { useTranslation } from 'react-i18next';
import { tasksAvailable, useStore } from '../store';
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
  // Geplante Agenten-Tasks: dieselbe Prüfung wie Panel und Palette
  // (tasksAvailable), damit die drei nie auseinanderlaufen (siehe store.ts).
  const scheduledTasksAvailable = useStore(tasksAvailable);
  const tasksPanelOpen = useStore((s) => s.tasksPanelOpen);
  const setTasksPanelOpen = useStore((s) => s.setTasksPanelOpen);

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
      {/* Umschalter, nicht nur „öffnen": aria-pressed und die active-Klasse
          versprechen genau das, und der Nachbar (Vorschau) macht es ebenso —
          ein Klick auf den gedrückten Knopf schließt das Panel wieder. */}
      {scheduledTasksAvailable && (
        <button type="button" className={`icon-btn ${tasksPanelOpen ? 'active' : ''}`} title={t('titlebar.scheduledTasks')}
                aria-pressed={tasksPanelOpen} onClick={() => setTasksPanelOpen(!tasksPanelOpen)}>
          <Icon name="clock" />
        </button>
      )}
      <button type="button" className="icon-btn" title={t('titlebar.globalSearch')}
              aria-label={t('titlebar.globalSearch')} onClick={() => setCommandPaletteOpen(true, 'panes')}>
        <Icon name="search" />
      </button>
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
