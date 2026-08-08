import { describe, it, expect } from 'vitest';
import {
  MAX_DIMENSION, asDimension, isNonEmptyString, isRecord,
  parseAgentDone, parseLoginLocal, parsePtyInput, parsePtyResize, parsePtySpawn,
  parseRemoteDriverDecision, parseRemoteFsFile, parseRemoteFsList, parseRemoteFsRename,
  parseRemoteFsWrite, parseRemotePaneRef, parseRemoteRef, parseRemoteScopeRef, parseScrollbackSave,
  parseServerConfig, parseServerRef, parseTasksSave, isSafeRemoteFsPath
} from '../src/main/ipc-validate';

// Anders als der Rest von src/main importiert ipc-validate kein Electron —
// deshalb braucht diese Datei keinen vi.mock('electron'), wie ihn etwa
// link-resolve.test.ts aufsetzen muss.

describe('asDimension', () => {
  // Der eigentliche Anlass: node-pty wirft in resize() bei nicht-positiven
  // Werten, und ein Throw in einem ipcMain.on-Listener ist eine
  // uncaughtException im Main-Prozess.
  it('rejects the values node-pty throws on', () => {
    expect(asDimension(0)).toBeNull();
    expect(asDimension(-1)).toBeNull();
  });

  it('rejects non-integers, NaN and Infinity', () => {
    expect(asDimension(1.5)).toBeNull();
    expect(asDimension(NaN)).toBeNull();
    expect(asDimension(Infinity)).toBeNull();
    expect(asDimension(-Infinity)).toBeNull();
  });

  it('rejects values that are not numbers at all', () => {
    expect(asDimension('80')).toBeNull();
    expect(asDimension(null)).toBeNull();
    expect(asDimension(undefined)).toBeNull();
    expect(asDimension({})).toBeNull();
  });

  it('accepts the valid range and rejects absurd sizes', () => {
    expect(asDimension(1)).toBe(1);
    expect(asDimension(80)).toBe(80);
    expect(asDimension(MAX_DIMENSION)).toBe(MAX_DIMENSION);
    expect(asDimension(MAX_DIMENSION + 1)).toBeNull();
  });
});

describe('isRecord / isNonEmptyString', () => {
  it('separates plain objects from arrays and null', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('x')).toBe(false);
  });

  it('requires a non-empty string', () => {
    expect(isNonEmptyString('p1')).toBe(true);
    expect(isNonEmptyString('')).toBe(false);
    expect(isNonEmptyString(undefined)).toBe(false);
    expect(isNonEmptyString(0)).toBe(false);
  });
});

describe('parsePtyResize', () => {
  it('accepts a well-formed payload', () => {
    expect(parsePtyResize({ paneId: 'p1', cols: 80, rows: 24 }))
      .toEqual({ paneId: 'p1', cols: 80, rows: 24 });
  });

  it('rejects zero or negative dimensions', () => {
    expect(parsePtyResize({ paneId: 'p1', cols: 0, rows: 24 })).toBeNull();
    expect(parsePtyResize({ paneId: 'p1', cols: 80, rows: 0 })).toBeNull();
    expect(parsePtyResize({ paneId: 'p1', cols: -5, rows: -5 })).toBeNull();
  });

  it('rejects a missing or empty paneId', () => {
    expect(parsePtyResize({ cols: 80, rows: 24 })).toBeNull();
    expect(parsePtyResize({ paneId: '', cols: 80, rows: 24 })).toBeNull();
  });

  it('rejects non-objects', () => {
    expect(parsePtyResize(undefined)).toBeNull();
    expect(parsePtyResize(null)).toBeNull();
    expect(parsePtyResize('p1')).toBeNull();
    expect(parsePtyResize([])).toBeNull();
  });

  // Nur die bekannten Felder werden übernommen — ein Extrafeld darf nicht
  // durchgereicht werden.
  it('drops unknown fields', () => {
    expect(parsePtyResize({ paneId: 'p1', cols: 80, rows: 24, evil: 1 }))
      .toEqual({ paneId: 'p1', cols: 80, rows: 24 });
  });
});

describe('parsePtyInput', () => {
  it('accepts an empty data string but not a missing one', () => {
    expect(parsePtyInput({ paneId: 'p1', data: '' })).toEqual({ paneId: 'p1', data: '' });
    expect(parsePtyInput({ paneId: 'p1' })).toBeNull();
  });

  it('rejects a non-string data field', () => {
    expect(parsePtyInput({ paneId: 'p1', data: 42 })).toBeNull();
    expect(parsePtyInput({ paneId: 'p1', data: null })).toBeNull();
  });
});

