import React, { useEffect } from 'react';
import { useStore } from './store';
import { Sidebar } from './components/Sidebar';
import { WorkspaceView } from './components/WorkspaceView';

export function App(): JSX.Element {
  const hydrated = useStore((s) => s.hydrated);
  const hydrate = useStore((s) => s.hydrate);

  useEffect(() => { void hydrate(); }, [hydrate]);

  if (!hydrated) return <div className="app" />;

  return (
    <div className="app">
      <Sidebar />
      <WorkspaceView />
    </div>
  );
}
