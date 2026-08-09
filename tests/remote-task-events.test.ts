import { describe, expect, it, vi } from 'vitest';
import { RemoteManager, type RemoteManagerDeps } from '../src/main/remote/remote-manager';
import { AuthManager, type SafeStorageLike } from '../src/main/remote/auth-manager';
import type { TaskServerMessage } from '../src/main/remote/remote-backend';

// Deckt RemoteManager.handleServerMessage ab: die Übersetzung der fünf
// Task-Nachrichtentypen des WebSocket-Protokolls (vendor/dmw-shared/
// protocol.ts) in die vier remote:task-Ereignisarten (shared/types.ts:
// RemoteTaskEvent). Analog zu tests/remote-manager.test.ts, aber ohne
// FakeServer/echte Verbindung — handleServerMessage ist ein reiner
// Übersetzer, der Server-Frame kommt hier direkt als Objektliteral rein
// (so wie ihn RemotePtyBackend.onTask sonst liefern würde).

const SRV = 'srv1';
const PROJ = 'p-1';

// Minimale, aber echte AuthManager-Instanz: RemoteManager verlangt sie im
// Konstruktor, handleServerMessage selbst braucht aber keinen Netzzugriff
// (kein Login, kein cookieHeader-Aufruf) — die Datei muss deshalb nicht
// existieren, AuthManager lädt nur bei Bedarf (loadOnce), nie eager.
function makeManager(overrides: Partial<RemoteManagerDeps> = {}): RemoteManager {
  const safeStorage: SafeStorageLike = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(s, 'utf8'),
    decryptString: (b) => b.toString('utf8')
  };
  const auth = new AuthManager({
    file: '/nonexistent/dmw-remote-task-events-test/remote-auth.json',
    safeStorage,
    openExternal: () => { /* im Test ungenutzt */ }
  });
  const deps: RemoteManagerDeps = {
    auth,
    send: () => { /* per Test überschrieben */ },
    initialServers: [],
    ...overrides
  };
  return new RemoteManager(deps);
}

// Vollständiges TaskInfo/TaskRunInfo (protocol.ts) — die Live-Nachrichten
// führen alle Felder außer RemoteTask.lastRun, das task.changed nicht mitschickt.
const taskInfo = {
  id: 't1', projectId: PROJ, name: 'Deps', description: 'wöchentlicher Dependency-Check',
  ownerId: 'u1', agent: 'claude' as const, prompt: 'npm audit', workdir: '.',
  scheduleKind: 'cron' as const, scheduleExpr: '0 3 * * 1', timezone: 'Europe/Berlin',
  timeoutMs: 600_000, enabled: true, nextRunAt: '2026-08-10T03:00:00.000Z'
};

const runInfo = {
  id: 'r1', taskId: 't1', status: 'running' as const, trigger: 'manual' as const,
  startedBy: 'u1', startedAt: '2026-08-09T08:00:00.000Z', finishedAt: null, exitCode: null
};

describe('RemoteManager.handleServerMessage: Task-Nachrichten -> remote:task-Ereignis', () => {
  it('übersetzt task.changed in ein remote:task-Ereignis', () => {
    const send = vi.fn();
    const manager = makeManager({ send });
    manager.handleServerMessage(SRV, PROJ, { type: 'task.changed', task: taskInfo });
    expect(send).toHaveBeenCalledWith('remote:task', {
      serverId: SRV, scopeKey: PROJ, kind: 'changed', task: taskInfo
    });
  });

  // Der Manager erfindet kein lastRun: er übersetzt zustandslos je Nachricht
  // und weiß nichts vom zuletzt bekannten Lauf. Ein `lastRun: null` wäre im
  // Store nicht von „hat noch nie gelaufen" zu unterscheiden und würde einen
  // laufenden Lauf löschen (das Zusammenführen macht der Store).
  it('reicht task.changed ohne erfundenes lastRun durch', () => {
    const send = vi.fn();
    const manager = makeManager({ send });
    manager.handleServerMessage(SRV, PROJ, { type: 'task.changed', task: taskInfo });
    const sent = send.mock.calls[0]![1] as { task: Record<string, unknown> };
    expect('lastRun' in sent.task).toBe(false);
  });

  it('übersetzt task.removed in ein remote:task-Ereignis', () => {
    const send = vi.fn();
    const manager = makeManager({ send });
    manager.handleServerMessage(SRV, PROJ, { type: 'task.removed', taskId: 't1' });
    expect(send).toHaveBeenCalledWith('remote:task', {
      serverId: SRV, scopeKey: PROJ, kind: 'removed', taskId: 't1'
    });
  });

  it('übersetzt sowohl task.run.started als auch task.run.finished auf kind "run"', () => {
    const send = vi.fn();
    const manager = makeManager({ send });
    manager.handleServerMessage(SRV, PROJ, { type: 'task.run.started', run: runInfo });
    const finished = { ...runInfo, status: 'success' as const, finishedAt: '2026-08-09T08:01:00.000Z', exitCode: 0 };
    manager.handleServerMessage(SRV, PROJ, { type: 'task.run.finished', run: finished });

    expect(send).toHaveBeenNthCalledWith(1, 'remote:task', { serverId: SRV, scopeKey: PROJ, kind: 'run', run: runInfo });
    expect(send).toHaveBeenNthCalledWith(2, 'remote:task', { serverId: SRV, scopeKey: PROJ, kind: 'run', run: finished });
  });

  it('reicht Protokollzeilen als eigenes Ereignis durch (Server-Feld `data` -> Event-Feld `chunk`)', () => {
    const send = vi.fn();
    const manager = makeManager({ send });
    manager.handleServerMessage(SRV, PROJ, { type: 'task.run.log', runId: 'r1', data: 'npm audit…' });
    expect(send).toHaveBeenCalledWith('remote:task', {
      serverId: SRV, scopeKey: PROJ, kind: 'log', runId: 'r1', chunk: 'npm audit…'
    });
  });

  it('ignoriert unbekannte Nachrichtentypen still (ältere/neuere Server)', () => {
    const send = vi.fn();
    const manager = makeManager({ send });
    manager.handleServerMessage(SRV, PROJ, { type: 'task.explode' } as unknown as TaskServerMessage);
    expect(send).not.toHaveBeenCalled();
  });
});
