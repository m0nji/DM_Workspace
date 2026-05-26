import { homedir } from 'os';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { AppState, Settings } from '../shared/types';

export function defaultSettings(): Settings {
  return { terminalBackground: '#1e1e1e', terminalOpacity: 0.75 };
}

export function defaultState(): AppState {
  return {
    version: 1,
    activeWorkspaceId: 'w1',
    workspaces: [{ id: 'w1', name: 'Workspace 1', cwd: homedir(), layout: null }],
    settings: defaultSettings()
  };
}

export function serialize(state: AppState): string {
  return JSON.stringify(state, null, 2);
}

function isValid(obj: unknown): obj is AppState {
  if (typeof obj !== 'object' || obj === null) return false;
  const s = obj as Record<string, unknown>;
  return s.version === 1
    && Array.isArray(s.workspaces)
    && (typeof s.activeWorkspaceId === 'string' || s.activeWorkspaceId === null);
}

export function deserialize(json: string): AppState {
  try {
    const parsed = JSON.parse(json);
    if (!isValid(parsed)) return defaultState();
    // Fill in settings for states persisted before settings existed / partial settings.
    return { ...parsed, settings: { ...defaultSettings(), ...(parsed.settings ?? {}) } };
  } catch {
    return defaultState();
  }
}

export function loadStateFromFile(file: string): AppState {
  try {
    return deserialize(readFileSync(file, 'utf8'));
  } catch {
    return defaultState();
  }
}

export function saveStateToFile(file: string, state: AppState): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, serialize(state), 'utf8');
  } catch (err) {
    console.error(`Failed to save state to ${file}:`, err);
  }
}
