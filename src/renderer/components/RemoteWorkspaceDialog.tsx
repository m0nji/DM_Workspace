import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store';
import { describeIpcError } from '../ipc-error';
import { Icon } from './Icon';
import { USER_SCOPE_KEY } from '../../shared/remote-pane-key';
import type { RemoteProject, RemoteUserRuntimeState, ServerConfig } from '../../shared/types';

// Stabile Referenz für „keine Server": ein `?? []` IM Selector würde bei jedem
// Snapshot ein neues Array liefern — useSyncExternalStore dreht dann durch
// (React #185, maximum update depth).
const NO_SERVERS: ServerConfig[] = [];

// Schlichter „Server -> Ziel wählen"-Flow zum Anlegen eines Remote-Workspace
// (Plan 4.4): oben die persönliche User-Runtime („Persönliche Umgebung",
// Phase D) mit Statusanzeige, darunter die Projektliste vom Server.
// Voraussetzung ist ein konfigurierter, angemeldeter Server (Einstellungen ->
// Konto & Server).

export function RemoteWorkspaceDialog(): React.JSX.Element | null {
  const { t } = useTranslation();
  const open = useStore((s) => s.remoteWorkspaceDialogOpen);
  const setOpen = useStore((s) => s.setRemoteWorkspaceDialogOpen);
  const servers = useStore((s) => s.settings.servers) ?? NO_SERVERS;
  const addRemoteWorkspace = useStore((s) => s.addRemoteWorkspace);

  const [serverId, setServerId] = useState<string | null>(null);
  const [projects, setProjects] = useState<RemoteProject[] | null>(null);
  // null = Status wird noch geladen ODER der Server kennt keine User-Runtimes
  // (älterer Stand ohne /api/runtimes/user) — dann erscheint der Eintrag nicht.
  const [userRuntime, setUserRuntime] = useState<RemoteUserRuntimeState | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Eigener Zustand statt einer Fehlermeldung: fehlende Anmeldung ist der
  // Normalzustand beim ersten Öffnen und verlangt einen Hinweis, kein Rot.
  const [needsLogin, setNeedsLogin] = useState(false);
  // scopeKey des gerade verbindenden Ziels: Projekt-UUID oder 'user'.
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const effectiveServerId = serverId ?? servers[0]?.id ?? null;

  // Projektliste und User-Runtime-Status (neu) laden, sobald der Dialog offen
  // ist und ein Server gewählt wurde; Antworten zu einem inzwischen
  // abgewählten Server verwerfen.
  useEffect(() => {
    if (!open || !effectiveServerId) return;
    let cancelled = false;
    setProjects(null);
    setUserRuntime(null);
    setError(null);
    setNeedsLogin(false);
    window.api.remoteProjects(effectiveServerId).then(
      (list) => { if (!cancelled) setProjects(list); },
      async (err: unknown) => {
        if (cancelled) return;
        // „Noch nicht angemeldet" ist kein Fehler, sondern der Normalzustand
        // beim ersten Öffnen — und es war das Erste, was ein neuer Nutzer
        // überhaupt zu sehen bekam, in Gestalt der rohen IPC-Ausnahme. Der
        // Grund wird deshalb erfragt, statt ihn aus dem (deutschen, in einer
        // englischen Oberfläche falschen) Text der Ausnahme zu raten.
        const status = await window.api.authStatus(effectiveServerId).catch(() => null);
        if (cancelled) return;
        if (status && !status.loggedIn) { setNeedsLogin(true); return; }
        setError(describeIpcError(err));
      }
    );
    // Fehler hier bewusst still (nur der Eintrag fehlt): ein älterer Server
    // ohne User-Runtimes soll die Projektauswahl nicht blockieren.
    window.api.remoteUserRuntime(effectiveServerId).then(
      (res) => { if (!cancelled && res.ok) setUserRuntime(res.status); },
      () => { /* Eintrag bleibt aus */ }
    );
    return () => { cancelled = true; };
  }, [open, effectiveServerId]);

  useEffect(() => {
    if (!open) { setServerId(null); setProjects(null); setUserRuntime(null); setError(null); setNeedsLogin(false); setBusyKey(null); }
  }, [open]);

  if (!open) return null;

  const connectProject = (projectId: string): void => {
    if (!effectiveServerId || busyKey) return;
    setBusyKey(projectId);
    setError(null);
    addRemoteWorkspace(effectiveServerId, { kind: 'project', projectId })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusyKey(null));
  };

  const connectUser = (): void => {
    if (!effectiveServerId || busyKey) return;
    setBusyKey(USER_SCOPE_KEY);
    setError(null);
    // Das Verbinden weckt eine schlafende (oder legt eine neue) Runtime —
    // dieselbe Lazy-Wake-Mechanik wie beim Projekt.
    addRemoteWorkspace(effectiveServerId, { kind: 'user' })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusyKey(null));
  };

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal remote-ws-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>{t('remote.dialogTitle')}</span>
          <button className="modal-close" title={t('common.close')} onClick={() => setOpen(false)}>
            <Icon name="close" size={16} />
          </button>
        </div>

        {servers.length === 0 ? (
          <p className="modal-hint">{t('remote.noServers')}</p>
        ) : (
          <>
            <div className="modal-section-label">{t('remote.chooseServer')}</div>
            <div className="segmented-control" role="group" aria-label={t('remote.chooseServer')}>
              {servers.map((srv) => (
                <button
                  key={srv.id}
                  type="button"
                  className={`segmented-control-item ${effectiveServerId === srv.id ? 'active' : ''}`}
                  onClick={() => setServerId(srv.id)}
                >
                  {srv.name}
                </button>
              ))}
            </div>

            {needsLogin && <p className="modal-hint">{t('remote.notSignedIn')}</p>}
            {error && <div className="setting-error">{error}</div>}

            {userRuntime !== null && (
              <>
                <div className="modal-section-label">{t('remote.userEnvironment')}</div>
                <div className="template-list">
                  <div className="template-row">
                    <span className="template-info">
                      <span className="template-name">{t('remote.userEnvironment')}</span>
                      <span className="template-meta">{t(`remote.userRuntimeStatus.${userRuntime}`)}</span>
                    </span>
                    <button
                      className="cwd-btn"
                      disabled={busyKey !== null}
                      onClick={connectUser}
                    >
                      {busyKey === USER_SCOPE_KEY ? t('remote.connecting') : t('remote.connect')}
                    </button>
                  </div>
                </div>
              </>
            )}

            <div className="modal-section-label">{t('remote.chooseProject')}</div>
            {!error && !needsLogin && projects === null && <p className="modal-hint">{t('remote.loadingProjects')}</p>}
            {projects !== null && projects.length === 0 && (
              <p className="modal-hint">{t('remote.noProjects')}</p>
            )}
            {projects !== null && projects.length > 0 && (
              <div className="template-list">
                {projects.map((p) => (
                  <div className="template-row" key={p.id}>
                    <span className="template-info">
                      <span className="template-name">{p.name}</span>
                      <span className="template-meta">{t(`remote.role.${p.role}`)}</span>
                    </span>
                    <button
                      className="cwd-btn"
                      disabled={busyKey !== null}
                      onClick={() => connectProject(p.id)}
                    >
                      {busyKey === p.id ? t('remote.connecting') : t('remote.connect')}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
