import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { remoteConnKey, tasksAvailable, useStore, workspaceScopeKey, type RemoteTasksState } from '../store';
import type {
  RemoteTask, RemoteTaskAccess, RemoteTaskError, RemoteTaskRun, RemoteProjectMember
} from '../../shared/types';
import {
  DEFAULT_SCHEDULE_PARTS, SCHEDULE_FREQUENCIES, buildTaskBody, formatTaskSchedule, parseSchedule,
  type ScheduleFrequency, type ScheduleParts
} from '../task-schedule';
import { describeTaskError } from '../task-error';
import { formatDateTime } from '../task-datetime';
import { toAbsPath } from '../workdir-path';
import { Icon } from './Icon';
import { ConfirmDialog } from './ConfirmDialog';
import { DirectoryPickerDialog } from './DirectoryPickerDialog';

// Panel für geplante Agenten-Tasks eines Remote-Projekts (Arbeitspaket B,
// Aufgabe 4). Drei Bereiche wie im Web-Client (DM_Workspace_Web/web/src/views/
// TasksPanel.tsx, das ausdrückliche Vorbild dieses Auftrags): Liste, Verlauf
// mit Live-Protokoll, Formular. Sichtbarkeit ausschließlich über
// tasksAvailable() aus dem Store — siehe dort für die drei Stufen.

interface TaskScope { serverId: string; scopeKey: string; }

type TaskState = 'active' | 'paused' | 'running';

function taskState(task: RemoteTask): TaskState {
  if (task.lastRun?.status === 'running') return 'running';
  return task.enabled ? 'active' : 'paused';
}

// Innerer Anzeigezustand des Panels — ein Bereich ist jeweils gemountet, nie
// mehrere gleichzeitig. Das Verlassen von 'detail' (Zurück, Server-Wechsel,
// Schließen) hängt daher automatisch den Log-Abonnenten in RunLogView aus
// (React-Unmount), ohne eigenen Aufräumcode an jeder Stelle.
type View =
  | { mode: 'list' }
  | { mode: 'detail'; taskId: string }
  | { mode: 'form'; taskId: string | null }; // null = neuer Task

