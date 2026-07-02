import { create } from 'zustand';
import type {
  AppState, PresetKind, Direction, Workspace, WorkspaceTemplate, Settings, UpdateEvent, PaneStatus, SettingsSection
} from '../shared/types';
import {
  makePreset, splitPane, closePane, setRatio, collectPaneIds, collectSplitIds
} from '../shared/layout-tree';
import { cloneTemplateLayout, remapStringMap } from '../shared/template-layout';
import { createIdGenerator } from '../shared/ids';
import { DEFAULT_THEME_ID } from '../shared/themes';
import type { ShortcutAction } from '../shared/shortcuts';
import type { PreviewSource } from '../shared/link-detect';
import { focusTerminal } from './terminal-registry';

const DEFAULT_SETTINGS: Settings = {
  themeId: DEFAULT_THEME_ID,
  // 0.95: a hint of window vibrancy while keeping the reserved scrollbar gutter
  // from reading as a band (the WebGL canvas composites translucency a few levels
  // lighter than the CSS-painted gutter; the gap scales with 1-opacity, so a near-
  // opaque terminal makes it imperceptible).
  terminalOpacity: 0.95,
  clickMovesCursor: false,
  showDoneBadge: false,
  notificationsEnabled: false,
  workspaceNavigationPlacement: 'left',
  brandDesign: 'black'
};

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
  taskView: boolean;                 // true => board visible instead of terminals
  tasks: import('../shared/types').TaskBoard | null;
  tasksDir: string | null;           // working dir the loaded board belongs to
  openTaskView: () => Promise<void>;
  closeTaskView: () => void;
  applyTasksChanged: (dir: string, board: import('../shared/types').TaskBoard) => void;
  mutateTasks: (fn: (board: import('../shared/types').TaskBoard) => import('../shared/types').TaskBoard) => void;
  runTaskInPane: (paneId: string, text: string) => void;
  runTaskInNewPane: (text: string) => void;
  commandPaletteOpen: boolean;
  templateWizard: TemplateWizardState;
  pendingTemplateLaunch: { templateId: string; workspaceId?: string } | null;
  shortcutRecordingAction: ShortcutAction | null; // set while the editor captures a key; gates global shortcuts
  previewPanel: {
    open: boolean;
    widthPx: number;
    source: PreviewSource | null;
    tab: 'files' | 'preview';
    browseRoot: string | null; // current folder shown in the Files tab
    editPath: string | null;   // file open in the inline editor (preview tab)
  };
  openPreview: (source: PreviewSource) => void;
  closePreview: () => void;
  togglePreview: () => void;
  setPreviewWidth: (px: number) => void;
  openFiles: () => void;
  setPanelTab: (tab: 'files' | 'preview') => void;
  setBrowseRoot: (path: string) => void;
  openInEditor: (path: string) => void;
  clearEditor: () => void; // drop the inline editor (e.g. its file was deleted)
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
  resizeSplit: (splitId: string, ratio: number, persistNow?: boolean) => void;
  toggleMaximize: (paneId: string) => void;
  // settings
  settingsFocusSection: SettingsSection | null; // when opening, scroll to this section
  updateSettings: (patch: Partial<Settings>) => void;
  setSettingsOpen: (open: boolean, focusSection?: SettingsSection | null) => void;
  clearSettingsFocusSection: () => void;
  setPaneStatus: (paneId: string, status: PaneStatus) => void;
  setPaneCwd: (paneId: string, cwd: string) => void;
  setFocusedPane: (paneId: string) => void;
  setWindowFocused: (focused: boolean) => void;
  setSearchOpen: (paneId: string | null) => void;
  setWorkspaceColor: (id: string, color: string) => void;
  setTasksEnabled: (id: string, enabled: boolean) => void;
  // command palette
  setCommandPaletteOpen: (open: boolean) => void;
  // templates
  setTemplateWizard: (state: TemplateWizardState) => void;
  setPendingTemplateLaunch: (value: { templateId: string; workspaceId?: string } | null) => void;
  saveActiveWorkspaceAsTemplate: (input: SaveTemplateInput) => void;
  updateWorkspaceTemplate: (id: string, patch: Partial<Omit<WorkspaceTemplate, 'id'>>) => void;
  deleteWorkspaceTemplate: (id: string) => void;
  requestTemplateLaunch: (id: string) => void;
  createWorkspaceFromTemplate: (id: string, includeStartupCommands: boolean) => void;
  applyTemplateToWorkspace: (workspaceId: string, templateId: string, includeStartupCommands: boolean) => void;
  launchTemplateIntoWorkspace: (workspaceId: string, templateId: string) => void;
  confirmPendingTemplateLaunch: (includeStartupCommands: boolean) => void;
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

