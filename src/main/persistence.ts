import { homedir } from 'os';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import type { AppState } from '../shared/types';

export function defaultState(): AppState {
  return {
    version: 1,
    activeWorkspaceId: 'w1',
    workspaces: [{ id: 'w1', name: 'Workspace 1', cwd: homedir(), layout: null }]
  };
}

export function serialize(state: AppState): string {
  return JSON.stringify(state, null, 2);
}

function isValid(obj: unknown): obj is AppState {
  if (typeof obj !== 'object' || obj === null) return false;
  const s = obj as Record<string, unknown>;
  return s.version === 1 && Array.isArray(s.workspaces);
}

export function deserialize(json: string): AppState {
  try {
    const parsed = JSON.parse(json);
    return isValid(parsed) ? (parsed as AppState) : defaultState();
  } catch {
    return defaultState();
  }
}

export function loadStateFromFile(file: string): AppState {
  if (!existsSync(file)) return defaultState();
  try {
    return deserialize(readFileSync(file, 'utf8'));
  } catch {
    return defaultState();
  }
}

export function saveStateToFile(file: string, state: AppState): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, serialize(state), 'utf8');
}
