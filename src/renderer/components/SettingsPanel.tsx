import React, { useEffect, useState } from 'react';
import { useStore } from '../store';
import type { SettingsSection } from '../../shared/types';
import { BUILTIN_THEMES, getTheme } from '../../shared/themes';
import {
  SHORTCUT_DEFINITIONS, resolveShortcuts, formatShortcut, formatShortcutCaps, shortcutFromEvent,
  isShortcutConflict, isReservedTerminalShortcut
} from '../../shared/shortcuts';

const isMac = navigator.userAgent.includes('Mac');

// Record/reset the binding for each app action. While recording, a window-level
// capture listener swallows the next key combo; global shortcuts are gated via
// the store's shortcutRecordingAction so they don't fire mid-recording.
function ShortcutsSection(): React.JSX.Element {
  const bindings = useStore((s) => s.settings.shortcutBindings);
  const updateBinding = useStore((s) => s.updateShortcutBinding);
  const resetBinding = useStore((s) => s.resetShortcutBinding);
  const recording = useStore((s) => s.shortcutRecordingAction);
  const setRecording = useStore((s) => s.setShortcutRecordingAction);
  const [error, setError] = useState<string | null>(null);
  const resolved = resolveShortcuts(bindings, isMac);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setRecording(null); return; }
      const binding = shortcutFromEvent(e, isMac);
      if (!binding) return; // only a modifier is down — wait for the real key
      const map = resolveShortcuts(useStore.getState().settings.shortcutBindings, isMac);
      if (isReservedTerminalShortcut(binding, isMac)) {
        setError(`${formatShortcut(binding, isMac)} is reserved for the terminal`);
        setRecording(null);
        return;
      }
      if (isShortcutConflict(binding, recording, map)) {
        setError(`${formatShortcut(binding, isMac)} is already assigned to another action`);
        setRecording(null);
        return;
      }
      updateBinding(recording, binding);
      setError(null);
      setRecording(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, updateBinding, setRecording]);

  // Clear a transient recording flag if the panel unmounts mid-recording.
  useEffect(() => () => setRecording(null), [setRecording]);

  return (
    <div>
      <div className="modal-section-label">Keyboard shortcuts</div>
      {error && <div className="setting-error">{error}</div>}
      <div className="shortcut-list">
        {SHORTCUT_DEFINITIONS.map((def) => {
          const isRecording = recording === def.action;
          const overridden = !!bindings?.[def.action];
          return (
            <div className={`shortcut-row ${isRecording ? 'recording' : ''}`} key={def.action}>
              <span className="shortcut-label">{def.label}</span>
              <span className="shortcut-keys">
                {isRecording
                  ? <span className="shortcut-recording">Press keys…</span>
                  : formatShortcutCaps(resolved[def.action], isMac).map((k, i) => <kbd className="key-cap" key={i}>{k}</kbd>)}
              </span>
              <button className="cwd-btn" onClick={() => { setError(null); setRecording(isRecording ? null : def.action); }}>
                {isRecording ? 'Cancel' : 'Record'}
              </button>
              <button className="cwd-btn ghost" disabled={!overridden} onClick={() => { setError(null); resetBinding(def.action); }}>
                Reset
              </button>
            </div>
          );
        })}
      </div>
      <p className="modal-hint">
        ⌘ on macOS, Ctrl elsewhere. On Windows/Linux a plain Ctrl+letter is reserved so the shell keeps Ctrl+C/D/W.
      </p>
    </div>
  );
}

// List, run, edit, and delete saved templates; launch the wizard to capture the
// current workspace.
function TemplatesSection(): React.JSX.Element {
  const templates = useStore((s) => s.workspaceTemplates ?? []);
  const setWizard = useStore((s) => s.setTemplateWizard);
  const requestLaunch = useStore((s) => s.requestTemplateLaunch);
  const deleteTemplate = useStore((s) => s.deleteWorkspaceTemplate);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const hasLayout = useStore((s) => !!s.workspaces.find((w) => w.id === s.activeWorkspaceId)?.layout);

  const run = (id: string): void => { setSettingsOpen(false); requestLaunch(id); };
  const edit = (id: string): void => { setSettingsOpen(false); setWizard({ open: true, templateId: id }); };
  const saveCurrent = (): void => { setSettingsOpen(false); setWizard({ open: true, templateId: null }); };

  return (
    <>
      <div className="modal-section-label">Workspace templates</div>
      {templates.length === 0 && (
        <p className="modal-hint" style={{ marginTop: 0 }}>No templates yet — save a workspace layout to reuse it later.</p>
      )}
      <div className="template-list">
        {templates.map((t) => {
          const cmdCount = t.startupCommands ? Object.keys(t.startupCommands).length : 0;
          return (
            <div className="template-row" key={t.id}>
              <span className="template-info">
                <span className="template-name">{t.name}</span>
                <span className="template-meta">{t.cwd}{cmdCount ? ` · ${cmdCount} startup command${cmdCount === 1 ? '' : 's'}` : ''}</span>
              </span>
              <button className="cwd-btn" onClick={() => run(t.id)}>Run</button>
              <button className="cwd-btn ghost" onClick={() => edit(t.id)}>Edit</button>
              <button className="cwd-btn ghost danger" onClick={() => deleteTemplate(t.id)}>Delete</button>
            </div>
          );
        })}
      </div>
      <button className="add-template" disabled={!hasLayout} onClick={saveCurrent}
              title={hasLayout ? undefined : 'Open a layout first'}>
        + Save current workspace as template
      </button>
    </>
  );
}

const COLOR_PRESETS: { label: string; value: string }[] = [
  { label: 'Black', value: '#000000' },
  { label: 'Dark gray', value: '#1e1e1e' },
  { label: 'Gray', value: '#3c3c43' },
  { label: 'Light gray', value: '#c7c7cc' },
  { label: 'White', value: '#ffffff' },
  { label: 'Dark purple', value: '#2d1b46' }
];

