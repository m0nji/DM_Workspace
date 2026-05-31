import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/store';

describe('workspace templates store actions', () => {
  const saveState = vi.fn();
  const kill = vi.fn();

  beforeEach(() => {
    saveState.mockClear();
    kill.mockClear();
    (globalThis as unknown as { window: unknown }).window = { api: { saveState, kill } };
    useStore.setState({
      version: 1,
      workspaces: [{
        id: 'w1',
        name: 'Frontend Dev',
        cwd: '/repo',
        layout: { type: 'pane', id: 'p1' },
        paneTitles: { p1: 'dev server' }
      }],
      workspaceTemplates: [],
      activeWorkspaceId: 'w1',
      settings: { themeId: 'default', terminalOpacity: 0.75 },
      maximizedPaneId: null,
      paneStatus: {},
      paneCwd: {},
      pendingTemplateLaunch: null,
      commandPaletteOpen: false
    });
  });

  it('saves the active workspace as a template', () => {
    useStore.getState().saveActiveWorkspaceAsTemplate({
      name: 'Frontend Template',
      paneTitles: { p1: 'dev server' },
      startupCommands: { p1: 'npm run dev' },
      confirmStartupCommands: true
    });

    const templates = useStore.getState().workspaceTemplates ?? [];
    expect(templates).toHaveLength(1);
    expect(templates[0]).toMatchObject({
      name: 'Frontend Template',
      cwd: '/repo',
      paneTitles: { p1: 'dev server' },
      startupCommands: { p1: 'npm run dev' },
      confirmStartupCommands: true
    });
    expect(saveState).toHaveBeenCalled();
  });

  it('does not template a welcome-screen workspace (null layout)', () => {
    useStore.setState({ workspaces: [{ id: 'w1', name: 'Empty', cwd: '/repo', layout: null }] });
    useStore.getState().saveActiveWorkspaceAsTemplate({ name: 'X', confirmStartupCommands: true });
    expect(useStore.getState().workspaceTemplates).toHaveLength(0);
  });

  it('creates a workspace from a template with fresh ids and pending commands', () => {
    useStore.setState({
      workspaceTemplates: [{
        id: 'tpl1',
        name: 'Frontend Template',
        cwd: '/repo',
        layout: { type: 'pane', id: 'tp1' },
        paneTitles: { tp1: 'dev server' },
        startupCommands: { tp1: 'npm run dev' },
        confirmStartupCommands: true
      }]
    });

    useStore.getState().createWorkspaceFromTemplate('tpl1', true);

    const created = useStore.getState().workspaces.at(-1)!;
    expect(created.name).toBe('Frontend Template');
    expect(created.layout?.type).toBe('pane');
    const newPaneId = created.layout!.id;
    expect(newPaneId).not.toBe('tp1');
    expect(created.paneTitles?.[newPaneId]).toBe('dev server');
    expect(created.pendingStartupCommands?.[newPaneId]).toBe('npm run dev');
    expect(useStore.getState().activeWorkspaceId).toBe(created.id);
  });

  it('omits startup commands when includeStartupCommands is false', () => {
    useStore.setState({
      workspaceTemplates: [{
        id: 'tpl1', name: 'T', cwd: '/repo',
        layout: { type: 'pane', id: 'tp1' },
        startupCommands: { tp1: 'npm run dev' },
        confirmStartupCommands: true
      }]
    });
    useStore.getState().createWorkspaceFromTemplate('tpl1', false);
    const created = useStore.getState().workspaces.at(-1)!;
    expect(created.pendingStartupCommands).toBeUndefined();
  });

  it('consumes a startup command exactly once', () => {
    useStore.setState({
      workspaces: [{
        id: 'w1', name: 'One', cwd: '/repo',
        layout: { type: 'pane', id: 'p1' },
        pendingStartupCommands: { p1: 'npm run dev' }
      }]
    });

    expect(useStore.getState().consumeStartupCommand('p1')).toBe('npm run dev');
    expect(useStore.getState().consumeStartupCommand('p1')).toBeNull();
    expect(useStore.getState().workspaces[0].pendingStartupCommands).toBeUndefined();
  });

  it('requestTemplateLaunch defers to a confirm dialog when commands need confirmation', () => {
    useStore.setState({
      workspaceTemplates: [{
        id: 'tpl1', name: 'T', cwd: '/repo', layout: { type: 'pane', id: 'tp1' },
        startupCommands: { tp1: 'npm run dev' }, confirmStartupCommands: true
      }]
    });
    const before = useStore.getState().workspaces.length;
    useStore.getState().requestTemplateLaunch('tpl1');
    expect(useStore.getState().pendingTemplateLaunch).toEqual({ templateId: 'tpl1' });
    expect(useStore.getState().workspaces.length).toBe(before); // not created yet
  });

  it('requestTemplateLaunch creates immediately when no confirmation is needed', () => {
    useStore.setState({
      workspaceTemplates: [{
        id: 'tpl2', name: 'NoConfirm', cwd: '/repo', layout: { type: 'pane', id: 'tp1' },
        startupCommands: { tp1: 'npm run dev' }, confirmStartupCommands: false
      }]
    });
    const before = useStore.getState().workspaces.length;
    useStore.getState().requestTemplateLaunch('tpl2');
    expect(useStore.getState().pendingTemplateLaunch).toBeNull();
    expect(useStore.getState().workspaces.length).toBe(before + 1);
  });

  it('requestTemplateLaunch creates immediately when there are no startup commands', () => {
    useStore.setState({
      workspaceTemplates: [{
        id: 'tpl3', name: 'Plain', cwd: '/repo', layout: { type: 'pane', id: 'tp1' },
        confirmStartupCommands: true
      }]
    });
    const before = useStore.getState().workspaces.length;
    useStore.getState().requestTemplateLaunch('tpl3');
    expect(useStore.getState().pendingTemplateLaunch).toBeNull();
    expect(useStore.getState().workspaces.length).toBe(before + 1);
  });

  it('deletes a template', () => {
    useStore.setState({
      workspaceTemplates: [{ id: 'tpl1', name: 'T', cwd: '/repo', layout: { type: 'pane', id: 'tp1' }, confirmStartupCommands: true }]
    });
    useStore.getState().deleteWorkspaceTemplate('tpl1');
    expect(useStore.getState().workspaceTemplates).toHaveLength(0);
  });

  it('strips a closed pane from paneTitles and pendingStartupCommands', () => {
    useStore.setState({
      workspaces: [{
        id: 'w1', name: 'X', cwd: '/r',
        layout: { type: 'split', id: 's1', direction: 'h', ratio: 0.5, children: [{ type: 'pane', id: 'p1' }, { type: 'pane', id: 'p2' }] },
        paneTitles: { p1: 'a', p2: 'b' },
        pendingStartupCommands: { p1: 'cmd1', p2: 'cmd2' }
      }],
      activeWorkspaceId: 'w1'
    });

    useStore.getState().closeActivePane('p1');

    const ws = useStore.getState().workspaces[0];
    expect(ws.paneTitles).toEqual({ p2: 'b' });
    expect(ws.pendingStartupCommands).toEqual({ p2: 'cmd2' });
    expect(kill).toHaveBeenCalledWith('p1');
  });

  it('updateWorkspaceTemplate drops emptied pane maps instead of storing {}', () => {
    useStore.setState({
      workspaceTemplates: [{
        id: 'tpl1', name: 'T', cwd: '/repo', layout: { type: 'pane', id: 'tp1' },
        startupCommands: { tp1: 'npm run dev' }, paneTitles: { tp1: 'dev' }, confirmStartupCommands: true
      }]
    });

    useStore.getState().updateWorkspaceTemplate('tpl1', { startupCommands: {}, paneTitles: {} });

    const tpl = (useStore.getState().workspaceTemplates ?? [])[0];
    expect(tpl.startupCommands).toBeUndefined();
    expect(tpl.paneTitles).toBeUndefined();
  });

  it('applyTemplateToWorkspace fills an existing blank workspace in place', () => {
    useStore.setState({
      workspaces: [{ id: 'w1', name: 'Workspace 1', cwd: '/old', layout: null }],
      activeWorkspaceId: 'w1',
      workspaceTemplates: [{
        id: 'tpl1', name: 'Dev', cwd: '/repo',
        layout: { type: 'pane', id: 'tp1' },
        paneTitles: { tp1: 'dev server' },
        startupCommands: { tp1: 'npm run dev' },
        confirmStartupCommands: true
      }]
    });

    useStore.getState().applyTemplateToWorkspace('w1', 'tpl1', true);

    const ws = useStore.getState().workspaces.find((w) => w.id === 'w1')!;
    expect(useStore.getState().workspaces).toHaveLength(1); // no new workspace
    expect(ws.name).toBe('Dev');
    expect(ws.cwd).toBe('/repo');
    expect(ws.layout?.type).toBe('pane');
    const newPaneId = ws.layout!.id;
    expect(newPaneId).not.toBe('tp1'); // fresh id
    expect(ws.paneTitles?.[newPaneId]).toBe('dev server');
    expect(ws.pendingStartupCommands?.[newPaneId]).toBe('npm run dev');
    expect(saveState).toHaveBeenCalled();
  });

  it('applyTemplateToWorkspace omits startup commands when not included', () => {
    useStore.setState({
      workspaces: [{ id: 'w1', name: 'W', cwd: '/old', layout: null }],
      activeWorkspaceId: 'w1',
      workspaceTemplates: [{
        id: 'tpl1', name: 'Dev', cwd: '/repo', layout: { type: 'pane', id: 'tp1' },
        startupCommands: { tp1: 'npm run dev' }, confirmStartupCommands: true
      }]
    });
    useStore.getState().applyTemplateToWorkspace('w1', 'tpl1', false);
    const ws = useStore.getState().workspaces.find((w) => w.id === 'w1')!;
    expect(ws.pendingStartupCommands).toBeUndefined();
  });

  it('applyTemplateToWorkspace clears stale fields the template does not supply', () => {
    useStore.setState({
      workspaces: [{
        id: 'w1', name: 'Old', cwd: '/old',
        layout: { type: 'pane', id: 'oldp' },
        color: '#abcdef',
        paneTitles: { oldp: 'old title' },
        pendingStartupCommands: { oldp: 'echo stale' }
      }],
      activeWorkspaceId: 'w1',
      workspaceTemplates: [{
        id: 'tpl1', name: 'Plain', cwd: '/repo',
        layout: { type: 'pane', id: 'tp1' },
        confirmStartupCommands: true
        // no color, no paneTitles, no startupCommands
      }]
    });

    useStore.getState().applyTemplateToWorkspace('w1', 'tpl1', true);

    const ws = useStore.getState().workspaces.find((w) => w.id === 'w1')!;
    expect(ws.color).toBeUndefined();
    expect(ws.paneTitles).toBeUndefined();
    expect(ws.pendingStartupCommands).toBeUndefined();
  });

  it('applyTemplateToWorkspace is a no-op when the template id is unknown', () => {
    useStore.setState({
      workspaces: [{ id: 'w1', name: 'W', cwd: '/old', layout: null }],
      activeWorkspaceId: 'w1',
      workspaceTemplates: []
    });
    useStore.getState().applyTemplateToWorkspace('w1', 'nope', true);
    const ws = useStore.getState().workspaces.find((w) => w.id === 'w1')!;
    expect(useStore.getState().workspaces).toHaveLength(1);
    expect(ws.layout).toBeNull();
  });

  it('launchTemplateIntoWorkspace applies directly when no confirmation is needed', () => {
    useStore.setState({
      workspaces: [{ id: 'w1', name: 'W', cwd: '/old', layout: null }],
      activeWorkspaceId: 'w1',
      workspaceTemplates: [{
        id: 'tpl1', name: 'Plain', cwd: '/repo', layout: { type: 'pane', id: 'tp1' },
        confirmStartupCommands: true // no startupCommands → nothing to confirm
      }]
    });
    useStore.getState().launchTemplateIntoWorkspace('w1', 'tpl1');
    expect(useStore.getState().pendingTemplateLaunch).toBeNull();
    expect(useStore.getState().workspaces.find((w) => w.id === 'w1')!.layout?.type).toBe('pane');
  });

  it('launchTemplateIntoWorkspace defers to confirm when commands need confirmation', () => {
    useStore.setState({
      workspaces: [{ id: 'w1', name: 'W', cwd: '/old', layout: null }],
      activeWorkspaceId: 'w1',
      workspaceTemplates: [{
        id: 'tpl1', name: 'Dev', cwd: '/repo', layout: { type: 'pane', id: 'tp1' },
        startupCommands: { tp1: 'npm run dev' }, confirmStartupCommands: true
      }]
    });
    useStore.getState().launchTemplateIntoWorkspace('w1', 'tpl1');
    expect(useStore.getState().pendingTemplateLaunch).toEqual({ templateId: 'tpl1', workspaceId: 'w1' });
    expect(useStore.getState().workspaces.find((w) => w.id === 'w1')!.layout).toBeNull(); // not applied yet
  });

  it('confirmPendingTemplateLaunch routes to the target workspace when present', () => {
    useStore.setState({
      workspaces: [{ id: 'w1', name: 'W', cwd: '/old', layout: null }],
      activeWorkspaceId: 'w1',
      workspaceTemplates: [{
        id: 'tpl1', name: 'Dev', cwd: '/repo', layout: { type: 'pane', id: 'tp1' },
        startupCommands: { tp1: 'npm run dev' }, confirmStartupCommands: true
      }],
      pendingTemplateLaunch: { templateId: 'tpl1', workspaceId: 'w1' }
    });
    useStore.getState().confirmPendingTemplateLaunch(true);
    expect(useStore.getState().workspaces).toHaveLength(1); // filled in place, no new ws
    expect(useStore.getState().workspaces[0].layout?.type).toBe('pane');
    expect(useStore.getState().pendingTemplateLaunch).toBeNull();
  });

  it('confirmPendingTemplateLaunch creates a new workspace when no target is set', () => {
    useStore.setState({
      workspaces: [{ id: 'w1', name: 'W', cwd: '/old', layout: { type: 'pane', id: 'p1' } }],
      activeWorkspaceId: 'w1',
      workspaceTemplates: [{
        id: 'tpl1', name: 'Dev', cwd: '/repo', layout: { type: 'pane', id: 'tp1' },
        startupCommands: { tp1: 'npm run dev' }, confirmStartupCommands: true
      }],
      pendingTemplateLaunch: { templateId: 'tpl1' }
    });
    useStore.getState().confirmPendingTemplateLaunch(true);
    expect(useStore.getState().workspaces).toHaveLength(2); // new workspace created
    expect(useStore.getState().pendingTemplateLaunch).toBeNull();
  });

  it('resolves a custom pane title with cwd fallback', () => {
    expect(useStore.getState().paneTitle('p1', '/repo')).toBe('dev server');
    expect(useStore.getState().paneTitle('pX', '/fallback')).toBe('/fallback');
  });
});

describe('shortcut binding store actions', () => {
  const saveState = vi.fn();

  beforeEach(() => {
    saveState.mockClear();
    (globalThis as unknown as { window: unknown }).window = { api: { saveState, kill: vi.fn() } };
    useStore.setState({
      version: 1,
      workspaces: [],
      workspaceTemplates: [],
      activeWorkspaceId: null,
      settings: { themeId: 'default', terminalOpacity: 0.75 }
    });
  });

  it('sets and resets a shortcut override', () => {
    useStore.getState().updateShortcutBinding('commandPalette', 'Mod+Alt+P');
    expect(useStore.getState().settings.shortcutBindings).toEqual({ commandPalette: 'Mod+Alt+P' });

    useStore.getState().resetShortcutBinding('commandPalette');
    expect(useStore.getState().settings.shortcutBindings).toBeUndefined();
  });
});
