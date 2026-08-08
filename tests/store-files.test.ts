import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../src/renderer/store';

const blankPanel = { open: false, widthPx: 480, source: null, tab: 'files' as const, browseRoot: null, editPath: null, editRemote: null };

describe('file browser store', () => {
  beforeEach(() => {
    useStore.setState({
      previewPanel: { ...blankPanel },
      workspaces: [{ id: 'w1', name: 'WS', cwd: '/tmp/proj', layout: null }],
      activeWorkspaceId: 'w1',
      focusedPaneId: null,
      paneCwd: {}
    });
  });

  it('openFiles opens the panel to the Files tab and defaults browseRoot to the active cwd', () => {
    useStore.getState().openFiles();
    const p = useStore.getState().previewPanel;
    expect(p.open).toBe(true);
    expect(p.tab).toBe('files');
    expect(p.browseRoot).toBe('/tmp/proj');
  });

  // Opening the browser should land where the user is actually working, so it
  // re-syncs to the focused pane's live cwd on every open rather than sticking
  // to whatever folder was browsed last time.
  it('openFiles jumps to the focused pane live cwd', () => {
    useStore.setState({ focusedPaneId: 'p1', paneCwd: { p1: '/tmp/proj/src' } });
    useStore.getState().openFiles();
    expect(useStore.getState().previewPanel.browseRoot).toBe('/tmp/proj/src');
  });

  it('openFiles falls back to the workspace cwd when the pane reported no cwd yet', () => {
    useStore.setState({ focusedPaneId: 'p1', paneCwd: {} });
    useStore.getState().openFiles();
    expect(useStore.getState().previewPanel.browseRoot).toBe('/tmp/proj');
  });

  it('openFiles re-syncs a stale browseRoot from a previous session', () => {
    useStore.setState({
      previewPanel: { ...blankPanel, browseRoot: '/somewhere/else' },
      focusedPaneId: 'p1',
      paneCwd: { p1: '/tmp/proj/src' }
    });
    useStore.getState().openFiles();
    expect(useStore.getState().previewPanel.browseRoot).toBe('/tmp/proj/src');
  });

  it('togglePreview syncs browseRoot when it opens the panel', () => {
    useStore.setState({
      previewPanel: { ...blankPanel, open: false, browseRoot: '/somewhere/else' },
      focusedPaneId: 'p1',
      paneCwd: { p1: '/tmp/proj/src' }
    });
    useStore.getState().togglePreview();
    const p = useStore.getState().previewPanel;
    expect(p.open).toBe(true);
    expect(p.browseRoot).toBe('/tmp/proj/src');
  });

  it('togglePreview leaves browseRoot alone when it closes the panel', () => {
    useStore.setState({
      previewPanel: { ...blankPanel, open: true, browseRoot: '/tmp/proj/docs' },
      focusedPaneId: 'p1',
      paneCwd: { p1: '/tmp/proj/src' }
    });
    useStore.getState().togglePreview();
    const p = useStore.getState().previewPanel;
    expect(p.open).toBe(false);
    expect(p.browseRoot).toBe('/tmp/proj/docs');
  });

  // While the panel stays open the user owns the position: navigating into a
  // subfolder and switching tabs must not yank the tree back to the pane cwd.
  it('keeps a browsed folder while the panel stays open', () => {
    useStore.setState({ focusedPaneId: 'p1', paneCwd: { p1: '/tmp/proj/src' } });
    useStore.getState().openFiles();
    useStore.getState().setBrowseRoot('/tmp/proj/docs');
    useStore.getState().setPanelTab('preview');
    useStore.getState().setPanelTab('files');
    expect(useStore.getState().previewPanel.browseRoot).toBe('/tmp/proj/docs');
  });

  it('setBrowseRoot updates the root and clears the editor', () => {
    useStore.setState({ previewPanel: { ...blankPanel, editPath: '/x/a.txt' } });
    useStore.getState().setBrowseRoot('/tmp/proj/src');
    const p = useStore.getState().previewPanel;
    expect(p.browseRoot).toBe('/tmp/proj/src');
    expect(p.editPath).toBe(null);
  });

  it('openInEditor switches to the preview tab, sets editPath, and clears source', () => {
    useStore.setState({ previewPanel: { ...blankPanel, source: { kind: 'web', target: 'https://x.com', resolved: true } } });
    useStore.getState().openInEditor('/tmp/proj/readme.md');
    const p = useStore.getState().previewPanel;
    expect(p.tab).toBe('preview');
    expect(p.editPath).toBe('/tmp/proj/readme.md');
    expect(p.open).toBe(true);
    expect(p.source).toBe(null);
  });

  it('openFiles clears any open editor', () => {
    useStore.setState({ previewPanel: { ...blankPanel, editPath: '/x/a.txt' } });
    useStore.getState().openFiles();
    expect(useStore.getState().previewPanel.editPath).toBe(null);
  });

  it('setPanelTab back to files leaves editPath intact for return', () => {
    useStore.getState().openInEditor('/tmp/proj/readme.md');
    useStore.getState().setPanelTab('files');
    expect(useStore.getState().previewPanel.tab).toBe('files');
  });

  it('openPreview sets the source, opens preview tab, and clears editPath', () => {
    useStore.setState({ previewPanel: { ...blankPanel, editPath: '/x/a.txt' } });
    useStore.getState().openPreview({ kind: 'markdown', target: '/tmp/a.md', resolved: true });
    const p = useStore.getState().previewPanel;
    expect(p.open).toBe(true);
    expect(p.tab).toBe('preview');
    expect(p.editPath).toBe(null);
    expect(p.source).toEqual({ kind: 'markdown', target: '/tmp/a.md', resolved: true });
  });
});

