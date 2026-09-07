import { execFile } from 'node:child_process';
import type { AgentState } from '../shared/agent-state';
import type { AgentSetup } from './agent-status-bridge';

type Provider = AgentState['provider'];
export type AgentCheck = 'ready' | 'missing-cli' | 'missing-node' | 'unsupported-shell' | 'check-failed';

// Run only fixed availability probes, using the same interactive shell profiles
// as a terminal. No model invocation, config changes or user-command interpolation.
export function checkAgentRequirements(shell: string, provider: Provider, env = process.env, cwd = process.cwd()): Promise<AgentCheck> {
  const powershell = /(?:^|[/\\])(?:powershell|pwsh)(?:\.exe)?$/i.test(shell);
  const posix = /(?:^|[/\\])(?:bash|zsh|sh)(?:\.exe)?$/i.test(shell);
  if (!powershell && !posix) return Promise.resolve('unsupported-shell');
  const script = powershell
    ? `if (!(Get-Command ${provider} -ErrorAction SilentlyContinue)) { Write-Output DMWS_CHECK_missing-cli } ${provider === 'codex' ? 'elseif (!(Get-Command node -ErrorAction SilentlyContinue)) { Write-Output DMWS_CHECK_missing-node } ' : ''}else { Write-Output DMWS_CHECK_ready }`
    : `if ! command -v ${provider} >/dev/null 2>&1; then echo DMWS_CHECK_missing-cli; ${provider === 'codex' ? 'elif ! command -v node >/dev/null 2>&1; then echo DMWS_CHECK_missing-node; ' : ''}else echo DMWS_CHECK_ready; fi`;
  const args = powershell ? ['-NoLogo', '-NonInteractive', '-Command', script]
    : ['-ilc', script];
  return new Promise(resolve => {
    execFile(shell, args, { env, cwd, timeout: 8000, maxBuffer: 256 * 1024, windowsHide: true }, (error, stdout) => {
      if (error) { resolve('check-failed'); return; }
      const result = stdout.match(/^DMWS_CHECK_(ready|missing-cli|missing-node)\r?$/m)?.[1];
      resolve(result as AgentCheck | undefined ?? 'check-failed');
    });
  });
}

interface Session { shell: string; nonce: string }
interface Backend { sessionInfo(id: string): Session | undefined; write(id: string, data: string): void }
interface Bridge { prepare(id: string, shell: string, nonce: string, provider: Provider): Promise<AgentSetup> }
const launches = new WeakSet<Session>();

// Only used for a newly created terminal, never for a user's existing prompt.
export async function launchPreparedAgent(paneId: string, provider: Provider, backend: Backend, bridge: Bridge): Promise<void> {
  const session = backend.sessionInfo(paneId);
  if (!session) throw new Error('No local terminal session');
  if (launches.has(session)) throw new Error('Agent launch already requested');
  launches.add(session);
  try {
    const setup = await bridge.prepare(paneId, session.shell, session.nonce, provider);
    if (backend.sessionInfo(paneId) !== session) throw new Error('Terminal session changed');
    backend.write(paneId, `${setup.launchCommand}\r`);
  } catch (error) {
    launches.delete(session);
    throw error;
  }
}
