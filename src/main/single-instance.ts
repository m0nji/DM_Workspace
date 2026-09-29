// Ein Profil, eine Instanz. Zwei Instanzen teilen sich userData: beide
// schreiben state.json und scrollback.json komplett zurück (die zuletzt
// speichernde gewinnt), die zweite überschreibt die generierte zsh-Integration
// mit ihrem eigenen Prompt-Nonce, und das Beenden der einen räumt das Temp-
// Verzeichnis der anderen ab. macOS verhindert den Zweitstart selbst; Windows
// und Linux nicht.
//
// Der Lock hängt am userData-Pfad. Die E2E-Läufe setzen ihn per DMWS_E2E/
// DMWS_USERDATA um, bevor dieses Modul läuft — parallele Testinstanzen mit
// eigenem Profil bleiben also möglich.
export interface SingleInstanceApp {
  requestSingleInstanceLock(): boolean;
  on(event: 'second-instance', listener: () => void): unknown;
  quit(): void;
}

export interface FocusableWindow {
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
}

export function enforceSingleInstance(
  app: SingleInstanceApp,
  getWindow: () => FocusableWindow | null | undefined
): boolean {
  if (!app.requestSingleInstanceLock()) {
    // Ohne diese Zeile endet ein `npm run dev` neben der installierten App
    // (gleiches Profil) stumm — der Grund gehört ins Terminal des Aufrufers.
    console.error('[main] another instance already holds the lock for this profile — quitting');
    app.quit();
    return false;
  }
  app.on('second-instance', () => {
    const win = getWindow();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  return true;
}
