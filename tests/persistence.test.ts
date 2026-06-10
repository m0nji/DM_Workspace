import { describe, it, expect } from 'vitest';
import { serialize, deserialize, defaultState, loadStateFromFile, saveStateToFile, migrateWindowBounds } from '../src/main/persistence';
import type { AppState } from '../src/shared/types';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('persistence serialize/deserialize', () => {
  const sample: AppState = {
    version: 1,
    activeWorkspaceId: 'w1',
    workspaces: [
      { id: 'w1', name: 'Workspace 1', cwd: '/home/x', layout: { type: 'pane', id: 'p1' } }
    ],
    settings: { themeId: 'default', terminalOpacity: 0.8, workspaceNavigationPlacement: 'left' }
  };

  it('round-trips state through serialize/deserialize', () => {
    expect(deserialize(serialize(sample))).toEqual(sample);
  });

  it('fills default settings when missing from persisted state', () => {
    const result = deserialize(JSON.stringify({
      version: 1,
      activeWorkspaceId: 'w1',
      workspaces: []
    }));
    expect(result.settings).toEqual({
      themeId: 'default',
      terminalOpacity: 0.95,
      workspaceNavigationPlacement: 'left'
    });
    expect(result.activeWorkspaceId).toBeNull();
  });

  it('returns defaultState for invalid JSON', () => {
    expect(deserialize('not json')).toEqual(defaultState());
  });

  it('returns defaultState when version is missing/unknown', () => {
    expect(deserialize(JSON.stringify({ workspaces: [] }))).toEqual(defaultState());
  });

  it('returns defaultState when version is an unknown number', () => {
    expect(deserialize(JSON.stringify({ version: 2, workspaces: [], activeWorkspaceId: null }))).toEqual(defaultState());
  });

  it('returns defaultState when activeWorkspaceId is missing', () => {
    expect(deserialize(JSON.stringify({ version: 1, workspaces: [] }))).toEqual(defaultState());
  });

  it('defaultState has one workspace with a null layout (welcome screen)', () => {
    const s = defaultState();
    expect(s.workspaces).toHaveLength(1);
    expect(s.workspaces[0].layout).toBeNull();
    expect(s.activeWorkspaceId).toBe(s.workspaces[0].id);
  });

  it('round-trips windowBounds through serialize/deserialize', () => {
    const withBounds: AppState = {
      ...sample,
      windowBounds: { x: 100, y: 120, width: 1600, height: 1000, isMaximized: false }
    };
    expect(deserialize(serialize(withBounds))).toEqual(withBounds);
  });

  it('drops malformed windowBounds but keeps the rest of the state', () => {
    const result = deserialize(JSON.stringify({
      version: 1,
      activeWorkspaceId: 'w1',
      workspaces: [],
      settings: { themeId: 'default', terminalOpacity: 0.75 },
      windowBounds: { width: 'oops' } // ungültig
    }));
    expect(result.windowBounds).toBeUndefined();
    expect(result.activeWorkspaceId).toBeNull();
    expect(result.workspaces).toEqual([]);
  });

  it('drops malformed workspaces instead of returning unsafe layout data', () => {
    const result = deserialize(JSON.stringify({
      version: 1,
      activeWorkspaceId: 'w1',
      workspaces: [
        { id: 'w1', name: 'Broken', cwd: '/tmp', layout: { type: 'split', id: 's1', direction: 'h', ratio: 0.5, children: [] } },
        { id: 'w2', name: 'Good', cwd: '/tmp', layout: { type: 'pane', id: 'p1' } }
      ]
    }));
    expect(result.workspaces).toEqual([
      { id: 'w2', name: 'Good', cwd: '/tmp', layout: { type: 'pane', id: 'p1' } }
    ]);
    expect(result.activeWorkspaceId).toBe('w2');
  });

  it('clamps persisted split ratios into the supported range', () => {
    const result = deserialize(JSON.stringify({
      version: 1,
      activeWorkspaceId: 'w1',
      workspaces: [
        {
          id: 'w1',
          name: 'Workspace 1',
          cwd: '/tmp',
          layout: {
            type: 'split',
            id: 's1',
            direction: 'h',
            ratio: 5,
            children: [{ type: 'pane', id: 'p1' }, { type: 'pane', id: 'p2' }]
          }
        }
      ]
    }));
    expect(result.workspaces[0].layout).toMatchObject({ type: 'split', ratio: 0.9 });
  });

  it('preserves a maximized windowBounds flag', () => {
    expect(migrateWindowBounds({ width: 800, height: 600, isMaximized: true }))
      .toEqual({ width: 800, height: 600, isMaximized: true });
  });

  it('returns undefined for non-object windowBounds', () => {
    expect(migrateWindowBounds(undefined)).toBeUndefined();
    expect(migrateWindowBounds(null)).toBeUndefined();
    expect(migrateWindowBounds(42)).toBeUndefined();
  });

  it('round-trips workspace pane titles and pending startup commands', () => {
    const state: AppState = {
      ...sample,
      workspaces: [{
        id: 'w1', name: 'Workspace 1', cwd: '/home/x',
        layout: { type: 'pane', id: 'p1' },
        paneTitles: { p1: 'dev server' },
        pendingStartupCommands: { p1: 'npm run dev' }
      }]
    };
    expect(deserialize(serialize(state))).toEqual(state);
  });

  it('round-trips valid workspace templates', () => {
    const state: AppState = {
      ...sample,
      workspaceTemplates: [{
        id: 'tpl1',
        name: 'Frontend Dev',
        cwd: '/repo',
        layout: { type: 'pane', id: 'tp1' },
        paneTitles: { tp1: 'dev server' },
        startupCommands: { tp1: 'npm run dev' },
        confirmStartupCommands: true
      }]
    };
    expect(deserialize(serialize(state))).toEqual(state);
  });

  it('drops templates with a missing or null layout', () => {
    const result = deserialize(JSON.stringify({
      ...sample,
      workspaceTemplates: [
        { id: 'bad', name: 'Broken', cwd: '/repo', layout: null, confirmStartupCommands: true },
        { id: 'ok', name: 'Good', cwd: '/repo', layout: { type: 'pane', id: 'tp1' }, confirmStartupCommands: false }
      ]
    }));
    expect(result.workspaceTemplates).toEqual([
      { id: 'ok', name: 'Good', cwd: '/repo', layout: { type: 'pane', id: 'tp1' }, confirmStartupCommands: false }
    ]);
  });

  it('defaults confirmStartupCommands to true when absent', () => {
    const result = deserialize(JSON.stringify({
      ...sample,
      workspaceTemplates: [{ id: 't', name: 'T', cwd: '/repo', layout: { type: 'pane', id: 'tp1' } }]
    }));
    expect(result.workspaceTemplates?.[0].confirmStartupCommands).toBe(true);
  });
});

describe('persistence file IO', () => {
  it('saves then loads identical state', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dmws-'));
    const file = join(dir, 'state.json');
    const state = defaultState();
    state.workspaces[0].name = 'Renamed';
    saveStateToFile(file, state);
    expect(loadStateFromFile(file)).toEqual(state);
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns defaultState when file is missing', () => {
    expect(loadStateFromFile('/nonexistent/path/state.json')).toEqual(defaultState());
  });

  it('creates nested directories recursively when saving', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dmws-'));
    const file = join(dir, 'sub', 'deep', 'state.json');
    const state = defaultState();
    state.workspaces[0].name = 'Nested';
    saveStateToFile(file, state);
    expect(loadStateFromFile(file)).toEqual(state);
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns defaultState when read fails (path is a directory)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dmws-'));
    expect(loadStateFromFile(dir)).toEqual(defaultState());
    rmSync(dir, { recursive: true, force: true });
  });
});
