import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { remoteConnKey, tasksAvailable, useStore, workspaceScopeKey, type RemoteTasksState } from '../store';
import type {
  RemoteTask, RemoteTaskAccess, RemoteTaskRun
} from '../../shared/types';
import {
  SCHEDULE_TEMPLATES, buildTaskBody, formatTaskSchedule, templateIdForTask,
  type ScheduleTemplateId
} from '../task-schedule';
import { describeTaskError } from '../task-error';
import { Icon } from './Icon';
import { ConfirmDialog } from './ConfirmDialog';

// Panel für geplante Agenten-Tasks eines Remote-Projekts (Arbeitspaket B,
// Aufgabe 4). Drei Bereiche wie im Web-Client (DM_Workspace_Web/web/src/views/
// TasksPanel.tsx, das ausdrückliche Vorbild dieses Auftrags): Liste, Verlauf
// mit Live-Protokoll, Formular. Sichtbarkeit ausschließlich über
// tasksAvailable() aus dem Store — siehe dort für die drei Stufen.

interface TaskScope { serverId: string; scopeKey: string; }

function fmtDateTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}

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
  const ws = useStore((s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId));

  const scope: TaskScope | null = ws?.kind === 'remote' && ws.remote
    ? { serverId: ws.remote.serverId, scopeKey: workspaceScopeKey(ws.remote) }
    : null;
  const key = scope ? remoteConnKey(scope.serverId, scope.scopeKey) : null;
  const entry = useStore((s) => (key ? s.remoteTasks[key] : undefined));
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
    if (open && available && activeWorkspaceId) void loadRemoteTasks(activeWorkspaceId);
  }, [open, available, activeWorkspaceId, loadRemoteTasks]);

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
  canRun: boolean;
  onReload: () => void;
  onOpenDetail: (taskId: string) => void;
  onOpenForm: (taskId: string | null) => void;
}

function TasksList({ scope, entry, canRun, onReload, onOpenDetail, onOpenForm }: TasksListProps): React.JSX.Element {
  const { t } = useTranslation();
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
                <span>{t('tasks.scheduled.list.nextRun')}: {task.enabled ? fmtDateTime(task.nextRunAt) : t('tasks.scheduled.list.noNextRun')}</span>
                <span>
                  {t('tasks.scheduled.list.lastRun')}: {task.lastRun
                    ? `${t(`tasks.scheduled.runStatus.${task.lastRun.status}`)} · ${fmtDateTime(task.lastRun.startedAt)}`
                    : t('tasks.scheduled.list.lastRunNone')}
                </span>
                <span>{t('tasks.scheduled.list.owner')}: {task.ownerId ?? t('tasks.scheduled.list.ownerNone')}</span>
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
  const { t } = useTranslation();
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
              <span>{fmtDateTime(r.startedAt)}</span>
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
  const { t } = useTranslation();
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
          {fmtDateTime(run.startedAt)} → {run.finishedAt ? fmtDateTime(run.finishedAt) : t('tasks.scheduled.detail.stillRunning')}
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
  onDone: () => void;
  onCancel: () => void;
}

function TaskForm({ scope, task, access, onDone, onCancel }: TaskFormProps): React.JSX.Element {
  const { t } = useTranslation();
  const [name, setName] = useState(task?.name ?? '');
  const [agent, setAgent] = useState<RemoteTask['agent']>(task?.agent ?? 'claude');
  const [prompt, setPrompt] = useState(task?.prompt ?? '');
  const [workdir, setWorkdir] = useState(task?.workdir ?? '.');
  const [templateId, setTemplateId] = useState<ScheduleTemplateId>(task ? templateIdForTask(task) : 'dailyAt3');
  const [intervalMinutes, setIntervalMinutes] = useState(
    task && task.scheduleKind === 'interval' ? task.scheduleExpr : '15'
  );
  const [customCronExpr, setCustomCronExpr] = useState(
    task && templateIdForTask(task) === 'customCron' ? task.scheduleExpr : '0 3 * * 1'
  );
  const [timeoutMinutes, setTimeoutMinutes] = useState(task ? String(Math.round(task.timeoutMs / 60_000)) : '10');
  const [enabled, setEnabled] = useState(task?.enabled ?? true);
  const [ownerId, setOwnerId] = useState(task?.ownerId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const canAssign = access?.canAssign ?? false;

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    // Feldauswahl (insbesondere die Zeitzone, die es nur beim Anlegen gibt)
    // steckt in buildTaskBody — rein und ohne React getestet, siehe dort.
    const body = buildTaskBody(
      { name, agent, prompt, workdir, templateId, intervalMinutes, customCronExpr, timeoutMinutes, enabled, ownerId, canAssign },
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
          <input className="wizard-input mono" value={workdir} onChange={(e) => setWorkdir(e.target.value)} />
        </label>
      </div>
      <p className="modal-hint" style={{ marginTop: -6 }}>{t('tasks.scheduled.form.workdirHint')}</p>

      <label>
        <span className="wizard-label">{t('tasks.scheduled.form.prompt')}</span>
        <textarea
          className="wizard-input" rows={6} value={prompt} required
          placeholder={t('tasks.scheduled.form.promptPlaceholder')} onChange={(e) => setPrompt(e.target.value)}
        />
      </label>

      <label>
        <span className="wizard-label">{t('tasks.scheduled.form.schedule')}</span>
        <select className="wizard-input" value={templateId} onChange={(e) => setTemplateId(e.target.value as ScheduleTemplateId)}>
          {SCHEDULE_TEMPLATES.map((tpl) => (
            <option key={tpl.id} value={tpl.id}>{t(`tasks.scheduled.schedule.template.${tpl.id}`)}</option>
          ))}
        </select>
      </label>
      {templateId === 'interval' && (
        <label>
          <span className="wizard-label">{t('tasks.scheduled.schedule.intervalLabel')}</span>
          <input
            className="wizard-input" type="number" min={1} max={10080} value={intervalMinutes} required
            placeholder={t('tasks.scheduled.schedule.intervalPlaceholder')} onChange={(e) => setIntervalMinutes(e.target.value)}
          />
        </label>
      )}
      {templateId === 'customCron' && (
        <label>
          <span className="wizard-label">{t('tasks.scheduled.schedule.customCronLabel')}</span>
          <input
            className="wizard-input mono" value={customCronExpr} required
            placeholder={t('tasks.scheduled.schedule.customCronPlaceholder')} onChange={(e) => setCustomCronExpr(e.target.value)}
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
          <input
            className="wizard-input" value={ownerId} disabled={!canAssign}
            title={canAssign ? '' : t('tasks.scheduled.blocked.assign')}
            placeholder={t('tasks.scheduled.form.ownerPlaceholder')} onChange={(e) => setOwnerId(e.target.value)}
          />
        </label>
      </div>
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
    </form>
  );
}
