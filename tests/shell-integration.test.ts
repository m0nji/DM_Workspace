import { describe, it, expect } from 'vitest';
import { bashPromptCommand, zshIntegrationFiles, screenrcContent, shellArgs, psCwdBootstrap } from '../src/main/shell-integration';
import { DMWS_PROMPT_OSC, promptPayload } from '../src/shared/pane-auto-title';

// Every hook embeds this launch's nonce, so the marker it prints cannot be
// reproduced by a program that only sees the terminal's output stream.
const NONCE = 'deadbeefcafe';
const MARKER = `]${DMWS_PROMPT_OSC};${promptPayload(NONCE)}`;

describe('shellArgs', () => {
  it('passes the OSC 9;9 cwd bootstrap to PowerShell (any spelling or path)', () => {
    expect(shellArgs('powershell.exe', NONCE)).toEqual(['-NoExit', '-Command', psCwdBootstrap(NONCE)]);
    expect(shellArgs('pwsh', NONCE)).toEqual(['-NoExit', '-Command', psCwdBootstrap(NONCE)]);
    expect(shellArgs('C:\\Program Files\\PowerShell\\7\\pwsh.exe', NONCE))
      .toEqual(['-NoExit', '-Command', psCwdBootstrap(NONCE)]);
  });

  it('launches POSIX shells as login shells', () => {
    expect(shellArgs('/bin/zsh', NONCE)).toEqual(['-l']);
    expect(shellArgs('/usr/bin/bash', NONCE)).toEqual(['-l']);
    expect(shellArgs('fish', NONCE)).toEqual(['-l']);
  });

  it('gives git-bash on Windows the login flag, not PowerShell args', () => {
    expect(shellArgs('C:\\Program Files\\Git\\bin\\bash.exe', NONCE)).toEqual(['-l']);
  });

  it('passes no flags to cmd.exe', () => {
    expect(shellArgs('cmd.exe', NONCE)).toEqual([]);
    expect(shellArgs('C:\\Windows\\System32\\cmd.exe', NONCE)).toEqual([]);
  });
});

describe('bashPromptCommand', () => {
  it('emits an OSC 7 file:// sequence using $HOSTNAME and $PWD', () => {
    const pc = bashPromptCommand(NONCE);
    expect(pc).toContain(']7;file://');
    expect(pc).toContain('$HOSTNAME');
    expect(pc).toContain('$PWD');
    expect(pc).toContain(MARKER);
    // raw ESC + BEL, not the escaped \e/\a literals (env vars are not shell-parsed)
    expect(pc).toContain('\x1b');
    expect(pc).toContain('\x07');
  });
});

describe('zshIntegrationFiles', () => {
  const dir = '/tmp/dmws-int';
  const files = zshIntegrationFiles(dir, NONCE);

  it('produces the four zsh startup files', () => {
    expect(Object.keys(files).sort()).toEqual(['.zlogin', '.zprofile', '.zshenv', '.zshrc']);
  });

  it('.zshrc sources the user file and registers the precmd hook', () => {
    expect(files['.zshrc']).toContain('_DMWS_USER_ZDOTDIR');
    expect(files['.zshrc']).toContain('precmd_functions+=(__dmws_cwd)');
    expect(files['.zshrc']).toContain(']7;file://');
    expect(files['.zshrc']).toContain(MARKER);
  });

  it('PowerShell emits the private local-prompt marker alongside its cwd', () => {
    expect(psCwdBootstrap(NONCE)).toContain(MARKER);
  });

  it('.zshenv re-pins ZDOTDIR to the integration dir after sourcing the user file', () => {
    expect(files['.zshenv']).toContain(`ZDOTDIR='${dir}'`);
  });

  it('escapes single quotes in the integration dir path', () => {
    const f = zshIntegrationFiles("/tmp/o'brien/zsh", NONCE);
    // the embedded path must use POSIX '\'' escaping, not a raw single quote
    expect(f['.zshenv']).toContain(`ZDOTDIR='/tmp/o'\\''brien/zsh'`);
  });

  it('each file sources only its matching user startup file', () => {
    expect(files['.zprofile']).toContain('.zprofile');
    expect(files['.zlogin']).toContain('.zlogin');
    expect(files['.zprofile']).not.toContain('.zshrc');
  });

  it('guards against sourcing the integration dir as the user zsh dir', () => {
    expect(files['.zshenv']).toContain('*/shell-integration/zsh');
    expect(files['.zshenv']).toContain('"$ZDOTDIR"');
  });
});

describe('screenrcContent', () => {
  it('forces the 15-char screen-256color window TERM (under macOS screen MAXTERMLEN 20)', () => {
    const rc = screenrcContent(null);
    expect(rc).toContain('term screen-256color');
    // it must not leave screen to derive the 21-char "screen.xterm-256color"
    expect('screen-256color'.length).toBeLessThanOrEqual(20);
  });

  it('omits a source line when the user has no screenrc', () => {
    expect(screenrcContent(null)).not.toContain('source');
  });

  it('forwards the user screenrc and sets term before sourcing it (so user term wins)', () => {
    const rc = screenrcContent('/Users/x/.screenrc');
    expect(rc).toContain('source "/Users/x/.screenrc"');
    expect(rc.indexOf('term screen-256color')).toBeLessThan(rc.indexOf('source'));
  });

  it('escapes backslashes and double quotes in the sourced path', () => {
    const rc = screenrcContent('/tmp/a"b\\c/.screenrc');
    expect(rc).toContain('source "/tmp/a\\"b\\\\c/.screenrc"');
  });
});
