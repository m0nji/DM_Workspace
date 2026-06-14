import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../src/renderer/store';

const blankPanel = { open: false, widthPx: 480, source: null, tab: 'files' as const, browseRoot: null, editPath: null };

describe('file browser store', () => {
  beforeEach(() => {
    useStore.setState({
      previewPanel: { ...blankPanel },
      workspaces: [{ id: 'w1', name: 'WS', cwd: '/tmp/proj', layout: null }],
      activeWorkspaceId: 'w1'
    });
  });

  it('openFiles opens the panel to the Files tab and defaults browseRoot to the active cwd', () => {
    useStore.getState().openFiles();
    const p = useStore.getState().previewPanel;
    expect(p.open).toBe(true);
    expect(p.tab).toBe('files');
    expect(p.browseRoot).toBe('/tmp/proj');
  });

  it('openFiles keeps an existing browseRoot', () => {
    useStore.setState({ previewPanel: { ...blankPanel, browseRoot: '/other' } });
    useStore.getState().openFiles();
    expect(useStore.getState().previewPanel.browseRoot).toBe('/other');
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
