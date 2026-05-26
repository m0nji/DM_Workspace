import { describe, it, expect } from 'vitest';
import { serialize, deserialize, defaultState, loadStateFromFile, saveStateToFile } from '../src/main/persistence';
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
    settings: { terminalBackground: '#101418', terminalOpacity: 0.8 }
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
    expect(result.settings).toEqual({ terminalBackground: '#0d0d0d', terminalOpacity: 1 });
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
