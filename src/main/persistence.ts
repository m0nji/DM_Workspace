import { homedir } from 'os';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { AppState, LayoutNode, Settings, WindowBounds, Workspace } from '../shared/types';
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
  const terminalOpacity = typeof r.terminalOpacity === 'number' && Number.isFinite(r.terminalOpacity)
    ? Math.min(1, Math.max(0, r.terminalOpacity))
    : d.terminalOpacity;
  const out: Settings = { themeId, terminalOpacity };
  if (typeof r.terminalBackground === 'string') out.terminalBackground = r.terminalBackground;
  if (typeof r.showDoneBadge === 'boolean') out.showDoneBadge = r.showDoneBadge;
  if (typeof r.notificationsEnabled === 'boolean') out.notificationsEnabled = r.notificationsEnabled;
  return out;
}

// Validate a persisted windowBounds blob. width/height/isMaximized are required;
// x/y are optional (absent => the window is centered on next launch). Returns
// undefined for any malformed input so a bad value never blocks loading the rest.
export function migrateWindowBounds(raw: unknown): WindowBounds | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.width !== 'number' || typeof r.height !== 'number') return undefined;
  if (!Number.isFinite(r.width) || !Number.isFinite(r.height)) return undefined;
  if (typeof r.isMaximized !== 'boolean') return undefined;
  const out: WindowBounds = { width: r.width, height: r.height, isMaximized: r.isMaximized };
  if (
    typeof r.x === 'number' && Number.isFinite(r.x) &&
    typeof r.y === 'number' && Number.isFinite(r.y)
  ) { out.x = r.x; out.y = r.y; }
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

function isValidRoot(obj: unknown): obj is Record<string, unknown> {
  if (typeof obj !== 'object' || obj === null) return false;
  const s = obj as Record<string, unknown>;
  return s.version === 1
    && Array.isArray(s.workspaces)
    && (typeof s.activeWorkspaceId === 'string' || s.activeWorkspaceId === null);
}

function migrateLayout(raw: unknown, depth = 0): LayoutNode | null | undefined {
  if (raw === null) return null;
  if (typeof raw !== 'object' || raw === null || depth > 64) return undefined;
  const r = raw as Record<string, unknown>;
  if (r.type === 'pane') {
    return typeof r.id === 'string' && r.id.length > 0 ? { type: 'pane', id: r.id } : undefined;
  }
  if (r.type !== 'split') return undefined;
  if (typeof r.id !== 'string' || r.id.length === 0) return undefined;
  if (r.direction !== 'h' && r.direction !== 'v') return undefined;
  if (typeof r.ratio !== 'number' || !Number.isFinite(r.ratio)) return undefined;
  if (!Array.isArray(r.children) || r.children.length !== 2) return undefined;
  const a = migrateLayout(r.children[0], depth + 1);
  const b = migrateLayout(r.children[1], depth + 1);
  if (a === undefined || b === undefined || a === null || b === null) return undefined;
  return {
    type: 'split',
    id: r.id,
    direction: r.direction,
    ratio: Math.min(0.9, Math.max(0.1, r.ratio)),
    children: [a, b]
  };
}

function migrateWorkspace(raw: unknown): Workspace | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id.length === 0) return undefined;
  if (typeof r.name !== 'string' || r.name.length === 0) return undefined;
  if (typeof r.cwd !== 'string') return undefined;
  const layout = migrateLayout(r.layout);
  if (layout === undefined) return undefined;
  const out: Workspace = { id: r.id, name: r.name, cwd: r.cwd, layout };
  if (typeof r.color === 'string') out.color = r.color;
  return out;
}

export function deserialize(json: string): AppState {
  try {
    const parsed = JSON.parse(json);
    if (!isValidRoot(parsed)) return defaultState();
    const rawWorkspaces = parsed.workspaces as unknown[];
    const workspaces = rawWorkspaces
      .map(migrateWorkspace)
      .filter((w): w is Workspace => w !== undefined);
    const rawActiveWorkspaceId = parsed.activeWorkspaceId as string | null;
    const activeWorkspaceId = workspaces.some((w) => w.id === rawActiveWorkspaceId)
      ? rawActiveWorkspaceId
      : (workspaces[0]?.id ?? null);
    // Migrate persisted settings to the current shape.
    const out: AppState = {
      version: 1,
      workspaces,
      activeWorkspaceId,
      settings: migrateSettings(parsed.settings)
    };
    const wb = migrateWindowBounds((parsed as unknown as Record<string, unknown>).windowBounds);
    if (wb) out.windowBounds = wb; else delete out.windowBounds;
    return out;
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
