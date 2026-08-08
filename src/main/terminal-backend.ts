// Abstraktion über das Prozess-Backend eines Terminals (Arbeitspaket B1 des
// Remote-Workspaces-Plans, docs/2026-08-08-remote-workspaces-integrationsplan.md
// Abschnitt 4.4). Das Interface ist exakt die heutige PtyManager-Oberfläche —
// B2 hängt hier ein RemotePtyBackend (WSS zum Workspace-Server) ein, ohne dass
// IPC-Kanäle, pty-data-batcher oder Renderer etwas davon merken.

import type { SpawnOptions } from './pty-manager';

export type TerminalDataListener = (paneId: string, data: string) => void;
export type TerminalExitListener = (paneId: string, exitCode: number) => void;

export interface TerminalBackend {
  spawn(paneId: string, opts: SpawnOptions): void;
  write(paneId: string, data: string): void;
  resize(paneId: string, cols: number, rows: number): void;
  kill(paneId: string): void;
  killAll(): void;
  /** Alle Prozesse beenden und auf deren tatsächliches Exit warten (Shutdown-Pfad). */
  killAllAndWait(timeoutMs?: number): Promise<void>;
  onData(cb: TerminalDataListener): void;
  onExit(cb: TerminalExitListener): void;
}

// Routet jede Pane auf ihr Backend. Heute gibt es nur das lokale Default-Backend
// (PtyManager); B2 registriert zusätzlich Remote-Backends und trägt Panes mit
// `target.kind === 'remote'` in die Map ein. Eine unbekannte paneId fällt auf
// das Default-Backend zurück — dort sind write/resize/kill für unbekannte Panes
// bereits No-ops, das heutige Verhalten bleibt also unverändert.
export class BackendRouter implements TerminalBackend {
  private readonly backends: TerminalBackend[] = [];
  private readonly byPane = new Map<string, TerminalBackend>();
  private readonly dataListeners: TerminalDataListener[] = [];
  private readonly exitListeners: TerminalExitListener[] = [];
  private remoteBackend: TerminalBackend | null = null;

  constructor(private readonly defaultBackend: TerminalBackend) {
    this.registerBackend(defaultBackend);
  }

  // Hängt ein weiteres Backend in die Aggregation von onData/onExit und in den
  // Shutdown-Pfad (killAll/killAllAndWait). B2 ruft das pro Remote-Server auf.
  registerBackend(backend: TerminalBackend): void {
    this.backends.push(backend);
    backend.onData((paneId, data) => this.dataListeners.forEach((l) => l(paneId, data)));
    backend.onExit((paneId, exitCode) => {
      // Der Prozess ist weg — Routing-Eintrag aufräumen, damit die Map über eine
      // lange Session nicht mit toten Panes wächst (spiegelt procs.delete im
      // PtyManager).
      this.byPane.delete(paneId);
      this.exitListeners.forEach((l) => l(paneId, exitCode));
    });
  }

  // Das Backend, an das Spawns mit target.kind === 'remote' gehen (B2:
  // RemotePtyBackend). Zusätzlich zu registerBackend aufzurufen.
  registerRemoteBackend(backend: TerminalBackend): void {
    this.registerBackend(backend);
    this.remoteBackend = backend;
  }

  onData(cb: TerminalDataListener): void { this.dataListeners.push(cb); }
  onExit(cb: TerminalExitListener): void { this.exitListeners.push(cb); }

  private backendFor(paneId: string): TerminalBackend {
    return this.byPane.get(paneId) ?? this.defaultBackend;
  }

  spawn(paneId: string, opts: SpawnOptions): void {
    const target = opts.target ?? { kind: 'local' };
    if (target.kind === 'remote') {
      if (!this.remoteBackend) {
        // Ohne registriertes Remote-Backend nimmt der Throw denselben Fehlerpfad
        // wie ein fehlgeschlagener lokaler Spawn: pty:spawn läuft über
        // ipcMain.handle, der Renderer sieht ein rejected Promise.
        throw new Error(`spawn: no backend for remote target (server ${target.serverId})`);
      }
      this.remoteBackend.spawn(paneId, opts);
      this.byPane.set(paneId, this.remoteBackend);
      return;
    }
    this.defaultBackend.spawn(paneId, opts);
    this.byPane.set(paneId, this.defaultBackend);
  }

  write(paneId: string, data: string): void {
    this.backendFor(paneId).write(paneId, data);
  }

  resize(paneId: string, cols: number, rows: number): void {
    this.backendFor(paneId).resize(paneId, cols, rows);
  }

  kill(paneId: string): void {
    const backend = this.backendFor(paneId);
    this.byPane.delete(paneId);
    backend.kill(paneId);
  }

  killAll(): void {
    this.byPane.clear();
    for (const backend of this.backends) backend.killAll();
  }

  async killAllAndWait(timeoutMs?: number): Promise<void> {
    this.byPane.clear();
    // Alle Backends parallel — der Shutdown wartet ohnehin nur bis zum Timeout
    // des langsamsten (siehe pty-shutdown.ts).
    await Promise.all(this.backends.map((b) => b.killAllAndWait(timeoutMs)));
  }
}
