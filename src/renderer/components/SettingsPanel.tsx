import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ParseKeys } from 'i18next';
import { useStore } from '../store';
import { Icon } from './Icon';
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
  const { t } = useTranslation();
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
        setError(t('settings.shortcuts.reservedForTerminal', { shortcut: formatShortcut(binding, isMac) }));
        setRecording(null);
        return;
      }
      if (isShortcutConflict(binding, recording, map)) {
        setError(t('settings.shortcuts.alreadyAssigned', { shortcut: formatShortcut(binding, isMac) }));
        setRecording(null);
        return;
      }
      updateBinding(recording, binding);
      setError(null);
      setRecording(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, updateBinding, setRecording, t]);

  // Clear a transient recording flag if the panel unmounts mid-recording.
  useEffect(() => () => setRecording(null), [setRecording]);

  return (
    <div>
      <div className="modal-section-label">{t('settings.shortcuts.title')}</div>
      {error && <div className="setting-error">{error}</div>}
      <div className="shortcut-list">
        {SHORTCUT_DEFINITIONS.map((def) => {
          const isRecording = recording === def.action;
          const overridden = !!bindings?.[def.action];
          return (
            <div className={`shortcut-row ${isRecording ? 'recording' : ''}`} key={def.action}>
              <span className="shortcut-label">{t(`settings.shortcuts.action.${def.action}`)}</span>
              <span className="shortcut-keys">
                {isRecording
                  ? <span className="shortcut-recording">{t('settings.shortcuts.pressKeys')}</span>
                  : formatShortcutCaps(resolved[def.action], isMac).map((k, i) => <kbd className="key-cap" key={i}>{k}</kbd>)}
              </span>
              <button className="cwd-btn" onClick={() => { setError(null); setRecording(isRecording ? null : def.action); }}>
                {isRecording ? t('common.cancel') : t('settings.shortcuts.record')}
              </button>
              <button className="cwd-btn ghost" disabled={!overridden} onClick={() => { setError(null); resetBinding(def.action); }}>
                {t('settings.shortcuts.reset')}
              </button>
            </div>
          );
        })}
      </div>
      <p className="modal-hint">
        {t('settings.shortcuts.hint')}
      </p>
    </div>
  );
}

// List, run, edit, and delete saved templates; launch the wizard to capture the
// current workspace.
function TemplatesSection(): React.JSX.Element {
  const { t } = useTranslation();
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
      <div className="modal-section-label">{t('settings.templates.title')}</div>
      {templates.length === 0 && (
        <p className="modal-hint" style={{ marginTop: 0 }}>{t('settings.templates.empty')}</p>
      )}
      <div className="template-list">
        {templates.map((tpl) => {
          const cmdCount = tpl.startupCommands ? Object.keys(tpl.startupCommands).length : 0;
          return (
            <div className="template-row" key={tpl.id}>
              <span className="template-info">
                <span className="template-name">{tpl.name}</span>
                <span className="template-meta">{tpl.cwd}{cmdCount ? ` · ${t('settings.templates.startupCommands', { count: cmdCount })}` : ''}</span>
              </span>
              <button className="cwd-btn" onClick={() => run(tpl.id)}>{t('settings.templates.run')}</button>
              <button className="cwd-btn ghost" onClick={() => edit(tpl.id)}>{t('settings.templates.edit')}</button>
              <button className="cwd-btn ghost danger" onClick={() => deleteTemplate(tpl.id)}>{t('settings.templates.delete')}</button>
            </div>
          );
        })}
      </div>
      <button className="add-template" disabled={!hasLayout} onClick={saveCurrent}
              title={hasLayout ? undefined : t('settings.templates.openLayoutFirst')}>
        {t('settings.templates.saveCurrent')}
      </button>
    </>
  );
}

