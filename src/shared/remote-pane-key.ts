// Namespacing der Pane-Schlüssel von Remote-Workspaces (Plan 4.4): Die Panes
// einer Server-Verbindung leben im lokalen Layout unter
// `r:<serverId>:<scopeKey>:<paneId>`. Das verhindert Kollisionen mit lokalen
// Pane-Ids (p1, p2, …) in procs/dataSubs/scrollback.json und macht aus dem
// Schlüssel selbst ablesbar, zu welcher Verbindung eine Pane gehört — der
// Renderer braucht dafür keinen Zusatz-Lookup.
//
// scopeKey identifiziert den Geltungsbereich der Verbindung innerhalb eines
// Servers: die Projekt-UUID (geteilte Projekt-Runtime) oder der reservierte
// Bezeichner USER_SCOPE_KEY = 'user' (persönliche User-Runtime, Phase D —
// bewusst ohne Id, der Server kennt nur die eigene Runtime des angemeldeten
// Nutzers). Kollisionsfrei, weil der Server Projekt-Ids ausschließlich als
// UUIDs vergibt und beim WS-Upgrade auch nur UUIDs akzeptiert.
//
// serverId wird lokal vergeben (ids.ts, kein ':'), der scopeKey enthält nie
// ':' (UUID bzw. 'user'), paneId ist eine Server-Pane-Id ('p1'). Beim Parsen
// wird von links getrennt und der Rest der paneId zugeschlagen, damit auch
// ein ':' in einer künftigen Server-Pane-Id nichts zerreißt.

import type { SpawnTargetScope } from './types';

export interface RemotePaneRef {
  serverId: string;
  scopeKey: string;
  remotePaneId: string;
}

const PREFIX = 'r:';

// Reservierter scopeKey der persönlichen User-Runtime.
export const USER_SCOPE_KEY = 'user';

// SpawnTargetScope -> Schlüsselsegment ('user' bzw. Projekt-UUID).
export function remoteScopeKey(scope: SpawnTargetScope): string {
  return scope.kind === 'user' ? USER_SCOPE_KEY : scope.projectId;
}

// Schlüsselsegment -> SpawnTargetScope (Umkehrung von remoteScopeKey).
export function remoteScopeFromKey(scopeKey: string): SpawnTargetScope {
  return scopeKey === USER_SCOPE_KEY ? { kind: 'user' } : { kind: 'project', projectId: scopeKey };
}

export function remotePaneKey(serverId: string, scopeKey: string, remotePaneId: string): string {
  return `${PREFIX}${serverId}:${scopeKey}:${remotePaneId}`;
}

export function isRemotePaneKey(paneId: string): boolean {
  return paneId.startsWith(PREFIX);
}

export function parseRemotePaneKey(paneId: string): RemotePaneRef | null {
  if (!paneId.startsWith(PREFIX)) return null;
  const rest = paneId.slice(PREFIX.length);
  const first = rest.indexOf(':');
  if (first <= 0) return null;
  const second = rest.indexOf(':', first + 1);
  if (second <= first + 1 || second === rest.length - 1) return null;
  return {
    serverId: rest.slice(0, first),
    scopeKey: rest.slice(first + 1, second),
    remotePaneId: rest.slice(second + 1)
  };
}
