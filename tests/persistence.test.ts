import { describe, it, expect } from 'vitest';
import { serialize, deserialize, defaultState } from '../src/main/persistence';
import type { AppState } from '../src/shared/types';

describe('persistence serialize/deserialize', () => {
  const sample: AppState = {
    version: 1,
    activeWorkspaceId: 'w1',
    workspaces: [
      { id: 'w1', name: 'Workspace 1', cwd: '/home/x', layout: { type: 'pane', id: 'p1' } }
    ]
  };

  it('round-trips state through serialize/deserialize', () => {
    expect(deserialize(serialize(sample))).toEqual(sample);
  });

  it('returns defaultState for invalid JSON', () => {
    expect(deserialize('not json')).toEqual(defaultState());
  });

  it('returns defaultState when version is missing/unknown', () => {
    expect(deserialize(JSON.stringify({ workspaces: [] }))).toEqual(defaultState());
  });

  it('defaultState has one workspace with a null layout (welcome screen)', () => {
    const s = defaultState();
    expect(s.workspaces).toHaveLength(1);
    expect(s.workspaces[0].layout).toBeNull();
    expect(s.activeWorkspaceId).toBe(s.workspaces[0].id);
  });
});
