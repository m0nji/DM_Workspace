import { create } from 'zustand';
import type {
  AppState, PresetKind, Direction, Workspace, WorkspaceTemplate, Settings, UpdateEvent, PaneStatus
} from '../shared/types';
import {
  makePreset, splitPane, closePane, setRatio, collectPaneIds, collectSplitIds, reassignIds
} from '../shared/layout-tree';
import { cloneTemplateLayout, remapStringMap } from '../shared/template-layout';
import { createIdGenerator } from '../shared/ids';
import { DEFAULT_THEME_ID } from '../shared/themes';
import type { ShortcutAction } from '../shared/shortcuts';
import type { PreviewSource } from '../shared/link-detect';

const DEFAULT_SETTINGS: Settings = { themeId: DEFAULT_THEME_ID, terminalOpacity: 0.75, showDoneBadge: false, notificationsEnabled: false };

export type UpdateStatus =
  | 'idle' | 'checking' | 'available' | 'downloading'
  | 'downloaded' | 'not-available' | 'error' | 'disabled';

export interface UpdateState {
  status: UpdateStatus;
  version?: string;
  percent?: number;
  error?: string;
}

const nextPaneId = createIdGenerator('p');
const nextSplitId = createIdGenerator('s');
const nextWsId = createIdGenerator('w');
const nextTemplateId = createIdGenerator('tpl');

// Fields the wizard collects when saving the active workspace as a template.
export interface SaveTemplateInput {
  name: string;
  cwd?: string; // optional override; defaults to the active workspace's cwd
  paneTitles?: Record<string, string>;
  startupCommands?: Record<string, string>;
  confirmStartupCommands: boolean;
}

export interface TemplateWizardState {
  open: boolean;
  templateId?: string | null; // set => editing an existing template; null/undefined => save current workspace
}

interface StoreState extends AppState {
  maximizedPaneId: string | null;
  hydrated: boolean;
  settingsOpen: boolean;
  paneStatus: Record<string, PaneStatus>;
  paneCwd: Record<string, string>; // live working dir per pane (from shell OSC reports)
  focusedPaneId: string | null;
  windowFocused: boolean;
  searchOpenPaneId: string | null;
  commandPaletteOpen: boolean;
  templateWizard: TemplateWizardState;
  pendingTemplateLaunch: { templateId: string } | null;
  shortcutRecordingAction: ShortcutAction | null; // set while the editor captures a key; gates global shortcuts
  previewPanel: { open: boolean; widthPx: number; source: PreviewSource | null };
  openPreview: (source: PreviewSource) => void;
  closePreview: () => void;
  togglePreview: () => void;
  setPreviewWidth: (px: number) => void;
  // lifecycle
  hydrate: () => Promise<void>;
  // workspaces
  activeWorkspace: () => Workspace | undefined;
  selectWorkspace: (id: string) => void;
  addWorkspace: () => void;
  renameWorkspace: (id: string, name: string) => void;
  setWorkspaceCwd: (id: string, cwd: string) => void;
  deleteWorkspace: (id: string) => void;
  // layout
  applyPreset: (kind: PresetKind) => void;
  splitActivePane: (paneId: string, direction: Direction) => void;
  closeActivePane: (paneId: string) => void;
  resizeSplit: (splitId: string, ratio: number) => void;
  toggleMaximize: (paneId: string) => void;
  // settings
  settingsFocusSection: 'shortcuts' | null; // when opening, scroll to this section
  updateSettings: (patch: Partial<Settings>) => void;
  setSettingsOpen: (open: boolean, focusSection?: 'shortcuts' | null) => void;
  clearSettingsFocusSection: () => void;
  setPaneStatus: (paneId: string, status: PaneStatus) => void;
  setPaneCwd: (paneId: string, cwd: string) => void;
  setFocusedPane: (paneId: string) => void;
  setWindowFocused: (focused: boolean) => void;
  setSearchOpen: (paneId: string | null) => void;
  setWorkspaceColor: (id: string, color: string) => void;
  // command palette
  setCommandPaletteOpen: (open: boolean) => void;
  // templates
  setTemplateWizard: (state: TemplateWizardState) => void;
  setPendingTemplateLaunch: (value: { templateId: string } | null) => void;
  saveActiveWorkspaceAsTemplate: (input: SaveTemplateInput) => void;
  updateWorkspaceTemplate: (id: string, patch: Partial<Omit<WorkspaceTemplate, 'id'>>) => void;
  deleteWorkspaceTemplate: (id: string) => void;
  requestTemplateLaunch: (id: string) => void;
  createWorkspaceFromTemplate: (id: string, includeStartupCommands: boolean) => void;
  applyTemplateToWorkspace: (workspaceId: string, templateId: string, includeStartupCommands: boolean) => void;
  consumeStartupCommand: (paneId: string) => string | null;
  paneTitle: (paneId: string, fallback: string) => string;
  // shortcuts
  updateShortcutBinding: (action: ShortcutAction, binding: string) => void;
  resetShortcutBinding: (action: ShortcutAction) => void;
  setShortcutRecordingAction: (action: ShortcutAction | null) => void;
  // updates
  update: UpdateState;
  applyUpdateEvent: (e: UpdateEvent) => void;
  checkForUpdates: () => void;
  downloadUpdate: () => void;
  installUpdate: () => void;
}

