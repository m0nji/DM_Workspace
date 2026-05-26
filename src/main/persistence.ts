import { homedir } from 'os';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { AppState, Settings } from '../shared/types';
import { getTheme, DEFAULT_THEME_ID } from '../shared/themes';

export function defaultSettings(): Settings {
  return { themeId: DEFAULT_THEME_ID, terminalOpacity: 0.75 };
}

// Migrate a raw persisted settings blob to the current shape. Pre-v0.2 states
// stored `terminalBackground` (a hex color) with no themeId; those map to the
// default theme while preserving the custom background as an override. Opacity
// is preserved when present.
export function migrateSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (typeof raw !== 'object' || raw === null) return d;
  const r = raw as Record<string, unknown>;
  const themeId = typeof r.themeId === 'string' && getTheme(r.themeId).id === r.themeId
    ? r.themeId
    : d.themeId;
  const terminalOpacity = typeof r.terminalOpacity === 'number' ? r.terminalOpacity : d.terminalOpacity;
  const out: Settings = { themeId, terminalOpacity };
  if (typeof r.terminalBackground === 'string') out.terminalBackground = r.terminalBackground;
  return out;
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
    // Migrate persisted settings to the current shape.
    return { ...parsed, settings: migrateSettings(parsed.settings) };
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
