import { describe, it, expect } from 'vitest';
import { windowsBuildFromArgv } from '../src/shared/windows-pty';

describe('ConPTY OS build handoff', () => {
  it('reads the real build without depending on flag position', () => {
    expect(windowsBuildFromArgv(['electron', '--dmws-windows-build=26200', '--other'])).toBe(26200);
    expect(windowsBuildFromArgv(['--dmws-windows-build=19045'])).toBe(19045);
  });
  it.each(['', 'undefined', '-1', '0', '26200junk', '10.0.26200', '9007199254740992'])(
    'rejects an absent or invalid build: %s', value => {
      expect(windowsBuildFromArgv([`--dmws-windows-build=${value}`])).toBeUndefined();
    }
  );
  it('leaves other platforms and older preloads unspecified', () => {
    expect(windowsBuildFromArgv([])).toBeUndefined();
  });
});