function UpdateSection(): React.JSX.Element {
  const update = useStore((s) => s.update);
  const checkForUpdates = useStore((s) => s.checkForUpdates);
  const downloadUpdate = useStore((s) => s.downloadUpdate);

  let status: string;
  let button: React.JSX.Element | null = (
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

const SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'templates', label: 'Templates' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'updates', label: 'Updates' }
];

export function SettingsPanel(): React.JSX.Element | null {
  const open = useStore((s) => s.settingsOpen);
  const setOpen = useStore((s) => s.setSettingsOpen);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const focus = useStore((s) => s.settingsFocusSection);
  const clearFocus = useStore((s) => s.clearSettingsFocusSection);
  const [section, setSection] = useState<SettingsSection>(focus ?? 'appearance');

  useEffect(() => {
    if (focus) { setSection(focus); clearFocus(); }
  }, [focus, clearFocus]);

  if (!open) return null;

  const pct = Math.round(settings.terminalOpacity * 100);
  // The effective background is the override if set, otherwise the theme's own.
  const activeBg = settings.terminalBackground ?? getTheme(settings.themeId).background;
  const workspaceNavigationPlacement = settings.workspaceNavigationPlacement ?? 'left';

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Settings</span>
          <button className="modal-close" title="Close" onClick={() => setOpen(false)}>✕</button>
        </div>

        <div className="settings-body">
          <nav className="settings-nav">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`settings-nav-item ${section === s.id ? 'active' : ''}`}
                aria-current={section === s.id ? 'page' : undefined}
                onClick={() => setSection(s.id)}
              >
                {s.label}
              </button>
            ))}
          </nav>
          <div className="settings-content">
            {section === 'appearance' && (
              <>
                <div className="settings-group">
                <div className="modal-section-label">Theme</div>

                <div className="theme-gallery">
                  {BUILTIN_THEMES.map((t) => {
                    const active = settings.themeId === t.id;
                    return (
                      <button
                        key={t.id}
                        className={`theme-tile ${active ? 'active' : ''}`}
                        title={t.name}
                        onClick={() => updateSettings({ themeId: t.id, terminalBackground: t.background })}
                      >
                        <span className="theme-swatch" style={{ background: t.background }}>
                          <span style={{ color: t.ansi[1] }}>A</span>
                          <span style={{ color: t.ansi[2] }}>a</span>
                          <span style={{ color: t.ansi[4] }}>#</span>
                        </span>
                        <span className="theme-name">{t.name}</span>
                      </button>
                    );
                  })}
                </div>
                </div>

                <div className="settings-group">
                <div className="modal-section-label">Background color</div>

                <div className="setting-row">
                  <label>Custom color</label>
                  <input
                    type="color"
                    value={activeBg}
                    onChange={(e) => updateSettings({ terminalBackground: e.target.value })}
                  />
                </div>

                <div className="swatch-row">
                  {COLOR_PRESETS.map((p) => {
                    const active = activeBg.toLowerCase() === p.value.toLowerCase();
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

                <p className="modal-hint">Overrides the selected theme's background. Pick a theme again to reset it.</p>

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
                  Lower opacity reveals the blurred backdrop behind the terminals (macOS).
                </p>
                </div>

                <div className="settings-group">
                <div className="modal-section-label">Workspace navigation</div>

                <div className="segmented-control" role="group" aria-label="Workspace navigation placement">
                  <button
                    type="button"
                    className={`segmented-control-item ${workspaceNavigationPlacement === 'left' ? 'active' : ''}`}
                    aria-pressed={workspaceNavigationPlacement === 'left'}
                    onClick={() => updateSettings({ workspaceNavigationPlacement: 'left' })}
                  >
                    Left sidebar
                  </button>
                  <button
                    type="button"
                    className={`segmented-control-item ${workspaceNavigationPlacement === 'top' ? 'active' : ''}`}
                    aria-pressed={workspaceNavigationPlacement === 'top'}
                    onClick={() => updateSettings({ workspaceNavigationPlacement: 'top' })}
                  >
                    Top tabs
                  </button>
                </div>

                <p className="modal-hint">
                  Choose where workspace switching appears. Only one placement is active at a time.
                </p>
                </div>
              </>
            )}
            {section === 'shortcuts' && <ShortcutsSection />}
            {section === 'templates' && <TemplatesSection />}
            {section === 'notifications' && (
              <>
                <div className="settings-group">
                <div className="modal-section-label">Sidebar</div>

                <div className="setting-row">
                  <label htmlFor="done-badge-toggle">Show "terminals ready" badge</label>
                  <input
                    id="done-badge-toggle"
                    type="checkbox"
                    checked={settings.showDoneBadge ?? false}
                    onChange={(e) => updateSettings({ showDoneBadge: e.target.checked })}
                  />
                </div>

                <p className="modal-hint">
                  Shows a green count on inactive workspaces when their terminals finish working.
                </p>
                </div>

                <div className="settings-group">
                <div className="modal-section-label">Notifications</div>

                <div className="setting-row">
                  <label htmlFor="notifications-toggle">Desktop notifications</label>
                  <input
                    id="notifications-toggle"
                    type="checkbox"
                    checked={settings.notificationsEnabled ?? false}
                    onChange={(e) => updateSettings({ notificationsEnabled: e.target.checked })}
                  />
                </div>

                <p className="modal-hint">
                  Show an OS notification when a terminal finishes in a background workspace. Off by default.
                </p>
                </div>
              </>
            )}
            {section === 'updates' && <UpdateSection />}
          </div>
        </div>
      </div>
    </div>
  );
}