describe('parsePtySpawn', () => {
  it('accepts a well-formed payload', () => {
    expect(parsePtySpawn({ paneId: 'p1', cwd: '/tmp', cols: 80, rows: 24 }))
      .toEqual({ paneId: 'p1', cwd: '/tmp', cols: 80, rows: 24 });
  });

  // Ein leerer cwd ist zulässig: resolveCwd fällt dafür bewusst auf das
  // Home-Verzeichnis zurück.
  it('accepts an empty cwd', () => {
    expect(parsePtySpawn({ paneId: 'p1', cwd: '', cols: 80, rows: 24 })?.cwd).toBe('');
  });

  it('rejects bad dimensions', () => {
    expect(parsePtySpawn({ paneId: 'p1', cwd: '/tmp', cols: 0, rows: 24 })).toBeNull();
  });
});

// Das optionale target-Feld (Remote-Workspaces, Arbeitspaket B1): fehlend =
// lokal; vorhanden wird es strikt geprüft. Ein kaputtes target verwirft den
// ganzen Payload, statt still auf lokal zurückzufallen.
describe('parsePtySpawn target', () => {
  const base = { paneId: 'p1', cwd: '/tmp', cols: 80, rows: 24 };

  it('omits target when the field is missing (local spawn)', () => {
    const parsed = parsePtySpawn(base);
    expect(parsed).toEqual(base);
    expect(parsed).not.toHaveProperty('target');
  });

  it("accepts an explicit { kind: 'local' }", () => {
    expect(parsePtySpawn({ ...base, target: { kind: 'local' } }))
      .toEqual({ ...base, target: { kind: 'local' } });
  });

  it('accepts a remote target with project scope', () => {
    const target = {
      kind: 'remote', serverId: 's1',
      scope: { kind: 'project', projectId: 'pr1' }, remotePaneId: 'rp1'
    };
    expect(parsePtySpawn({ ...base, target })).toEqual({ ...base, target });
  });

  it('accepts a remote target with user scope', () => {
    const target = { kind: 'remote', serverId: 's1', scope: { kind: 'user' }, remotePaneId: 'rp1' };
    expect(parsePtySpawn({ ...base, target })).toEqual({ ...base, target });
  });

  it('rejects an unknown target kind and non-object targets', () => {
    expect(parsePtySpawn({ ...base, target: { kind: 'ssh' } })).toBeNull();
    expect(parsePtySpawn({ ...base, target: 'local' })).toBeNull();
    expect(parsePtySpawn({ ...base, target: null })).toBeNull();
    expect(parsePtySpawn({ ...base, target: [] })).toBeNull();
  });

  it('rejects a remote target with a missing or empty serverId/remotePaneId', () => {
    const scope = { kind: 'user' };
    expect(parsePtySpawn({ ...base, target: { kind: 'remote', scope, remotePaneId: 'rp1' } })).toBeNull();
    expect(parsePtySpawn({ ...base, target: { kind: 'remote', serverId: '', scope, remotePaneId: 'rp1' } })).toBeNull();
    expect(parsePtySpawn({ ...base, target: { kind: 'remote', serverId: 's1', scope } })).toBeNull();
    expect(parsePtySpawn({ ...base, target: { kind: 'remote', serverId: 's1', scope, remotePaneId: '' } })).toBeNull();
  });

  it('rejects a remote target with a broken scope', () => {
    const remote = { kind: 'remote', serverId: 's1', remotePaneId: 'rp1' };
    expect(parsePtySpawn({ ...base, target: remote })).toBeNull();
    expect(parsePtySpawn({ ...base, target: { ...remote, scope: { kind: 'team' } } })).toBeNull();
    expect(parsePtySpawn({ ...base, target: { ...remote, scope: { kind: 'project' } } })).toBeNull();
    expect(parsePtySpawn({ ...base, target: { ...remote, scope: { kind: 'project', projectId: '' } } })).toBeNull();
    expect(parsePtySpawn({ ...base, target: { ...remote, scope: 'user' } })).toBeNull();
  });

  // Wie überall in dieser Datei: nur die bekannten Felder werden übernommen.
  it('drops unknown fields inside target and scope', () => {
    const parsed = parsePtySpawn({
      ...base,
      target: {
        kind: 'remote', serverId: 's1', remotePaneId: 'rp1', evil: 1,
        scope: { kind: 'project', projectId: 'pr1', sneaky: true }
      }
    });
    expect(parsed?.target).toEqual({
      kind: 'remote', serverId: 's1',
      scope: { kind: 'project', projectId: 'pr1' }, remotePaneId: 'rp1'
    });
  });
});

