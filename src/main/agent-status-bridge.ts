import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { PSREADLINE_CLEAR_INPUT_SEQUENCE } from '../shared/psreadline-heal';
import type { Settings } from '../shared/types';
import { codexSetup } from './codex-status-setup';
import { join } from 'node:path';
import { claudeState, codexState, type AgentState, type AgentStateEvent } from '../shared/agent-state';

// SessionStart does not support HTTP hooks. Bind on the first submitted prompt.
const EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse',
  'PostToolUseFailure', 'PostToolBatch', 'Notification', 'Elicitation', 'ElicitationResult', 'Stop', 'StopFailure', 'SessionEnd'];
interface Registration {
  paneId: string; token: string; remoteEnabled: boolean; settingsPath: string; command: string; launchCommand: string;
  turnId?: string; retiredTurns: Set<string>; state: AgentState; retired: Set<string>; waiting: Set<string>; nonce: string; interrupted: boolean;
}
export interface AgentSetup { command: string; settingsPath: string; launchCommand: string; inputPrefix?: string }

export class AgentStatusBridge {
  private server: Server | null = null;
  private starting: Promise<number> | null = null;
  private closed = false;
  private endedStates = new Map<string, AgentState>();
  private registrations = new Map<string, Registration>();
  private byToken = new Map<string, Registration>();
  constructor(private readonly dir: string, private readonly send: (event: AgentStateEvent) => void,
    private readonly remoteSettings: () => NonNullable<Settings['agentRemoteControl']> = () => ({})) {}

