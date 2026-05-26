import { contextBridge, ipcRenderer } from 'electron';
import type {
  RendererApi, PtySpawnRequest, PtyInputRequest, PtyResizeRequest,
  PtyDataEvent, PtyExitEvent, AppState
} from '../shared/types';

const api: RendererApi = {
  spawn: (req: PtySpawnRequest) => ipcRenderer.invoke('pty:spawn', req),
  input: (req: PtyInputRequest) => ipcRenderer.send('pty:input', req),
  resize: (req: PtyResizeRequest) => ipcRenderer.send('pty:resize', req),
  kill: (paneId: string) => ipcRenderer.send('pty:kill', paneId),
  onData: (cb: (e: PtyDataEvent) => void) => {
    const handler = (_e: unknown, payload: PtyDataEvent) => cb(payload);
    ipcRenderer.on('pty:data', handler);
    return () => ipcRenderer.removeListener('pty:data', handler);
  },
  onExit: (cb: (e: PtyExitEvent) => void) => {
    const handler = (_e: unknown, payload: PtyExitEvent) => cb(payload);
    ipcRenderer.on('pty:exit', handler);
    return () => ipcRenderer.removeListener('pty:exit', handler);
  },
  loadState: () => ipcRenderer.invoke('state:load') as Promise<AppState>,
  saveState: (state: AppState) => ipcRenderer.invoke('state:save', state),
  pickDirectory: () => ipcRenderer.invoke('dialog:pickDirectory') as Promise<string | null>
};

contextBridge.exposeInMainWorld('api', api);
