import { describe, it, expect } from 'vitest';
import { bashPromptCommand, zshIntegrationFiles } from '../src/main/shell-integration';

describe('bashPromptCommand', () => {
  it('emits an OSC 7 file:// sequence using $HOSTNAME and $PWD', () => {
    const pc = bashPromptCommand();
    expect(pc).toContain(']7;file://');
    expect(pc).toContain('$HOSTNAME');
    expect(pc).toContain('$PWD');
    // raw ESC + BEL, not the escaped \e/\a literals (env vars are not shell-parsed)
    expect(pc).toContain('\x1b');
    expect(pc).toContain('\x07');
  });
});

describe('zshIntegrationFiles', () => {
  const dir = '/tmp/dmws-int';
  const files = zshIntegrationFiles(dir);

  it('produces the four zsh startup files', () => {
    expect(Object.keys(files).sort()).toEqual(['.zlogin', '.zprofile', '.zshenv', '.zshrc']);
  });

  it('.zshrc sources the user file and registers the precmd hook', () => {
    expect(files['.zshrc']).toContain('_DMWS_USER_ZDOTDIR');
    expect(files['.zshrc']).toContain('precmd_functions+=(__dmws_cwd)');
    expect(files['.zshrc']).toContain(']7;file://');
  });

  it('.zshenv re-pins ZDOTDIR to the integration dir after sourcing the user file', () => {
    expect(files['.zshenv']).toContain(`ZDOTDIR='${dir}'`);
  });

  it('escapes single quotes in the integration dir path', () => {
    const f = zshIntegrationFiles("/tmp/o'brien/zsh");
    // the embedded path must use POSIX '\'' escaping, not a raw single quote
    expect(f['.zshenv']).toContain(`ZDOTDIR='/tmp/o'\\''brien/zsh'`);
  });

  it('each file sources only its matching user startup file', () => {
    expect(files['.zprofile']).toContain('.zprofile');
    expect(files['.zlogin']).toContain('.zlogin');
    expect(files['.zprofile']).not.toContain('.zshrc');
  });
});
