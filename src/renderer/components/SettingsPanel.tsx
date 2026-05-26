import React from 'react';
import { useStore } from '../store';

const COLOR_PRESETS: { label: string; value: string }[] = [
  { label: 'Black', value: '#000000' },
  { label: 'Dark gray', value: '#1e1e1e' },
  { label: 'Gray', value: '#3c3c43' },
  { label: 'Light gray', value: '#c7c7cc' },
  { label: 'White', value: '#ffffff' },
  { label: 'Dark purple', value: '#2d1b46' }
];

function UpdateSection(): JSX.Element {
  const update = useStore((s) => s.update);
  const checkForUpdates = useStore((s) => s.checkForUpdates);
  const downloadUpdate = useStore((s) => s.downloadUpdate);

  let status: string;
  let button: JSX.Element | null = (
    <button className="cwd-btn" onClick={checkForUpdates}>Check for updates</button>
  );

  switch (update.status) {
    case 'checking':
      status = 'Checking for updates…';
      button = <button className="cwd-btn" disabled>Checking…</button>;
      break;
    case 'available':
      status = `Update available: v${update.version}`;
      button = <button className="cwd-btn" onClick={downloadUpdate}>Download &amp; install</button>;
      break;
    case 'downloading':
      status = `Downloading… ${update.percent ?? 0}%`;
      button = <button className="cwd-btn" disabled>Downloading…</button>;
      break;
    case 'downloaded':
      status = `Update v${update.version} ready — restarting…`;
      button = null;
      break;
    case 'not-available':
      status = "You're up to date.";
      break;
    case 'error':
      status = `Update error: ${update.error ?? 'unknown'}`;
      break;
    case 'disabled':
      status = 'Updates are available only in the installed app.';
      button = null;
      break;
    default:
      status = '';
  }

  return (
    <>
      <div className="modal-section-label">Updates</div>
      <div className="setting-row">
        <span className="update-status">{status}</span>
        {button}
      </div>
    </>
  );
}

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

        <div className="swatch-row">
          {COLOR_PRESETS.map((p) => {
            const active = settings.terminalBackground.toLowerCase() === p.value.toLowerCase();
            return (
              <button
                key={p.value}
                className={`swatch ${active ? 'active' : ''}`}
                title={p.label}
                style={{ background: p.value }}
                onClick={() => updateSettings({ terminalBackground: p.value })}
              />
            );
          })}
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

        <UpdateSection />
      </div>
    </div>
  );
}