const COLOR_PRESETS: { labelKey: ParseKeys; value: string }[] = [
  { labelKey: 'settings.appearance.preset.black', value: '#000000' },
  { labelKey: 'settings.appearance.preset.darkGray', value: '#1e1e1e' },
  { labelKey: 'settings.appearance.preset.gray', value: '#3c3c43' },
  { labelKey: 'settings.appearance.preset.lightGray', value: '#c7c7cc' },
  { labelKey: 'settings.appearance.preset.white', value: '#ffffff' },
  { labelKey: 'settings.appearance.preset.darkPurple', value: '#2d1b46' }
];

function UpdateSection(): React.JSX.Element {
  const { t } = useTranslation();
  const update = useStore((s) => s.update);
  const checkForUpdates = useStore((s) => s.checkForUpdates);
  const downloadUpdate = useStore((s) => s.downloadUpdate);

  let status: string;
  let button: React.JSX.Element | null = (
    <button className="cwd-btn" onClick={checkForUpdates}>{t('settings.updates.checkForUpdates')}</button>
  );

  switch (update.status) {
    case 'checking':
      status = t('settings.updates.checking');
      button = <button className="cwd-btn" disabled>{t('settings.updates.checkingShort')}</button>;
      break;
    case 'available':
      status = t('settings.updates.available', { version: update.version });
      button = <button className="cwd-btn" onClick={downloadUpdate}>{t('settings.updates.downloadInstall')}</button>;
      break;
    case 'downloading':
      status = t('settings.updates.downloading', { percent: update.percent ?? 0 });
      button = <button className="cwd-btn" disabled>{t('settings.updates.downloadingShort')}</button>;
      break;
    case 'downloaded':
      status = t('settings.updates.ready', { version: update.version });
      button = null;
      break;
    case 'not-available':
      status = t('settings.updates.upToDate');
      break;
    case 'error':
      status = t('settings.updates.error', { error: update.error ?? t('settings.updates.errorUnknown') });
      break;
    case 'disabled':
      status = t('settings.updates.disabled');
      button = null;
      break;
    default:
      status = '';
  }

  return (
    <>
      <div className="modal-section-label">{t('settings.updates.title')}</div>
      <div className="setting-row">
        <span className="update-status">{status}</span>
        {button}
      </div>
    </>
  );
}

const SECTIONS: { id: SettingsSection; labelKey: ParseKeys }[] = [
  { id: 'appearance', labelKey: 'settings.nav.appearance' },
  { id: 'shortcuts', labelKey: 'settings.nav.shortcuts' },
  { id: 'templates', labelKey: 'settings.nav.templates' },
  { id: 'notifications', labelKey: 'settings.nav.notifications' },
  { id: 'updates', labelKey: 'settings.nav.updates' }
];