// ---- Remote-Workspaces (Arbeitspaket B2) -----------------------------------

describe('parseServerConfig', () => {
  it('accepts a well-formed server and normalizes a trailing slash', () => {
    expect(parseServerConfig({ id: 's1', name: 'Dev', baseUrl: 'https://dmw.example/' }))
      .toEqual({ id: 's1', name: 'Dev', baseUrl: 'https://dmw.example' });
  });

  it('rejects non-http(s) schemes', () => {
    expect(parseServerConfig({ id: 's1', name: 'Dev', baseUrl: 'file:///etc' })).toBeNull();
    expect(parseServerConfig({ id: 's1', name: 'Dev', baseUrl: 'ws://dmw.example' })).toBeNull();
    expect(parseServerConfig({ id: 's1', name: 'Dev', baseUrl: 'not a url' })).toBeNull();
  });

  // Eingebettete Credentials in der URL würden im Klartext in state.json landen.
  it('rejects URLs with embedded credentials', () => {
    expect(parseServerConfig({ id: 's1', name: 'Dev', baseUrl: 'https://oauth2:tok@dmw.example' })).toBeNull();
  });

  it('rejects missing fields', () => {
    expect(parseServerConfig({ name: 'Dev', baseUrl: 'https://x' })).toBeNull();
    expect(parseServerConfig({ id: 's1', baseUrl: 'https://x' })).toBeNull();
    expect(parseServerConfig({ id: 's1', name: 'Dev' })).toBeNull();
    expect(parseServerConfig(null)).toBeNull();
  });
});

describe('parseServerRef / parseRemoteRef / parseRemoteScopeRef / parseRemotePaneRef / parseRemoteDriverDecision', () => {
  it('accepts well-formed refs and drops unknown fields', () => {
    expect(parseServerRef({ serverId: 's1', evil: 1 })).toEqual({ serverId: 's1' });
    expect(parseRemoteRef({ serverId: 's1', projectId: 'p1', evil: 1 }))
      .toEqual({ serverId: 's1', projectId: 'p1' });
    expect(parseRemoteScopeRef({ serverId: 's1', scopeKey: 'p1', evil: 1 }))
      .toEqual({ serverId: 's1', scopeKey: 'p1' });
    // Der reservierte scopeKey der persönlichen User-Runtime ist ein normaler
    // nicht-leerer String — dieselbe Prüfung wie eine Projekt-UUID.
    expect(parseRemoteScopeRef({ serverId: 's1', scopeKey: 'user' }))
      .toEqual({ serverId: 's1', scopeKey: 'user' });
    expect(parseRemotePaneRef({ serverId: 's1', scopeKey: 'p1', paneId: 'rp1', evil: 1 }))
      .toEqual({ serverId: 's1', scopeKey: 'p1', paneId: 'rp1' });
    expect(parseRemoteDriverDecision({ serverId: 's1', scopeKey: 'p1', paneId: 'rp1', clientId: 'c9' }))
      .toEqual({ serverId: 's1', scopeKey: 'p1', paneId: 'rp1', clientId: 'c9' });
  });

  it('rejects missing or empty fields at every level', () => {
    expect(parseServerRef({})).toBeNull();
    expect(parseServerRef({ serverId: '' })).toBeNull();
    expect(parseRemoteRef({ serverId: 's1' })).toBeNull();
    expect(parseRemoteScopeRef({ serverId: 's1' })).toBeNull();
    expect(parseRemoteScopeRef({ serverId: 's1', scopeKey: '' })).toBeNull();
    expect(parseRemotePaneRef({ serverId: 's1', scopeKey: 'p1' })).toBeNull();
    expect(parseRemoteDriverDecision({ serverId: 's1', scopeKey: 'p1', paneId: 'rp1' })).toBeNull();
    expect(parseRemoteDriverDecision({ serverId: 's1', scopeKey: 'p1', paneId: 'rp1', clientId: '' })).toBeNull();
  });

  it('rejects non-objects', () => {
    expect(parseServerRef('s1')).toBeNull();
    expect(parseRemoteRef(null)).toBeNull();
    expect(parseRemoteScopeRef(null)).toBeNull();
    expect(parseRemotePaneRef([])).toBeNull();
  });
});

