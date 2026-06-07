import { contextBridge, ipcRenderer } from 'electron';
import type {
  RendererApi, PtySpawnRequest, PtyInputRequest, PtyResizeRequest,
  PtyDataEvent, PtyExitEvent, AppState, UpdateEvent, AgentDonePayload
} from '../shared/types';

// Route pty:data / pty:exit to per-pane subscribers through a SINGLE ipcRenderer
// listener per channel. Registering one ipcRenderer listener per terminal would
// exceed EventEmitter's default max (10) and re-broadcast every chunk to all panes.
const dataSubs = new Map<string, Set<(data: string) => void>>();
const exitSubs = new Map<string, Set<(exitCode: number) => void>>();

ipcRenderer.on('pty:data', (_e, p: PtyDataEvent) => {
  dataSubs.get(p.paneId)?.forEach((cb) => cb(p.data));
});
ipcRenderer.on('pty:exit', (_e, p: PtyExitEvent) => {
  exitSubs.get(p.paneId)?.forEach((cb) => cb(p.exitCode));
});

function subscribe<T>(map: Map<string, Set<T>>, paneId: string, cb: T): () => void {
  let set = map.get(paneId);
  if (!set) {
    set = new Set<T>();
    map.set(paneId, set);
  }
  set.add(cb);
  return () => {
    const s = map.get(paneId);
    if (!s) return;
    s.delete(cb);
    if (s.size === 0) map.delete(paneId);
  };
}

const api: RendererApi = {
  spawn: (req: PtySpawnRequest) => ipcRenderer.invoke('pty:spawn', req),
  input: (req: PtyInputRequest) => ipcRenderer.send('pty:input', req),
  resize: (req: PtyResizeRequest) => ipcRenderer.send('pty:resize', req),
  kill: (paneId: string) => ipcRenderer.send('pty:kill', paneId),
  onData: (paneId: string, cb: (data: string) => void) => subscribe(dataSubs, paneId, cb),
  onExit: (paneId: string, cb: (exitCode: number) => void) => subscribe(exitSubs, paneId, cb),
  loadState: () => ipcRenderer.invoke('state:load') as Promise<AppState>,
  saveState: (state: AppState) => ipcRenderer.invoke('state:save', state),
  pickDirectory: () => ipcRenderer.invoke('dialog:pickDirectory') as Promise<string | null>,
  resolveLink: (rel: string, cwd: string, roots: string[]) =>
    ipcRenderer.invoke('link:resolve', { rel, cwd, roots }) as Promise<string | null>,
  readFile: (path: string) => ipcRenderer.invoke('file:read', path) as Promise<string>,
  loadTasks: (dir: string) => ipcRenderer.invoke('tasks:load', dir) as Promise<import('../shared/tasks-markdown').TaskBoard>,
  saveTasks: (dir, board) => ipcRenderer.send('tasks:save', { dir, board }),
  onTasksChanged: (cb) => {
    const handler = (_e: unknown, p: { dir: string; board: import('../shared/tasks-markdown').TaskBoard }) => cb(p.dir, p.board);
    ipcRenderer.on('tasks:changed', handler);
    return () => ipcRenderer.removeListener('tasks:changed', handler);
  },
  getScrollback: (paneId: string) => ipcRenderer.invoke('scrollback:get', paneId) as Promise<string | null>,
  saveScrollback: (paneId: string, data: string) => ipcRenderer.send('scrollback:save', { paneId, data }),
  checkForUpdates: () => ipcRenderer.send('updates:check'),
  downloadUpdate: () => ipcRenderer.send('updates:download'),
  quitAndInstall: () => ipcRenderer.send('updates:install'),
  onUpdateEvent: (cb: (e: UpdateEvent) => void) => {
    const handler = (_e: unknown, payload: UpdateEvent) => cb(payload);
    ipcRenderer.on('updates:event', handler);
    return () => ipcRenderer.removeListener('updates:event', handler);
  },
  clipboardRead: () => ipcRenderer.invoke('clipboard:read') as Promise<string>,
  clipboardHasImage: () => ipcRenderer.invoke('clipboard:has-image') as Promise<boolean>,
  clipboardWrite: (text: string) => ipcRenderer.send('clipboard:write', text),
  notifyAgentDone: (payload: AgentDonePayload) => ipcRenderer.send('notify:agentDone', payload),
  onWindowFocus: (cb: (focused: boolean) => void) => {
    const handler = (_e: unknown, focused: boolean) => cb(focused);
    ipcRenderer.on('window:focus', handler);
    return () => ipcRenderer.removeListener('window:focus', handler);
  },
  onActivateWorkspace: (cb: (workspaceId: string) => void) => {
    const handler = (_e: unknown, workspaceId: string) => cb(workspaceId);
    ipcRenderer.on('notify:activateWorkspace', handler);
    return () => ipcRenderer.removeListener('notify:activateWorkspace', handler);
  }
};

contextBridge.exposeInMainWorld('api', api);
