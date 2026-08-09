import React, { useEffect } from 'react';
import { useStore } from './store';
import i18n, { resolveLocale } from './i18n';
import { WorkspaceNavigation } from './components/WorkspaceNavigation';
import { WorkspaceView } from './components/WorkspaceView';
import { SettingsPanel } from './components/SettingsPanel';
import { PreviewPanel } from './components/PreviewPanel';
import { TitlebarActions } from './components/TitlebarActions';
import { CommandPalette } from './components/CommandPalette';
import { TemplateWizard } from './components/TemplateWizard';
import { StartupCommandConfirmDialog } from './components/StartupCommandConfirmDialog';
import { TaskBoard } from './components/TaskBoard';
import { ClosePaneConfirmDialog } from './components/ClosePaneConfirmDialog';
import { RemoteWorkspaceDialog } from './components/RemoteWorkspaceDialog';
import { TasksPanel } from './components/TasksPanel';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

export function App(): React.JSX.Element {
  const hydrated = useStore((s) => s.hydrated);
  const hydrate = useStore((s) => s.hydrate);
  const applyUpdateEvent = useStore((s) => s.applyUpdateEvent);
  const checkForUpdates = useStore((s) => s.checkForUpdates);
  const setWindowFocused = useStore((s) => s.setWindowFocused);
  const selectWorkspace = useStore((s) => s.selectWorkspace);
  const workspaceNavigationPlacement = useStore((s) => s.settings.workspaceNavigationPlacement ?? 'left');
  const taskView = useStore((s) => s.taskView);
  const applyTasksChanged = useStore((s) => s.applyTasksChanged);
  const tasksEnabled = useStore((s) => s.activeWorkspace()?.tasksEnabled ?? false);
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId);
  const pendingClosePane = useStore((s) => s.pendingClosePane);
  const confirmClosePane = useStore((s) => s.confirmClosePane);
  const cancelClosePane = useStore((s) => s.cancelClosePane);
  // Board shows only when toggled on AND the active workspace opted in. Guards the
  // case where you switch to a non-task workspace while the board is open.
  const showBoard = taskView && tasksEnabled;

  const locale = useStore((s) => s.settings.locale);
  const brandDesign = useStore((s) => s.settings.brandDesign ?? 'graphite');

  useKeyboardShortcuts();

  useEffect(() => { void hydrate(); }, [hydrate]);

  useEffect(() => {
    const target = resolveLocale(locale);
    if (i18n.language !== target) void i18n.changeLanguage(target);
  }, [locale]);

  // Subscribe to update events and check for updates on startup.
  useEffect(() => {
    const off = window.api.onUpdateEvent(applyUpdateEvent);
    checkForUpdates();
    return off;
  }, [applyUpdateEvent, checkForUpdates]);

  // Re-check for updates every 60 minutes so a long-running window still notices
  // a release. Skip while a download is in flight or already staged so the check
  // (which flips status back to 'checking') doesn't wipe that progress.
  useEffect(() => {
    const id = setInterval(() => {
      const status = useStore.getState().update.status;
      if (status === 'downloading' || status === 'downloaded') return;
      useStore.getState().checkForUpdates();
    }, 60 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // Track window focus (gates notifications) and handle notification clicks
  // that ask to jump to a specific workspace.
  useEffect(() => {
    const offFocus = window.api.onWindowFocus(setWindowFocused);
    const offActivate = window.api.onActivateWorkspace(selectWorkspace);
    return () => { offFocus(); offActivate(); };
  }, [setWindowFocused, selectWorkspace]);

  // Live-update the board when TASKS.md changes outside the app.
  useEffect(() => window.api.onTasksChanged(applyTasksChanged), [applyTasksChanged]);

  // Remote-Workspaces: Verbindungs-, Driver- und Presence-Pushes aus dem
  // Main-Prozess in den Store spiegeln (Muster: tasks:changed oben). Die
  // Task-Ereignisse (geplante Agenten-Tasks, Arbeitspaket B) laufen über
  // denselben Kanal-Ansatz — global abonniert, nicht erst wenn das
  // Tasks-Panel geöffnet ist, damit Liste und Protokoll auch im Hintergrund
  // aktuell bleiben (siehe applyRemoteTask in store.ts).
  useEffect(() => {
    const s = useStore.getState();
    const offs = [
      window.api.onRemoteStatus(s.applyRemoteStatus),
      window.api.onRemoteDriver(s.applyRemoteDriver),
      window.api.onRemotePresence(s.applyRemotePresence),
      window.api.onRemoteTask(s.applyRemoteTask)
    ];
    return () => { offs.forEach((off) => off()); };
  }, []);

  // When the active workspace changes while the board is open, rebind it to the
  // newly active workspace (reloads its TASKS.md, re-arms the file watcher, and
  // re-points tasksDir) so edits never target the previous workspace's file.
  useEffect(() => {
    const s = useStore.getState();
    if (s.taskView && s.activeWorkspace()?.tasksEnabled) void s.openTaskView();
  }, [activeWorkspaceId]);

  if (!hydrated) {
    return (
      <div className="root" data-brand-design={brandDesign}>
        <div className="titlebar" />
        <div className="app" />
      </div>
    );
  }

  return (
    <div className="root" data-brand-design={brandDesign}>
      {/* Draggable strip clearing the macOS traffic lights (hiddenInset). On
          Windows it's a custom row below the native window controls, so both
          platforms have the same titlebar surface for the action buttons. */}
      <div className="titlebar"><TitlebarActions /></div>
      <div className={`app app-${workspaceNavigationPlacement}`}>
        {/* Both placements render the SAME element structure; only the shell's
            flex direction differs (see .app-left/.app-top in styles.css). The
            two placements must not be separate branches: a different element
            type at this position remounts the whole workspace view, which tears
            down every PanePortal. Its cleanup then releases the pane container
            the newly mounted slot had just re-adopted, and the terminals end up
            in detached divs — blank panes that no further toggle repairs. */}
        <div className="workspace-shell">
          <WorkspaceNavigation placement={workspaceNavigationPlacement} />
          <div className="view-stack">
            <div className="view-pane" style={{ display: showBoard ? 'none' : 'flex' }}>
              <WorkspaceView />
            </div>
            {showBoard && <div className="view-pane"><TaskBoard /></div>}
          </div>
        </div>
        <PreviewPanel />
      </div>
      <SettingsPanel />
      <CommandPalette />
      <TemplateWizard />
      <StartupCommandConfirmDialog />
      {/* Global, damit jeder Einstiegspunkt (Kopf-Knopf, Kontextmenü, Palette,
          Tastenkürzel) dieselbe Rückfrage bekommt, statt eigenen Zustand zu halten. */}
      {pendingClosePane && (
        <ClosePaneConfirmDialog
          remote={pendingClosePane.remote}
          onConfirm={confirmClosePane}
          onCancel={cancelClosePane}
        />
      )}
      <RemoteWorkspaceDialog />
      <TasksPanel />
    </div>
  );
}
