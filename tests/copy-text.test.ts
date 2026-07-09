import { describe, it, expect } from 'vitest';
import { stripTrailingWhitespace, selectionAsCommand } from '../src/shared/copy-text';

describe('stripTrailingWhitespace', () => {
  it('strips spaces and tabs at each line end', () => {
    expect(stripTrailingWhitespace('foo   \nbar\t\nbaz')).toBe('foo\nbar\nbaz');
  });

  it('keeps leading indentation (code!)', () => {
    expect(stripTrailingWhitespace('def f():\n    return 1   ')).toBe('def f():\n    return 1');
  });

  it('keeps empty lines and the overall line structure', () => {
    expect(stripTrailingWhitespace('a  \n\nb  ')).toBe('a\n\nb');
  });

  it('handles CRLF from foreign clipboard content', () => {
    expect(stripTrailingWhitespace('a  \r\nb  ')).toBe('a\nb');
  });

  it('leaves a selection without padding untouched', () => {
    expect(stripTrailingWhitespace('npm run build')).toBe('npm run build');
  });
});

describe('selectionAsCommand', () => {
  it('trims every line and joins the fragments into one line', () => {
    expect(selectionAsCommand('  git clone https://example.com/repo.git \\\n'
      + '    --depth 1  ')).toBe('git clone https://example.com/repo.git \\ --depth 1');
  });

  it('joins a TUI-wrapped command into a single pasteable line', () => {
    const sel = '  npm install --save-dev @xterm/xterm   \n'
      + '      @xterm/addon-fit @xterm/addon-search   ';
    expect(selectionAsCommand(sel)).toBe('npm install --save-dev @xterm/xterm @xterm/addon-fit @xterm/addon-search');
  });

  it('drops blank padding lines entirely', () => {
    expect(selectionAsCommand('   \n  echo hi  \n   \n')).toBe('echo hi');
  });

  it('returns an empty string for whitespace-only selections', () => {
    expect(selectionAsCommand('   \n \t \n')).toBe('');
  });
});