  private listen(): Promise<number> {
    if (this.closed) return Promise.reject(new Error('Agent bridge is closed'));
    if (this.starting) return this.starting;
    this.starting = new Promise<number>((resolve, reject) => {
      const server = createServer((req, res) => this.receive(req, res));
      this.server = server;
      server.requestTimeout = 5000;
      server.headersTimeout = 5000;
      server.maxHeadersCount = 16;
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') { reject(new Error('Missing loopback port')); return; }
        resolve(address.port);
      });
    }).catch((error: unknown) => {
      this.server?.close(() => {});
      this.server = null;
      this.starting = null;
      throw error;
    });
    return this.starting;
  }

  async prepare(paneId: string, shell: string, nonce: string, provider: AgentState['provider'] = 'claude'): Promise<AgentSetup> {
    const powershell = /(?:^|[/\\])(?:powershell|pwsh)(?:\.exe)?$/i.test(shell);
    if (!powershell && !/(?:^|[/\\])(?:bash|zsh|sh)(?:\.exe)?$/i.test(shell)) {
      throw new Error('Unsupported shell for agent status setup');
    }
    if (!/^[a-f0-9]{64}$/.test(nonce)) throw new Error('Invalid terminal nonce');
    const inputPrefix = powershell && process.platform === 'win32' ? PSREADLINE_CLEAR_INPUT_SEQUENCE : '\x05\x15';
    const port = provider === 'opencode' ? 0 : await this.listen();
    if (this.closed) throw new Error('Agent bridge is closed');
    const remote = this.remoteSettings();
    const remoteEnabled = provider === 'codex' ? remote.codex === true : provider === 'claude' && remote.claude === true;
    let existing = this.registrations.get(paneId);
    if (existing?.state.event === 'shell' && existing.remoteEnabled !== remoteEnabled) {
      this.release(paneId);
      existing = undefined;
    }
    if (existing?.state.provider === provider && existing.state.event === 'shell') {
      existing.state.paused = false;
      existing.state.generation = randomBytes(16).toString('hex');
      this.update(existing, 'unknown', 'setup', null);
    }
    if (existing?.state.provider === provider) return { command: existing.command, settingsPath: existing.settingsPath, launchCommand: existing.launchCommand, inputPrefix };
    if (existing) {
      if (existing.state.sessionId) throw new Error('End the active agent session before switching providers');
      this.release(paneId);
    }
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const token = randomBytes(32).toString('hex');
    const settingsPath = join(this.dir, `${randomBytes(16).toString('hex')}.${provider === 'codex' ? 'cjs' : 'json'}`);
    const hook = { type: 'http', url: `http://127.0.0.1:${port}/claude`, timeout: 1,
      headers: { Authorization: `Bearer ${token}`, 'X-DMWS-Terminal': '$DMWS_AGENT_NONCE' },
      allowedEnvVars: ['DMWS_AGENT_NONCE'] };
    const hooks = Object.fromEntries(EVENTS.map(event => [event, [{ hooks: [hook] }]]));
    const codex = provider === 'codex' ? codexSetup(settingsPath, port, token, powershell, remote.codex === true, nonce) : null;
    writeFileSync(settingsPath, codex?.script ?? JSON.stringify(provider === 'opencode' ? {} : { hooks }), { mode: 0o600, flag: 'wx' });
    const quoted = powershell ? settingsPath.replace(/'/g, "''") : settingsPath.replace(/'/g, "'\\''");
    const command = provider === 'opencode' ? 'opencode' : codex?.command ?? `claude --settings '${quoted}'${remote.claude ? ' --remote-control' : ''}`;
    // Keep PTY input below canonical line limits, even before readline is ready.
    // The full Codex hook configuration stays in a private file, not an input line.
    const startPath = `${settingsPath}.start`;
    const startQuoted = powershell ? startPath.replace(/'/g, "''") : startPath.replace(/'/g, "'\\''");
    try { writeFileSync(startPath, command + '\n', { mode: 0o600, flag: 'wx' }); }
    catch (error) { rmSync(settingsPath, { force: true }); throw error; }
    const launchCommand = powershell
      ? `& ([scriptblock]::Create([IO.File]::ReadAllText('${startQuoted}')))`
      : `. '${startQuoted}'`;
    const registration: Registration = {
      paneId, token, remoteEnabled, settingsPath, nonce, waiting: new Set(), interrupted: false, command, launchCommand, retired: new Set(), retiredTurns: new Set(),
      state: { provider, generation: randomBytes(16).toString('hex'), status: 'unknown', sessionId: null, event: 'setup', updatedAt: Date.now() }
    };
    this.endedStates.delete(paneId);
    this.registrations.set(paneId, registration);
    this.byToken.set(token, registration);
    this.send({ paneId, state: registration.state });
    return { command: registration.command, launchCommand: registration.launchCommand, settingsPath, inputPrefix };
  }

  snapshot(paneId: string): AgentState | null { return this.registrations.get(paneId)?.state ?? this.endedStates.get(paneId) ?? null; }

  private update(r: Registration, status: AgentState['status'], event: string, sessionId = r.state.sessionId): void {
    r.state = { ...r.state, status, event, sessionId, updatedAt: Date.now() };
    this.send({ paneId: r.paneId, state: r.state });
  }
  interrupt(paneId: string): void {
    const r = this.registrations.get(paneId);
    if (r) { r.interrupted = true; r.waiting.clear(); this.update(r, 'unknown', 'interrupted'); }
  }
  shellReturned(paneId: string): void {
    const r = this.registrations.get(paneId);
    if (!r) return;
    if (r.state.sessionId) r.retired.add(r.state.sessionId);
    r.waiting.clear();
    this.update(r, 'unknown', 'shell', null);
  }
  disconnect(paneId: string): void {
    const r = this.registrations.get(paneId);
    if (!r) return;
    r.state = { ...r.state, paused: true };
    this.send({ paneId, state: r.state });
  }
  reconnect(paneId: string): void {
    const r = this.registrations.get(paneId);
    if (!r || !r.state.paused || ['shell', 'SessionEnd'].includes(r.state.event)) throw new Error('No paused live registration');
    r.state = { ...r.state, paused: false };
    // Replay the last observed state, preserving its actual report timestamp.
    this.send({ paneId, state: r.state });
  }
  rememberEnded(paneId: string, previous: AgentState): void {
    if (this.registrations.has(paneId)) return;
    const state: AgentState = { ...previous, paused: false, status: 'unknown', sessionId: null, event: 'shell', updatedAt: Date.now() };
    this.endedStates.set(paneId, state);
    this.send({ paneId, state });
  }
  release(paneId: string): void {
    const hadEnded = this.endedStates.delete(paneId);
    const r = this.registrations.get(paneId);
    if (!r) { if (hadEnded) this.send({ paneId, state: null }); return; }
    this.registrations.delete(paneId);
    this.byToken.delete(r.token);
    rmSync(r.settingsPath, { force: true });
    rmSync(`${r.settingsPath}.start`, { force: true });
    this.send({ paneId, state: null });
  }
  async close(): Promise<void> {
    this.closed = true;
    this.endedStates.clear();
    for (const id of this.registrations.keys()) this.release(id);
    if (this.starting) await this.starting.catch(() => undefined);
    const server = this.server;
    if (server) {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    rmSync(this.dir, { recursive: true, force: true });
  }

  private receive(req: IncomingMessage, res: ServerResponse): void {
    const reply = (status: number): void => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end('{}'); // observation only: never approve, block, or add model context
    };
    if (req.headers.origin) { reply(403); return; }
    if (req.method !== 'POST' || !['/claude', '/codex'].includes(req.url ?? '')) { reply(404); return; }
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    const r = token ? this.byToken.get(token) : undefined;
    if (!r || req.url !== `/${r.state.provider}` || req.headers['x-dmws-terminal'] !== r.nonce) { reply(401); return; }
    if (!req.headers['content-type']?.startsWith('application/json')) { reply(415); return; }
    let size = 0;
    let chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      if (res.writableEnded) return;
      size += chunk.length;
      if (size > 256 * 1024) {
        chunks = [];
        reply(413);
      } else chunks.push(chunk);
    });
    req.on('error', () => { if (!res.writableEnded) reply(400); });
    req.on('end', () => {
      if (res.writableEnded) return;
      if (this.byToken.get(r.token) !== r) { reply(401); return; }
      let input: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid object');
        input = parsed as Record<string, unknown>;
      } catch { reply(400); return; }
      chunks = [];
      const session = input.session_id;
      const event = input.hook_event_name;
      if (typeof session !== 'string' || !session || session.length > 256 || typeof event !== 'string') {
        reply(400); return;
      }
      const status = r.state.provider === 'codex' ? codexState(input) : r.state.provider === 'claude' ? claudeState(input) : null;
      if (status === null || r.retired.has(session)) { reply(200); return; }
      const turn = input.turn_id;
      if (r.state.provider === 'codex' && event !== 'SessionEnd') {
        if (typeof turn !== 'string' || !turn || turn.length > 256) { reply(400); return; }
        if (r.retiredTurns.has(turn) || (event !== 'UserPromptSubmit' && turn !== r.turnId)) { reply(200); return; }
        if (event === 'UserPromptSubmit' && turn !== r.turnId) {
          if (r.retiredTurns.size >= 4096) { this.update(r, 'unknown', 'turn-limit'); reply(200); return; }
          if (r.turnId) r.retiredTurns.add(r.turnId);
          r.turnId = turn;
        }
      }
      if (event === 'UserPromptSubmit') {
        if (r.state.sessionId !== session) {
          if (r.retired.size >= 1024) { this.update(r, 'unknown', 'session-limit'); reply(200); return; }
          if (r.state.sessionId) r.retired.add(r.state.sessionId);
        }
        r.interrupted = false;
        r.waiting.clear();
        this.update(r, status, event, session);
      } else if (session === r.state.sessionId) {
        if (event === 'Interrupt') {
          this.interrupt(r.paneId);
        } else if (event === 'SessionEnd') {
          r.retired.add(session);
          r.waiting.clear();
          this.update(r, status, event, null);
        } else if (!r.interrupted) {
          const toolId = typeof input.tool_use_id === 'string' && input.tool_use_id.length <= 256 ? input.tool_use_id : null;
          const elicitationId = typeof input.elicitation_id === 'string' && input.elicitation_id.length <= 256 ? input.elicitation_id : null;
          if (status === 'needs-input' && r.waiting.size < 1024) {
            // Notification often duplicates a PermissionRequest; it cannot
            // identify a specific tool, so do not add a second anonymous wait.
            if (event !== 'Notification' || r.waiting.size === 0) {
              r.waiting.add(event === 'Elicitation' && elicitationId ? `elicitation:${elicitationId}` : toolId ? `tool:${toolId}` : 'unidentified');
            }
          }
          if ((event === 'PostToolUse' || event === 'PostToolUseFailure') && toolId) r.waiting.delete(`tool:${toolId}`);
          if (event === 'ElicitationResult' && elicitationId) r.waiting.delete(`elicitation:${elicitationId}`);
          // PermissionRequest has no tool ID. Only the batch boundary proves
          // all parallel requests resolved before the next model call.
          if (event === 'PostToolBatch' || event === 'Stop' || event === 'StopFailure') r.waiting.clear();
          this.update(r, r.waiting.size > 0 ? 'needs-input' : status, event);
        }
      }
      reply(200);
    });
  }
}
