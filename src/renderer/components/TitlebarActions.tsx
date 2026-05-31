import React from 'react';
import { useStore } from '../store';
import { Icon } from './Icon';

export function TitlebarActions(): JSX.Element {
  const togglePreview = useStore((s) => s.togglePreview);
  const previewOpen = useStore((s) => s.previewPanel.open);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const setCommandPaletteOpen = useStore((s) => s.setCommandPaletteOpen);
  const updateAvailable = useStore((s) => s.update.status === 'available');

  return (
    <div className="titlebar-actions">
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