export function SettingsPanel(): React.JSX.Element | null {
  const { t } = useTranslation();
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
          <span>{t('settings.title')}</span>
          <button className="modal-close" title={t('common.close')} onClick={() => setOpen(false)}><Icon name="close" size={16} /></button>
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
                {t(s.labelKey)}
              </button>
            ))}
          </nav>
          <div className="settings-content">
            {section === 'appearance' && (
              <>
                <div className="settings-group">
                  <div className="modal-section-label">{t('settings.language.label')}</div>
                  <div className="segmented-control" role="group" aria-label={t('settings.language.label')}>
                    {(['en', 'de'] as const).map((lng) => (
                      <button
                        key={lng}
                        type="button"
                        className={`segmented-control-item ${(settings.locale ?? 'en') === lng ? 'active' : ''}`}
                        onClick={() => updateSettings({ locale: lng })}
                      >
                        {t(`settings.language.${lng}`)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="settings-group">
                <div className="modal-section-label">{t('settings.appearance.theme')}</div>

                <div className="theme-gallery">
                  {BUILTIN_THEMES.map((theme) => {
                    const active = settings.themeId === theme.id;
                    return (
                      <button
                        key={theme.id}
                        className={`theme-tile ${active ? 'active' : ''}`}
                        title={theme.name}
                        onClick={() => updateSettings({ themeId: theme.id, terminalBackground: theme.background })}
                      >
                        <span className="theme-swatch" style={{ background: theme.background }}>
                          <span style={{ color: theme.ansi[1] }}>A</span>
                          <span style={{ color: theme.ansi[2] }}>a</span>
                          <span style={{ color: theme.ansi[4] }}>#</span>
                        </span>
                        <span className="theme-name">{theme.name}</span>
                      </button>
                    );
                  })}
                </div>
                </div>

                <div className="settings-group">
                <div className="modal-section-label">{t('settings.appearance.backgroundColor')}</div>

                <div className="setting-row">
                  <label>{t('settings.appearance.customColor')}</label>
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
                        title={t(p.labelKey)}
                        style={{ background: p.value }}
                        onClick={() => updateSettings({ terminalBackground: p.value })}
                      />
                    );
                  })}
                </div>

                <p className="modal-hint">{t('settings.appearance.backgroundHint')}</p>

                <div className="setting-row">
                  <label>{t('settings.appearance.opacity')}</label>
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
                  {t('settings.appearance.opacityHint')}
                </p>
                </div>

                <div className="settings-group">
                <div className="modal-section-label">{t('settings.appearance.workspaceNavigation')}</div>

                <div className="segmented-control" role="group" aria-label={t('settings.appearance.workspaceNavigationPlacement')}>
                  <button
                    type="button"
                    className={`segmented-control-item ${workspaceNavigationPlacement === 'left' ? 'active' : ''}`}
                    aria-pressed={workspaceNavigationPlacement === 'left'}
                    onClick={() => updateSettings({ workspaceNavigationPlacement: 'left' })}
                  >
                    {t('settings.appearance.leftSidebar')}
                  </button>
                  <button
                    type="button"
                    className={`segmented-control-item ${workspaceNavigationPlacement === 'top' ? 'active' : ''}`}
                    aria-pressed={workspaceNavigationPlacement === 'top'}
                    onClick={() => updateSettings({ workspaceNavigationPlacement: 'top' })}
                  >
                    {t('settings.appearance.topTabs')}
                  </button>
                </div>

                <p className="modal-hint">
                  {t('settings.appearance.workspaceNavigationHint')}
                </p>
                </div>

                <div className="settings-group">
                <div className="modal-section-label">{t('settings.appearance.terminalInput')}</div>

                <div className="setting-row">
                  <label htmlFor="click-moves-cursor-toggle">{t('settings.appearance.clickMovesCursor')}</label>
                  <input
                    id="click-moves-cursor-toggle"
                    type="checkbox"
                    checked={settings.clickMovesCursor ?? false}
                    onChange={(e) => updateSettings({ clickMovesCursor: e.target.checked })}
                  />
                </div>

                <p className="modal-hint">
                  {t('settings.appearance.clickMovesCursorHint')}
                </p>
                </div>
              </>
            )}
            {section === 'shortcuts' && <ShortcutsSection />}
            {section === 'templates' && <TemplatesSection />}
            {section === 'notifications' && (
              <>
                <div className="settings-group">
                <div className="modal-section-label">{t('settings.notifications.sidebar')}</div>

                <div className="setting-row">
                  <label htmlFor="done-badge-toggle">{t('settings.notifications.showReadyBadge')}</label>
                  <input
                    id="done-badge-toggle"
                    type="checkbox"
                    checked={settings.showDoneBadge ?? false}
                    onChange={(e) => updateSettings({ showDoneBadge: e.target.checked })}
                  />
                </div>

                <p className="modal-hint">
                  {t('settings.notifications.showReadyBadgeHint')}
                </p>
                </div>

                <div className="settings-group">
                <div className="modal-section-label">{t('settings.notifications.title')}</div>

                <div className="setting-row">
                  <label htmlFor="notifications-toggle">{t('settings.notifications.desktopNotifications')}</label>
                  <input
                    id="notifications-toggle"
                    type="checkbox"
                    checked={settings.notificationsEnabled ?? false}
                    onChange={(e) => updateSettings({ notificationsEnabled: e.target.checked })}
                  />
                </div>

                <p className="modal-hint">
                  {t('settings.notifications.desktopNotificationsHint')}
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
