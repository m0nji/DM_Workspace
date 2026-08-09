import { describe, expect, it } from 'vitest';
import { describeIpcError } from '../src/renderer/ipc-error';

describe('describeIpcError', () => {
  it('entfernt den Electron-Präfix, den der Nutzer nie sehen soll', () => {
    // Genau so stand es in der Oberfläche: der Methodenname der IPC-Brücke
    // mitten im Dialog "Neuer Remote-Workspace".
    expect(describeIpcError(new Error(
      "Error invoking remote method 'remote:projects': Error: Nicht angemeldet"
    ))).toBe('Nicht angemeldet');
  });

  it('entfernt auch einen doppelten Fehler-Präfix', () => {
    expect(describeIpcError(new Error(
      "Error invoking remote method 'remote:panes': TypeError: kaputt"
    ))).toBe('kaputt');
  });

  it('lässt eine schon saubere Meldung unangetastet', () => {
    expect(describeIpcError(new Error('Server nicht erreichbar'))).toBe('Server nicht erreichbar');
  });

  it('kommt mit Werten klar, die gar keine Error-Instanz sind', () => {
    // Über die IPC-Grenze kann alles ankommen; ein Absturz beim Anzeigen
    // eines Fehlers wäre die schlechteste Art zu scheitern.
    expect(describeIpcError('schlicht ein String')).toBe('schlicht ein String');
    expect(describeIpcError(null)).toBe('null');
    expect(describeIpcError({ seltsam: true })).toContain('object');
  });

  it('gibt bei leerer Meldung etwas Anzeigbares zurück statt einer leeren Zeile', () => {
    expect(describeIpcError(new Error(''))).not.toBe('');
    expect(describeIpcError(new Error("Error invoking remote method 'x': Error: "))).not.toBe('');
  });
});
