import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore, tasksAvailable, tasksBlockedReason, remoteConnKey, TASK_LOG_MAX_CHARS } from '../src/renderer/store';
import i18n from '../src/renderer/i18n';
import { USER_SCOPE_KEY, remotePaneKey } from '../src/shared/remote-pane-key';
import type { RemoteTaskListResult, Workspace } from '../src/shared/types';

const SRV = 'srv1';
const PROJ = 'proj1';
const KEY = remoteConnKey(SRV, PROJ);

function remoteWorkspace(): Workspace {
  return {
    id: 'wr1', name: 'Projekt X', cwd: '~', layout: null,
    kind: 'remote', remote: { serverId: SRV, scope: 'project', projectId: PROJ }
  };
}

// Remote-Workspace der persönlichen User-Runtime: ebenfalls kind 'remote',
// aber ohne Projekt — sein scopeKey ist der reservierte Bezeichner 'user'.
function userRuntimeWorkspace(): Workspace {
  return {
    id: 'wu1', name: 'Meine Umgebung', cwd: '~', layout: null,
    kind: 'remote', remote: { serverId: SRV, scope: 'user' }
  };
}

// Legt Server, Remote-Workspace und eine verbundene remote[KEY]-Verbindung mit
// serverFeatures: features an. Setzt remoteTasks/taskLogs zurück, damit die
// Task-Ereignis-Tests nicht am Zustand eines vorigen Tests hängen.
function setUpRemote(opts: { features: string[] }): void {
  useStore.setState({
    settings: { themeId: 'default', terminalOpacity: 0.95, servers: [{ id: SRV, name: 'Dev', baseUrl: 'https://x' }] },
    workspaces: [remoteWorkspace()],
    activeWorkspaceId: 'wr1',
    remote: {
      [KEY]: {
        status: 'connected', clientId: 'c1', role: 'editor', panes: [],
        presence: [], deniedPaneId: null, lastError: null, serverFeatures: opts.features
      }
    },
    remoteTasks: {},
    taskLogs: {}
  });
}

describe('Sichtbarkeit des Tasks-Bereichs', () => {
  it('ohne konfigurierten Server gibt es Tasks nicht – der Normalfall lokaler Nutzer', () => {
    useStore.setState({
      settings: { themeId: 'default', terminalOpacity: 0.95 },   // kein servers-Feld
      workspaces: [{ id: 'w1', name: 'Lokal', cwd: '/tmp', layout: null }],
      activeWorkspaceId: 'w1', remote: {}
    });
    expect(tasksAvailable(useStore.getState())).toBe(false);
    expect(tasksBlockedReason(useStore.getState())).toBe('no-server');
  });

  it('mit Server, aber lokalem Workspace bleibt der Bereich unanwählbar', () => {
    useStore.setState({
      settings: { themeId: 'default', terminalOpacity: 0.95, servers: [{ id: SRV, name: 'Dev', baseUrl: 'https://x' }] },
      workspaces: [{ id: 'w1', name: 'Lokal', cwd: '/tmp', layout: null }],
      activeWorkspaceId: 'w1', remote: {}
    });
    expect(tasksAvailable(useStore.getState())).toBe(false);
    expect(tasksBlockedReason(useStore.getState())).toBe('local-workspace');
  });

  it('meldet der Server keine tasks-Fähigkeit, bleibt der Bereich aus', () => {
    setUpRemote({ features: [] });
    expect(tasksAvailable(useStore.getState())).toBe(false);
    expect(tasksBlockedReason(useStore.getState())).toBe('server-too-old');
  });

  it('erst mit Server, Remote-Workspace und features:[tasks] ist der Bereich da', () => {
    setUpRemote({ features: ['tasks'] });
    expect(tasksAvailable(useStore.getState())).toBe(true);
    expect(tasksBlockedReason(useStore.getState())).toBeNull();
  });

  // Die persönliche User-Runtime ist ein Remote-Workspace OHNE Projekt. Der
  // Server meldet features: ['tasks'] auch für sie (verbindungsweit, nicht je
  // Scope), die dritte Stufe greift also nicht — nur die Scope-Prüfung hält
  // den Bereich hier fern. Ohne sie fragt der REST-Client
  // GET /api/projects/user/tasks und der Nutzer sieht „Serverfehler".
  it('in der persönlichen User-Runtime bleibt der Bereich aus, obwohl der Server tasks kann', () => {
    useStore.setState({
      settings: { themeId: 'default', terminalOpacity: 0.95, servers: [{ id: SRV, name: 'Dev', baseUrl: 'https://x' }] },
      workspaces: [userRuntimeWorkspace()],
      activeWorkspaceId: 'wu1',
      remote: {
        [remoteConnKey(SRV, USER_SCOPE_KEY)]: {
          status: 'connected', clientId: 'c1', role: 'editor', panes: [],
          presence: [], deniedPaneId: null, lastError: null, serverFeatures: ['tasks']
        }
      },
      remoteTasks: {},
      taskLogs: {}
    });
    expect(tasksBlockedReason(useStore.getState())).toBe('user-runtime');
    expect(tasksAvailable(useStore.getState())).toBe(false);
  });
});