export function TasksPanel(): React.JSX.Element | null {
  const { t } = useTranslation();
  const available = useStore(tasksAvailable);
  const open = useStore((s) => s.tasksPanelOpen);
  const setOpen = useStore((s) => s.setTasksPanelOpen);
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId);
  const loadRemoteTasks = useStore((s) => s.loadRemoteTasks);
  const loadRemoteMembers = useStore((s) => s.loadRemoteMembers);
  const ws = useStore((s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId));

  const scope: TaskScope | null = ws?.kind === 'remote' && ws.remote
    ? { serverId: ws.remote.serverId, scopeKey: workspaceScopeKey(ws.remote) }
    : null;
  const key = scope ? remoteConnKey(scope.serverId, scope.scopeKey) : null;
  const entry = useStore((s) => (key ? s.remoteTasks[key] : undefined));
  const membersEntry = useStore((s) => (key ? s.remoteMembers[key] : undefined));
  // Starten/Abbrechen ist KEINE Ableitung aus der Projektrolle — der Server
  // liefert access.canRun eigens (GET .../tasks), und der Client baut die
  // Regel nicht nach (siehe RemoteTaskAccess in shared/types.ts). Solange die
  // Liste noch nicht geladen ist (entry === undefined), bleibt canRun false —
  // die Knöpfe sind gesperrt statt kurz freigeschaltet.
  const canRun = entry?.access?.canRun ?? false;

  const [view, setView] = useState<View>({ mode: 'list' });

  // Verschwindet die Voraussetzung während das Panel offen ist (z. B.
  // Verbindungsabbruch), schließt es sich selbst — sonst bliebe ein
  // verwaistes Panel für einen nicht mehr sichtbaren Bereich offen.
  useEffect(() => {
    if (open && !available) setOpen(false);
  }, [open, available, setOpen]);

  useEffect(() => {
    if (!(open && available && activeWorkspaceId)) return;
    void loadRemoteTasks(activeWorkspaceId);
    void loadRemoteMembers(activeWorkspaceId);
  }, [open, available, activeWorkspaceId, loadRemoteTasks, loadRemoteMembers]);

  // Zurück zur Liste beim Schließen und bei jedem Wechsel des Projekt-Scopes —
  // sonst zeigte ein späteres Wiederöffnen (oder ein Workspace-Wechsel bei
  // offenem Panel) den Verlauf/das Formular eines fremden Workspace weiter an.
  // Der Wechsel hängt dabei automatisch RunLogView aus (Unmount), das meldet
  // sich in seinem Cleanup vom Protokoll ab.
  useEffect(() => {
    setView({ mode: 'list' });
  }, [open, key]);

  if (!open || !available || !scope) return null;

  const tasks = entry?.tasks ?? [];
  const activeTask = view.mode !== 'list' && view.taskId ? tasks.find((tt) => tt.id === view.taskId) ?? null : null;

  return (
    <div className="modal-backdrop" onMouseDown={() => setOpen(false)}>
      <div className="modal tasks-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          {view.mode === 'list' ? (
            <span>{t('tasks.scheduled.panel.title')}</span>
          ) : (
            <button type="button" className="tasks-back-btn" onClick={() => setView({ mode: 'list' })}>
              <Icon name="back" size={14} />{t('tasks.scheduled.panel.backToList')}
            </button>
          )}
          <button className="modal-close" title={t('common.close')} onClick={() => setOpen(false)}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="tasks-body">
          {view.mode === 'list' && (
            <TasksList
              scope={scope}
              entry={entry}
              members={membersEntry?.members ?? []}
              canRun={canRun}
              onReload={() => void loadRemoteTasks(activeWorkspaceId!)}
              onOpenDetail={(taskId) => setView({ mode: 'detail', taskId })}
              onOpenForm={(taskId) => setView({ mode: 'form', taskId })}
            />
          )}
          {view.mode === 'detail' && (
            activeTask
              ? <TaskDetail scope={scope} task={activeTask} canRun={canRun} />
              : <p className="modal-hint">{t('tasks.scheduled.error.notFound')}</p>
          )}
          {view.mode === 'form' && (
            <TaskForm
              scope={scope}
              task={view.taskId ? activeTask : null}
              access={entry?.access ?? null}
              members={membersEntry?.members ?? []}
              membersError={membersEntry?.error ?? null}
              onDone={() => setView({ mode: 'list' })}
              onCancel={() => setView({ mode: 'list' })}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Liste ------------------------------------------------------------------

interface TasksListProps {
  scope: TaskScope;
  entry: RemoteTasksState | undefined;
  members: RemoteProjectMember[];
  canRun: boolean;
  onReload: () => void;
  onOpenDetail: (taskId: string) => void;
  onOpenForm: (taskId: string | null) => void;
}

// Die Liste zeigte bisher die rohe Nutzer-UUID — dieselbe Kennung, die das
// Formular gerade abgeschafft hat.
function memberName(members: RemoteProjectMember[], ownerId: string | null, t: TFunction): string {
  if (!ownerId) return t('tasks.scheduled.list.ownerNone');
  return members.find((m) => m.userId === ownerId)?.displayName ?? t('tasks.scheduled.list.ownerUnknown');
}

function TasksList({ scope, entry, members, canRun, onReload, onOpenDetail, onOpenForm }: TasksListProps): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const tasks = entry?.tasks ?? [];
  const canManage = entry?.access?.canManage ?? false;
  // canRun (Starten) ist eine eigene, vom Server berechnete Berechtigung
  // (access.canRun) — unabhängig von canManage, siehe taskAccess() im Server.
  // Die Runtime ist je Projekt geteilt: es läuft immer nur ein Lauf gleichzeitig.
  const anyRunning = tasks.some((tt) => tt.lastRun?.status === 'running');

  const [pendingDelete, setPendingDelete] = useState<RemoteTask | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const clearRowError = (taskId: string): void =>
    setRowErrors((prev) => { if (!(taskId in prev)) return prev; const next = { ...prev }; delete next[taskId]; return next; });
  const setRowError = (taskId: string, message: string): void =>
    setRowErrors((prev) => ({ ...prev, [taskId]: message }));

  const start = async (task: RemoteTask): Promise<void> => {
    clearRowError(task.id);
    setBusyId(task.id);
    const res = await window.api.remoteTasksRun(scope.serverId, scope.scopeKey, task.id);
    setBusyId(null);
    if (!res.ok) setRowError(task.id, describeTaskError(res, t));
    // Erfolg: kein manuelles Nachladen nötig — task.run.started/finished laufen
    // über denselben Push-Kanal wie die Liste (applyRemoteTask, in App.tsx
    // abonniert) und spiegeln sich automatisch in task.lastRun.
  };

  const togglePause = async (task: RemoteTask): Promise<void> => {
    clearRowError(task.id);
    setBusyId(task.id);
    const res = await window.api.remoteTasksUpdate(scope.serverId, scope.scopeKey, task.id, { enabled: !task.enabled });
    setBusyId(null);
    if (!res.ok) setRowError(task.id, describeTaskError(res, t));
  };

  const confirmDelete = async (): Promise<void> => {
    const task = pendingDelete;
    if (!task) return;
    setPendingDelete(null);
    clearRowError(task.id);
    setBusyId(task.id);
    const res = await window.api.remoteTasksRemove(scope.serverId, scope.scopeKey, task.id);
    setBusyId(null);
    if (!res.ok) setRowError(task.id, describeTaskError(res, t));
  };

  return (
    <>
      <div className="tasks-toolbar">
        <span className="tasks-toolbar-spacer" />
        <button type="button" className="icon-btn" title={t('tasks.scheduled.panel.retry')} onClick={onReload}>
          <Icon name="reload" />
        </button>
        <button
          type="button"
          className="confirm-btn primary"
          disabled={!canManage}
          title={canManage ? t('tasks.scheduled.panel.newTask') : t('tasks.scheduled.blocked.manage')}
          onClick={() => onOpenForm(null)}
        >{t('tasks.scheduled.panel.newTask')}</button>
      </div>

      {/* Auch der Ladefehler zeigt die Servermeldung, wenn eine mitkam — hier,
          wo die Liste leer bleibt, ist sie die einzige Begründung. */}
      {entry?.error && <div className="setting-error">{describeTaskError(entry.error, t)}</div>}
      {(entry?.loading ?? false) && tasks.length === 0 && <p className="modal-hint">{t('tasks.scheduled.panel.loading')}</p>}
      {!(entry?.loading ?? false) && tasks.length === 0 && !entry?.error && (
        <p className="modal-hint">{t('tasks.scheduled.panel.empty')}</p>
      )}

      <div className="tasks-list">
        {tasks.map((task) => {
          const state = taskState(task);
          const startBlocked: 'run' | 'alreadyRunning' | null = !canRun ? 'run' : anyRunning ? 'alreadyRunning' : null;
          const manageBlocked = !canManage;
          return (
            <div className="tasks-row" key={task.id}>
              <div className="tasks-row-head">
                <button
                  type="button"
                  className="tasks-row-name"
                  title={t('tasks.scheduled.action.viewHistory')}
                  onClick={() => onOpenDetail(task.id)}
                >{task.name}</button>
                <span className="tasks-agent-badge">{t(`tasks.scheduled.agent.${task.agent}`)}</span>
                <span className="tasks-state">
                  <span className={`status-dot ${state === 'running' ? 'busy' : state === 'active' ? 'done' : 'idle'}`} />
                  {t(`tasks.scheduled.state.${state}`)}
                </span>
              </div>
              <div className="tasks-row-meta">
                <span>{formatTaskSchedule(task, t)}</span>
                <span>{t('tasks.scheduled.list.nextRun')}: {task.enabled ? formatDateTime(task.nextRunAt, i18n.language) : t('tasks.scheduled.list.noNextRun')}</span>
                <span>
                  {t('tasks.scheduled.list.lastRun')}: {task.lastRun
                    ? `${t(`tasks.scheduled.runStatus.${task.lastRun.status}`)} · ${formatDateTime(task.lastRun.startedAt, i18n.language)}`
                    : t('tasks.scheduled.list.lastRunNone')}
                </span>
                <span>{t('tasks.scheduled.list.owner')}: {memberName(members, task.ownerId, t)}</span>
              </div>
              <div className="tasks-row-actions">
                <button
                  type="button"
                  className="confirm-btn"
                  disabled={busyId === task.id || startBlocked !== null}
                  title={startBlocked ? t(`tasks.scheduled.blocked.${startBlocked}`) : t('tasks.scheduled.action.start')}
                  onClick={() => void start(task)}
                >{t('tasks.scheduled.action.start')}</button>
                <button
                  type="button"
                  className="confirm-btn"
                  disabled={busyId === task.id || manageBlocked}
                  title={manageBlocked ? t('tasks.scheduled.blocked.manage') : t('tasks.scheduled.action.edit')}
                  onClick={() => onOpenForm(task.id)}
                >{t('tasks.scheduled.action.edit')}</button>
                <button
                  type="button"
                  className="confirm-btn"
                  disabled={busyId === task.id || manageBlocked}
                  title={manageBlocked ? t('tasks.scheduled.blocked.manage') : t(task.enabled ? 'tasks.scheduled.action.pause' : 'tasks.scheduled.action.resume')}
                  onClick={() => void togglePause(task)}
                >{t(task.enabled ? 'tasks.scheduled.action.pause' : 'tasks.scheduled.action.resume')}</button>
                <button
                  type="button"
                  className="confirm-btn confirm-btn-danger"
                  disabled={busyId === task.id || manageBlocked}
                  title={manageBlocked ? t('tasks.scheduled.blocked.manage') : t('tasks.scheduled.action.delete')}
                  onClick={() => setPendingDelete(task)}
                >{t('tasks.scheduled.action.delete')}</button>
              </div>
              {rowErrors[task.id] && <div className="tasks-row-error">{rowErrors[task.id]}</div>}
            </div>
          );
        })}
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title={t('tasks.scheduled.confirm.deleteTitle')}
          message={t('tasks.scheduled.confirm.deleteMessage', { name: pendingDelete.name })}
          confirmLabel={t('common.delete')}
          tone="danger"
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </>
  );
}

// ---- Verlauf + Live-Protokoll ------------------------------------------------

function TaskDetail({ scope, task, canRun }: { scope: TaskScope; task: RemoteTask; canRun: boolean }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const [runs, setRuns] = useState<RemoteTaskRun[] | null>(null);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRuns(null);
    setRunsError(null);
    setSelectedRunId(null);
    void window.api.remoteTasksListRuns(scope.serverId, scope.scopeKey, task.id).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setRuns(res.runs);
        setSelectedRunId(res.runs[0]?.id ?? null);
      } else {
        setRunsError(describeTaskError(res, t));
        setRuns([]);
      }
    });
    return () => { cancelled = true; };
  }, [scope.serverId, scope.scopeKey, task.id, t]);

  // Live: derselbe Push-Kanal wie die Liste (applyRemoteTask, kind 'run')
  // spiegelt einen neuen/beendeten Lauf bereits in task.lastRun — hier nur
  // beobachtet, um die Verlaufsliste ohne Neuladen aktuell zu halten.
  const lastRun = useStore((s) => {
    const connKey = remoteConnKey(scope.serverId, scope.scopeKey);
    return s.remoteTasks[connKey]?.tasks.find((tt) => tt.id === task.id)?.lastRun ?? null;
  });
  useEffect(() => {
    if (!lastRun) return;
    setRuns((rs) => {
      if (!rs) return rs;
      const idx = rs.findIndex((r) => r.id === lastRun.id);
      return idx >= 0 ? rs.map((r, i) => (i === idx ? lastRun : r)) : [lastRun, ...rs];
    });
    // Ein frisch gestarteter Lauf wird automatisch ausgewählt — das ist der,
    // den man gerade live mitverfolgen möchte.
    if (lastRun.status === 'running') setSelectedRunId(lastRun.id);
  }, [lastRun]);

  const selectedRun = runs?.find((r) => r.id === selectedRunId) ?? null;

  return (
    <div className="tasks-detail">
      <div className="modal-section-label">{t('tasks.scheduled.detail.title', { name: task.name })}</div>
      {runsError && <div className="setting-error">{runsError}</div>}
      {runs === null && <p className="modal-hint">{t('tasks.scheduled.detail.loadingRuns')}</p>}
      {runs !== null && runs.length === 0 && !runsError && <p className="modal-hint">{t('tasks.scheduled.detail.noRuns')}</p>}
      {runs !== null && runs.length > 0 && (
        <div className="tasks-runs-list">
          {runs.map((r) => (
            <button
              type="button"
              key={r.id}
              className={`tasks-run-row ${r.id === selectedRunId ? 'active' : ''}`}
              onClick={() => setSelectedRunId(r.id)}
            >
              <span className={`tasks-run-status tasks-run-status-${r.status}`}>{t(`tasks.scheduled.runStatus.${r.status}`)}</span>
              <span>{formatDateTime(r.startedAt, i18n.language)}</span>
              <span>{t(`tasks.scheduled.detail.trigger.${r.trigger}`)}</span>
            </button>
          ))}
        </div>
      )}
      {selectedRun && <RunLogView key={selectedRun.id} scope={scope} run={selectedRun} canRun={canRun} />}
      {runs !== null && runs.length > 0 && !selectedRun && <p className="modal-hint">{t('tasks.scheduled.detail.noRunSelected')}</p>}
    </div>
  );
}

