import { describe, it, expect } from 'vitest';
import { paneDisplayName } from '../src/renderer/pane-display-name';

describe('paneDisplayName', () => {
  it('bevorzugt die Beschriftung vor dem Ordner', () => {
    expect(paneDisplayName('Server-Logs', '/home/m/projekte/dm')).toBe('Server-Logs');
  });

  it('nimmt ohne Beschriftung den Basisnamen des Pfades', () => {
    expect(paneDisplayName('', '/home/m/projekte/dm')).toBe('dm');
  });

  it('versteht Windows-Pfade', () => {
    expect(paneDisplayName('', 'C:\\Users\\m\\Projekte\\dm')).toBe('dm');
  });

  // Ein Pfad ohne Trenner ist bereits sein eigener Basisname.
  it('laesst einen Pfad ohne Trenner unveraendert', () => {
    expect(paneDisplayName('', 'dm')).toBe('dm');
  });

  // basename('/') ist leer -- ohne Rueckfall auf den Pfad selbst stuende im
  // Hinweis ein leeres Anfuehrungszeichen-Paar.
  it('faellt bei einem Wurzelpfad auf den Pfad selbst zurueck', () => {
    expect(paneDisplayName('', '/')).toBe('/');
  });

  it('ignoriert eine Beschriftung aus reinem Leerraum', () => {
    expect(paneDisplayName('   ', '/home/m/dm')).toBe('dm');
  });

  // Ein frisch angelegtes Pane hat noch kein gemeldetes Arbeitsverzeichnis.
  // Der Aufrufer zeigt dann den Rueckfalltext statt eines leeren Namens.
  it('liefert leer, wenn weder Beschriftung noch Pfad vorliegen', () => {
    expect(paneDisplayName('', '')).toBe('');
  });
});
