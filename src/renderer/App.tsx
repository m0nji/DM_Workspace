import React, { useEffect } from 'react';
import { useStore } from './store';
import { WorkspaceNavigation } from './components/WorkspaceNavigation';
import { WorkspaceView } from './components/WorkspaceView';
import { SettingsPanel } from './components/SettingsPanel';
import { PreviewPanel } from './components/PreviewPanel';
import { TitlebarActions } from './components/TitlebarActions';
import { CommandPalette } from './components/CommandPalette';
import { TemplateWizard } from './components/TemplateWizard';
import { StartupCommandConfirmDialog } from './components/StartupCommandConfirmDialog';
import { TaskBoard } from './components/TaskBoard';
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
  // Board shows only when toggled on AND the active workspace opted in. Guards the
  // case where you switch to a non-task workspace while the board is open.
  const showBoard = taskView && tasksEnabled;

  useKeyboardShortcuts();

  useEffect(() => { void hydrate(); }, [hydrate]);

  // Subscribe to update events and check for updates on startup.
  useEffect(() => {
    const off = window.api.onUpdateEvent(applyUpdateEvent);
    checkForUpdates();
    return off;
  }, [applyUpdateEvent, checkForUpdates]);

  // Track window focus (gates notifications) and handle notification clicks
  // that ask to jump to a specific workspace.
  useEffect(() => {
    const offFocus = window.api.onWindowFocus(setWindowFocused);
    const offActivate = window.api.onActivateWorkspace(selectWorkspace);
    return () => { offFocus(); offActivate(); };
  }, [setWindowFocused, selectWorkspace]);

  // Live-update the board when TASKS.md changes outside the app.
  useEffect(() => window.api.onTasksChanged(applyTasksChanged), [applyTasksChanged]);

  if (!hydrated) {
    return (
      <div className="root">
        <div className="titlebar" />
        <div className="app" />
      </div>
    );
  }

  return (
    <div className="root">
      {/* Draggable strip clearing the macOS traffic lights (hiddenInset). On
          Windows it's a custom row below the native window controls, so both
          platforms have the same titlebar surface for the action buttons. */}
      <div className="titlebar"><TitlebarActions /></div>
      <div className={`app app-${workspaceNavigationPlacement}`}>
        {workspaceNavigationPlacement === 'left' ? (
          <>
            <WorkspaceNavigation placement="left" />
            <div className="view-stack">
              <div className="view-pane" style={{ display: showBoard ? 'none' : 'block' }}>
                <WorkspaceView />
              </div>
              {showBoard && <div className="view-pane"><TaskBoard /></div>}
            </div>
          </>
        ) : (
          <div className="workspace-shell">
            <WorkspaceNavigation placement="top" />
            <div className="view-stack">
              <div className="view-pane" style={{ display: showBoard ? 'none' : 'block' }}>
                <WorkspaceView />
              </div>
              {showBoard && <div className="view-pane"><TaskBoard /></div>}
            </div>
          </div>
        )}
        <PreviewPanel />
      </div>
      <SettingsPanel />
      <CommandPalette />
      <TemplateWizard />
      <StartupCommandConfirmDialog />
    </div>
  );
}