describe('Task-Ereignisse', () => {
  it('nimmt einen geänderten Task in die Liste auf und ersetzt einen vorhandenen', () => {
    setUpRemote({ features: ['tasks'] });
    useStore.getState().applyRemoteTask({ serverId: SRV, scopeKey: PROJ, kind: 'changed',
      task: { id: 't1', name: 'Deps' } as never });
    expect(useStore.getState().remoteTasks[KEY]!.tasks).toHaveLength(1);

    useStore.getState().applyRemoteTask({ serverId: SRV, scopeKey: PROJ, kind: 'changed',
      task: { id: 't1', name: 'Deps neu' } as never });
    const tasks = useStore.getState().remoteTasks[KEY]!.tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.name).toBe('Deps neu');
  });

  // Die Live-Nachricht task.changed führt kein lastRun. Wird der Task
  // vollständig ersetzt, springt „Letzter Lauf" beim Pausieren eines gerade
  // laufenden Tasks auf „keiner" — und weil dann kein Task mehr als laufend
  // gilt, sind alle Starten-Knöpfe wieder frei und der nächste Klick läuft in
  // einen 409.
  it('bewahrt beim Ändern den zuletzt bekannten Lauf des vorhandenen Tasks', () => {
    setUpRemote({ features: ['tasks'] });
    useStore.getState().applyRemoteTask({ serverId: SRV, scopeKey: PROJ, kind: 'changed', task: { id: 't1', name: 'Deps', enabled: true } as never });
    useStore.getState().applyRemoteTask({
      serverId: SRV, scopeKey: PROJ, kind: 'run',
      run: { id: 'r1', taskId: 't1', status: 'running' } as never
    });

    // Pausieren: der Server schickt den geänderten Task ohne lastRun.
    useStore.getState().applyRemoteTask({ serverId: SRV, scopeKey: PROJ, kind: 'changed', task: { id: 't1', name: 'Deps', enabled: false } as never });

    const task = useStore.getState().remoteTasks[KEY]!.tasks[0]!;
    expect(task.enabled).toBe(false);
    expect(task.lastRun).toMatchObject({ id: 'r1', status: 'running' });
  });

  it('ein neu hinzukommender Task hat noch keinen Lauf', () => {
    setUpRemote({ features: ['tasks'] });
    useStore.getState().applyRemoteTask({ serverId: SRV, scopeKey: PROJ, kind: 'changed', task: { id: 't9', name: 'Neu' } as never });
    expect(useStore.getState().remoteTasks[KEY]!.tasks[0]!.lastRun).toBeNull();
  });

  it('entfernt einen gelöschten Task', () => {
    setUpRemote({ features: ['tasks'] });
    useStore.getState().applyRemoteTask({ serverId: SRV, scopeKey: PROJ, kind: 'changed', task: { id: 't1' } as never });
    useStore.getState().applyRemoteTask({ serverId: SRV, scopeKey: PROJ, kind: 'removed', taskId: 't1' });
    expect(useStore.getState().remoteTasks[KEY]!.tasks).toHaveLength(0);
  });

  it('spiegelt einen Lauf im lastRun des betroffenen Tasks', () => {
    setUpRemote({ features: ['tasks'] });
    useStore.getState().applyRemoteTask({ serverId: SRV, scopeKey: PROJ, kind: 'changed', task: { id: 't1', lastRun: null } as never });
    useStore.getState().applyRemoteTask({
      serverId: SRV, scopeKey: PROJ, kind: 'run',
      run: { id: 'r1', taskId: 't1', status: 'running' } as never
    });
    const tasks = useStore.getState().remoteTasks[KEY]!.tasks;
    expect(tasks[0]!.lastRun).toMatchObject({ id: 'r1', status: 'running' });
  });

  it('hängt Protokollzeilen in der Reihenfolge ihres Eintreffens an', () => {
    setUpRemote({ features: ['tasks'] });
    useStore.getState().applyRemoteTask({ serverId: SRV, scopeKey: PROJ, kind: 'log', runId: 'r1', chunk: 'A' });
    useStore.getState().applyRemoteTask({ serverId: SRV, scopeKey: PROJ, kind: 'log', runId: 'r1', chunk: 'B' });
    expect(useStore.getState().taskLogs['r1']).toBe('AB');
  });

  it('ignoriert Ereignisse einer unbekannten Verbindung', () => {
    setUpRemote({ features: ['tasks'] });
    useStore.getState().applyRemoteTask({ serverId: 'fremd', scopeKey: 'x', kind: 'removed', taskId: 't1' });
    expect(useStore.getState().remoteTasks[remoteConnKey('fremd', 'x')]).toBeUndefined();
  });

  // Fix-Runde 1: ein einzelner Lauf darf den Speicher nicht unbegrenzt füllen
  // (ein Agentenlauf kann Megabytes an Protokoll erzeugen). Deckel je Lauf,
  // nur der Fuß bleibt, mit sichtbarem Kürzungsvermerk.
  it('kürzt ein Protokoll, das die Obergrenze überschreitet, auf den Fuß mit Hinweis', () => {
    setUpRemote({ features: ['tasks'] });
    // Erst über die Grenze füllen, dann ein eindeutig erkennbares letztes Stück
    // anhängen — das muss am Ende (dem "Fuß") stehen bleiben.
    const filler = 'x'.repeat(TASK_LOG_MAX_CHARS);
    useStore.getState().applyRemoteTask({ serverId: SRV, scopeKey: PROJ, kind: 'log', runId: 'r1', chunk: filler });
    useStore.getState().applyRemoteTask({ serverId: SRV, scopeKey: PROJ, kind: 'log', runId: 'r1', chunk: 'LETZTE-ZEILE' });

    const log = useStore.getState().taskLogs['r1']!;
    expect(log.length).toBeLessThanOrEqual(TASK_LOG_MAX_CHARS);
    // Der Vermerk kommt aus dem Sprachkatalog (beide Sprachen), nicht als
    // fester deutscher Satz aus dem Code — deshalb hier gegen die Übersetzung
    // geprüft statt gegen ein Literal.
    expect(log).toContain(i18n.t('tasks.scheduled.detail.logTruncated'));
    expect(log.endsWith('LETZTE-ZEILE')).toBe(true);
  });

  it('lässt ein Protokoll unterhalb der Obergrenze unangetastet', () => {
    setUpRemote({ features: ['tasks'] });
    useStore.getState().applyRemoteTask({ serverId: SRV, scopeKey: PROJ, kind: 'log', runId: 'r1', chunk: 'kurz' });
    expect(useStore.getState().taskLogs['r1']).toBe('kurz');
  });
});

