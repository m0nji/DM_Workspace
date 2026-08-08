import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../src/renderer/store';

describe('preview panel store', () => {
  beforeEach(() => {
    useStore.setState({ previewPanel: { open: false, widthPx: 480, source: null, tab: 'files', browseRoot: null, editPath: null, editRemote: null } });
  });

  it('openPreview sets the source and opens the panel', () => {
    useStore.getState().openPreview({ kind: 'markdown', target: '/tmp/a.md', resolved: true });
    const p = useStore.getState().previewPanel;
    expect(p.open).toBe(true);
    expect(p.source).toEqual({ kind: 'markdown', target: '/tmp/a.md', resolved: true });
  });

  it('closePreview closes but keeps the source', () => {
    useStore.getState().openPreview({ kind: 'web', target: 'https://x.com', resolved: true });
    useStore.getState().closePreview();
    const p = useStore.getState().previewPanel;
    expect(p.open).toBe(false);
    expect(p.source).toEqual({ kind: 'web', target: 'https://x.com', resolved: true });
  });

  it('togglePreview flips the open flag', () => {
    useStore.getState().togglePreview();
    expect(useStore.getState().previewPanel.open).toBe(true);
    useStore.getState().togglePreview();
    expect(useStore.getState().previewPanel.open).toBe(false);
  });

  it('setPreviewWidth clamps between 240 and 1200', () => {
    useStore.getState().setPreviewWidth(100);
    expect(useStore.getState().previewPanel.widthPx).toBe(240);
    useStore.getState().setPreviewWidth(5000);
    expect(useStore.getState().previewPanel.widthPx).toBe(1200);
    useStore.getState().setPreviewWidth(600);
    expect(useStore.getState().previewPanel.widthPx).toBe(600);
  });
});