// ---- Remote-Workspaces (B3): Files-Tab zeigt den Server-Projektbaum --------

describe('file browser store – remote workspaces', () => {
  beforeEach(() => {
    useStore.setState({
      previewPanel: { ...blankPanel },
      workspaces: [{
        id: 'wr1', name: 'Projekt X', cwd: '~', layout: null,
        kind: 'remote', remote: { serverId: 'srv1', scope: 'project', projectId: 'proj1' }
      }],
      activeWorkspaceId: 'wr1',
      focusedPaneId: 'p1',
      paneCwd: { p1: '/workspace/src' } // Container-Pfad der Remote-Shell
    });
  });

  it('openFiles startet im Projektroot statt im (Container-)Pane-cwd', () => {
    useStore.getState().openFiles();
    expect(useStore.getState().previewPanel.browseRoot).toBe('/');
  });

  it('togglePreview synchronisiert den Root eines Remote-Workspace auf /', () => {
    useStore.setState({ previewPanel: { ...blankPanel, browseRoot: '/tmp/woanders' } });
    useStore.getState().togglePreview();
    expect(useStore.getState().previewPanel.browseRoot).toBe('/');
  });

  it('openInEditor trägt die Remote-Herkunft und clearEditor räumt sie ab', () => {
    useStore.getState().openInEditor('/docs/a.md', { serverId: 'srv1', projectId: 'proj1' });
    let p = useStore.getState().previewPanel;
    expect(p.editPath).toBe('/docs/a.md');
    expect(p.editRemote).toEqual({ serverId: 'srv1', projectId: 'proj1' });

    useStore.getState().clearEditor();
    p = useStore.getState().previewPanel;
    expect(p.editPath).toBeNull();
    expect(p.editRemote).toBeNull();
  });

  it('openInEditor ohne Herkunft bleibt lokal (editRemote null)', () => {
    useStore.getState().openInEditor('/tmp/a.txt');
    expect(useStore.getState().previewPanel.editRemote).toBeNull();
  });

  it('setBrowseRoot verwirft eine offene Remote-Editor-Herkunft mit', () => {
    useStore.getState().openInEditor('/docs/a.md', { serverId: 'srv1', projectId: 'proj1' });
    useStore.getState().setBrowseRoot('/src');
    const p = useStore.getState().previewPanel;
    expect(p.editPath).toBeNull();
    expect(p.editRemote).toBeNull();
  });
});
