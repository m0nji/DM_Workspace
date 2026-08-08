import { describe, it, expect } from 'vitest';
import {
  BackendRouter, type TerminalBackend, type TerminalDataListener, type TerminalExitListener
} from '../src/main/terminal-backend';
import type { SpawnOptions } from '../src/main/pty-manager';

// Anders als pty-manager.test.ts braucht diese Datei weder node-pty noch
// Electron: der Router wird gegen In-Memory-Fakes getestet (die SpawnOptions-
// und Backend-Typen sind type-only-Importe und zur Laufzeit weg).

class FakeBackend implements TerminalBackend {
  calls: unknown[][] = [];
  killAllAndWaitCalls: Array<number | undefined> = [];
  private dataListeners: TerminalDataListener[] = [];
  private exitListeners: TerminalExitListener[] = [];

  onData(cb: TerminalDataListener): void { this.dataListeners.push(cb); }
  onExit(cb: TerminalExitListener): void { this.exitListeners.push(cb); }
  emitData(paneId: string, data: string): void { this.dataListeners.forEach((l) => l(paneId, data)); }
  emitExit(paneId: string, exitCode: number): void { this.exitListeners.forEach((l) => l(paneId, exitCode)); }

  spawn(paneId: string, opts: SpawnOptions): void { this.calls.push(['spawn', paneId, opts]); }
  write(paneId: string, data: string): void { this.calls.push(['write', paneId, data]); }
  resize(paneId: string, cols: number, rows: number): void { this.calls.push(['resize', paneId, cols, rows]); }
  kill(paneId: string): void { this.calls.push(['kill', paneId]); }
  killAll(): void { this.calls.push(['killAll']); }
  killAllAndWait(timeoutMs?: number): Promise<void> {
    this.killAllAndWaitCalls.push(timeoutMs);
    return Promise.resolve();
  }
}

const spawnOpts = (extra?: Partial<SpawnOptions>): SpawnOptions =>
  ({ cwd: '/tmp', cols: 80, rows: 24, ...extra });

const remoteTarget = {
  kind: 'remote' as const,
  serverId: 's1',
  scope: { kind: 'project' as const, projectId: 'pr1' },
  remotePaneId: 'rp1'
};

describe('BackendRouter', () => {
  it('routes a spawn without target to the default backend', () => {
    const local = new FakeBackend();
    const router = new BackendRouter(local);
    router.spawn('p1', spawnOpts());
    expect(local.calls).toEqual([['spawn', 'p1', spawnOpts()]]);
  });

  it("routes a spawn with target kind 'local' to the default backend", () => {
    const local = new FakeBackend();
    const router = new BackendRouter(local);
    router.spawn('p1', spawnOpts({ target: { kind: 'local' } }));
    expect(local.calls[0][0]).toBe('spawn');
  });

  // B1 kennt kein Remote-Backend: derselbe Fehlerpfad wie ein fehlgeschlagener
  // lokaler Spawn (synchroner Throw, den ipcMain.handle zum rejected Promise
  // macht). B2 ersetzt den Throw durch das RemotePtyBackend.
  it('rejects a remote spawn with a synchronous error and touches no backend', () => {
    const local = new FakeBackend();
    const router = new BackendRouter(local);
    expect(() => router.spawn('p1', spawnOpts({ target: remoteTarget }))).toThrow(/remote/);
    expect(local.calls).toEqual([]);
  });

  it('routes write/resize/kill for a spawned pane to its backend', () => {
    const local = new FakeBackend();
    const router = new BackendRouter(local);
    router.spawn('p1', spawnOpts());
    router.write('p1', 'ls\r');
    router.resize('p1', 100, 30);
    router.kill('p1');
    expect(local.calls.slice(1)).toEqual([
      ['write', 'p1', 'ls\r'],
      ['resize', 'p1', 100, 30],
      ['kill', 'p1']
    ]);
  });

  // Heutiges Verhalten: eine unbekannte paneId landet beim lokalen PtyManager,
  // wo write/resize/kill für unbekannte Panes No-ops sind.
  it('falls back to the default backend for an unknown paneId', () => {
    const local = new FakeBackend();
    const router = new BackendRouter(local);
    router.write('ghost', 'x');
    router.resize('ghost', 80, 24);
    router.kill('ghost');
    expect(local.calls).toEqual([
      ['write', 'ghost', 'x'],
      ['resize', 'ghost', 80, 24],
      ['kill', 'ghost']
    ]);
  });

  it('aggregates onData across all registered backends', () => {
    const local = new FakeBackend();
    const other = new FakeBackend();
    const router = new BackendRouter(local);
    router.registerBackend(other);
    const seen: Array<[string, string]> = [];
    router.onData((paneId, data) => seen.push([paneId, data]));
    local.emitData('p1', 'aus lokal');
    other.emitData('p2', 'aus remote');
    expect(seen).toEqual([['p1', 'aus lokal'], ['p2', 'aus remote']]);
  });

  it('aggregates onExit across all registered backends', () => {
    const local = new FakeBackend();
    const other = new FakeBackend();
    const router = new BackendRouter(local);
    router.registerBackend(other);
    const seen: Array<[string, number]> = [];
    router.onExit((paneId, exitCode) => seen.push([paneId, exitCode]));
    local.emitExit('p1', 0);
    other.emitExit('p2', 137);
    expect(seen).toEqual([['p1', 0], ['p2', 137]]);
  });

  // Listener-Registrierung ist unabhängig von der Backend-Registrierung: auch
  // ein VOR registerBackend angemeldeter Listener sieht die Events des später
  // registrierten Backends (B2 registriert Remote-Backends erst bei Bedarf).
  it('delivers events of late-registered backends to existing listeners', () => {
    const local = new FakeBackend();
    const router = new BackendRouter(local);
    const seen: string[] = [];
    router.onData((paneId) => seen.push(paneId));
    const late = new FakeBackend();
    router.registerBackend(late);
    late.emitData('p9', 'x');
    expect(seen).toEqual(['p9']);
  });

  it('delegates killAll to every registered backend', () => {
    const local = new FakeBackend();
    const other = new FakeBackend();
    const router = new BackendRouter(local);
    router.registerBackend(other);
    router.killAll();
    expect(local.calls).toEqual([['killAll']]);
    expect(other.calls).toEqual([['killAll']]);
  });

  it('delegates killAllAndWait to every backend and forwards the timeout', async () => {
    const local = new FakeBackend();
    const other = new FakeBackend();
    const router = new BackendRouter(local);
    router.registerBackend(other);
    await router.killAllAndWait(500);
    expect(local.killAllAndWaitCalls).toEqual([500]);
    expect(other.killAllAndWaitCalls).toEqual([500]);
  });

  it('killAllAndWait without a timeout leaves the backend default in charge', async () => {
    const local = new FakeBackend();
    const router = new BackendRouter(local);
    await router.killAllAndWait();
    expect(local.killAllAndWaitCalls).toEqual([undefined]);
  });
});
