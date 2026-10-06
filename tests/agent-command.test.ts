import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { argumentProblem, buildAgentCommand } from '../src/main/agent-command';
import { codexSetup } from '../src/main/codex-status-setup';
import { posixWord, powerShellApplication, powerShellWord, quotePosix, quotePowerShell, quoteWindowsNative, shellKind } from '../src/main/shell-quote';
import { builtinAgentProfile, launchArgs, type AgentProfile } from '../src/shared/agent-profiles';

const custom = (patch: Partial<AgentProfile>): AgentProfile => ({ ...builtinAgentProfile('opencode'), id: 'custom-1', ...patch });

describe('shell quoting', () => {
  it('detects supported shells', () => {
    expect(shellKind('/bin/zsh')).toBe('posix');
    expect(shellKind('C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBe('powershell');
    expect(shellKind('cmd.exe')).toBeNull();
  });
  it.skipIf(process.platform === 'win32')('POSIX quoting survives a real shell byte for byte', () => {
    for (const value of ["it's", 'a "b"', '$HOME', '`id`', 'Grüße', 'back\\slash', '*']) {
      expect(execFileSync('/bin/sh', ['-c', `printf %s ${quotePosix(value)}`], { encoding: 'utf8' })).toBe(value);
    }
  });
  it('keeps bare words bare and never leaves ~ unquoted', () => {
    expect(posixWord('codex')).toBe('codex');
    expect(posixWord('~/bin/x')).toBe(`'~/bin/x'`);
  });
  it('quotes for the Windows command-line parser', () => {
    expect(quoteWindowsNative('a b')).toBe('"a b"');
    expect(quoteWindowsNative('say "hi"')).toBe('"say \\"hi\\""');
    expect(quoteWindowsNative('C:\\dir\\')).toBe('"C:\\dir\\\\"');
  });
});

// PowerShell ends a single-quoted string at ' and at the typographic quotes
// U+2018-U+201B alike; inside one, any of them is escaped by doubling it.
describe('PowerShell quoting of typographic single quotes', () => {
  const quotes = ['\u2018', '\u2019', '\u201A', '\u201B'];
  it('doubles ASCII and typographic single quotes', () => {
    expect(quotePowerShell("it's")).toBe("'it''s'");
    for (const q of quotes) expect(quotePowerShell(`a${q}b`)).toBe(`'a${q}${q}b'`);
    expect(quotePowerShell(`'\u2018\u2019\u201A\u201B`)).toBe(`'''\u2018\u2018\u2019\u2019\u201A\u201A\u201B\u201B'`);
    expect(powerShellWord('agent\u2019')).toBe(`'agent\u2019\u2019'`);
  });
  it('keeps an injection-shaped program name, argument and variable inside PowerShell strings', () => {
    const command = buildAgentCommand({ profile: custom({ command: 'agent\u2019; Remove-Item -Recurse C:\\x; \u2018', args: ['\u201Aa\u201B'], env: { NOTE: '\u2019; exit; \u2019' } }),
      shell: 'powershell', settingsPath: 's', remote: false });
    expect(command.split('\n')).toEqual([
      '& {', `$dmwsEnv0 = $env:NOTE; $env:NOTE = '\u2019\u2019; exit; \u2019\u2019'`, 'try {',
      `& (Get-Command 'agent\u2019\u2019; Remove-Item -Recurse C:\\x; \u2018\u2018' -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source '\u201A\u201Aa\u201B\u201B'`,
      '} finally {', '$env:NOTE = $dmwsEnv0', '}', '}'
    ]);
  });
  it('resolves the application with one shared lookup for agents and Codex', () => {
    expect(powerShellApplication('codex')).toBe('(Get-Command codex -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source');
    expect(powerShellApplication('my\u2019codex')).toBe(`(Get-Command 'my\u2019\u2019codex' -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source`);
    expect(codexSetup('C:\\t\\h.cjs', 1, 'tok', true, false, undefined, { program: 'my\u2019codex' }).command)
      .toContain(`& ${powerShellApplication('my\u2019codex')} --% -c "`);
  });
});

describe('buildAgentCommand', () => {
  it('keeps the default Claude command unchanged on POSIX and appends quoted args', () => {
    expect(buildAgentCommand({ profile: builtinAgentProfile('claude'), shell: 'posix', settingsPath: '/t/s.json', remote: false }))
      .toBe(`claude --settings '/t/s.json'`);
    expect(buildAgentCommand({ profile: { ...builtinAgentProfile('claude'), args: ['--model', "it's"] }, shell: 'posix', settingsPath: '/t/s.json', remote: true }))
      .toBe(`claude --settings '/t/s.json' --remote-control '--model' 'it'\\''s'`);
  });
  it('scopes environment variables to the agent on POSIX with a subshell', () => {
    const command = buildAgentCommand({ profile: custom({ env: { OLLAMA_HOST: 'http://x', NOTE: "it's" } }), shell: 'posix', settingsPath: '/t/s.json', remote: false });
    expect(command).toBe(`( export OLLAMA_HOST='http://x' NOTE='it'\\''s'; opencode )`);
  });
  it('resolves the application on PowerShell and quotes program and args', () => {
    const command = buildAgentCommand({ profile: custom({ command: 'C:\\Program Files\\x\\agent.exe', args: ["it's"] }), shell: 'powershell', settingsPath: 'C:\\t\\s.json', remote: false });
    expect(command).toBe(`& (Get-Command 'C:\\Program Files\\x\\agent.exe' -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source 'it''s'`);
  });
  it('restores PowerShell environment variables in finally', () => {
    const command = buildAgentCommand({ profile: custom({ env: { A: 'x' } }), shell: 'powershell', settingsPath: 's', remote: false });
    expect(command.split('\n')).toEqual([
      '& {', `$dmwsEnv0 = $env:A; $env:A = 'x'`, 'try {',
      `& (Get-Command opencode -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source`,
      '} finally {', '$env:A = $dmwsEnv0', '}', '}'
    ]);
  });
  it('nests the Codex PowerShell block inside the environment block', () => {
    for (const remote of [false, true]) {
      const codex = codexSetup('C:\\t\\h.cjs', 1, 'tok', true, remote, remote ? 'n'.repeat(64) : undefined, { program: 'codex', args: ['--profile', 'o s'] });
      const command = buildAgentCommand({ profile: { ...builtinAgentProfile('codex'), env: { OPENAI_BASE_URL: "http://x/'v1'" } },
        shell: 'powershell', settingsPath: 'C:\\t\\h.cjs', remote, codexCommand: codex.command });
      const lines = command.split('\n');
      expect(lines).toEqual([
        '& {', `$dmwsEnv0 = $env:OPENAI_BASE_URL; $env:OPENAI_BASE_URL = 'http://x/''v1'''`, 'try {',
        ...codex.command.split('\n'),
        '} finally {', '$env:OPENAI_BASE_URL = $dmwsEnv0', '}', '}'
      ]);
      // The inner Codex scope is a block of its own: its first and last lines
      // open and close it, and --% (stop parsing to the end of the line) never
      // shares a line with a closing brace of either block.
      expect(codex.command.split('\n')[0]).toBe('& {');
      expect(codex.command.split('\n').at(-1)).toBe('}');
      // Without the phone option there is one invocation with and one without
      // --no-daemon (for Codex versions that don't know the flag).
      const stopParsing = lines.filter(line => line.includes(' --% '));
      expect(stopParsing).toHaveLength(remote ? 1 : 2);
      for (const line of stopParsing) expect(line).toMatch(/^& \(Get-Command codex .* --% .* "--profile" "o s"$/);
      // Outside the --% line (whose TOML config carries braces of its own) the
      // script's braces balance.
      const braces = lines.filter(line => !line.includes(' --% ')).join('\n');
      expect(braces.split('{').length).toBe(braces.split('}').length);
    }
  });
  it('uses the prepared Codex command as the inner command', () => {
    expect(buildAgentCommand({ profile: builtinAgentProfile('codex'), shell: 'posix', settingsPath: 's', remote: false, codexCommand: 'command codex -c x' }))
      .toBe('command codex -c x');
  });
});

describe('codexSetup with profile program and args', () => {
  it('probes the default executable before choosing the local runtime', () => {
    expect(codexSetup('/t/h.cjs', 1, 'tok', false).command.split('\n')[0])
      .toBe('case "$(command codex --help 2>&1)" in');
  });
  it('quotes a custom program and appends args on POSIX and after --% on PowerShell', () => {
    const posix = codexSetup('/t/h.cjs', 1, 'tok', false, false, undefined, { program: '/opt/my codex', args: ['--profile', 'o s'] }).command;
    expect(posix).toContain(`command '/opt/my codex' --help 2>&1`);
    for (const line of posix.split('\n').filter(line => line.includes(' -c '))) {
      expect(line).toMatch(/^ {4}command '\/opt\/my codex' (?:--no-daemon )?-c '.*' '--profile' 'o s' ;;$/);
    }
    const ps = codexSetup('C:\\t\\h.cjs', 1, 'tok', true, false, undefined, { program: 'codex', args: ['--profile', 'o s'] }).command;
    expect(ps).toContain(' --% -c "');
    expect(ps).toMatch(/ "--profile" "o s"\n\}\n\}$/);
  });
});

describe('codexSetup on PowerShell and the shared Codex server', () => {
  const lines = (remote: boolean) =>
    codexSetup('C:\\t\\h.cjs', 1, 'tok', true, remote, remote ? 'n'.repeat(64) : undefined).command.split('\n');
  it('starts Codex without the console-less background server when the version supports it', () => {
    const l = lines(false);
    const probe = l.findIndex(line => line.startsWith('if ((& (Get-Command codex '));
    expect(l[probe]).toBe(`if ((& ${powerShellApplication('codex')} --help 2>&1 | Out-String) -match '--no-daemon') {`);
    expect(l[probe + 1]).toMatch(/ --% --no-daemon -c "/);
    expect(l[probe + 2]).toBe('} else {');
    expect(l[probe + 3]).toMatch(/ --% -c "/);
    expect(l[probe + 4]).toBe('}');
  });
  it('keeps the server for the phone option, which connects through it', () => {
    const command = lines(true).join('\n');
    expect(command).not.toContain('--no-daemon');
    expect(command).toContain(' --% --remote unix:// ');
  });
  it('keeps the POSIX phone option on the remote server', () => {
    const command = codexSetup('/t/h.cjs', 1, 'tok', false, true).command;
    expect(command).not.toContain('--no-daemon');
    expect(command).toContain('--remote unix://');
  });
});

describe('argumentProblem', () => {
  const host = (major: number, minor: number, appExtension = 'exe') => ({ version: [major, minor] as [number, number], appExtension });
  it('accepts everything on POSIX', () => {
    expect(argumentProblem(custom({ args: ['a"b', '%x%', 'c\\ d\\'] }), null)).toBeNull();
  });
  it('rejects quotes and trailing backslashes with spaces on legacy PowerShell or batch launchers', () => {
    expect(argumentProblem(custom({ args: ['a"b'] }), host(5, 1))).toBe('unsupported-argument');
    expect(argumentProblem(custom({ args: ['C:\\my dir\\'] }), host(7, 2))).toBe('unsupported-argument');
    expect(argumentProblem(custom({ args: ['a"b'] }), host(7, 4, 'cmd'))).toBe('unsupported-argument');
    expect(argumentProblem(custom({ args: ['a"b'] }), host(7, 4))).toBeNull();
  });
  it('rejects percent signs for batch launchers and Codex on PowerShell', () => {
    expect(argumentProblem(custom({ args: ['100%'] }), host(7, 4, 'bat'))).toBe('unsupported-argument');
    expect(argumentProblem({ ...builtinAgentProfile('codex'), args: ['%PATH%'] }, host(7, 4))).toBe('unsupported-argument');
    expect(argumentProblem(custom({ args: ['100%'] }), host(7, 4))).toBeNull();
  });
  it('rejects cmd.exe metacharacters for batch launchers, Codex included', () => {
    for (const arg of ['a&b', 'a|b', '<in', 'out>', 'x^y', '(x)', 'f(', ')']) {
      expect(argumentProblem(custom({ args: [arg] }), host(7, 4, 'cmd'))).toBe('unsupported-argument');
      expect(argumentProblem(custom({ args: [arg] }), host(5, 1, 'bat'))).toBe('unsupported-argument');
      expect(argumentProblem({ ...builtinAgentProfile('codex'), args: [arg] }, host(7, 4, 'cmd'))).toBe('unsupported-argument');
      expect(argumentProblem(custom({ args: [arg] }), host(7, 4))).toBeNull();
      expect(argumentProblem({ ...builtinAgentProfile('codex'), args: [arg] }, host(7, 4))).toBeNull();
    }
    expect(argumentProblem(custom({ args: ['--model', 'ollama/qwen3-coder'] }), host(7, 4, 'cmd'))).toBeNull();
  });
});

describe('start prompt and pull on start', () => {
  const host = (appExtension: string) => ({ version: [7, 4] as [number, number], appExtension });
  it('passes the start prompt after -- on POSIX and as --prompt= for OpenCode on PowerShell', () => {
    const claude = { ...builtinAgentProfile('claude'), startPrompt: "Hole es's" };
    expect(buildAgentCommand({ profile: claude, shell: 'posix', settingsPath: '/t/s.json', remote: false }))
      .toBe(`claude --settings '/t/s.json' '--' 'Hole es'\\''s'`);
    expect(buildAgentCommand({ profile: custom({ startPrompt: 'Hallo Welt' }), shell: 'powershell', settingsPath: 's', remote: false }))
      .toBe(`& (Get-Command opencode -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source '--prompt=Hallo Welt'`);
  });
  it('puts the start prompt after the Codex arguments behind --%', () => {
    const profile = { ...builtinAgentProfile('codex'), args: ['--profile', 'o'], startPrompt: 'Hallo Welt' };
    const codex = codexSetup('C:\\t\\h.cjs', 1, 'tok', true, false, undefined, { program: 'codex', args: launchArgs(profile) });
    expect(codex.command).toMatch(/ "--profile" "o" "--" "Hallo Welt"\n\}\n\}$/);
  });
  it('runs git pull --ff-only before the agent, inside a repository only', () => {
    const profile = { ...builtinAgentProfile('claude'), pullOnStart: true };
    expect(buildAgentCommand({ profile, shell: 'posix', settingsPath: '/t/s.json', remote: false }).split('\n'))
      .toEqual(['if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then git pull --ff-only; fi', `claude --settings '/t/s.json'`]);
    const ps = buildAgentCommand({ profile, shell: 'powershell', settingsPath: 's', remote: false }).split('\n');
    expect(ps[0]).toBe(`if ((Get-Command git -CommandType Application -ErrorAction SilentlyContinue) -and ((git rev-parse --is-inside-work-tree 2>$null) -eq 'true')) { git pull --ff-only }`);
    expect(ps).toHaveLength(2);
  });
  it('keeps the pull outside the environment block and omits it by default', () => {
    const lines = buildAgentCommand({ profile: custom({ pullOnStart: true, env: { A: 'x' } }), shell: 'posix', settingsPath: 's', remote: false }).split('\n');
    expect(lines[1]).toBe(`( export A='x'; opencode )`);
    expect(buildAgentCommand({ profile: custom({}), shell: 'posix', settingsPath: 's', remote: false })).not.toContain('git pull');
  });
  it('checks the start prompt like any other argument', () => {
    expect(argumentProblem(custom({ startPrompt: 'Hole (alles)' }), host('cmd'))).toBe('unsupported-argument');
    expect(argumentProblem(custom({ startPrompt: 'Hole alles' }), host('cmd'))).toBeNull();
  });
});
