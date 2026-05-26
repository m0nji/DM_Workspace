import React from 'react';
import { useStore } from '../store';

export function SettingsPanel(): JSX.Element | null {
  const open = useStore((s) => s.settingsOpen);
  const setOpen = useStore((s) => s.setSettingsOpen);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);

  if (!open) return null;

  const pct = Math.round(settings.terminalOpacity * 100);

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Settings</span>
          <button className="modal-close" title="Close" onClick={() => setOpen(false)}>✕</button>
        </div>

        <div className="modal-section-label">Terminal appearance</div>

        <div className="setting-row">
          <label>Background color</label>
          <input
            type="color"
            value={settings.terminalBackground}
            onChange={(e) => updateSettings({ terminalBackground: e.target.value })}
          />
        </div>

        <div className="setting-row">
          <label>Opacity</label>
          <input
            type="range"
            min={10}
            max={100}
            value={pct}
            onChange={(e) => updateSettings({ terminalOpacity: Number(e.target.value) / 100 })}
          />
          <span className="setting-value">{pct}%</span>
        </div>

        <p className="modal-hint">
          Lower opacity reveals a blurred backdrop behind the terminals (macOS).
        </p>
      </div>
    </div>
  );
}
