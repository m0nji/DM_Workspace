// Nach dem Aufwachen aus dem Ruhezustand (oder Entsperren) kann der GPU-Speicher
// geleert sein, ohne dass Chromium einen WebGL-Kontextverlust meldet. Die
// Terminal-Panes zeichnen dann weiter Hintergründe und Cursor, aber keinen
// Text: xterm lädt die Glyph-Textur nur bei einer Atlas-Änderung neu hoch
// (GlyphRenderer: page.version !== texture.version), eine still geleerte Textur
// bemerkt es nie. Bisher half erst ein Workspace-Wechsel oder ein Fokuswechsel
// (z. B. durch einen Screenshot).
//
// Hier: beim Aufwachen das ganze Fenster neu komponieren lassen und dem
// Renderer Bescheid geben, der die Atlanten der Terminals neu aufbaut (siehe
// repaintTerminals in terminal-registry.ts).

/** Nur der Ausschnitt von powerMonitor, den das Aufwachen braucht. */
export interface WakeSource {
  on(event: 'resume' | 'unlock-screen', listener: () => void): unknown;
  removeListener(event: 'resume' | 'unlock-screen', listener: () => void): unknown;
}

/** Nur der Ausschnitt von BrowserWindow, den das Neuzeichnen braucht. */
export interface WakeWindow {
  isDestroyed(): boolean;
  webContents: { invalidate(): void; send(channel: string): void };
}

export const SYSTEM_WAKE_CHANNEL = 'system:wake';

/** Verdrahtet das Aufwachen mit dem Fenster. Gibt die Abmeldung zurück (beim 'closed' rufen). */
export function wireWakeRepaint(power: WakeSource, win: WakeWindow): () => void {
  const onWake = (): void => {
    if (win.isDestroyed()) return;
    win.webContents.invalidate();
    win.webContents.send(SYSTEM_WAKE_CHANNEL);
  };
  power.on('resume', onWake);
  power.on('unlock-screen', onWake);
  return () => {
    power.removeListener('resume', onWake);
    power.removeListener('unlock-screen', onWake);
  };
}
