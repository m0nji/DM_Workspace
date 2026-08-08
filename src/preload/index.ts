import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { promptNonceFromArgv } from '../shared/prompt-nonce';
import type {
  RendererApi, PtySpawnRequest, PtyInputRequest, PtyResizeRequest,
  PtyDataEvent, PtyExitEvent, AppState, UpdateEvent, AgentDonePayload,
  RemoteAuthStatus, RemoteLoginResult, DevicePairingResult, RemoteProject,
  RemoteUserRuntimeResult, RemoteUserRuntimeStopResult,
  RemoteWorkspaceInfo, RemoteConnectionInfo, RemoteStatusEvent, RemoteDriverEvent,
  RemotePresenceEvent, RemoteFsListResult, RemoteFsReadResult, RemoteFsWriteResult,
  RemoteFsOkResult, ServerConfig
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
  readDir: (path: string) => ipcRenderer.invoke('fs:readdir', path) as Promise<import('../shared/types').DirEntry[]>,
  readTextFile: (path: string) => ipcRenderer.invoke('fs:readText', path) as Promise<import('../shared/types').ReadTextResult>,
  writeTextFile: (path: string, content: string) => ipcRenderer.invoke('fs:writeText', { path, content }) as Promise<void>,
  createFile: (dir: string, name: string) => ipcRenderer.invoke('fs:createFile', { dir, name }) as Promise<import('../shared/types').CreateFileResult>,
  deletePath: (path: string) => ipcRenderer.invoke('fs:delete', path) as Promise<void>,
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
  fetchUpdateNotes: (version: string) => ipcRenderer.invoke('updates:notes', version) as Promise<string | null>,
  onUpdateEvent: (cb: (e: UpdateEvent) => void) => {
    const handler = (_e: unknown, payload: UpdateEvent) => cb(payload);
    ipcRenderer.on('updates:event', handler);
    return () => ipcRenderer.removeListener('updates:event', handler);
  },
  clipboardRead: () => ipcRenderer.invoke('clipboard:read') as Promise<string>,
  clipboardHasImage: () => ipcRenderer.invoke('clipboard:has-image') as Promise<boolean>,
  // Save a clipboard image to a temp PNG and return its absolute path (null if
  // there's no image or the write fails). Lets us insert a file path that any
  // tool can read, instead of relying on the tool to read the OS clipboard.
  clipboardSaveImage: () => ipcRenderer.invoke('clipboard:save-image') as Promise<string | null>,
  clipboardWrite: (text: string) => ipcRenderer.send('clipboard:write', text),
  // Resolve the real filesystem path of a dropped File (Electron 32+ removed
  // File.path; webUtils.getPathForFile is the supported replacement).
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  openExternal: (url: string) => ipcRenderer.send('shell:openExternal', url),
  platform: process.platform,
  disableWebgl: process.env.DMWS_DISABLE_WEBGL === '1',
  isE2E: process.env.DMWS_E2E === '1',
  // Authenticates the local shell prompt marker; '' when absent, which makes
  // the renderer trust no marker at all (see shared/pane-auto-title).
  promptNonce: promptNonceFromArgv(process.argv),
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
  },
  // ---- Remote-Workspaces: alles Token-Handling bleibt im Main-Prozess ----
  authLoginLocal: (serverId: string, username: string, password: string) =>
    ipcRenderer.invoke('auth:loginLocal', { serverId, username, password }) as Promise<RemoteLoginResult>,
  authStartDevicePairing: (serverId: string) =>
    ipcRenderer.invoke('auth:startDevicePairing', { serverId }) as Promise<DevicePairingResult>,
  authLogout: (serverId: string) => ipcRenderer.invoke('auth:logout', { serverId }) as Promise<void>,
  authStatus: (serverId: string) => ipcRenderer.invoke('auth:status', { serverId }) as Promise<RemoteAuthStatus>,
  serverAdd: (server: ServerConfig) => ipcRenderer.invoke('server:add', server) as Promise<void>,
  serverRemove: (serverId: string) => ipcRenderer.invoke('server:remove', { serverId }) as Promise<void>,
  remoteProjects: (serverId: string) =>
    ipcRenderer.invoke('remote:projects', { serverId }) as Promise<RemoteProject[]>,
  remoteUserRuntime: (serverId: string) =>
    ipcRenderer.invoke('remote:userRuntime', { serverId }) as Promise<RemoteUserRuntimeResult>,
  remoteUserRuntimeStop: (serverId: string) =>
    ipcRenderer.invoke('remote:userRuntimeStop', { serverId }) as Promise<RemoteUserRuntimeStopResult>,
  // scopeKey: Projekt-UUID oder 'user' (shared/remote-pane-key.ts).
  remoteConnectWorkspace: (serverId: string, scopeKey: string) =>
    ipcRenderer.invoke('remote:connectWorkspace', { serverId, scopeKey }) as Promise<RemoteWorkspaceInfo>,
  remotePanes: (serverId: string, scopeKey: string) =>
    ipcRenderer.invoke('remote:panes', { serverId, scopeKey }) as Promise<RemoteConnectionInfo | null>,
  remoteDisconnect: (serverId: string, scopeKey: string) =>
    ipcRenderer.send('remote:disconnect', { serverId, scopeKey }),
  remoteDriverRequest: (serverId: string, scopeKey: string, paneId: string) =>
    ipcRenderer.send('remote:driverRequest', { serverId, scopeKey, paneId }),
  remoteDriverRelease: (serverId: string, scopeKey: string, paneId: string) =>
    ipcRenderer.send('remote:driverRelease', { serverId, scopeKey, paneId }),
  remoteDriverApprove: (serverId: string, scopeKey: string, paneId: string, clientId: string) =>
    ipcRenderer.send('remote:driverApprove', { serverId, scopeKey, paneId, clientId }),
  remoteDriverDeny: (serverId: string, scopeKey: string, paneId: string, clientId: string) =>
    ipcRenderer.send('remote:driverDeny', { serverId, scopeKey, paneId, clientId }),
  remotePaneCreate: (serverId: string, scopeKey: string) =>
    ipcRenderer.send('remote:paneCreate', { serverId, scopeKey }),
  remotePaneClose: (serverId: string, scopeKey: string, paneId: string) =>
    ipcRenderer.send('remote:paneClose', { serverId, scopeKey, paneId }),
  onRemoteStatus: (cb: (e: RemoteStatusEvent) => void) => {
    const handler = (_e: unknown, payload: RemoteStatusEvent) => cb(payload);
    ipcRenderer.on('remote:status', handler);
    return () => ipcRenderer.removeListener('remote:status', handler);
  },
  onRemoteDriver: (cb: (e: RemoteDriverEvent) => void) => {
    const handler = (_e: unknown, payload: RemoteDriverEvent) => cb(payload);
    ipcRenderer.on('remote:driver', handler);
    return () => ipcRenderer.removeListener('remote:driver', handler);
  },
  onRemotePresence: (cb: (e: RemotePresenceEvent) => void) => {
    const handler = (_e: unknown, payload: RemotePresenceEvent) => cb(payload);
    ipcRenderer.on('remote:presence', handler);
    return () => ipcRenderer.removeListener('remote:presence', handler);
  },
  // ---- Remote-Dateizugriff (B3): relative Projektpfade, '' = Root ----
  remoteFsList: (serverId: string, projectId: string, path: string) =>
    ipcRenderer.invoke('remoteFs:list', { serverId, projectId, path }) as Promise<RemoteFsListResult>,
  remoteFsRead: (serverId: string, projectId: string, path: string) =>
    ipcRenderer.invoke('remoteFs:read', { serverId, projectId, path }) as Promise<RemoteFsReadResult>,
  remoteFsWrite: (serverId: string, projectId: string, path: string, content: string, baseMtime?: number) =>
    ipcRenderer.invoke('remoteFs:write', { serverId, projectId, path, content, baseMtime }) as Promise<RemoteFsWriteResult>,
  remoteFsMkdir: (serverId: string, projectId: string, path: string) =>
    ipcRenderer.invoke('remoteFs:mkdir', { serverId, projectId, path }) as Promise<RemoteFsOkResult>,
  remoteFsDelete: (serverId: string, projectId: string, path: string) =>
    ipcRenderer.invoke('remoteFs:delete', { serverId, projectId, path }) as Promise<RemoteFsOkResult>,
  remoteFsRename: (serverId: string, projectId: string, from: string, to: string) =>
    ipcRenderer.invoke('remoteFs:rename', { serverId, projectId, from, to }) as Promise<RemoteFsOkResult>
};

contextBridge.exposeInMainWorld('api', api);
