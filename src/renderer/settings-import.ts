import type {
  ServerConfig, Settings, SettingsExportFile, SettingsImportParts, Workspace, WorkspaceGroup, WorkspaceTemplate
} from '../shared/types';
import { cloneTemplateLayout, remapStringMap } from '../shared/template-layout';
import { normalizeGroups } from '../shared/workspace-groups';

// Übernimmt eine (in Main bereits geprüfte) Exportdatei in den laufenden Stand.
// Rein funktional, damit die Regeln ohne Electron testbar sind:
//
// - Einstellungen ersetzen die aktuellen komplett (Darstellung, Tastenkürzel,
//   Agentenprofile …). Nur die Serverliste wird vereinigt: ein hier schon
//   eingetragener Server bleibt, sonst hinge sein angemeldetes Token ins Leere;
//   Server aus der Datei werden ergänzt (Anmeldung ist neu nötig).
// - Vorlagen werden ergänzt; eine gleichnamige Vorlage wird überschrieben, damit
//   ein zweiter Import keine Dubletten erzeugt.
// - Workspaces werden angehängt, nie ersetzt; ein schon vorhandener (gleicher
//   Name und Ordner) wird übersprungen. Alle ids (Workspace, Pane, Split,
//   Gruppe) werden neu vergeben — die Datei stammt von einem anderen Rechner
//   und ihre ids kollidieren sonst mit laufenden PTYs und Scrollback.

export interface SettingsImportState {
  settings: Settings;
  workspaces: Workspace[];
  workspaceTemplates: WorkspaceTemplate[];
  workspaceGroups: WorkspaceGroup[];
  activeWorkspaceId: string | null;
}

export interface SettingsImportIds {
  pane: () => string;
  split: () => string;
  workspace: () => string;
  template: () => string;
  group: () => string;
  server: () => string;
}

export interface SettingsImportOutcome extends SettingsImportState {
  addedServers: ServerConfig[]; // neu eingetragen — Main muss sie in seine Registry übernehmen
}

export interface SettingsImportSummary {
  agentProfiles: number;
  servers: number;
  templates: number;
  workspaces: number;
}

export function summarizeSettingsImport(file: SettingsExportFile): SettingsImportSummary {
  return {
    agentProfiles: file.settings.agentProfiles?.length ?? 0,
    servers: file.settings.servers?.length ?? 0,
    templates: file.workspaceTemplates.length,
    workspaces: file.workspaces.length
  };
}

// Server werden über ihre URL zugeordnet, nicht über ihre id: ids sind nur pro
// Rechner eindeutig ('srv1' hier kann ein ganz anderer Server sein als 'srv1'
// in der Datei), und an der id hängt das gespeicherte Session-Token. Eine
// kollidierende id bekommt deshalb eine frische — sonst ginge das Token dieses
// Rechners an die URL aus der Datei.
function mapServers(
  imported: ServerConfig[],
  current: ServerConfig[],
  freshId: () => string
): { idMap: Map<string, string>; added: ServerConfig[] } {
  const idMap = new Map<string, string>();
  const added: ServerConfig[] = [];
  const used = new Set(current.map((s) => s.id));
  for (const srv of imported) {
    const same = current.find((c) => c.baseUrl === srv.baseUrl) ?? added.find((a) => a.baseUrl === srv.baseUrl);
    if (same) { idMap.set(srv.id, same.id); continue; }
    let id = srv.id;
    while (used.has(id)) id = freshId();
    used.add(id);
    idMap.set(srv.id, id);
    added.push({ ...srv, id });
  }
  return { idMap, added };
}

function importTemplate(tpl: WorkspaceTemplate, id: string, ids: SettingsImportIds): WorkspaceTemplate {
  const { layout, paneIdMap } = cloneTemplateLayout(tpl.layout, ids.pane, ids.split);
  const out: WorkspaceTemplate = {
    id, name: tpl.name, cwd: tpl.cwd, layout, confirmStartupCommands: tpl.confirmStartupCommands
  };
  if (tpl.color) out.color = tpl.color;
  const paneTitles = remapStringMap(tpl.paneTitles, paneIdMap);
  if (paneTitles) out.paneTitles = paneTitles;
  const startupCommands = remapStringMap(tpl.startupCommands, paneIdMap);
  if (startupCommands) out.startupCommands = startupCommands;
  return out;
}

