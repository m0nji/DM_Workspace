import { homedir } from 'os';
import { readFileSync } from 'fs';
import { writeFileAtomic } from './atomic-write';
import type {
  AppState, BusyIndicator, LayoutNode, ServerConfig, Settings, WindowBounds, Workspace,
  WorkspaceGroup, WorkspaceTemplate, WorkspaceNavigationPlacement
} from '../shared/types';
import {
  BUSY_INDICATOR_KINDS, BUSY_INDICATOR_SPEED_MAX_MS, BUSY_INDICATOR_SPEED_MIN_MS,
  TERMINAL_FONT_SIZE_MIN, TERMINAL_FONT_SIZE_MAX
} from '../shared/types';
import { getTheme, DEFAULT_THEME_ID } from '../shared/themes';
import { normalizeGroups } from '../shared/workspace-groups';
import { SHORTCUT_ACTIONS, type ShortcutAction } from '../shared/shortcuts';

// Keep only entries whose value is a non-empty string; returns undefined when the
// result would be empty so the field can be omitted entirely.
function migrateStringMap(raw: unknown): Record<string, string> | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const entries = Object.entries(raw as Record<string, unknown>)
    .filter(([, value]) => typeof value === 'string' && value.trim().length > 0) as Array<[string, string]>;
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function isBusyIndicator(raw: unknown): raw is BusyIndicator {
  return typeof raw === 'string' && (BUSY_INDICATOR_KINDS as readonly string[]).includes(raw);
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

// Konfigurierte Workspace-Server (Remote-Workspaces). Nur strukturell gültige
// Einträge mit http(s)-URL überleben; doppelte ids kollabieren auf den ersten
// Eintrag, damit ein kaputter Stand nicht zwei Server mit derselben Identität
// (und demselben safeStorage-Token) erzeugt.
function migrateServers(raw: unknown): ServerConfig[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const out: ServerConfig[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const r = entry as Record<string, unknown>;
    if (typeof r.id !== 'string' || r.id.length === 0) continue;
    if (typeof r.name !== 'string' || r.name.length === 0) continue;
    if (typeof r.baseUrl !== 'string' || !/^https?:\/\//i.test(r.baseUrl)) continue;
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({ id: r.id, name: r.name, baseUrl: r.baseUrl.replace(/\/+$/, '') });
  }
  return out.length > 0 ? out : undefined;
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
  if (typeof r.terminalFontSize === 'number' && Number.isFinite(r.terminalFontSize)) {
    out.terminalFontSize = Math.min(TERMINAL_FONT_SIZE_MAX, Math.max(TERMINAL_FONT_SIZE_MIN, Math.round(r.terminalFontSize)));
  }
  if (typeof r.terminalBackground === 'string') out.terminalBackground = r.terminalBackground;
  if (typeof r.clickMovesCursor === 'boolean') out.clickMovesCursor = r.clickMovesCursor;
  if (typeof r.showDoneBadge === 'boolean') out.showDoneBadge = r.showDoneBadge;
  // Die drei Werte des Laufanzeigers landen in der Oberflaeche direkt in
  // CSS-Eigenschaften, deshalb wird hier geprueft statt geglaubt: eine
  // unbekannte Art waere ein Klassenname ins Leere, eine wilde Zahl eine
  // Animationsdauer von Stunden oder Millisekunden.
  if (isBusyIndicator(r.busyIndicator)) out.busyIndicator = r.busyIndicator;
  if (typeof r.busyIndicatorColor === 'string') out.busyIndicatorColor = r.busyIndicatorColor;
  if (typeof r.busyIndicatorSpeedMs === 'number' && Number.isFinite(r.busyIndicatorSpeedMs)) {
    out.busyIndicatorSpeedMs = Math.min(
      BUSY_INDICATOR_SPEED_MAX_MS,
      Math.max(BUSY_INDICATOR_SPEED_MIN_MS, Math.round(r.busyIndicatorSpeedMs))
    );
  }
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
  // Serverliste MUSS den Round-Trip überleben (wie brandDesign/locale): ohne
  // diesen Zweig würde jeder Neustart die konfigurierten Server verwerfen.
  const servers = migrateServers(r.servers);
  if (servers) out.servers = servers;
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
  // Group membership has to be carried over explicitly: this function builds a
  // NEW object and keeps only what is named here, so anything not listed is
  // dropped on every load. An empty id would not name a group, so only a
  // non-empty string counts; deserialize drops ids that name no group at all.
  if (typeof r.groupId === 'string' && r.groupId.length > 0) out.groupId = r.groupId;
  const paneTitles = migrateStringMap(r.paneTitles);
  if (paneTitles) out.paneTitles = paneTitles;
  const pendingStartupCommands = migrateStringMap(r.pendingStartupCommands);
  if (pendingStartupCommands) out.pendingStartupCommands = pendingStartupCommands;
  // Remote-Workspace nur, wenn kind UND Verweis vollständig sind — ein halber
  // Eintrag würde als Remote-Hülle ohne Server auferstehen. Sonst fällt der
  // Workspace auf lokal zurück (kind bleibt weg, wie vor der Migration).
  // Bestände aus B2/B3 tragen kein scope-Feld: das war immer ein Projekt
  // (User-Workspaces gibt es erst seit dem scope-Feld) -> 'project' ergänzen.
  if (r.kind === 'remote' && typeof r.remote === 'object' && r.remote !== null) {
    const remote = r.remote as Record<string, unknown>;
    const serverId = typeof remote.serverId === 'string' && remote.serverId.length > 0 ? remote.serverId : null;
    if (serverId && remote.scope === 'user') {
      out.kind = 'remote';
      out.remote = { serverId, scope: 'user' };
    } else if (
      serverId && (remote.scope === 'project' || remote.scope === undefined) &&
      typeof remote.projectId === 'string' && remote.projectId.length > 0
    ) {
      out.kind = 'remote';
      out.remote = { serverId, scope: 'project', projectId: remote.projectId };
    }
  }
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

// A group needs an id and a name. The name may be empty: that is exactly the
// state a group is created in, before the user has typed one. Colour and
// collapsed are optional and only kept when they have the expected type.
function migrateWorkspaceGroup(raw: unknown): WorkspaceGroup | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id.length === 0) return undefined;
  if (typeof r.name !== 'string') return undefined;
  const out: WorkspaceGroup = { id: r.id, name: r.name };
  if (typeof r.color === 'string') out.color = r.color;
  if (typeof r.collapsed === 'boolean') out.collapsed = r.collapsed;
  return out;
}

// Unreadable entries are dropped rather than taking the whole list with them —
// losing one group beats losing every workspace. On a duplicate id the first
// entry wins: a `groupId` names exactly one group, so a second one carrying the
// same id could never be addressed anyway.
function migrateWorkspaceGroups(raw: unknown): WorkspaceGroup[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: WorkspaceGroup[] = [];
  for (const entry of raw) {
    const group = migrateWorkspaceGroup(entry);
    if (group === undefined || seen.has(group.id)) continue;
    seen.add(group.id);
    out.push(group);
  }
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
    const migrated = rawWorkspaces
      .map(migrateWorkspace)
      .filter((w): w is Workspace => w !== undefined);
    // Groups are repaired, not believed — same stance as the activeWorkspaceId
    // check below. A file on disk can come from an older build, a crash between
    // two writes, or an editor: normalizeGroups drops ids naming no group,
    // drops groups with no members, and pulls a broken run back together. It
    // runs first so everything below already sees the repaired list.
    const normalized = normalizeGroups({
      workspaces: migrated,
      groups: migrateWorkspaceGroups((parsed as unknown as Record<string, unknown>).workspaceGroups)
    });
    const workspaces = normalized.workspaces;
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
    // Absent rather than empty: a state with no groups has to look exactly like
    // one written before groups existed, so nothing downstream has to tell the
    // two apart.
    if (normalized.groups.length > 0) out.workspaceGroups = normalized.groups;
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
    // Owner-only like the scrollback beside it: this records the user's project
    // paths and per-workspace startup commands, which can carry credentials.
    writeFileAtomic(file, serialize(state), { mode: 0o600 });
  } catch (err) {
    console.error(`Failed to save state to ${file}:`, err);
  }
}
