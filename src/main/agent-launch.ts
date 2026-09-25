import { execFile } from 'node:child_process';
import type { AgentProfile } from '../shared/agent-profiles';
import type { AgentCheck } from '../shared/types';
import type { AgentSetup } from './agent-status-bridge';
import { argumentProblem } from './agent-command';
import { quotePosix, quotePowerShell, shellKind } from './shell-quote';

export type { AgentCheck };

export function parseCheckOutput(stdout: string, profile: AgentProfile, powershell: boolean): AgentCheck {
  const result = stdout.match(/^DMWS_CHECK_(ready|missing-cli|missing-node)\r?$/m)?.[1] as AgentCheck | undefined;
  if (!result) return 'check-failed';
  if (result !== 'ready' || !powershell) return result;
  const version = stdout.match(/^DMWS_PS_(\d+)\.(\d+)\r?$/m);
  const extension = stdout.match(/^DMWS_EXT_([a-z0-9]*)\r?$/m);
  if (!version || !extension) return 'check-failed';
  return argumentProblem(profile, { version: [Number(version[1]), Number(version[2])], appExtension: extension[1] }) ?? 'ready';
}

// Run only fixed availability probes, using the same interactive shell profiles
// as a terminal. The program name is always quoted: it is user configuration.
// The profile's variables are set after the startup files, as for the launch
// (agent-command.ts withEnvironment): a profile that sets PATH is checked with it.
export function checkAgentRequirements(shell: string, profile: AgentProfile, env = process.env, cwd = process.cwd()): Promise<AgentCheck> {
  const kind = shellKind(shell);
  if (!kind) return Promise.resolve('unsupported-shell');
  const codex = profile.adapter === 'codex';
  const variables = Object.entries(profile.env);
  const script = kind === 'powershell'
    ? variables.map(([k, v]) => `$env:${k} = ${quotePowerShell(v)}; `).join('')
      + `$dmwsApp = Get-Command ${quotePowerShell(profile.command)} -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1; `
      + 'if (!$dmwsApp) { Write-Output DMWS_CHECK_missing-cli } '
      + (codex ? 'elseif (!(Get-Command node -CommandType Application -ErrorAction SilentlyContinue)) { Write-Output DMWS_CHECK_missing-node } ' : '')
      + "else { Write-Output ('DMWS_PS_' + $PSVersionTable.PSVersion.Major + '.' + $PSVersionTable.PSVersion.Minor); "
      + "Write-Output ('DMWS_EXT_' + [IO.Path]::GetExtension($dmwsApp.Source).TrimStart('.').ToLower()); Write-Output DMWS_CHECK_ready }"
    : (variables.length ? `export ${variables.map(([k, v]) => `${k}=${quotePosix(v)}`).join(' ')}; ` : '')
      + `if ! command -v ${quotePosix(profile.command)} >/dev/null 2>&1; then echo DMWS_CHECK_missing-cli; ${codex ? 'elif ! command -v node >/dev/null 2>&1; then echo DMWS_CHECK_missing-node; ' : ''}else echo DMWS_CHECK_ready; fi`;
  const args = kind === 'powershell' ? ['-NoLogo', '-NonInteractive', '-Command', script] : ['-ilc', script];
  return new Promise(resolve => {
    execFile(shell, args, { env, cwd, timeout: 8000, maxBuffer: 256 * 1024, windowsHide: true }, (error, stdout) => {
      resolve(error ? 'check-failed' : parseCheckOutput(stdout, profile, kind === 'powershell'));
    });
  });
}

interface Session { shell: string; nonce: string }
interface Backend { sessionInfo(id: string): Session | undefined; write(id: string, data: string): void }
interface Bridge { prepare(id: string, shell: string, nonce: string, profile: AgentProfile): Promise<AgentSetup> }
const launches = new WeakSet<Session>();

// Only used for a newly created terminal, never for a user's existing prompt.
export async function launchPreparedAgent(paneId: string, profile: AgentProfile, backend: Backend, bridge: Bridge): Promise<void> {
  const session = backend.sessionInfo(paneId);
  if (!session) throw new Error('No local terminal session');
  if (launches.has(session)) throw new Error('Agent launch already requested');
  launches.add(session);
  try {
    const setup = await bridge.prepare(paneId, session.shell, session.nonce, profile);
    if (backend.sessionInfo(paneId) !== session) throw new Error('Terminal session changed');
    backend.write(paneId, `${setup.launchCommand}\r`);
  } catch (error) {
    launches.delete(session);
    throw error;
  }
}