// Derselbe Workspace ist schon da: gleicher Name, gleicher Ordner, gleiche
// Art — bei Remote auch derselbe Server und dasselbe Projekt. Dann wird er beim
// Import übersprungen, damit ein zweiter Import derselben Datei (oder ein
// Import auf dem Rechner, der exportiert hat) keine Kopien anlegt.
function alreadyPresent(ws: Workspace, serverId: string | undefined, existing: Workspace[]): boolean {
  return existing.some((e) => {
    if (e.name !== ws.name || e.cwd !== ws.cwd) return false;
    if ((e.kind === 'remote') !== (ws.kind === 'remote')) return false;
    if (ws.kind !== 'remote' || !ws.remote) return true;
    if (!e.remote || e.remote.serverId !== serverId || e.remote.scope !== ws.remote.scope) return false;
    return e.remote.scope !== 'project' || ws.remote.scope !== 'project' || e.remote.projectId === ws.remote.projectId;
  });
}

// Die leere Willkommens-Hülle eines frischen Rechners: genau ein Workspace ohne
// Layout. Sie würde nach dem Import nur als überflüssiges Register stehen bleiben.
function isPristine(workspaces: Workspace[]): boolean {
  return workspaces.length === 1 && workspaces[0].layout === null && workspaces[0].kind !== 'remote';
}

export function applySettingsImport(
  current: SettingsImportState,
  file: SettingsExportFile,
  parts: SettingsImportParts,
  ids: SettingsImportIds
): SettingsImportOutcome {
  const currentServers = current.settings.servers ?? [];
  const { idMap: serverIdMap, added } = mapServers(file.settings.servers ?? [], currentServers, ids.server);
  let settings = current.settings;
  let addedServers: ServerConfig[] = [];
  if (parts.settings) {
    settings = { ...file.settings };
    addedServers = added;
    const servers = [...currentServers, ...added];
    if (servers.length > 0) settings.servers = servers; else delete settings.servers;
  }

  let workspaceTemplates = current.workspaceTemplates;
  if (parts.templates && file.workspaceTemplates.length > 0) {
    workspaceTemplates = [...workspaceTemplates];
    for (const tpl of file.workspaceTemplates) {
      const existing = workspaceTemplates.findIndex((t) => t.name === tpl.name);
      if (existing >= 0) {
        workspaceTemplates[existing] = importTemplate(tpl, workspaceTemplates[existing].id, ids);
      } else {
        workspaceTemplates.push(importTemplate(tpl, ids.template(), ids));
      }
    }
  }

  let workspaces = current.workspaces;
  let workspaceGroups = current.workspaceGroups;
  let activeWorkspaceId = current.activeWorkspaceId;
  if (parts.workspaces && file.workspaces.length > 0) {
    const knownServers = new Set((settings.servers ?? []).map((s) => s.id));
    const groupIdMap = new Map<string, string>();
    const added: Workspace[] = [];
    for (const ws of file.workspaces) {
      // Ein Remote-Workspace ohne seinen Server wäre eine Hülle ohne Verbindung.
      const serverId = ws.kind === 'remote' && ws.remote ? serverIdMap.get(ws.remote.serverId) : undefined;
      if (ws.kind === 'remote' && (!serverId || !knownServers.has(serverId))) continue;
      if (alreadyPresent(ws, serverId, current.workspaces)) continue;
      const next: Workspace = { id: ids.workspace(), name: ws.name, cwd: ws.cwd, layout: null };
      if (ws.layout) {
        const { layout, paneIdMap } = cloneTemplateLayout(ws.layout, ids.pane, ids.split);
        next.layout = layout;
        const paneTitles = remapStringMap(ws.paneTitles, paneIdMap);
        if (paneTitles) next.paneTitles = paneTitles;
      }
      if (ws.color) next.color = ws.color;
      if (ws.kind === 'remote' && ws.remote && serverId) {
        next.kind = 'remote';
        next.remote = { ...ws.remote, serverId };
      }
      if (ws.groupId) {
        let gid = groupIdMap.get(ws.groupId);
        if (!gid) { gid = ids.group(); groupIdMap.set(ws.groupId, gid); }
        next.groupId = gid;
      }
      added.push(next);
    }
    if (added.length > 0) {
      const importedGroups: WorkspaceGroup[] = [];
      for (const g of file.workspaceGroups) {
        const gid = groupIdMap.get(g.id);
        if (gid) importedGroups.push({ ...g, id: gid });
      }
      const base = isPristine(current.workspaces) ? [] : current.workspaces;
      const normalized = normalizeGroups({
        workspaces: [...base, ...added],
        groups: [...current.workspaceGroups, ...importedGroups]
      });
      workspaces = normalized.workspaces;
      workspaceGroups = normalized.groups;
      if (!workspaces.some((w) => w.id === activeWorkspaceId)) activeWorkspaceId = added[0].id;
    }
  }

  return { settings, workspaces, workspaceTemplates, workspaceGroups, activeWorkspaceId, addedServers };
}