// Remove a pane-keyed entry from an optional string map, returning undefined when
// the map becomes empty (so the field can be dropped). Returns the input unchanged
// when the key is absent.
function stripKey(map: Record<string, string> | undefined, key: string): Record<string, string> | undefined {
  if (!map || !(key in map)) return map;
  const next = { ...map };
  delete next[key];
  return Object.keys(next).length ? next : undefined;
}

function persist(state: AppState): void {
  void window.api.saveState({
    version: 1,
    workspaces: state.workspaces,
    workspaceTemplates: state.workspaceTemplates ?? [],
    activeWorkspaceId: state.activeWorkspaceId,
    settings: state.settings
  });
}

export const useStore = create<StoreState>((set, get) => ({
  version: 1,
  workspaces: [],
  workspaceTemplates: [],
  activeWorkspaceId: null,
  settings: DEFAULT_SETTINGS,
  maximizedPaneId: null,
  hydrated: false,
  settingsOpen: false,
  settingsFocusSection: null,
  paneStatus: {},
  paneCwd: {},
  focusedPaneId: null,
  windowFocused: true,
  searchOpenPaneId: null,
  commandPaletteOpen: false,
  templateWizard: { open: false, templateId: null },
  pendingTemplateLaunch: null,
  shortcutRecordingAction: null,
  update: { status: 'idle' },
  previewPanel: { open: false, widthPx: 480, source: null },

  hydrate: async () => {
    const loaded = await window.api.loadState();
    const templates = loaded.workspaceTemplates ?? [];
    // Seed the id generators past ids already used by the restored layout, so the
    // next split/workspace can't reuse an existing id (which would make two panes
    // share a paneId — colliding PTYs and duplicated scrollback replay). Template
    // layouts are seeded too so cloning a template never collides with a live pane.
    nextPaneId.seed([
      ...loaded.workspaces.flatMap((w) => collectPaneIds(w.layout)),
      ...templates.flatMap((t) => collectPaneIds(t.layout))
    ]);
    nextSplitId.seed([
      ...loaded.workspaces.flatMap((w) => collectSplitIds(w.layout)),
      ...templates.flatMap((t) => collectSplitIds(t.layout))
    ]);
    nextWsId.seed(loaded.workspaces.map((w) => w.id));
    nextTemplateId.seed(templates.map((t) => t.id));
    set({ ...loaded, workspaceTemplates: templates, hydrated: true });
  },

  activeWorkspace: () => get().workspaces.find((w) => w.id === get().activeWorkspaceId),

  selectWorkspace: (id) => set((s) => {
    if (!s.workspaces.some((w) => w.id === id)) return s;
    const next = { ...s, activeWorkspaceId: id, maximizedPaneId: null };
    persist(next);
    return next;
  }),

  addWorkspace: () => {
    const ws: Workspace = {
      id: nextWsId(),
      name: `Workspace ${get().workspaces.length + 1}`,
      cwd: get().workspaces[0]?.cwd ?? '~',
      layout: null
    };
    set((s) => {
      const next = { ...s, workspaces: [...s.workspaces, ws], activeWorkspaceId: ws.id };
      persist(next);
      return next;
    });
  },

  renameWorkspace: (id, name) => set((s) => {
    const next = { ...s, workspaces: s.workspaces.map((w) => w.id === id ? { ...w, name } : w) };
    persist(next);
    return next;
  }),

  // Change a workspace's base directory. If it already has running panes, restart
  // them in the new directory: kill the old PTYs and remount the same layout with
  // fresh pane ids so each terminal respawns with the new cwd. (For a workspace
  // still on the welcome screen there are no panes, so this just sets the cwd.)
  setWorkspaceCwd: (id, cwd) => set((s) => {
    const ws = s.workspaces.find((w) => w.id === id);
    if (!ws?.layout) {
      const next = { ...s, workspaces: s.workspaces.map((w) => w.id === id ? { ...w, cwd } : w) };
      persist(next);
      return next;
    }
    const paneStatus = { ...s.paneStatus };
    const paneCwd = { ...s.paneCwd };
    collectPaneIds(ws.layout).forEach((pid) => {
      window.api.kill(pid); delete paneStatus[pid]; delete paneCwd[pid];
    });
    const layout = reassignIds(ws.layout, nextPaneId, nextSplitId);
    const workspaces = s.workspaces.map((w) => w.id === id ? { ...w, cwd, layout } : w);
    const next = {
      ...s, workspaces, paneStatus, paneCwd,
      maximizedPaneId: null,
      focusedPaneId: null
    };
    persist(next);
    return next;
  }),

  deleteWorkspace: (id) => set((s) => {
    const ws = s.workspaces.find((w) => w.id === id);
    const paneStatus = { ...s.paneStatus };
    const paneCwd = { ...s.paneCwd };
    if (ws?.layout) collectPaneIds(ws.layout).forEach((pid) => {
      window.api.kill(pid); delete paneStatus[pid]; delete paneCwd[pid];
    });
    const workspaces = s.workspaces.filter((w) => w.id !== id);
    const activeWorkspaceId = s.activeWorkspaceId === id
      ? (workspaces[0]?.id ?? null)
      : s.activeWorkspaceId;
    const next = { ...s, workspaces, paneStatus, paneCwd, activeWorkspaceId, maximizedPaneId: null };
    persist(next);
    return next;
  }),

  applyPreset: (kind) => set((s) => {
    const layout = makePreset(kind, nextPaneId, nextSplitId);
    const workspaces = s.workspaces.map((w) =>
      w.id === s.activeWorkspaceId ? { ...w, layout } : w);
    const next = { ...s, workspaces };
    persist(next);
    return next;
  }),

  splitActivePane: (paneId, direction) => set((s) => {
    const workspaces = s.workspaces.map((w) => {
      if (w.id !== s.activeWorkspaceId || !w.layout) return w;
      return { ...w, layout: splitPane(w.layout, paneId, direction, nextPaneId(), nextSplitId()) };
    });
    const next = { ...s, workspaces };
    persist(next);
    return next;
  }),

  closeActivePane: (paneId) => set((s) => {
    window.api.kill(paneId);
    const paneStatus = { ...s.paneStatus }; delete paneStatus[paneId];
    const paneCwd = { ...s.paneCwd }; delete paneCwd[paneId];
    const workspaces = s.workspaces.map((w) => {
      if (w.id !== s.activeWorkspaceId || !w.layout) return w;
      const next: Workspace = { ...w, layout: closePane(w.layout, paneId) };
      // Drop the closed pane's metadata so it can't orphan in persisted state
      // (mirrors the paneStatus/paneCwd cleanup above).
      const titles = stripKey(next.paneTitles, paneId);
      if (titles) next.paneTitles = titles; else delete next.paneTitles;
      const pending = stripKey(next.pendingStartupCommands, paneId);
      if (pending) next.pendingStartupCommands = pending; else delete next.pendingStartupCommands;
      return next;
    });
    const next = {
      ...s,
      workspaces,
      paneStatus,
      paneCwd,
      focusedPaneId: s.focusedPaneId === paneId ? null : s.focusedPaneId,
      maximizedPaneId: s.maximizedPaneId === paneId ? null : s.maximizedPaneId
    };
    persist(next);
    return next;
  }),

  resizeSplit: (splitId, ratio) => set((s) => {
    const workspaces = s.workspaces.map((w) => {
      if (w.id !== s.activeWorkspaceId || !w.layout) return w;
      return { ...w, layout: setRatio(w.layout, splitId, ratio) };
    });
    const next = { ...s, workspaces };
    persist(next);
    return next;
  }),

  toggleMaximize: (paneId) =>
    set((s) => ({ maximizedPaneId: s.maximizedPaneId === paneId ? null : paneId })),

  updateSettings: (patch) => set((s) => {
    const next = { ...s, settings: { ...s.settings, ...patch } };
    persist(next);
    return next;
  }),

  setSettingsOpen: (open, focusSection = null) => set({ settingsOpen: open, settingsFocusSection: open ? focusSection : null }),
  clearSettingsFocusSection: () => set({ settingsFocusSection: null }),

  setPaneStatus: (paneId, status) => set((s) => {
    if (s.paneStatus[paneId] === status) return s;
    const paneStatus = { ...s.paneStatus, [paneId]: status };
    // Notify only when the pane is NOT visible (inactive workspace) OR the window
    // is unfocused — otherwise the user is already looking at it. The transition
    // into 'done' happens once until the user reacts (input resets to idle), which
    // debounces repeat notifications for the same pane. Gated on an opt-in setting
    // (default off) since OS notifications can be noisy.
    if (status === 'done' && s.settings.notificationsEnabled) {
      const ws = s.workspaces.find((w) => collectPaneIds(w.layout).includes(paneId));
      const visible = ws != null && ws.id === s.activeWorkspaceId;
      if (ws && (!visible || !s.windowFocused)) {
        window.api.notifyAgentDone({ workspaceId: ws.id, workspaceName: ws.name, paneTitle: ws.cwd });
      }
    }
    return { ...s, paneStatus };
  }),

  setPaneCwd: (paneId, cwd) => set((s) => {
    if (s.paneCwd[paneId] === cwd) return s;
    return { ...s, paneCwd: { ...s.paneCwd, [paneId]: cwd } };
  }),

  setFocusedPane: (paneId) => set({ focusedPaneId: paneId }),
  setWindowFocused: (focused) => set({ windowFocused: focused }),
  setSearchOpen: (paneId) => set({ searchOpenPaneId: paneId }),

  openPreview: (source) => set((s) => ({ previewPanel: { ...s.previewPanel, open: true, source } })),
  closePreview: () => set((s) => ({ previewPanel: { ...s.previewPanel, open: false } })),
  togglePreview: () => set((s) => ({ previewPanel: { ...s.previewPanel, open: !s.previewPanel.open } })),
  setPreviewWidth: (px) => set((s) => ({
    previewPanel: { ...s.previewPanel, widthPx: Math.min(1200, Math.max(240, px)) }
  })),

  setWorkspaceColor: (id, color) => set((s) => {
    const next = { ...s, workspaces: s.workspaces.map((w) => w.id === id ? { ...w, color } : w) };
    persist(next);
    return next;
  }),

  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),

  setTemplateWizard: (state) => set({ templateWizard: state }),

  setPendingTemplateLaunch: (value) => set({ pendingTemplateLaunch: value }),

  // Capture the active workspace's layout/folder as a reusable template. The
  // layout is deep-copied so later edits to the live workspace don't mutate the
  // stored template; its pane ids become the template's metadata keys.
  saveActiveWorkspaceAsTemplate: (input) => set((s) => {
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
    if (!ws || !ws.layout) return s; // can't template the welcome screen
    const template: WorkspaceTemplate = {
      id: nextTemplateId(),
      name: input.name,
      cwd: input.cwd ?? ws.cwd,
      layout: JSON.parse(JSON.stringify(ws.layout)),
      confirmStartupCommands: input.confirmStartupCommands
    };
    if (ws.color) template.color = ws.color;
    if (input.paneTitles && Object.keys(input.paneTitles).length) template.paneTitles = input.paneTitles;
    if (input.startupCommands && Object.keys(input.startupCommands).length) template.startupCommands = input.startupCommands;
    const next = { ...s, workspaceTemplates: [...(s.workspaceTemplates ?? []), template] };
    persist(next);
    return next;
  }),

  updateWorkspaceTemplate: (id, patch) => set((s) => {
    const workspaceTemplates = (s.workspaceTemplates ?? []).map((t) => {
      if (t.id !== id) return t;
      const merged: WorkspaceTemplate = { ...t, ...patch };
      // Keep the in-memory shape identical to what persistence stores: empty
      // maps are dropped, not kept as {} (so serialize→deserialize round-trips).
      if (!merged.paneTitles || Object.keys(merged.paneTitles).length === 0) delete merged.paneTitles;
      if (!merged.startupCommands || Object.keys(merged.startupCommands).length === 0) delete merged.startupCommands;
      return merged;
    });
    const next = { ...s, workspaceTemplates };
    persist(next);
    return next;
  }),

  deleteWorkspaceTemplate: (id) => set((s) => {
    const workspaceTemplates = (s.workspaceTemplates ?? []).filter((t) => t.id !== id);
    const next = { ...s, workspaceTemplates };
    persist(next);
    return next;
  }),

  // Entry point for "New workspace from template". Defers to a confirmation
  // dialog when the template carries startup commands and asks for confirmation;
  // otherwise creates the workspace (running its commands) right away. Shared by
  // the Command Palette and Settings so the decision lives in one place.
  requestTemplateLaunch: (id) => {
    const tpl = (get().workspaceTemplates ?? []).find((t) => t.id === id);
    if (!tpl) return;
    const hasCommands = !!tpl.startupCommands && Object.keys(tpl.startupCommands).length > 0;
    if (hasCommands && tpl.confirmStartupCommands) {
      set({ pendingTemplateLaunch: { templateId: id }, commandPaletteOpen: false });
    } else {
      get().createWorkspaceFromTemplate(id, true);
      set({ commandPaletteOpen: false });
    }
  },

  // Instantiate a template: clone its layout with fresh ids, remap pane titles,
  // and (optionally) stage startup commands as one-shot pending commands that
  // each pane consumes after it spawns.
  createWorkspaceFromTemplate: (id, includeStartupCommands) => set((s) => {
    const tpl = (s.workspaceTemplates ?? []).find((t) => t.id === id);
    if (!tpl) return s;
    const { layout, paneIdMap } = cloneTemplateLayout(tpl.layout, nextPaneId, nextSplitId);
    const ws: Workspace = { id: nextWsId(), name: tpl.name, cwd: tpl.cwd, layout };
    if (tpl.color) ws.color = tpl.color;
    const paneTitles = remapStringMap(tpl.paneTitles, paneIdMap);
    if (paneTitles) ws.paneTitles = paneTitles;
    if (includeStartupCommands) {
      const pending = remapStringMap(tpl.startupCommands, paneIdMap);
      if (pending) ws.pendingStartupCommands = pending;
    }
    const next = {
      ...s,
      workspaces: [...s.workspaces, ws],
      activeWorkspaceId: ws.id,
      maximizedPaneId: null,
      focusedPaneId: null
    };
    persist(next);
    return next;
  }),

  // Fill an existing (blank) workspace from a template, in place — used by the
  // welcome screen so picking a template doesn't leave the empty workspace
  // behind. Same clone/remap rules as createWorkspaceFromTemplate. Patches in
  // place and does NOT change activeWorkspaceId — the caller targets the
  // already-active workspace. Stale optional fields are deleted when the
  // template omits them (this is why it spreads over the existing object).
  applyTemplateToWorkspace: (workspaceId, templateId, includeStartupCommands) => set((s) => {
    const tpl = (s.workspaceTemplates ?? []).find((t) => t.id === templateId);
    if (!tpl) return s;
    const { layout, paneIdMap } = cloneTemplateLayout(tpl.layout, nextPaneId, nextSplitId);
    const workspaces = s.workspaces.map((w) => {
      if (w.id !== workspaceId) return w;
      const next: Workspace = { ...w, name: tpl.name, cwd: tpl.cwd, layout };
      if (tpl.color) next.color = tpl.color; else delete next.color;
      const paneTitles = remapStringMap(tpl.paneTitles, paneIdMap);
      if (paneTitles) next.paneTitles = paneTitles; else delete next.paneTitles;
      const pending = includeStartupCommands ? remapStringMap(tpl.startupCommands, paneIdMap) : undefined;
      if (pending) next.pendingStartupCommands = pending; else delete next.pendingStartupCommands;
      return next;
    });
    const out = { ...s, workspaces, maximizedPaneId: null, focusedPaneId: null };
    persist(out);
    return out;
  }),

  // Return a pane's pending startup command once, then remove it (persisting so a
  // restart won't re-run it). Returns null when there's nothing pending.
  consumeStartupCommand: (paneId) => {
    const ws = get().workspaces.find((w) => w.pendingStartupCommands?.[paneId]);
    if (!ws) return null;
    const command = ws.pendingStartupCommands![paneId];
    set((s) => {
      const workspaces = s.workspaces.map((w) => {
        if (w.id !== ws.id) return w;
        const rest = { ...w.pendingStartupCommands };
        delete rest[paneId];
        const nextWs: Workspace = { ...w };
        if (Object.keys(rest).length) nextWs.pendingStartupCommands = rest;
        else delete nextWs.pendingStartupCommands;
        return nextWs;
      });
      const next = { ...s, workspaces };
      persist(next);
      return next;
    });
    return command;
  },

  paneTitle: (paneId, fallback) => {
    const ws = get().workspaces.find((w) => w.paneTitles?.[paneId]);
    return ws?.paneTitles?.[paneId] ?? fallback;
  },

  updateShortcutBinding: (action, binding) => set((s) => {
    const shortcutBindings = { ...(s.settings.shortcutBindings ?? {}), [action]: binding };
    const next = { ...s, settings: { ...s.settings, shortcutBindings } };
    persist(next);
    return next;
  }),

  resetShortcutBinding: (action) => set((s) => {
    const shortcutBindings = { ...(s.settings.shortcutBindings ?? {}) };
    delete shortcutBindings[action];
    const settings: Settings = { ...s.settings };
    if (Object.keys(shortcutBindings).length) settings.shortcutBindings = shortcutBindings;
    else delete settings.shortcutBindings;
    const next = { ...s, settings };
    persist(next);
    return next;
  }),

  setShortcutRecordingAction: (action) => set({ shortcutRecordingAction: action }),

  applyUpdateEvent: (e) => set(() => {
    switch (e.type) {
      case 'checking': return { update: { status: 'checking' } };
      case 'available': return { update: { status: 'available', version: e.version } };
      case 'not-available': return { update: { status: 'not-available' } };
      case 'progress': return { update: { status: 'downloading', percent: e.percent } };
      case 'downloaded': return { update: { status: 'downloaded', version: e.version } };
      case 'error': return { update: { status: 'error', error: e.message } };
      case 'disabled': return { update: { status: 'disabled' } };
    }
  }),

  checkForUpdates: () => { set({ update: { status: 'checking' } }); window.api.checkForUpdates(); },
  downloadUpdate: () => { set({ update: { status: 'downloading', percent: 0 } }); window.api.downloadUpdate(); },
  installUpdate: () => window.api.quitAndInstall()
}));
