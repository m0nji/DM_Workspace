import { join } from 'node:path';
import {
  migrateSettings, migrateWorkspace, migrateWorkspaceGroups, migrateWorkspaceTemplate
} from './persistence';
import { normalizeGroups } from '../shared/workspace-groups';
import {
  SETTINGS_EXPORT_FORMAT, SETTINGS_EXPORT_VERSION,
  type SettingsExportFile, type SettingsExportPayload, type Workspace, type WorkspaceTemplate
} from '../shared/types';

// Einstellungen sichern & übertragen. Export und Import laufen durch dieselben
// migrate*-Funktionen wie state.json: eine Exportdatei ist damit nie mächtiger
// als ein State, den die App selbst lädt, und eine kaputte oder fremde Datei
// kann nichts einschleusen, was persistence.ts beim nächsten Start verwerfen
// würde.

// Großzügig für Hunderte Workspaces und Profile, aber klein genug, dass ein
// versehentlich gewähltes Video nicht komplett in den Speicher wandert.
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export type SettingsImportErrorCode = 'invalid' | 'unsupported-version';

export class SettingsImportError extends Error {
  // Nie den Parserfehler durchreichen: er kann Ausschnitte der Datei enthalten.
  constructor(public readonly code: SettingsImportErrorCode) {
    super(code === 'invalid' ? 'Not a DM Workspace settings file' : 'Settings file was written by a newer version');
    this.name = 'SettingsImportError';
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function trimTrailingSeparators(p: string): string {
  return p.length > 1 ? p.replace(/[\\/]+$/, '') : p;
}

// Pfad unter dem Home-Ordner -> "~/a/b" mit Schrägstrichen, damit er auf einem
// anderen Rechner (anderer Benutzername, anderes Betriebssystem) wieder unter
// dessen Home landet. Alles andere bleibt unverändert. Windows-Pfade werden
// ohne Rücksicht auf Groß-/Kleinschreibung verglichen.
export function toPortablePath(path: string, home: string, platform: NodeJS.Platform = process.platform): string {
  if (path === '~' || path.startsWith('~/') || path.startsWith('~\\')) return `~${path.slice(1).replace(/\\/g, '/')}`;
  const h = trimTrailingSeparators(home);
  if (!h) return path;
  const fold = (s: string): string => (platform === 'win32' ? s.toLowerCase() : s);
  const p = fold(path);
  const base = fold(h);
  if (p === base || p === `${base}/` || p === `${base}\\`) return '~';
  if (p.startsWith(`${base}/`) || p.startsWith(`${base}\\`)) {
    return `~/${path.slice(h.length + 1).replace(/\\/g, '/')}`;
  }
  return path;
}

// Gegenstück beim Import: "~/a/b" wird zum absoluten Pfad im Home dieses
// Rechners, mit den Trennzeichen des Betriebssystems.
export function fromPortablePath(path: string, home: string): string {
  if (path === '~') return home;
  if (path.startsWith('~/') || path.startsWith('~\\')) {
    const rest = path.slice(2).split(/[\\/]+/).filter(Boolean);
    return rest.length > 0 ? join(home, ...rest) : home;
  }
  return path;
}

function normalizeWorkspaces(
  rawWorkspaces: unknown,
  rawGroups: unknown,
  mapPath: (p: string) => string
): { workspaces: Workspace[]; groups: SettingsExportFile['workspaceGroups'] } {
  const list = Array.isArray(rawWorkspaces) ? rawWorkspaces : [];
  const seen = new Set<string>();
  const workspaces: Workspace[] = [];
  for (const raw of list) {
    const ws = migrateWorkspace(raw);
    if (!ws || seen.has(ws.id)) continue;
    seen.add(ws.id);
    // Einmal-Startbefehle gehören zu einem Workspace, der gerade aus einer
    // Vorlage entstanden ist — sie dürfen nicht auf einem anderen Rechner
    // nachträglich losgehen.
    delete ws.pendingStartupCommands;
    ws.cwd = mapPath(ws.cwd);
    workspaces.push(ws);
  }
  const normalized = normalizeGroups({ workspaces, groups: migrateWorkspaceGroups(rawGroups) });
  return { workspaces: normalized.workspaces, groups: normalized.groups };
}

function normalizeTemplates(raw: unknown, mapPath: (p: string) => string): WorkspaceTemplate[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: WorkspaceTemplate[] = [];
  for (const entry of raw) {
    const tpl = migrateWorkspaceTemplate(entry);
    if (!tpl || seen.has(tpl.id)) continue;
    seen.add(tpl.id);
    tpl.cwd = mapPath(tpl.cwd);
    out.push(tpl);
  }
  return out;
}

export function buildSettingsExport(
  payload: SettingsExportPayload,
  meta: { appVersion: string; now: Date; home: string; platform?: NodeJS.Platform }
): SettingsExportFile {
  const portable = (p: string): string => toPortablePath(p, meta.home, meta.platform);
  const { workspaces, groups } = normalizeWorkspaces(payload.workspaces, payload.workspaceGroups, portable);
  return {
    format: SETTINGS_EXPORT_FORMAT,
    formatVersion: SETTINGS_EXPORT_VERSION,
    appVersion: meta.appVersion,
    exportedAt: meta.now.toISOString(),
    settings: migrateSettings(payload.settings),
    workspaceTemplates: normalizeTemplates(payload.workspaceTemplates, portable),
    workspaces,
    workspaceGroups: groups
  };
}

export function serializeSettingsExport(file: SettingsExportFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

// Liest eine Exportdatei und bringt sie in die Form, die der Renderer ohne
// weitere Prüfung übernehmen kann. "~/..." wird zum Home dieses Rechners.
export function parseSettingsExport(json: string, home: string): SettingsExportFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json.replace(/^\uFEFF/, ''));
  } catch {
    throw new SettingsImportError('invalid');
  }
  if (!isRecord(parsed) || parsed.format !== SETTINGS_EXPORT_FORMAT) throw new SettingsImportError('invalid');
  if (typeof parsed.formatVersion !== 'number' || !Number.isInteger(parsed.formatVersion) || parsed.formatVersion < 1) {
    throw new SettingsImportError('invalid');
  }
  if (parsed.formatVersion > SETTINGS_EXPORT_VERSION) throw new SettingsImportError('unsupported-version');
  if (!isRecord(parsed.settings)) throw new SettingsImportError('invalid');
  const local = (p: string): string => fromPortablePath(p, home);
  const { workspaces, groups } = normalizeWorkspaces(parsed.workspaces, parsed.workspaceGroups, local);
  return {
    format: SETTINGS_EXPORT_FORMAT,
    formatVersion: SETTINGS_EXPORT_VERSION,
    appVersion: typeof parsed.appVersion === 'string' ? parsed.appVersion.slice(0, 64) : '',
    exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt.slice(0, 64) : '',
    settings: migrateSettings(parsed.settings),
    workspaceTemplates: normalizeTemplates(parsed.workspaceTemplates, local),
    workspaces,
    workspaceGroups: groups
  };
}

export function defaultExportFileName(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `dm-workspace-settings-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}