describe('clearTaskLog', () => {
  it('entfernt das Protokoll eines Laufs', () => {
    setUpRemote({ features: ['tasks'] });
    useStore.getState().applyRemoteTask({ serverId: SRV, scopeKey: PROJ, kind: 'log', runId: 'r1', chunk: 'A' });
    expect(useStore.getState().taskLogs['r1']).toBe('A');

    useStore.getState().clearTaskLog('r1');
    expect(useStore.getState().taskLogs['r1']).toBeUndefined();
  });

  it('lässt andere Läufe unangetastet', () => {
    setUpRemote({ features: ['tasks'] });
    useStore.getState().applyRemoteTask({ serverId: SRV, scopeKey: PROJ, kind: 'log', runId: 'r1', chunk: 'A' });
    useStore.getState().applyRemoteTask({ serverId: SRV, scopeKey: PROJ, kind: 'log', runId: 'r2', chunk: 'B' });

    useStore.getState().clearTaskLog('r1');
    expect(useStore.getState().taskLogs['r1']).toBeUndefined();
    expect(useStore.getState().taskLogs['r2']).toBe('B');
  });

  it('ist ein No-Op für einen unbekannten Lauf', () => {
    setUpRemote({ features: ['tasks'] });
    expect(() => useStore.getState().clearTaskLog('nie-abonniert')).not.toThrow();
  });
});