let saveInFlight = false;
let pendingSave: AppState | null = null;

function persistSnapshot(state: AppState): AppState {
  return {
    version: 1,
    workspaces: state.workspaces,
    workspaceTemplates: state.workspaceTemplates ?? [],
    activeWorkspaceId: state.activeWorkspaceId,
    settings: state.settings
  };
}

function flushPersist(snapshot: AppState): void {
  saveInFlight = true;
  void Promise.resolve(window.api.saveState(snapshot))
    .catch((err) => {
      console.error('Failed to save app state:', err);
    })
    .finally(() => {
      const next = pendingSave;
      pendingSave = null;
      if (next) {
        flushPersist(next);
      } else {
        saveInFlight = false;
      }
    });
}

function persist(state: AppState): void {
  const snapshot = persistSnapshot(state);
  if (saveInFlight) {
    pendingSave = snapshot;
    return;
  }
  flushPersist(snapshot);
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
  taskView: false,
  tasks: null,
  tasksDir: null,
  commandPaletteOpen: false,
  templateWizard: { open: false, templateId: null },
  pendingTemplateLaunch: null,
  shortcutRecordingAction: null,
  update: { status: 'idle' },
  previewPanel: { open: false, widthPx: 480, source: null, tab: 'files', browseRoot: null, editPath: null },

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
    // Drop the file-browser folder so the Files tab re-derives it from the newly
    // active workspace's cwd, instead of clinging to the previous workspace's path.
    const next = {
      ...s,
      activeWorkspaceId: id,
      maximizedPaneId: null,
      previewPanel: { ...s.previewPanel, browseRoot: null }
    };
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
    // Fresh pane ids force a TerminalView remount (respawn in the new cwd) —
    // pane-keyed metadata has to follow the id change or titles/pending startup
    // commands would be orphaned under the old keys and persist forever.
    const { layout, paneIdMap } = cloneTemplateLayout(ws.layout, nextPaneId, nextSplitId);
    const workspaces = s.workspaces.map((w) => {
      if (w.id !== id) return w;
      const nextWs: Workspace = { ...w, cwd, layout };
      const paneTitles = remapStringMap(w.paneTitles, paneIdMap);
      if (paneTitles) nextWs.paneTitles = paneTitles; else delete nextWs.paneTitles;
      const pending = remapStringMap(w.pendingStartupCommands, paneIdMap);
      if (pending) nextWs.pendingStartupCommands = pending; else delete nextWs.pendingStartupCommands;
      return nextWs;
    });
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

  resizeSplit: (splitId, ratio, persistNow = true) => set((s) => {
    const workspaces = s.workspaces.map((w) => {
      if (w.id !== s.activeWorkspaceId || !w.layout) return w;
      return { ...w, layout: setRatio(w.layout, splitId, ratio) };
    });
    const next = { ...s, workspaces };
    if (persistNow) persist(next);
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

  openTaskView: async () => {
    const ws = get().activeWorkspace();
    if (!ws) return;
    const dir = ws.cwd;
    // Bind tasksDir synchronously so edits always target the ACTIVE workspace's
    // file, even before the async load resolves (prevents writing to the previous
    // workspace's TASKS.md when switching while the board is open). Clear stale
    // tasks when the dir changes so the board shows "loading" rather than the old
    // workspace's cards.
    set((s) => ({ taskView: true, tasksDir: dir, tasks: s.tasksDir === dir ? s.tasks : null }));
    const board = await window.api.loadTasks(dir);
    // Guard against an out-of-order load if the dir changed again meanwhile.
    if (get().tasksDir === dir) set({ tasks: board });
  },
  closeTaskView: () => set({ taskView: false }),

  // Apply an external file change only when it matches the board we're showing.
  applyTasksChanged: (dir, board) => set((s) => (s.tasksDir === dir ? { tasks: board } : s)),

  // Local edit helper: transform the board, persist to TASKS.md, keep state in sync.
  mutateTasks: (fn) => set((s) => {
    if (!s.tasks || !s.tasksDir) return s;
    const tasks = fn(s.tasks);
    window.api.saveTasks(s.tasksDir, tasks);
    return { ...s, tasks };
  }),

  // Send a task's command/title into a running pane, then reveal terminals and
  // focus that pane. Uses the same input path as startup commands.
  runTaskInPane: (paneId, text) => {
    window.api.input({ paneId, data: `${text}\r` });
    set({ taskView: false, focusedPaneId: paneId });
    // rAF so the pane is un-hidden (display:none -> block) before we focus it.
    requestAnimationFrame(() => focusTerminal(paneId));
  },

  // Create a pane and stage the task text as a one-shot startup command, reusing
  // the proven consumeStartupCommand mechanism. Splits the focused pane (or makes
  // a single pane on the welcome screen).
  runTaskInNewPane: (text) => set((s) => {
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
    if (!ws) return s;
    const newPaneId = nextPaneId();
    let layout;
    if (!ws.layout) {
      layout = { type: 'pane', id: newPaneId } as const;
    } else {
      const ids = collectPaneIds(ws.layout);
      const target = s.focusedPaneId && ids.includes(s.focusedPaneId) ? s.focusedPaneId : ids[0];
      layout = splitPane(ws.layout, target, 'h', newPaneId, nextSplitId());
    }
    const pendingStartupCommands = { ...(ws.pendingStartupCommands ?? {}), [newPaneId]: text };
    const workspaces = s.workspaces.map((w) => w.id === ws.id ? { ...w, layout, pendingStartupCommands } : w);
    const next = { ...s, workspaces, taskView: false, focusedPaneId: newPaneId };
    persist(next);
    return next;
  }),

  openPreview: (source) => set((s) => ({
    previewPanel: { ...s.previewPanel, open: true, tab: 'preview', editPath: null, source }
  })),
  closePreview: () => set((s) => ({ previewPanel: { ...s.previewPanel, open: false } })),
  togglePreview: () => set((s) => ({ previewPanel: { ...s.previewPanel, open: !s.previewPanel.open } })),
  setPreviewWidth: (px) => set((s) => ({
    previewPanel: { ...s.previewPanel, widthPx: Math.min(1200, Math.max(240, px)) }
  })),
  openFiles: () => set((s) => {
    const cwd = s.workspaces.find((w) => w.id === s.activeWorkspaceId)?.cwd ?? '~';
    const browseRoot = s.previewPanel.browseRoot ?? cwd;
    return { previewPanel: { ...s.previewPanel, open: true, tab: 'files', browseRoot, editPath: null } };
  }),
  setPanelTab: (tab) => set((s) => ({ previewPanel: { ...s.previewPanel, tab } })),
  setBrowseRoot: (path) => set((s) => ({ previewPanel: { ...s.previewPanel, browseRoot: path, editPath: null } })),
  openInEditor: (path) => set((s) => ({ previewPanel: { ...s.previewPanel, open: true, tab: 'preview', editPath: path, source: null } })),
  clearEditor: () => set((s) => ({ previewPanel: { ...s.previewPanel, editPath: null, tab: 'files' } })),

  setWorkspaceColor: (id, color) => set((s) => {
    const next = { ...s, workspaces: s.workspaces.map((w) => w.id === id ? { ...w, color } : w) };
    persist(next);
    return next;
  }),

  setTasksEnabled: (id, enabled) => set((s) => {
    const workspaces = s.workspaces.map((w) => w.id === id ? { ...w, tasksEnabled: enabled } : w);
    // If the active workspace just lost tasks, leave the board view.
    const taskView = s.taskView && !(s.activeWorkspaceId === id && !enabled);
    const next = { ...s, workspaces, taskView };
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

  // Welcome-screen entry point: fill the given blank workspace from a template,
  // routing through the confirm dialog first when the template carries startup
  // commands that ask for confirmation.
  launchTemplateIntoWorkspace: (workspaceId, templateId) => {
    const tpl = (get().workspaceTemplates ?? []).find((t) => t.id === templateId);
    if (!tpl) return;
    const hasCommands = !!tpl.startupCommands && Object.keys(tpl.startupCommands).length > 0;
    if (hasCommands && tpl.confirmStartupCommands) {
      set({ pendingTemplateLaunch: { templateId, workspaceId }, commandPaletteOpen: false });
    } else {
      get().applyTemplateToWorkspace(workspaceId, templateId, true);
      set({ commandPaletteOpen: false });
    }
  },

  // Resolve a pending launch from the confirm dialog. If it targets an existing
  // workspace (welcome-screen flow) fill it in place; otherwise create a new one.
  confirmPendingTemplateLaunch: (includeStartupCommands) => {
    const pending = get().pendingTemplateLaunch;
    if (!pending) return;
    if (pending.workspaceId) {
      get().applyTemplateToWorkspace(pending.workspaceId, pending.templateId, includeStartupCommands);
    } else {
      get().createWorkspaceFromTemplate(pending.templateId, includeStartupCommands);
    }
    set({ pendingTemplateLaunch: null });
  },

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
