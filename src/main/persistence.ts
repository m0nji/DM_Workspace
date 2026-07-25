import { homedir } from 'os';
import { readFileSync } from 'fs';
import { writeFileAtomic } from './atomic-write';
import type {
  AppState, LayoutNode, Settings, WindowBounds, Workspace, WorkspaceTemplate, WorkspaceNavigationPlacement
} from '../shared/types';
import { getTheme, DEFAULT_THEME_ID } from '../shared/themes';
import { SHORTCUT_ACTIONS, type ShortcutAction } from '../shared/shortcuts';

// Keep only entries whose value is a non-empty string; returns undefined when the
// result would be empty so the field can be omitted entirely.
function migrateStringMap(raw: unknown): Record<string, string> | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const entries = Object.entries(raw as Record<string, unknown>)
    .filter(([, value]) => typeof value === 'string' && value.trim().length > 0) as Array<[string, string]>;
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

// Keep only known shortcut actions mapped to non-empty strings.
function migrateShortcutBindings(raw: unknown): Partial<Record<ShortcutAction, string>> | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const out: Partial<Record<ShortcutAction, string>> = {};
  for (const action of SHORTCUT_ACTIONS) {
    const value = r[action];
    if (typeof value === 'string' && value.trim().length > 0) out[action] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function migrateWorkspaceNavigationPlacement(raw: unknown): WorkspaceNavigationPlacement | undefined {
  return raw === 'left' || raw === 'top' ? raw : undefined;
}

function migrateBrandDesign(raw: unknown): Settings['brandDesign'] {
  return raw === 'graphite' || raw === 'standard' || raw === 'black' ? raw : undefined;
}

function migrateLocale(raw: unknown): Settings['locale'] {
  return raw === 'en' || raw === 'de' ? raw : undefined;
}

export function defaultSettings(): Settings {
  return { themeId: DEFAULT_THEME_ID, terminalOpacity: 0.95, workspaceNavigationPlacement: 'left' };
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
  const out: Settings = { themeId, terminalOpacity, workspaceNavigationPlacement: d.workspaceNavigationPlacement };
  if (typeof r.terminalBackground === 'string') out.terminalBackground = r.terminalBackground;
  if (typeof r.clickMovesCursor === 'boolean') out.clickMovesCursor = r.clickMovesCursor;
  if (typeof r.showDoneBadge === 'boolean') out.showDoneBadge = r.showDoneBadge;
  if (typeof r.notificationsEnabled === 'boolean') out.notificationsEnabled = r.notificationsEnabled;
  if (typeof r.restoreTerminalHistory === 'boolean') out.restoreTerminalHistory = r.restoreTerminalHistory;
  // brandDesign/locale MUST survive the round-trip: dropping them here is what
  // made the app fall back to Black Utility (and OS language) on every launch —
  // the next save then persisted the stripped settings, losing the choice for good.
  const brandDesign = migrateBrandDesign(r.brandDesign);
  if (brandDesign) out.brandDesign = brandDesign;
  const locale = migrateLocale(r.locale);
  if (locale) out.locale = locale;
  const shortcutBindings = migrateShortcutBindings(r.shortcutBindings);
  if (shortcutBindings) out.shortcutBindings = shortcutBindings;
  const workspaceNavigationPlacement = migrateWorkspaceNavigationPlacement(r.workspaceNavigationPlacement);
  if (workspaceNavigationPlacement) out.workspaceNavigationPlacement = workspaceNavigationPlacement;
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
  if (typeof r.tasksEnabled === 'boolean') out.tasksEnabled = r.tasksEnabled;
  const paneTitles = migrateStringMap(r.paneTitles);
  if (paneTitles) out.paneTitles = paneTitles;
  const pendingStartupCommands = migrateStringMap(r.pendingStartupCommands);
  if (pendingStartupCommands) out.pendingStartupCommands = pendingStartupCommands;
  return out;
}

// A template requires a real (non-null) layout. confirmStartupCommands defaults
// to the safe value (true) when missing. Optional string maps are kept only when
// non-empty so a template round-trips to an identical object.
function migrateWorkspaceTemplate(raw: unknown): WorkspaceTemplate | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id.length === 0) return undefined;
  if (typeof r.name !== 'string' || r.name.length === 0) return undefined;
  if (typeof r.cwd !== 'string') return undefined;
  const layout = migrateLayout(r.layout);
  if (layout === undefined || layout === null) return undefined;
  const out: WorkspaceTemplate = {
    id: r.id,
    name: r.name,
    cwd: r.cwd,
    layout,
    confirmStartupCommands: typeof r.confirmStartupCommands === 'boolean' ? r.confirmStartupCommands : true
  };
  if (typeof r.color === 'string') out.color = r.color;
  const paneTitles = migrateStringMap(r.paneTitles);
  if (paneTitles) out.paneTitles = paneTitles;
  const startupCommands = migrateStringMap(r.startupCommands);
  if (startupCommands) out.startupCommands = startupCommands;
  return out;
}

export function deserialize(json: string): AppState {
  try {
    // Explizit unknown statt des impliziten any von JSON.parse: die Guards unten
    // (isValidRoot, migrate*) sind die einzige Stelle, an der aus diesen Daten ein
    // Typ wird — any würde sie stillschweigend umgehbar machen.
    const parsed: unknown = JSON.parse(json);
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
    const rawTemplates = (parsed as unknown as Record<string, unknown>).workspaceTemplates;
    if (Array.isArray(rawTemplates)) {
      out.workspaceTemplates = rawTemplates
        .map(migrateWorkspaceTemplate)
        .filter((t): t is WorkspaceTemplate => t !== undefined);
    }
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
    writeFileAtomic(file, serialize(state));
  } catch (err) {
    console.error(`Failed to save state to ${file}:`, err);
  }
}
