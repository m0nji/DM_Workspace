import { describe, expect, it } from 'vitest';
import { WORKSPACE_ROOT, toAbsPath, toFsPath, toWorkdir } from '../src/renderer/workdir-path';

// Drei Darstellungen desselben Ortes treffen im Formular aufeinander: der
// Formularwert (relativ, '.' für die Wurzel — so will es der Server), der
// Anzeigepfad (absolut, damit man sieht wo man ist) und der Pfad der Datei-API
// (relativ, aber '' für die Wurzel). Die Umrechnung liegt deshalb an einer
// Stelle statt verstreut in der Oberfläche.

describe('toAbsPath', () => {
  it('setzt den relativen Pfad hinter /workspace', () => {
    expect(toAbsPath('dm_chat/server')).toBe('/workspace/dm_chat/server');
  });

  it('bildet die Wurzel in allen ihren Schreibweisen auf /workspace ab', () => {
    for (const raw of ['.', '', '  ', './', '/', '/.', '//.', '/./']) expect(toAbsPath(raw)).toBe(WORKSPACE_ROOT);
  });

  it('räumt führende und mehrfache Schrägstriche sowie ./ weg', () => {
    expect(toAbsPath('/dm_chat/')).toBe('/workspace/dm_chat');
    expect(toAbsPath('./dm_chat//server/')).toBe('/workspace/dm_chat/server');
    expect(toAbsPath('././dm_chat')).toBe('/workspace/dm_chat');
  });
});

describe('toWorkdir', () => {
  it('macht aus dem absoluten Pfad wieder den Formularwert', () => {
    expect(toWorkdir('/workspace/dm_chat/server')).toBe('dm_chat/server');
  });

  // '.' und nicht '', weil der Server genau das als Wurzel erwartet
  // (validateWorkdir in server/src/tasks/schedule.ts).
  it('gibt für die Wurzel den Punkt zurück', () => {
    expect(toWorkdir(WORKSPACE_ROOT)).toBe('.');
    expect(toWorkdir('/workspace/')).toBe('.');
    expect(toWorkdir('/workspace/.')).toBe('.');
  });

  it('lässt einen Pfad ausserhalb von /workspace unangetastet stehen', () => {
    expect(toWorkdir('/etc/passwd')).toBe('/etc/passwd');
  });
});

describe('toFsPath', () => {
  it('liefert für die Wurzel den leeren Pfad, den die Datei-API erwartet', () => {
    for (const raw of ['.', '', '/', '/.', '//.', '/./']) expect(toFsPath(raw)).toBe('');
  });

  it('liefert sonst den bereinigten relativen Pfad', () => {
    expect(toFsPath('./dm_chat//server/')).toBe('dm_chat/server');
    expect(toFsPath('././dm_chat')).toBe('dm_chat');
  });
});

describe('toWorkdir/toAbsPath als Rundreise', () => {
  it('führt jeden Formularwert unverändert zurück', () => {
    for (const w of ['.', 'src', 'dm_chat/server']) expect(toWorkdir(toAbsPath(w))).toBe(w);
  });
});
