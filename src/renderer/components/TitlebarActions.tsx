import React from 'react';
import { useStore } from '../store';
import { Icon } from './Icon';

export function TitlebarActions(): React.JSX.Element {
  const togglePreview = useStore((s) => s.togglePreview);
  const previewOpen = useStore((s) => s.previewPanel.open);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const setCommandPaletteOpen = useStore((s) => s.setCommandPaletteOpen);
  const updateAvailable = useStore((s) => s.update.status === 'available');
  const taskView = useStore((s) => s.taskView);
  const openTaskView = useStore((s) => s.openTaskView);
  const closeTaskView = useStore((s) => s.closeTaskView);
  // The board toggle only exists when the active workspace has tasks enabled.
  const tasksEnabled = useStore((s) => s.activeWorkspace()?.tasksEnabled ?? false);

  return (
    <div className="titlebar-actions">
      {tasksEnabled && (
        <div className="view-toggle" role="tablist" aria-label="Ansicht">
          <button type="button" role="tab" aria-selected={!taskView}
                  className={`view-toggle-btn ${!taskView ? 'active' : ''}`}
                  onClick={closeTaskView}>Terminals</button>
          <button type="button" role="tab" aria-selected={taskView}
                  className={`view-toggle-btn ${taskView ? 'active' : ''}`}
                  onClick={() => void openTaskView()}>Tasks</button>
        </div>
      )}
      <button type="button" className="icon-btn" title="Command palette" onClick={() => setCommandPaletteOpen(true)}>
        <Icon name="command-palette" />
      </button>
      <button type="button" className={`icon-btn ${previewOpen ? 'active' : ''}`} title="Vorschau / Browser umschalten" aria-pressed={previewOpen} onClick={togglePreview}>
        <Icon name="preview" />
      </button>
      <button type="button" className="icon-btn" title="Settings" onClick={() => setSettingsOpen(true)}>
        <Icon name="settings" />
        {updateAvailable && <span className="update-dot" title="Update available" />}
      </button>
    </div>
  );
}