describe('parseLoginLocal', () => {
  it('accepts a well-formed payload (empty password is structurally valid)', () => {
    expect(parseLoginLocal({ serverId: 's1', username: 'karl', password: '' }))
      .toEqual({ serverId: 's1', username: 'karl', password: '' });
  });

  it('rejects a missing username or non-string password', () => {
    expect(parseLoginLocal({ serverId: 's1', password: 'x' })).toBeNull();
    expect(parseLoginLocal({ serverId: 's1', username: '', password: 'x' })).toBeNull();
    expect(parseLoginLocal({ serverId: 's1', username: 'k', password: 42 })).toBeNull();
    expect(parseLoginLocal(null)).toBeNull();
  });
});

describe('parseScrollbackSave', () => {
  it('accepts an empty buffer', () => {
    expect(parseScrollbackSave({ paneId: 'p1', data: '' })).toEqual({ paneId: 'p1', data: '' });
  });

  it('rejects a missing paneId', () => {
    expect(parseScrollbackSave({ data: 'x' })).toBeNull();
  });
});

describe('parseAgentDone', () => {
  it('accepts a well-formed payload', () => {
    expect(parseAgentDone({ workspaceId: 'w1', workspaceName: 'One', paneTitle: 'build' }))
      .toEqual({ workspaceId: 'w1', workspaceName: 'One', paneTitle: 'build' });
  });

  it('rejects a payload missing a field', () => {
    expect(parseAgentDone({ workspaceId: 'w1', workspaceName: 'One' })).toBeNull();
  });
});

describe('parseTasksSave', () => {
  const board = {
    columns: [
      { name: 'Todo', tasks: [{ id: 't1', title: 'A', done: false }] },
      { name: 'Done', tasks: [] }
    ]
  };

  it('accepts a well-formed board', () => {
    expect(parseTasksSave({ dir: '/tmp', board })).toEqual({ dir: '/tmp', board });
  });

  it('keeps the optional description and command fields', () => {
    const withOptional = {
      columns: [{ name: 'Todo', tasks: [{ id: 't1', title: 'A', done: true, description: 'd', command: 'ls' }] }]
    };
    expect(parseTasksSave({ dir: '/tmp', board: withOptional })?.board).toEqual(withOptional);
  });

  // Das Board geht direkt in serializeTasks und von dort in die TASKS.md des
  // Nutzers — ein Fremdfeld darf dort nicht landen.
  it('strips unknown task fields', () => {
    const dirty = { columns: [{ name: 'Todo', tasks: [{ id: 't1', title: 'A', done: false, injected: 'x' }] }] };
    const out = parseTasksSave({ dir: '/tmp', board: dirty });
    expect(out?.board.columns[0].tasks[0]).toEqual({ id: 't1', title: 'A', done: false });
  });

  it('rejects a board whose task is missing a required field', () => {
    const broken = { columns: [{ name: 'Todo', tasks: [{ id: 't1', title: 'A' }] }] };
    expect(parseTasksSave({ dir: '/tmp', board: broken })).toBeNull();
  });

  it('rejects a non-array columns field', () => {
    expect(parseTasksSave({ dir: '/tmp', board: { columns: 'nope' } })).toBeNull();
  });

  it('rejects a missing dir', () => {
    expect(parseTasksSave({ board })).toBeNull();
  });
});

// ---- Remote-Dateizugriff (B3) ----------------------------------------------

