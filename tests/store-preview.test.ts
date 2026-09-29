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

describe('leaving the editor with unsaved changes', () => {
  beforeEach(() => {
    useStore.setState({
      previewPanel: { open: false, widthPx: 480, source: null, tab: 'files', browseRoot: null, editPath: null, editRemote: null },
      editorDirty: false, pendingEditorLeave: null
    });
    useStore.getState().openInEditor('/tmp/a.md');
    useStore.getState().setEditorDirty(true);
  });

  it('closePreview waits for confirmation and closes after it', () => {
    useStore.getState().closePreview();
    expect(useStore.getState().previewPanel.open).toBe(true);
    expect(useStore.getState().pendingEditorLeave).not.toBeNull();

    useStore.getState().confirmEditorLeave();
    const s = useStore.getState();
    expect(s.previewPanel.open).toBe(false);
    expect(s.editorDirty).toBe(false);
    expect(s.pendingEditorLeave).toBeNull();
  });

  it('cancelEditorLeave keeps the editor open on the same file', () => {
    useStore.getState().closePreview();
    useStore.getState().cancelEditorLeave();
    const s = useStore.getState();
    expect(s.previewPanel).toMatchObject({ open: true, editPath: '/tmp/a.md' });
    expect(s.editorDirty).toBe(true);
    expect(s.pendingEditorLeave).toBeNull();
  });

  it('asks before switching to another file, but not when re-opening the same one', () => {
    useStore.getState().openInEditor('/tmp/a.md');
    expect(useStore.getState().pendingEditorLeave).toBeNull();

    useStore.getState().openInEditor('/tmp/b.md');
    expect(useStore.getState().previewPanel.editPath).toBe('/tmp/a.md');
    useStore.getState().confirmEditorLeave();
    expect(useStore.getState().previewPanel.editPath).toBe('/tmp/b.md');
  });

  it('togglePreview asks only when it would close the panel', () => {
    useStore.getState().togglePreview();
    expect(useStore.getState().previewPanel.open).toBe(true);
    expect(useStore.getState().pendingEditorLeave).not.toBeNull();
  });

  it('asks for every other way of leaving the editor', () => {
    for (const leave of [
      () => useStore.getState().setBrowseRoot('/tmp'),
      () => useStore.getState().openFiles(),
      () => useStore.getState().openPreview({ kind: 'markdown', target: '/tmp/x.md', resolved: true })
    ]) {
      useStore.setState({ pendingEditorLeave: null });
      leave();
      expect(useStore.getState().previewPanel.editPath).toBe('/tmp/a.md');
      expect(useStore.getState().pendingEditorLeave).not.toBeNull();
    }
  });

  it('does not ask when the editor is clean', () => {
    useStore.getState().setEditorDirty(false);
    useStore.getState().closePreview();
    expect(useStore.getState().previewPanel.open).toBe(false);
    expect(useStore.getState().pendingEditorLeave).toBeNull();
  });
});
