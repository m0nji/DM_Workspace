import { describe, it, expect } from 'vitest';
import { isPaneRunning, workspaceRunning } from '../src/shared/pane-busy';

// Die Frage lautet "passiert dort noch was, oder ist eine Eingabe faellig?".
// Beide Quellen beantworten davon verschiedene Haelften: der Prompt-Marker
// sagt verlaesslich, wann die Shell WIEDER FREI ist; ob gerade gearbeitet
// wird, sagt nur die Heuristik auf dem Ausgabestrom.
describe('isPaneRunning', () => {
  // Die Haelfte, die der Marker allein kann: die Shell meldet selbst, dass sie
  // auf Eingabe wartet. Ausgabe kann nach dem Prompt noch nachlaufen (Motd, ein
  // Hintergrundjob, der in dieselbe Pane schreibt) — am Prompt zu stehen ist
  // trotzdem die staerkere Aussage und schlaegt die Heuristik.
  it('glaubt der Shell, wenn sie sich als frei meldet', () => {
    expect(isPaneRunning('atPrompt', 'busy')).toBe(false);
    expect(isPaneRunning('atPrompt', 'done')).toBe(false);
    expect(isPaneRunning('atPrompt', 'idle')).toBe(false);
  });

  // An echten Sitzungen gemessen (Claude Code und Codex): ein wartender Agent
  // meldet 'running', weil seit dem letzten Prompt eine Zeile abgeschickt wurde
  // und er noch laeuft. Genau dann ist aber eine Eingabe faellig. 'running'
  // allein darf deshalb nichts ausloesen.
  it('haelt ein wartendes Unterprogramm nicht faelschlich fuer beschaeftigt', () => {
    expect(isPaneRunning('running', 'done')).toBe(false);
    expect(isPaneRunning('running', 'idle')).toBe(false);
  });

  it('erkennt ein arbeitendes Unterprogramm an seiner Ausgabe', () => {
    expect(isPaneRunning('running', 'busy')).toBe(true);
  });

  it('faellt ohne Marker auf die Heuristik zurueck', () => {
    // Remote-Panes und Shells ohne unsere Integration (cmd.exe) senden nie
    // einen Marker und stehen dauerhaft auf 'unknown'.
    expect(isPaneRunning('unknown', 'busy')).toBe(true);
    expect(isPaneRunning('unknown', 'idle')).toBe(false);
    expect(isPaneRunning('unknown', 'done')).toBe(false);
  });

  // Stirbt der Prozess mitten in einem Kommando (Ctrl+C auf die Shell selbst,
  // Absturz, exit), kommt nie wieder ein Prompt-Marker. TerminalView meldet
  // deshalb beim Prozessende 'unknown'; abgeraeumt wird die Anzeige dann von
  // der Heuristik, sobald die letzte Ausgabe verstummt ist.
  it('laesst eine tote Pane von der Heuristik abraeumen', () => {
    expect(isPaneRunning('unknown', 'busy')).toBe(true);
    expect(isPaneRunning('unknown', 'done')).toBe(false);
  });

  it('behandelt eine Pane ohne jede Meldung als untaetig', () => {
    // Frisch angelegt, noch nichts gespawnt: nichts zu melden heisst nicht
    // "es laeuft etwas".
    expect(isPaneRunning(undefined, undefined)).toBe(false);
    expect(isPaneRunning('running', undefined)).toBe(false);
    expect(isPaneRunning(undefined, 'busy')).toBe(true);
  });
});

describe('workspaceRunning', () => {
  const shell = { a: 'atPrompt', b: 'running', c: 'unknown' } as const;

  it('meldet ein Register, sobald EINE seiner Panes arbeitet', () => {
    const status = { a: 'idle', b: 'busy', c: 'idle' } as const;
    expect(workspaceRunning(['a', 'b'], shell, status)).toBe(true);
  });

  it('meldet nichts, wenn alle Panes auf Eingabe warten', () => {
    // b laeuft zwar noch (ein offener Agent), wartet aber — das ist der Fall,
    // der die Anzeige frueher dauerhaft angeschaltet haette.
    const status = { a: 'idle', b: 'done', c: 'done' } as const;
    expect(workspaceRunning(['a', 'b', 'c'], shell, status)).toBe(false);
  });

  it('laesst eine wartende Shell eine arbeitende Nachbar-Pane nicht ueberstimmen', () => {
    const status = { a: 'busy', b: 'busy', c: 'idle' } as const;
    // a steht am Prompt und zaehlt nicht, b arbeitet und zaehlt.
    expect(workspaceRunning(['a'], shell, status)).toBe(false);
    expect(workspaceRunning(['a', 'b'], shell, status)).toBe(true);
  });

  it('meldet nichts fuer ein Register ohne Panes', () => {
    // Der Willkommensbildschirm hat kein Layout und damit keine Pane.
    expect(workspaceRunning([], shell, { a: 'busy', b: 'busy', c: 'busy' })).toBe(false);
  });
});
