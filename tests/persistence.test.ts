import { describe, it, expect } from 'vitest';
import { serialize, deserialize, defaultState, loadStateFromFile, saveStateToFile, migrateWindowBounds } from '../src/main/persistence';
import type { AppState, Settings, Workspace } from '../src/shared/types';
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

  // Remote-Workspaces: kind/remote müssen den Round-Trip überleben; ein halber
  // Eintrag (kind ohne Verweis) fällt auf lokal zurück.
  it('round-trips a remote workspace (kind + remote reference)', () => {
    const withRemote: AppState = {
      ...sample,
      workspaces: [
        ...sample.workspaces,
        {
          id: 'w2', name: 'Projekt X', cwd: '~',
          layout: { type: 'pane', id: 'r:srv1:proj1:p1' },
          kind: 'remote', remote: { serverId: 'srv1', scope: 'project', projectId: 'proj1' }
        },
        {
          id: 'w3', name: 'Meine Umgebung', cwd: '~',
          layout: { type: 'pane', id: 'r:srv1:user:p1' },
          kind: 'remote', remote: { serverId: 'srv1', scope: 'user' }
        }
      ]
    };
    expect(deserialize(serialize(withRemote))).toEqual(withRemote);
  });

  // Bestände aus B2/B3 tragen kein scope-Feld — das war immer ein Projekt.
  it('migrates a scope-less remote reference to scope project', () => {
    const result = deserialize(JSON.stringify({
      version: 1,
      activeWorkspaceId: 'w1',
      workspaces: [
        {
          id: 'w1', name: 'Projekt X', cwd: '~', layout: null,
          kind: 'remote', remote: { serverId: 'srv1', projectId: 'proj1' }
        }
      ],
      settings: { themeId: 'default', terminalOpacity: 0.75 }
    }));
    expect(result.workspaces[0].kind).toBe('remote');
    expect(result.workspaces[0].remote).toEqual({ serverId: 'srv1', scope: 'project', projectId: 'proj1' });
  });

  it('drops an incomplete remote reference back to a local workspace', () => {
    const result = deserialize(JSON.stringify({
      version: 1,
      activeWorkspaceId: 'w1',
      workspaces: [
        { id: 'w1', name: 'X', cwd: '~', layout: null, kind: 'remote' },
        { id: 'w2', name: 'Y', cwd: '~', layout: null, kind: 'remote', remote: { serverId: 'srv1' } },
        // scope 'project' ohne projectId ist genauso unvollständig …
        { id: 'w3', name: 'Z', cwd: '~', layout: null, kind: 'remote', remote: { serverId: 'srv1', scope: 'project' } },
        // … wie ein User-Verweis ohne serverId.
        { id: 'w4', name: 'U', cwd: '~', layout: null, kind: 'remote', remote: { scope: 'user' } }
      ],
      settings: { themeId: 'default', terminalOpacity: 0.75 }
    }));
    expect(result.workspaces).toHaveLength(4);
    for (const ws of result.workspaces) {
      expect(ws.kind).toBeUndefined();
      expect(ws.remote).toBeUndefined();
    }
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

// Groups are a side band: `workspaces` stays flat and each entry carries an
// optional groupId. Everything below is about the two invariants surviving a
// trip through disk — every groupId names a group that exists, and a group's
// members sit next to each other.
describe('persistence workspace groups', () => {
  const settings: Settings = {
    themeId: 'default', terminalOpacity: 0.8, workspaceNavigationPlacement: 'left'
  };
  const ws = (id: string, groupId?: string): Workspace => ({
    id, name: `Workspace ${id}`, cwd: '/home/x', layout: null,
    ...(groupId === undefined ? {} : { groupId })
  });
  const raw = (workspaces: unknown[], workspaceGroups?: unknown) => JSON.stringify({
    version: 1,
    activeWorkspaceId: 'w1',
    workspaces,
    settings,
    ...(workspaceGroups === undefined ? {} : { workspaceGroups })
  });

  it('round-trips workspaces together with their groups', () => {
    const state: AppState = {
      version: 1,
      activeWorkspaceId: 'w1',
      workspaces: [ws('w1', 'g1'), ws('w2', 'g1'), ws('w3')],
      workspaceGroups: [{ id: 'g1', name: 'Backend', color: '#cc3333', collapsed: true }],
      settings
    };
    expect(deserialize(serialize(state))).toEqual(state);
  });

  it('loads a state written before groups existed, unchanged', () => {
    const state: AppState = {
      version: 1, activeWorkspaceId: 'w1', workspaces: [ws('w1'), ws('w2')], settings
    };
    const result = deserialize(serialize(state));
    expect(result).toEqual(state);
    // Absent, not an empty array: identical to what an older build wrote.
    expect('workspaceGroups' in result).toBe(false);
  });

  it('keeps a group whose name is still empty', () => {
    // The state a group is in between being created and being named.
    const result = deserialize(raw([ws('w1', 'g1')], [{ id: 'g1', name: '' }]));
    expect(result.workspaceGroups).toEqual([{ id: 'g1', name: '' }]);
    expect(result.workspaces[0].groupId).toBe('g1');
  });

  it('drops a groupId that names no group', () => {
    const result = deserialize(raw([ws('w1', 'ghost'), ws('w2')]));
    expect(result.workspaces.map((w) => w.id)).toEqual(['w1', 'w2']);
    expect(result.workspaces.every((w) => w.groupId === undefined)).toBe(true);
    expect(result.workspaceGroups).toBeUndefined();
  });

  it('ignores an empty groupId', () => {
    const result = deserialize(raw([{ ...ws('w1'), groupId: '' }]));
    expect('groupId' in result.workspaces[0]).toBe(false);
  });

  it('drops a group that has no members left', () => {
    const result = deserialize(raw([ws('w1')], [{ id: 'g1', name: 'Leer' }]));
    expect(result.workspaceGroups).toBeUndefined();
    expect(result.workspaces.map((w) => w.id)).toEqual(['w1']); // workspace survives
  });

  it('pulls a broken run back together at its first member', () => {
    const result = deserialize(raw(
      [ws('w1', 'g1'), ws('w2'), ws('w3', 'g1')],
      [{ id: 'g1', name: 'Backend' }]
    ));
    expect(result.workspaces.map((w) => w.id)).toEqual(['w1', 'w3', 'w2']);
    expect(result.workspaceGroups).toEqual([{ id: 'g1', name: 'Backend' }]);
  });

  it('drops unreadable group entries without taking the workspaces with them', () => {
    const result = deserialize(raw(
      [ws('w1', 'g1'), ws('w2', 'g2')],
      [null, 'nope', 7, { id: '', name: 'Namenlos' }, { id: 'g1' }, { id: 'g2', name: 'Gut' }]
    ));
    // Losing one group beats losing every workspace, so both registers stay.
    expect(result.workspaces.map((w) => w.id)).toEqual(['w1', 'w2']);
    expect(result.workspaceGroups).toEqual([{ id: 'g2', name: 'Gut' }]);
    expect(result.workspaces[0].groupId).toBeUndefined(); // g1 was unreadable
    expect(result.workspaces[1].groupId).toBe('g2');
  });

  it('keeps the first of two groups sharing an id', () => {
    const result = deserialize(raw(
      [ws('w1', 'g1')],
      [{ id: 'g1', name: 'Erste' }, { id: 'g1', name: 'Zweite' }]
    ));
    expect(result.workspaceGroups).toEqual([{ id: 'g1', name: 'Erste' }]);
  });

  it('ignores a workspaceGroups field that is not an array', () => {
    const result = deserialize(raw([ws('w1', 'g1')], { g1: { id: 'g1', name: 'Objekt' } }));
    expect(result.workspaceGroups).toBeUndefined();
    expect(result.workspaces[0].groupId).toBeUndefined();
  });

  it('drops collapsed and color when they carry the wrong type', () => {
    const result = deserialize(raw(
      [ws('w1', 'g1')],
      [{ id: 'g1', name: 'Backend', color: 42, collapsed: 'yes' }]
    ));
    expect(result.workspaceGroups).toEqual([{ id: 'g1', name: 'Backend' }]);
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