// Protokoll eines einzelnen Laufs: Basistext per REST, danach live per Push.
function RunLogView({ scope, run, canRun }: { scope: TaskScope; run: RemoteTaskRun; canRun: boolean }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const [baseLog, setBaseLog] = useState<string | null>(null); // null = noch nicht geladen
  const [loadError, setLoadError] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const logRef = useRef<HTMLPreElement>(null);
  const clearTaskLog = useStore((s) => s.clearTaskLog);

  // Seit dem Abonnieren angehängte Protokollzeilen dieses Laufs (im Store
  // konkateniert, siehe applyRemoteTask kind 'log').
  const live = useStore((s) => s.taskLogs[run.id] ?? '');

  useEffect(() => {
    let cancelled = false;
    setBaseLog(null);
    setLoadError(null);

    // Erst abonnieren, DANACH den bisherigen Text per REST laden: beides läuft
    // nebenläufig, und eine Zeile, die genau in diesem Fenster über die
    // Live-Verbindung eintrifft, landet in store.taskLogs[run.id] (siehe
    // `live` oben) UND möglicherweise schon im REST-Schnappschuss — sie wird
    // unten an den Schnappschuss angehängt, nicht ersetzt. Das Protokoll trägt
    // keine Sequenznummern (anders als z. B. Terminal-Ausgabe), eine exakte
    // Entdopplung ist also nicht möglich. Bewusste Wahl: lieber eine Zeile
    // doppelt zeigen als eine zu verlieren — dieselbe Abwägung trifft der
    // Web-Client an derselben Stelle (RunLogView, DM_Workspace_Web/web/src/
    // views/TasksPanel.tsx).
    window.api.remoteTaskLogSubscribe(scope.serverId, scope.scopeKey, run.id);
    void window.api.remoteTasksGetRun(scope.serverId, scope.scopeKey, run.id).then((res) => {
      if (cancelled) return;
      if (res.ok) setBaseLog(res.run.log);
      else { setLoadError(describeTaskError(res, t)); setBaseLog(''); }
    });

    // Abmelden bei jedem Verlassen dieses Laufs: Wechsel auf einen anderen
    // Lauf (run.id ändert sich → Cleanup vor dem nächsten Abonnieren),
    // Zurück/Schließen des Panels und Abbau der Komponente laufen alle über
    // dieses Unmount/Dependency-Cleanup. clearTaskLog räumt den im Store seit
    // dem Abonnieren angesammelten Live-Text desselben Laufs ab — sonst wächst
    // taskLogs unbegrenzt weiter (auch nach dem Schließen), ein Agentenlauf
    // kann Megabytes an Protokoll erzeugen. Wer denselben Lauf gleich wieder
    // öffnet, verliert dadurch nichts: der nächste Aufruf abonniert erneut und
    // lädt den vollständigen Text frisch per REST (oben) — der gelöschte
    // Live-Anteil steckt bereits in diesem neuen Schnappschuss.
    return () => {
      cancelled = true;
      window.api.remoteTaskLogUnsubscribe(scope.serverId, scope.scopeKey, run.id);
      clearTaskLog(run.id);
    };
  }, [scope.serverId, scope.scopeKey, run.id, t, clearTaskLog]);

  const log = (baseLog ?? '') + live;

  useEffect(() => {
    if (follow && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log, follow]);

  const canCancel = canRun && run.status === 'running';

  const cancel = async (): Promise<void> => {
    setCancelling(true);
    setCancelError(null);
    const res = await window.api.remoteTasksCancel(scope.serverId, scope.scopeKey, run.id);
    setCancelling(false);
    if (!res.ok) setCancelError(describeTaskError(res, t));
  };

  return (
    <div className="tasks-log-panel">
      <div className="tasks-log-toolbar">
        <span>
          {formatDateTime(run.startedAt, i18n.language)} → {run.finishedAt ? formatDateTime(run.finishedAt, i18n.language) : t('tasks.scheduled.detail.stillRunning')}
          {run.exitCode !== null && ` · ${t('tasks.scheduled.detail.exitCode', { code: run.exitCode })}`}
        </span>
        <label className="tasks-log-follow">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
          {t('tasks.scheduled.detail.follow')}
        </label>
        {run.status === 'running' && (
          <button
            type="button"
            className="confirm-btn"
            disabled={!canCancel || cancelling}
            title={canCancel ? t('tasks.scheduled.detail.cancel') : t('tasks.scheduled.blocked.cancel')}
            onClick={() => void cancel()}
          >{t('tasks.scheduled.detail.cancel')}</button>
        )}
      </div>
      {loadError && <div className="setting-error">{loadError}</div>}
      {cancelError && <div className="setting-error">{cancelError}</div>}
      <pre ref={logRef} className="tasks-log">
        {baseLog === null ? t('tasks.scheduled.detail.loadingLog') : (log || t('tasks.scheduled.detail.emptyLog'))}
      </pre>
    </div>
  );
}

// ---- Formular (anlegen/bearbeiten) ------------------------------------------

interface TaskFormProps {
  scope: TaskScope;
  task: RemoteTask | null; // null = neuer Task
  access: RemoteTaskAccess | null;
  members: RemoteProjectMember[];
  membersError: RemoteTaskError | null;
  onDone: () => void;
  onCancel: () => void;
}

// Wochentage in Cron-Reihenfolge (0 = Sonntag). Dieselben Übersetzungen wie in
// der Liste, damit Auswahl und Anzeige denselben Wortlaut tragen.
const WEEKDAY_OPTIONS = [
  'tasks.scheduled.schedule.weekday.sun',
  'tasks.scheduled.schedule.weekday.mon',
  'tasks.scheduled.schedule.weekday.tue',
  'tasks.scheduled.schedule.weekday.wed',
  'tasks.scheduled.schedule.weekday.thu',
  'tasks.scheduled.schedule.weekday.fri',
  'tasks.scheduled.schedule.weekday.sat'
] as const;

function TaskForm({ scope, task, access, members, membersError, onDone, onCancel }: TaskFormProps): React.JSX.Element {
  const { t } = useTranslation();
  const [name, setName] = useState(task?.name ?? '');
  const [agent, setAgent] = useState<RemoteTask['agent']>(task?.agent ?? 'claude');
  const [prompt, setPrompt] = useState(task?.prompt ?? '');
  const [workdir, setWorkdir] = useState(task?.workdir ?? '.');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [schedule, setSchedule] = useState<ScheduleParts>(task ? parseSchedule(task) : DEFAULT_SCHEDULE_PARTS);
  const patchSchedule = (patch: Partial<ScheduleParts>): void => setSchedule((prev) => ({ ...prev, ...patch }));
  const [timeoutMinutes, setTimeoutMinutes] = useState(task ? String(Math.round(task.timeoutMs / 60_000)) : '10');
  const [enabled, setEnabled] = useState(task?.enabled ?? true);
  const [ownerId, setOwnerId] = useState(task?.ownerId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const canAssign = access?.canAssign ?? false;
  // Zuweisbar sind nur Mitglieder ab Editor-Rolle (parseTaskBody im Server).
  // Die aktuell zugewiesene Person bleibt in der Auswahl, auch wenn sie
  // zwischenzeitlich auf Viewer zurückgestuft wurde — sonst zeigte die Auswahl
  // fälschlich „niemand", und das Speichern eines anderen Feldes löschte die
  // Zuweisung unbemerkt. Dieselbe Regel wendet der Web-Client an.
  const assignable = members.filter((m) => m.role !== 'viewer' || m.userId === task?.ownerId);

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    // Feldauswahl (insbesondere die Zeitzone, die es nur beim Anlegen gibt)
    // steckt in buildTaskBody — rein und ohne React getestet, siehe dort.
    const body = buildTaskBody(
      { name, agent, prompt, workdir, schedule, timeoutMinutes, enabled, ownerId, canAssign },
      task ? 'edit' : 'create'
    );

    setSaving(true);
    const res = task
      ? await window.api.remoteTasksUpdate(scope.serverId, scope.scopeKey, task.id, body)
      : await window.api.remoteTasksCreate(scope.serverId, scope.scopeKey, body);
    setSaving(false);
    if (res.ok) onDone();
    else setError(describeTaskError(res, t));
  };

  return (
    <form className="tasks-form-grid" onSubmit={(e) => void save(e)}>
      <div className="modal-section-label">
        {task ? t('tasks.scheduled.form.editTitle', { name: task.name }) : t('tasks.scheduled.form.createTitle')}
      </div>
      {error && <div className="setting-error">{error}</div>}

      <label>
        <span className="wizard-label">{t('tasks.scheduled.form.name')}</span>
        <input
          className="wizard-input" value={name} maxLength={80} autoFocus required
          placeholder={t('tasks.scheduled.form.namePlaceholder')} onChange={(e) => setName(e.target.value)}
        />
      </label>

      <div className="tasks-form-row-2">
        <label>
          <span className="wizard-label">{t('tasks.scheduled.form.agent')}</span>
          <select className="wizard-input" value={agent} onChange={(e) => setAgent(e.target.value as RemoteTask['agent'])}>
            <option value="claude">{t('tasks.scheduled.agent.claude')}</option>
            <option value="codex">{t('tasks.scheduled.agent.codex')}</option>
            <option value="opencode">{t('tasks.scheduled.agent.opencode')}</option>
          </select>
        </label>
        <label>
          <span className="wizard-label">{t('tasks.scheduled.form.workdir')}</span>
          <div className="tasks-workdir-field">
            <input className="wizard-input mono" value={workdir} onChange={(e) => setWorkdir(e.target.value)} />
            <button type="button" className="confirm-btn" onClick={() => setPickerOpen(true)}>
              {t('tasks.scheduled.form.workdirBrowse')}
            </button>
          </div>
        </label>
      </div>
      {/* Der aufgelöste Pfad statt eines Hinweistexts: Er beantwortet dieselbe
          Frage („relativ wozu?") und zeigt zusätzlich, wo man gerade landet. */}
      <p className="modal-hint mono" style={{ marginTop: -6 }}>{toAbsPath(workdir)}</p>

      <label>
        <span className="wizard-label">{t('tasks.scheduled.form.prompt')}</span>
        <textarea
          className="wizard-input" rows={6} value={prompt} required
          placeholder={t('tasks.scheduled.form.promptPlaceholder')} onChange={(e) => setPrompt(e.target.value)}
        />
      </label>

      <label>
        <span className="wizard-label">{t('tasks.scheduled.form.schedule')}</span>
        <select
          className="wizard-input"
          value={schedule.frequency}
          onChange={(e) => patchSchedule({ frequency: e.target.value as ScheduleFrequency })}
        >
          {SCHEDULE_FREQUENCIES.map((f) => (
            <option key={f} value={f}>{t(`tasks.scheduled.schedule.frequency.${f}`)}</option>
          ))}
        </select>
      </label>

      {/* Die Vorlage gibt nur den Startwert vor — angezeigt wird sie als
          gefülltes, änderbares Feld, nicht als unveränderliche Beschriftung. */}
      {schedule.frequency === 'hourly' && (
        <label>
          <span className="wizard-label">{t('tasks.scheduled.schedule.minuteLabel')}</span>
          <input
            className="wizard-input" type="number" min={0} max={59} value={schedule.minute} required
            onChange={(e) => patchSchedule({ minute: e.target.value })}
          />
        </label>
      )}
      {schedule.frequency === 'daily' && (
        <label>
          <span className="wizard-label">{t('tasks.scheduled.schedule.timeLabel')}</span>
          <input
            className="wizard-input" type="time" value={schedule.time} required
            onChange={(e) => patchSchedule({ time: e.target.value })}
          />
        </label>
      )}
      {schedule.frequency === 'weekly' && (
        <div className="tasks-form-row-2">
          <label>
            <span className="wizard-label">{t('tasks.scheduled.schedule.weekdayLabel')}</span>
            <select
              className="wizard-input"
              value={String(schedule.weekday)}
              onChange={(e) => patchSchedule({ weekday: Number(e.target.value) })}
            >
              {WEEKDAY_OPTIONS.map((key, day) => (
                <option key={key} value={day}>{t(key)}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="wizard-label">{t('tasks.scheduled.schedule.timeLabel')}</span>
            <input
              className="wizard-input" type="time" value={schedule.time} required
              onChange={(e) => patchSchedule({ time: e.target.value })}
            />
          </label>
        </div>
      )}
      {schedule.frequency === 'interval' && (
        <label>
          <span className="wizard-label">{t('tasks.scheduled.schedule.intervalLabel')}</span>
          <input
            className="wizard-input" type="number" min={1} max={10080} value={schedule.intervalMinutes} required
            placeholder={t('tasks.scheduled.schedule.intervalPlaceholder')}
            onChange={(e) => patchSchedule({ intervalMinutes: e.target.value })}
          />
        </label>
      )}
      {schedule.frequency === 'customCron' && (
        <label>
          <span className="wizard-label">{t('tasks.scheduled.schedule.customCronLabel')}</span>
          <input
            className="wizard-input mono" value={schedule.cronExpr} required
            placeholder={t('tasks.scheduled.schedule.customCronPlaceholder')}
            onChange={(e) => patchSchedule({ cronExpr: e.target.value })}
          />
        </label>
      )}

      <div className="tasks-form-row-2">
        <label>
          <span className="wizard-label">{t('tasks.scheduled.form.timeout')}</span>
          <input
            className="wizard-input" type="number" min={1} max={240} value={timeoutMinutes} required
            onChange={(e) => setTimeoutMinutes(e.target.value)}
          />
        </label>
        <label>
          <span className="wizard-label">{t('tasks.scheduled.form.owner')}</span>
          {members.length > 0 ? (
            <select
              className="wizard-input" value={ownerId} disabled={!canAssign}
              title={canAssign ? '' : t('tasks.scheduled.blocked.assign')}
              onChange={(e) => setOwnerId(e.target.value)}
            >
              <option value="">{t('tasks.scheduled.form.ownerNone')}</option>
              {assignable.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.displayName} ({t(`tasks.scheduled.role.${m.role}`)})
                </option>
              ))}
            </select>
          ) : (
            // Kommt die Mitgliederliste nicht (Server kurz weg, kein Zugriff),
            // bleibt das frühere Textfeld statt einer leeren Auswahl — ein
            // Nebenwert darf das ganze Formular nicht blockieren.
            <input
              className="wizard-input" value={ownerId} disabled={!canAssign}
              title={canAssign ? '' : t('tasks.scheduled.blocked.assign')}
              placeholder={t('tasks.scheduled.form.ownerPlaceholder')} onChange={(e) => setOwnerId(e.target.value)}
            />
          )}
        </label>
      </div>
      {membersError && <div className="setting-error">{describeTaskError(membersError, t)}</div>}
      <p className="modal-hint" style={{ marginTop: -6 }}>{t('tasks.scheduled.form.ownerHint')}</p>

      <label className="wizard-confirm-toggle">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        {t('tasks.scheduled.form.enabled')}
      </label>
      <p className="modal-hint" style={{ marginTop: -6 }}>{t('tasks.scheduled.form.enabledHint')}</p>

      <div className="tasks-form-footer">
        <button type="button" className="confirm-btn" onClick={onCancel}>{t('tasks.scheduled.form.cancel')}</button>
        <button type="submit" className="confirm-btn primary" disabled={saving}>{t('tasks.scheduled.form.save')}</button>
      </div>

      {/* scope.scopeKey ist hier immer die Projekt-UUID: Das Tasks-Panel ist
          über tasksAvailable() für den User-Scope gesperrt (store.ts, Stufe
          „user-runtime"), der reservierte Wert 'user' kann also nicht auftreten. */}
      {pickerOpen && (
        <DirectoryPickerDialog
          serverId={scope.serverId}
          projectId={scope.scopeKey}
          initialWorkdir={workdir}
          onSelect={(picked) => { setWorkdir(picked); setPickerOpen(false); }}
          onCancel={() => setPickerOpen(false)}
        />
      )}
    </form>
  );
}