describe('loadRemoteTasks', () => {
  const remoteTasksList = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as unknown as { window: unknown }).window = { api: { remoteTasksList } };
    setUpRemote({ features: ['tasks'] });
  });

  it('lädt die Liste über den Workspace und übernimmt access unverändert vom Server', async () => {
    const result: RemoteTaskListResult = {
      ok: true,
      tasks: [{ id: 't1' } as never],
      access: { canManage: true, canRun: true, canAssign: false }
    };
    remoteTasksList.mockResolvedValue(result);

    await useStore.getState().loadRemoteTasks('wr1');

    expect(remoteTasksList).toHaveBeenCalledWith(SRV, PROJ);
    const entry = useStore.getState().remoteTasks[KEY];
    expect(entry?.tasks).toHaveLength(1);
    expect(entry?.access).toEqual({ canManage: true, canRun: true, canAssign: false });
    expect(entry?.loading).toBe(false);
    expect(entry?.error).toBeNull();
  });

  it('lädt auch über die Id einer Remote-Pane statt der Workspace-Id', async () => {
    remoteTasksList.mockResolvedValue({ ok: true, tasks: [], access: { canManage: false, canRun: false, canAssign: false } });
    await useStore.getState().loadRemoteTasks(remotePaneKey(SRV, PROJ, 'p1'));
    expect(remoteTasksList).toHaveBeenCalledWith(SRV, PROJ);
  });

  it('behält bei einem Fehler Code UND Servermeldung, ohne die zuletzt bekannte Liste zu verwerfen', async () => {
    remoteTasksList.mockResolvedValueOnce({ ok: true, tasks: [{ id: 't1' } as never], access: { canManage: true, canRun: true, canAssign: true } });
    await useStore.getState().loadRemoteTasks('wr1');

    remoteTasksList.mockResolvedValueOnce({ ok: false, code: 'forbidden', message: 'Kein Zugriff auf dieses Projekt' });
    await useStore.getState().loadRemoteTasks('wr1');

    const entry = useStore.getState().remoteTasks[KEY];
    expect(entry?.error?.code).toBe('forbidden');
    // Die Servermeldung bleibt erhalten: sie ist die einzige Begründung, die
    // der Nutzer sieht, wenn die Liste leer bleibt.
    expect(entry?.error?.message).toBe('Kein Zugriff auf dieses Projekt');
    expect(entry?.loading).toBe(false);
    expect(entry?.tasks).toHaveLength(1); // alte Liste bleibt stehen
  });

  it('ohne bekannte Verbindung wird gar nicht erst gerufen', async () => {
    await useStore.getState().loadRemoteTasks('unbekannt');
    expect(remoteTasksList).not.toHaveBeenCalled();
  });
});

describe('setTasksPanelOpen', () => {
  it('setzt und liest den Panel-Zustand', () => {
    useStore.getState().setTasksPanelOpen(true);
    expect(useStore.getState().tasksPanelOpen).toBe(true);
    useStore.getState().setTasksPanelOpen(false);
    expect(useStore.getState().tasksPanelOpen).toBe(false);
  });
});