describe('isSafeRemoteFsPath', () => {
  it('accepts relative project paths incl. the empty root path', () => {
    expect(isSafeRemoteFsPath('')).toBe(true);
    expect(isSafeRemoteFsPath('README.md')).toBe(true);
    expect(isSafeRemoteFsPath('src/app/main.ts')).toBe(true);
    // '..' als Namensbestandteil ist harmlos — nur das Segment '..' klettert.
    expect(isSafeRemoteFsPath('a..b/notes..md')).toBe(true);
  });

  it('rejects any ".." path segment (zusätzlich zur serverseitigen Prüfung)', () => {
    expect(isSafeRemoteFsPath('..')).toBe(false);
    expect(isSafeRemoteFsPath('../etc/passwd')).toBe(false);
    expect(isSafeRemoteFsPath('src/../..')).toBe(false);
    expect(isSafeRemoteFsPath('a/../b')).toBe(false);
  });

  it('rejects Windows backslashes and NUL bytes', () => {
    // Der Renderer baut Remote-Pfade immer mit '/'; ein Backslash wäre ein Bug
    // (und '..\\' würde die Segmentprüfung unterlaufen).
    expect(isSafeRemoteFsPath('src\\app.ts')).toBe(false);
    expect(isSafeRemoteFsPath('..\\..\\etc')).toBe(false);
    expect(isSafeRemoteFsPath('a' + String.fromCharCode(0) + 'b')).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isSafeRemoteFsPath(undefined)).toBe(false);
    expect(isSafeRemoteFsPath(42)).toBe(false);
    expect(isSafeRemoteFsPath(['a'])).toBe(false);
  });
});

describe('parseRemoteFsList / parseRemoteFsFile', () => {
  const base = { serverId: 'srv1', projectId: 'proj1' };

  it('list accepts the empty path (project root)', () => {
    expect(parseRemoteFsList({ ...base, path: '' })).toEqual({ ...base, path: '' });
    expect(parseRemoteFsList({ ...base, path: 'src' })).toEqual({ ...base, path: 'src' });
  });

  it('file requires a non-empty path (root is never a file target)', () => {
    expect(parseRemoteFsFile({ ...base, path: '' })).toBeNull();
    expect(parseRemoteFsFile({ ...base, path: 'a.txt' })).toEqual({ ...base, path: 'a.txt' });
  });

  it('rejects missing ids, missing path and unsafe paths', () => {
    expect(parseRemoteFsList({ serverId: 'srv1', path: 'x' })).toBeNull();
    expect(parseRemoteFsList({ ...base })).toBeNull();
    expect(parseRemoteFsList({ ...base, path: '../x' })).toBeNull();
    expect(parseRemoteFsFile({ ...base, path: 'a\\b.txt' })).toBeNull();
    expect(parseRemoteFsList('nope')).toBeNull();
  });
});

describe('parseRemoteFsWrite', () => {
  const base = { serverId: 'srv1', projectId: 'proj1', path: 'notes.md', content: 'hallo' };

  it('accepts content with and without baseMtime', () => {
    expect(parseRemoteFsWrite(base)).toEqual(base);
    expect(parseRemoteFsWrite({ ...base, baseMtime: 1700000000 })).toEqual({ ...base, baseMtime: 1700000000 });
    // content darf leer sein (neue Datei anlegen).
    expect(parseRemoteFsWrite({ ...base, content: '' })).toEqual({ ...base, content: '' });
  });

  it('rejects a broken baseMtime instead of dropping it silently', () => {
    expect(parseRemoteFsWrite({ ...base, baseMtime: -1 })).toBeNull();
    expect(parseRemoteFsWrite({ ...base, baseMtime: NaN })).toBeNull();
    expect(parseRemoteFsWrite({ ...base, baseMtime: '123' })).toBeNull();
  });

  it('rejects missing content and unsafe paths', () => {
    expect(parseRemoteFsWrite({ serverId: 'srv1', projectId: 'proj1', path: 'x' })).toBeNull();
    expect(parseRemoteFsWrite({ ...base, path: '../notes.md' })).toBeNull();
    expect(parseRemoteFsWrite({ ...base, path: '' })).toBeNull();
  });
});

describe('parseRemoteFsRename', () => {
  const base = { serverId: 'srv1', projectId: 'proj1' };

  it('accepts two safe non-empty paths', () => {
    expect(parseRemoteFsRename({ ...base, from: 'a.txt', to: 'b/c.txt' }))
      .toEqual({ ...base, from: 'a.txt', to: 'b/c.txt' });
  });

  it('rejects empty or unsafe endpoints', () => {
    expect(parseRemoteFsRename({ ...base, from: '', to: 'b' })).toBeNull();
    expect(parseRemoteFsRename({ ...base, from: 'a', to: '' })).toBeNull();
    expect(parseRemoteFsRename({ ...base, from: 'a', to: '../b' })).toBeNull();
    expect(parseRemoteFsRename({ ...base, from: 'a\\b', to: 'c' })).toBeNull();
    expect(parseRemoteFsRename({ ...base, from: 'a' })).toBeNull();
  });
});
