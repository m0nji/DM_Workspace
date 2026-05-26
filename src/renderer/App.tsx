import React, { useEffect } from 'react';
import { useStore } from './store';
import { Sidebar } from './components/Sidebar';
import { WorkspaceView } from './components/WorkspaceView';
import { SettingsPanel } from './components/SettingsPanel';

export function App(): JSX.Element {
  const hydrated = useStore((s) => s.hydrated);
  const hydrate = useStore((s) => s.hydrate);
  const applyUpdateEvent = useStore((s) => s.applyUpdateEvent);
  const checkForUpdates = useStore((s) => s.checkForUpdates);

  useEffect(() => { void hydrate(); }, [hydrate]);

  // Subscribe to update events and check for updates on startup.
  useEffect(() => {
    const off = window.api.onUpdateEvent(applyUpdateEvent);
    checkForUpdates();
    return off;
  }, [applyUpdateEvent, checkForUpdates]);

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
      {/* Draggable strip clearing the macOS traffic lights (hiddenInset). */}
      <div className="titlebar" />
      <div className="app">
        <Sidebar />
        <WorkspaceView />
      </div>
      <SettingsPanel />
    </div>
  );
}
