import { describe, it, expect } from 'vitest';
import {
  MAX_DIMENSION, asDimension, isNonEmptyString, isRecord,
  parseAgentDone, parsePtyInput, parsePtyResize, parsePtySpawn,
  parseScrollbackSave, parseTasksSave
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
