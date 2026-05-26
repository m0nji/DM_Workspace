import { create } from 'zustand';
import type {
  AppState, PresetKind, Direction, Workspace, Settings, UpdateEvent, PaneStatus
} from '../shared/types';
import {
  makePreset, splitPane, closePane, setRatio, collectPaneIds, collectSplitIds
} from '../shared/layout-tree';
import { createIdGenerator } from '../shared/ids';
import { DEFAULT_THEME_ID } from '../shared/themes';

const DEFAULT_SETTINGS: Settings = { themeId: DEFAULT_THEME_ID, terminalOpacity: 0.75, showDoneBadge: false };

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

interface StoreState extends AppState {
  maximizedPaneId: string | null;
  hydrated: boolean;
  settingsOpen: boolean;
  paneStatus: Record<string, PaneStatus>;
  focusedPaneId: string | null;
  windowFocused: boolean;
  searchOpenPaneId: string | null;
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
  updateSettings: (patch: Partial<Settings>) => void;
  setSettingsOpen: (open: boolean) => void;
  setPaneStatus: (paneId: string, status: PaneStatus) => void;
  setFocusedPane: (paneId: string) => void;
  setWindowFocused: (focused: boolean) => void;
  setSearchOpen: (paneId: string | null) => void;
  setWorkspaceColor: (id: string, color: string) => void;
  // updates
  update: UpdateState;
  applyUpdateEvent: (e: UpdateEvent) => void;
  checkForUpdates: () => void;
  downloadUpdate: () => void;
  installUpdate: () => void;
}

function persist(state: AppState): void {
  void window.api.saveState({
    version: 1,
    workspaces: state.workspaces,
    activeWorkspaceId: state.activeWorkspaceId,
    settings: state.settings
  });
}

export const useStore = create<StoreState>((set, get) => ({
  version: 1,
  workspaces: [],
  activeWorkspaceId: null,
  settings: DEFAULT_SETTINGS,
  maximizedPaneId: null,
  hydrated: false,
  settingsOpen: false,
  paneStatus: {},
  focusedPaneId: null,
  windowFocused: true,
  searchOpenPaneId: null,
  update: { status: 'idle' },

  hydrate: async () => {
    const loaded = await window.api.loadState();
    // Seed the id generators past ids already used by the restored layout, so the
    // next split/workspace can't reuse an existing id (which would make two panes
    // share a paneId — colliding PTYs and duplicated scrollback replay).
    nextPaneId.seed(loaded.workspaces.flatMap((w) => collectPaneIds(w.layout)));
    nextSplitId.seed(loaded.workspaces.flatMap((w) => collectSplitIds(w.layout)));
    nextWsId.seed(loaded.workspaces.map((w) => w.id));
    set({ ...loaded, hydrated: true });
  },

  activeWorkspace: () => get().workspaces.find((w) => w.id === get().activeWorkspaceId),

  selectWorkspace: (id) => set({ activeWorkspaceId: id, maximizedPaneId: null }),

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

  setWorkspaceCwd: (id, cwd) => set((s) => {
    const next = { ...s, workspaces: s.workspaces.map((w) => w.id === id ? { ...w, cwd } : w) };
    persist(next);
    return next;
  }),

  deleteWorkspace: (id) => set((s) => {
    const ws = s.workspaces.find((w) => w.id === id);
    const paneStatus = { ...s.paneStatus };
    if (ws?.layout) collectPaneIds(ws.layout).forEach((pid) => { window.api.kill(pid); delete paneStatus[pid]; });
    const workspaces = s.workspaces.filter((w) => w.id !== id);
    const activeWorkspaceId = s.activeWorkspaceId === id
      ? (workspaces[0]?.id ?? null)
      : s.activeWorkspaceId;
    const next = { ...s, workspaces, paneStatus, activeWorkspaceId, maximizedPaneId: null };
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
    const workspaces = s.workspaces.map((w) => {
      if (w.id !== s.activeWorkspaceId || !w.layout) return w;
      return { ...w, layout: closePane(w.layout, paneId) };
    });
    const next = {
      ...s,
      workspaces,
      paneStatus,
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

  setSettingsOpen: (open) => set({ settingsOpen: open }),

  setPaneStatus: (paneId, status) => set((s) => {
    if (s.paneStatus[paneId] === status) return s;
    const paneStatus = { ...s.paneStatus, [paneId]: status };
    // Notify only when the pane is NOT visible (inactive workspace) OR the window
    // is unfocused — otherwise the user is already looking at it. The transition
    // into 'done' happens once until the user reacts (input resets to idle), which
    // debounces repeat notifications for the same pane.
    if (status === 'done') {
      const ws = s.workspaces.find((w) => collectPaneIds(w.layout).includes(paneId));
      const visible = ws != null && ws.id === s.activeWorkspaceId;
      if (ws && (!visible || !s.windowFocused)) {
        window.api.notifyAgentDone({ workspaceId: ws.id, workspaceName: ws.name, paneTitle: ws.cwd });
      }
    }
    return { ...s, paneStatus };
  }),

  setFocusedPane: (paneId) => set({ focusedPaneId: paneId }),
  setWindowFocused: (focused) => set({ windowFocused: focused }),
  setSearchOpen: (paneId) => set({ searchOpenPaneId: paneId }),

  setWorkspaceColor: (id, color) => set((s) => {
    const next = { ...s, workspaces: s.workspaces.map((w) => w.id === id ? { ...w, color } : w) };
    persist(next);
    return next;
  }),

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
