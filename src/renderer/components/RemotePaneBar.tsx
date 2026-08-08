import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore, remoteConnKey, REMOTE_ERROR_TTL_MS, REMOTE_MAX_PANES } from '../store';
import { USER_SCOPE_KEY, parseRemotePaneKey } from '../../shared/remote-pane-key';
import { ConfirmDialog } from './ConfirmDialog';

// Text zu einer abgelehnten Aktion. Die Codes kommen aus zwei Quellen, die
// unterschiedlich schreiben: der Desktop blockiert vorab mit camelCase
// (RemoteBlockReason), der Server antwortet im Protokoll mit snake_case. Beide
// Schreibweisen zeigen auf denselben Satz — sonst fiele ausgerechnet die
// Server-Antwort auf den allgemeinen Text zurück, und die greift genau dann,
// wenn der Preflight danebenlag. Unbekannte Codes bleiben sichtbar.
const ERROR_TEXT = {
  forbidden: 'remote.actionForbidden',
  viewer: 'remote.actionForbidden',
  offline: 'remote.actionOffline',
  paneLimit: 'remote.actionPaneLimit',
  lastPane: 'remote.actionLastPane',
  pane_limit: 'remote.actionPaneLimit',
  last_pane: 'remote.actionLastPane',
  unknown_pane: 'remote.actionUnknownPane'
} as const;

// Schmale Statusleiste über jeder Remote-Pane (Plan 4.4): Verbindungsstatus,
// Driver-Anzeige mit Anfordern/Abgeben, Approve/Deny für wartende Anfragen
// (wenn man selbst Driver ist) und Presence (wer ist da, wer fährt).
// Ohne Schreibrecht wird Input bereits in TerminalView lokal verworfen — die
// Leiste macht sichtbar, warum.
//
// In der persönlichen User-Runtime (scopeKey 'user') kommt ein „Umgebung
// stoppen"-Button dazu — das Gegenstück zum 4205-„Wecken": der Server stoppt
// den Container und schließt die Verbindung mit 4205 (Status runtime-stopped).

interface Props { paneId: string; }

