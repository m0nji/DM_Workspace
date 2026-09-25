import type { AgentProfile } from '../shared/agent-profiles';
import { posixWord, powerShellApplication, quotePosix, quotePowerShell, type ShellKind } from './shell-quote';

export interface PowerShellHost { version: [number, number]; appExtension: string }

// PowerShell < 7.3 and batch launchers (npm .cmd shims) re-parse arguments:
// embedded quotes and a trailing backslash inside a quoted argument break,
// and cmd.exe expands %VAR%. Codex runs after --%, where %VAR% expands too.
// A batch launcher also hands arguments without spaces to cmd.exe unquoted,
// which then runs & | < > ^ ( ) as command syntax.
export function argumentProblem(profile: AgentProfile, host: PowerShellHost | null): 'unsupported-argument' | null {
  if (!host) return null;
  const [major, minor] = host.version;
  const legacy = major < 7 || (major === 7 && minor < 3);
  const batch = host.appExtension === 'cmd' || host.appExtension === 'bat';
  for (const arg of profile.args) {
    if (profile.adapter !== 'codex' && (legacy || batch) && (arg.includes('"') || (/\s/.test(arg) && arg.endsWith('\\')))) return 'unsupported-argument';
    if ((batch || profile.adapter === 'codex') && arg.includes('%')) return 'unsupported-argument';
    if (batch && /[&|<>^()]/.test(arg)) return 'unsupported-argument';
  }
  return null;
}

export interface AgentCommandInput {
  profile: AgentProfile;
  shell: ShellKind;
  settingsPath: string; // hook file; only Claude receives it as --settings
  remote: boolean;      // resolved phone option (claude/codex only)
  codexCommand?: string; // from codexSetup for the codex adapter
}

export function buildAgentCommand({ profile, shell, settingsPath, remote, codexCommand }: AgentCommandInput): string {
  const inner = profile.adapter === 'codex' && codexCommand ? codexCommand
    : shell === 'posix' ? posixInvocation(profile, settingsPath, remote)
    : powerShellInvocation(profile, settingsPath, remote);
  return withEnvironment(inner, profile.env, shell);
}

function claudeWords(profile: AgentProfile, settingsPath: string, remote: boolean, quote: (s: string) => string): string[] {
  return profile.adapter === 'claude' ? ['--settings', quote(settingsPath), ...(remote ? ['--remote-control'] : [])] : [];
}

function posixInvocation(profile: AgentProfile, settingsPath: string, remote: boolean): string {
  return [posixWord(profile.command), ...claudeWords(profile, settingsPath, remote, quotePosix), ...profile.args.map(quotePosix)].join(' ');
}

function powerShellInvocation(profile: AgentProfile, settingsPath: string, remote: boolean): string {
  return [`& ${powerShellApplication(profile.command)}`, ...claudeWords(profile, settingsPath, remote, quotePowerShell), ...profile.args.map(quotePowerShell)].join(' ');
}

function withEnvironment(command: string, env: Record<string, string>, shell: ShellKind): string {
  const entries = Object.entries(env);
  if (entries.length === 0) return command;
  // A subshell keeps the variables out of the interactive shell after exit.
  if (shell === 'posix') return `( export ${entries.map(([k, v]) => `${k}=${quotePosix(v)}`).join(' ')}; ${command} )`;
  // $env: is process-wide in PowerShell; restore (or remove, when it was unset) in finally.
  return ['& {',
    ...entries.map(([k, v], i) => `$dmwsEnv${i} = $env:${k}; $env:${k} = ${quotePowerShell(v)}`),
    'try {', command, '} finally {',
    ...entries.map(([k], i) => `$env:${k} = $dmwsEnv${i}`),
    '}', '}'].join('\n');
}
