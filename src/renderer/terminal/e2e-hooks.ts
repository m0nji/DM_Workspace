import type { Terminal } from '@xterm/xterm';

// Test-Hooks, die die e2e-Suite pro Pane am window erwartet (siehe main.tsx):
//
//  - __bufferTypes: der aktive Puffertyp, damit Tests die Alt-Screen-Erholung
//    prüfen können, ohne xterms DOM zu befragen (dessen Scroll-Metriken den
//    Pufferwechsel nicht deterministisch widerspiegeln).
//  - __termWrite: direktes term.write, um renderer-seitige Vergiftung zu
//    simulieren — den Weg, den ein schlechter Scrollback-Restore nimmt. Über die
//    PTY geht das nicht: ConPTY schluckt unter Windows die Mouse-Tracking-DECSETs,
//    die durch die Shell kommen.
//  - __bufferText: der Text des normalen Puffers für Restore-Assertions,
//    unabhängig vom Viewport.
//
// Alle drei landen in EINER Map-Liste, und der Disposer räumt genau diese Liste
// ab. Vorher standen Registrierung und Abmeldung 500 Zeilen auseinander, und
// prompt wurden zwei der drei beim Unmount vergessen: die Closures hielten das
// disposete Terminal fest, und ein späterer Test hätte ein totes xterm
// angesteuert, statt am fehlenden Eintrag zu scheitern.
const HOOK_NAMES = ['__bufferTypes', '__termWrite', '__bufferText'] as const;

type HookWindow = Record<string, Map<string, unknown> | undefined>;

export function registerE2EHooks(paneId: string, term: Terminal): () => void {
  if (!window.api?.isE2E) return () => { /* außerhalb von e2e gibt es nichts abzuräumen */ };

  const g = window as unknown as HookWindow;
  const set = (name: string, value: unknown): void => {
    (g[name] ??= new Map()).set(paneId, value);
  };

  set('__bufferTypes', () => term.buffer.active.type);
  set('__termWrite', (data: string) => term.write(data));
  set('__bufferText', () => {
    const b = term.buffer.normal;
    const rows: string[] = [];
    for (let i = 0; i < b.length; i++) rows.push(b.getLine(i)?.translateToString(true) ?? '');
    return rows.join('\n');
  });

  return () => {
    for (const name of HOOK_NAMES) g[name]?.delete(paneId);
  };
}