export function RemotePaneBar({ paneId }: Props): React.JSX.Element | null {
  const { t } = useTranslation();
  const ref = parseRemotePaneKey(paneId);
  const conn = useStore((s) => (ref ? s.remote[remoteConnKey(ref.serverId, ref.scopeKey)] : undefined));
  const clearRemoteError = useStore((s) => s.clearRemoteError);
  const [confirmStop, setConfirmStop] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);

  // Rückmeldung des Servers bzw. des Stores zu einer abgelehnten Aktion (z. B.
  // pane.create bei Rolle 'viewer') — das Sicherheitsnetz für den Fall, dass der
  // Preflight-Check die Rolle noch nicht kennt (Race zwischen Rollenwechsel und
  // Klick). paneId grenzt die Meldung auf die betroffene Pane ein, damit eine
  // Ablehnung für Pane B nicht auch in Pane A aufploppt; ohne paneId (Ereignis
  // ohne Pane-Bezug) gilt sie für jede offene Pane der Verbindung.
  const lastError = conn?.lastError ?? null;
  const serverId = ref?.serverId;
  const scopeKey = ref?.scopeKey;
  // Selbstauflösung: ohne sie bliebe eine einmalige Ablehnung (rate_limited,
  // not_driver …) dauerhaft rot stehen, solange kein panes-/connection-Ereignis
  // mehr kommt — auf einer stabilen Verbindung also für immer.
  useEffect(() => {
    if (!lastError || !serverId || scopeKey === undefined) return;
    const rest = Math.max(0, lastError.at + REMOTE_ERROR_TTL_MS - Date.now());
    const id = setTimeout(() => clearRemoteError(serverId, scopeKey), rest);
    return () => clearTimeout(id);
  }, [lastError, serverId, scopeKey, clearRemoteError]);

  if (!ref) return null;

  const status = conn?.status ?? 'closed';
  const clientId = conn?.clientId ?? null;
  const pane = conn?.panes.find((p) => p.paneId === ref.remotePaneId);
  const presence = conn?.presence ?? [];
  const isDriver = !!pane && !!clientId && pane.driver === clientId;
  const inQueue = !!pane && !!clientId && pane.driverQueue.includes(clientId);
  const denied = conn?.deniedPaneId === ref.remotePaneId;
  const errorApplies = !!lastError
    && (!lastError.paneId || lastError.paneId === ref.remotePaneId)
    && Date.now() - lastError.at < REMOTE_ERROR_TTL_MS;
  const errorText = errorApplies && lastError
    ? t(ERROR_TEXT[lastError.code as keyof typeof ERROR_TEXT] ?? 'remote.actionRejected',
        { max: REMOTE_MAX_PANES })
    : null;
  const nameOf = (cid: string): string => presence.find((u) => u.clientId === cid)?.name ?? cid;

  const requestDriver = (): void =>
    window.api.remoteDriverRequest(ref.serverId, ref.scopeKey, ref.remotePaneId);
  const releaseDriver = (): void =>
    window.api.remoteDriverRelease(ref.serverId, ref.scopeKey, ref.remotePaneId);
  const reconnect = (): void =>
    useStore.getState().reconnectRemote(ref.serverId, ref.scopeKey);
  const stopRuntime = (): void => {
    setConfirmStop(false);
    setStopError(null);
    // Der Statuswechsel kommt als 4205-Close über remote:status zurück; hier
    // nur Fehler anzeigen (z. B. Session abgelaufen).
    void window.api.remoteUserRuntimeStop(ref.serverId).then((res) => {
      if (!res.ok) setStopError(res.error);
    });
  };

  let driverLabel: string;
  if (isDriver) driverLabel = t('remote.driverYou');
  else if (pane?.driver) driverLabel = t('remote.driverOther', { name: nameOf(pane.driver) });
  else driverLabel = t('remote.driverNone');

  const isUserScope = ref.scopeKey === USER_SCOPE_KEY;
  const showWake = status === 'runtime-stopped';
  const showReconnect = status === 'closed' || status === 'kicked';

  return (
    <div className="remote-bar" data-status={status}>
      <span className={`remote-status remote-status-${status}`} title={t('remote.statusTitle')}>
        <span className="remote-status-dot" aria-hidden />
        {t(`remote.status.${status}`)}
      </span>
      {status === 'kicked' && <span className="remote-hint">{t('remote.kickedHint')}</span>}
      {showWake && (
        <button className="cwd-btn remote-bar-btn" onClick={reconnect}>{t('remote.wake')}</button>
      )}
      {showReconnect && (
        <button className="cwd-btn remote-bar-btn" onClick={reconnect}>{t('remote.reconnect')}</button>
      )}

      <span className="remote-driver">{driverLabel}</span>
      {status === 'connected' && pane && (
        isDriver ? (
          <button className="cwd-btn remote-bar-btn" onClick={releaseDriver}>{t('remote.releaseDriver')}</button>
        ) : inQueue ? (
          <span className="remote-hint">{t('remote.requestPending')}</span>
        ) : (
          <button className="cwd-btn remote-bar-btn" onClick={requestDriver}>{t('remote.requestDriver')}</button>
        )
      )}
      {denied && <span className="remote-hint remote-denied">{t('remote.requestDenied')}</span>}
      {errorText && <span className="remote-hint remote-denied">{errorText}</span>}

      {/* Wartende Driver-Anfragen: der aktuelle Driver entscheidet. */}
      {isDriver && pane && pane.driverQueue.length > 0 && (
        <span className="remote-queue">
          {pane.driverQueue.map((cid) => (
            <span className="remote-queue-entry" key={cid}>
              <span className="remote-queue-name">{t('remote.queueRequest', { name: nameOf(cid) })}</span>
              <button
                className="cwd-btn remote-bar-btn"
                onClick={() => window.api.remoteDriverApprove(ref.serverId, ref.scopeKey, ref.remotePaneId, cid)}
              >{t('remote.approve')}</button>
              <button
                className="cwd-btn remote-bar-btn ghost"
                onClick={() => window.api.remoteDriverDeny(ref.serverId, ref.scopeKey, ref.remotePaneId, cid)}
              >{t('remote.deny')}</button>
            </span>
          ))}
        </span>
      )}

      {isUserScope && status === 'connected' && (
        <button className="cwd-btn remote-bar-btn ghost" onClick={() => setConfirmStop(true)}>
          {t('remote.stopRuntime')}
        </button>
      )}
      {stopError && <span className="remote-hint remote-denied">{stopError}</span>}

      <span className="remote-presence" title={t('remote.presenceTitle')}>
        {presence.map((u) => (
          <span
            className={`remote-presence-user ${pane?.driver === u.clientId ? 'driving' : ''}`}
            key={u.clientId}
            style={{ borderColor: u.color }}
            title={pane?.driver === u.clientId ? t('remote.presenceDriver', { name: u.name }) : u.name}
          >{u.name}</span>
        ))}
      </span>

      {confirmStop && (
        <ConfirmDialog
          title={t('remote.stopRuntime')}
          message={t('remote.stopRuntimeConfirm')}
          confirmLabel={t('remote.stopRuntimeAction')}
          tone="danger"
          onConfirm={stopRuntime}
          onCancel={() => setConfirmStop(false)}
        />
      )}
    </div>
  );
}
