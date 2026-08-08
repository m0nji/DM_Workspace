import type { RemoteWorkspaceRef, ServerConfig } from '../shared/types';

// Ein Remote-Workspace speichert nur die serverId; Name und baseUrl leben im
// Server-Eintrag der Einstellungen. Wird der Server dort entfernt, bleibt der
// Workspace liegen und ist nicht mehr verbindungsfähig — dafür steht null.
export function remoteServerName(
  servers: ServerConfig[],
  ref: RemoteWorkspaceRef | undefined
): string | null {
  if (!ref) return null;
  return servers.find((s) => s.id === ref.serverId)?.name ?? null;
}
