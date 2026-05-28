import React from 'react';
import { useStore } from '../store';

export function TitlebarActions(): JSX.Element {
  const togglePreview = useStore((s) => s.togglePreview);
  const previewOpen = useStore((s) => s.previewPanel.open);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const updateAvailable = useStore((s) => s.update.status === 'available');

  return (
    <div className="titlebar-actions">
      <button
        type="button"
        className={`preview-toggle-btn ${previewOpen ? 'active' : ''}`}
        title="Vorschau / Browser umschalten"
        onClick={togglePreview}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor"
             strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="12" height="10" rx="1.5" />
          <line x1="9.5" y1="3.5" x2="9.5" y2="12.5" />
        </svg>
      </button>
      <button className="settings-btn" title="Settings" onClick={() => setSettingsOpen(true)}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        {updateAvailable && <span className="update-dot" title="Update available" />}
      </button>
    </div>
  );
}
