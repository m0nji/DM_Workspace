import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as atomic from '../src/main/atomic-write';
import { defaultState, loadStateFromFile, saveStateToFile, serialize, StateLoadError } from '../src/main/persistence';
import { stateLoadErrorMessage } from '../src/main/state-load-error';

const dirs: string[] = [];
function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dmws-state-recovery-'));
  dirs.push(dir);
  return join(dir, 'state.json');
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('state recovery without data loss', () => {
  it('loads a PowerShell UTF-8 BOM without losing workspaces, templates or settings', () => {
    const file = fixture();
    const state = defaultState();
    state.workspaces[0].name = 'My existing project';
    state.settings.locale = 'de';
    state.workspaceTemplates = [{ id: 'tpl', name: 'Review', cwd: '/project', confirmStartupCommands: true, layout: { type: 'pane', id: 'p7' } }];
    writeFileSync(file, '\uFEFF' + serialize(state));
    expect(loadStateFromFile(file)).toEqual(state);
    expect(saveStateToFile(file, state)).toBe(true);
    expect(loadStateFromFile(file)).toEqual(state);
    expect(readdirSync(dirs[0])).toEqual(['state.json']);
  });

  it.each([
    Buffer.from('{"workspaces":'),
    Buffer.from('{"version":99,"workspaces":[],"activeWorkspaceId":null}'),
    Buffer.from('{}'),
    Buffer.from([0xff, 0xfe, 0x7b, 0x00])
  ])('preserves invalid bytes and refuses default autosaves (%s)', (bytes) => {
    const file = fixture();
    writeFileSync(file, bytes);
    let failure: StateLoadError | undefined;
    try { loadStateFromFile(file); } catch (err) { failure = err as StateLoadError; }
    expect(failure).toBeInstanceOf(StateLoadError);
    expect(failure?.backupFile).toContain('state.json.corrupt-');
    expect(readFileSync(failure!.backupFile!)).toEqual(bytes);
    if (process.platform !== 'win32') expect(statSync(failure!.backupFile!).mode & 0o777).toBe(0o600);
    expect(saveStateToFile(file, defaultState())).toBe(false);
    expect(readFileSync(file)).toEqual(bytes);
    expect(readdirSync(dirs[0])).toHaveLength(2);
    // Even a subsequent disappearance is not mistaken for a first launch.
    rmSync(file);
    expect(() => loadStateFromFile(file)).toThrow(StateLoadError);
    expect(saveStateToFile(file, defaultState())).toBe(false);
  });

  it('never overwrites the original when its backup cannot be written', () => {
    const file = fixture();
    writeFileSync(file, 'damaged private configuration');
    vi.spyOn(atomic, 'writeFileAtomic').mockImplementation(() => { throw new Error('disk full'); });
    let failure: StateLoadError | undefined;
    try { loadStateFromFile(file); } catch (err) { failure = err as StateLoadError; }
    expect(failure).toBeInstanceOf(StateLoadError);
    expect(failure?.backupFile).toBeUndefined();
    expect(String(failure)).not.toContain('private');
    expect(saveStateToFile(file, defaultState())).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe('damaged private configuration');
  });

  it('catches corruption that happened after loading and before autosave', () => {
    const file = fixture();
    expect(saveStateToFile(file, defaultState())).toBe(true);
    const state = loadStateFromFile(file);
    writeFileSync(file, '{broken');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(saveStateToFile(file, state)).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe('{broken');
    const backup = readdirSync(dirs[0]).find(name => name.includes('.corrupt-'))!;
    expect(readFileSync(join(dirs[0], backup), 'utf8')).toBe('{broken');
    writeFileSync(file, serialize(state));
    expect(loadStateFromFile(file)).toEqual(state);
    expect(saveStateToFile(file, state)).toBe(true);
  });

  it('explains the stop and backup location in German and English', () => {
    const error = new StateLoadError('/profile/state.json', '/profile/state.json.corrupt-test');
    expect(stateLoadErrorMessage(error, 'de-DE').detail).toContain('DM Workspace wird beendet');
    expect(stateLoadErrorMessage(error, 'en-US').detail).toContain('DM Workspace will close');
    expect(stateLoadErrorMessage(error, 'en-US').detail).toContain(error.backupFile);
    expect(stateLoadErrorMessage(new StateLoadError(error.file), 'de').detail).toContain('Zugriffsrechte');
  });
});
