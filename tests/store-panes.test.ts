import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/store';
import { registerTerminalFocus, unregisterTerminalFocus } from '../src/renderer/terminal-registry';
import type { LayoutNode } from '../src/shared/types';

const pane = (id: string): LayoutNode => ({ type: 'pane', id });
const split = (id: string, direction: 'h' | 'v', a: LayoutNode, b: LayoutNode): LayoutNode =>
  ({ type: 'split', id, direction, ratio: 0.5, children: [a, b] });

// 2x2-Gitter:  tl | tr
//              ---+---
//              bl | br
const grid = (): LayoutNode => split('s0', 'v',
  split('s1', 'h', pane('tl'), pane('tr')),
  split('s2', 'h', pane('bl'), pane('br')));

const saveState = vi.fn();

// persist() im Store schreibt ueber eine Promise-Kette; zwei Ticks reichen,
// damit saveInFlight wieder frei ist (wie in store-workspaces.test.ts).
const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('Pane-Navigation im Store', () => {
  beforeEach(() => {
    saveState.mockClear();
    (globalThis as unknown as { window: unknown }).window = {
      api: { saveState, kill: vi.fn() }
    };
    (globalThis as unknown as { requestAnimationFrame: (cb: FrameRequestCallback) => number })
      .requestAnimationFrame = (cb: FrameRequestCallback) => { cb(0); return 0; };
    useStore.setState({
      version: 1,
      workspaces: [{ id: 'w1', name: 'One', cwd: '/tmp', layout: grid() }],
      activeWorkspaceId: 'w1',
      focusedPaneId: 'tl',
      maximizedPaneId: null,
      draggingPaneId: null,
      settings: { themeId: 'default', terminalOpacity: 0.75 }
    });
  });

  it('bewegt den Fokus in jede Richtung', () => {
    useStore.getState().focusPaneInDirection('right');
    expect(useStore.getState().focusedPaneId).toBe('tr');
    useStore.getState().focusPaneInDirection('down');
    expect(useStore.getState().focusedPaneId).toBe('br');
    useStore.getState().focusPaneInDirection('left');
    expect(useStore.getState().focusedPaneId).toBe('bl');
    useStore.getState().focusPaneInDirection('up');
    expect(useStore.getState().focusedPaneId).toBe('tl');
  });

  it('laesst den Fokus am Rand stehen', () => {
    useStore.getState().focusPaneInDirection('left');
    expect(useStore.getState().focusedPaneId).toBe('tl');
    useStore.getState().focusPaneInDirection('up');
    expect(useStore.getState().focusedPaneId).toBe('tl');
  });

  it('tut nichts, solange ein Pane maximiert ist', () => {
    useStore.setState({ maximizedPaneId: 'tl' });
    useStore.getState().focusPaneInDirection('right');
    expect(useStore.getState().focusedPaneId).toBe('tl');
  });

  it('tut nichts ohne fokussiertes Pane', () => {
    useStore.setState({ focusedPaneId: null });
    useStore.getState().focusPaneInDirection('right');
    expect(useStore.getState().focusedPaneId).toBeNull();
  });

  it('tut nichts im Willkommensbildschirm ohne Layout', () => {
    useStore.setState({ workspaces: [{ id: 'w1', name: 'One', cwd: '/tmp', layout: null }] });
    useStore.getState().focusPaneInDirection('right');
    expect(useStore.getState().focusedPaneId).toBe('tl');
  });

  // Der eigentliche Zweck der Aktion: nicht nur focusedPaneId setzen, sondern
  // auch den DOM-Fokus per focusTerminal aufs Ziel-Pane holen. Ohne die
  // requestAnimationFrame(() => focusTerminal(target))-Zeile wuerde nur die
  // Markierung wandern, waehrend die Tastatureingabe im alten Terminal bliebe --
  // das faellt aber nur auf, wenn hier tatsaechlich focusTerminal geprueft wird.
  it('holt den DOM-Fokus per focusTerminal auf das Ziel-Pane nach', () => {
    const trFocus = vi.fn();
    registerTerminalFocus('tr', trFocus);
    try {
      useStore.getState().focusPaneInDirection('right');
      expect(trFocus).toHaveBeenCalledTimes(1);
    } finally {
      unregisterTerminalFocus('tr');
    }
  });

  it('ruft focusTerminal nicht, wenn die Bewegung bei maximiertem Pane wirkungslos bleibt', () => {
    const trFocus = vi.fn();
    registerTerminalFocus('tr', trFocus);
    try {
      useStore.setState({ maximizedPaneId: 'tl' });
      useStore.getState().focusPaneInDirection('right');
      expect(trFocus).not.toHaveBeenCalled();
    } finally {
      unregisterTerminalFocus('tr');
    }
  });
});

describe('Panes tauschen im Store', () => {
  beforeEach(() => {
    saveState.mockClear();
    (globalThis as unknown as { window: unknown }).window = {
      api: { saveState, kill: vi.fn() }
    };
    (globalThis as unknown as { requestAnimationFrame: (cb: FrameRequestCallback) => number })
      .requestAnimationFrame = (cb: FrameRequestCallback) => { cb(0); return 0; };
    useStore.setState({
      version: 1,
      workspaces: [{ id: 'w1', name: 'One', cwd: '/tmp', layout: grid() }],
      activeWorkspaceId: 'w1',
      focusedPaneId: 'tl',
      maximizedPaneId: null,
      draggingPaneId: null,
      settings: { themeId: 'default', terminalOpacity: 0.75 }
    });
  });

  const paneOrder = (): string[] => {
    const layout = useStore.getState().workspaces[0].layout;
    const walk = (n: LayoutNode | null): string[] =>
      n === null ? [] : n.type === 'pane' ? [n.id] : [...walk(n.children[0]), ...walk(n.children[1])];
    return walk(layout);
  };

  it('tauscht zwei Panes im aktiven Workspace', () => {
    useStore.getState().swapPanesInLayout('tl', 'br');
    expect(paneOrder()).toEqual(['br', 'tr', 'bl', 'tl']);
  });

  it('laesst den Fokus auf derselben Pane-Id', () => {
    useStore.getState().swapPanesInLayout('tl', 'br');
    expect(useStore.getState().focusedPaneId).toBe('tl');
  });

  // persist() schreibt beim ersten Aufruf synchron, danach erst wieder, wenn
  // der vorige Schreibvorgang aufgeloest ist (saveInFlight/pendingSave im
  // Store). Deshalb wie in store-workspaces.test.ts die Microtasks leeren,
  // bevor geprueft wird -- sonst haengt das Ergebnis an der Testreihenfolge.
  it('schreibt den neuen Zustand weg', async () => {
    await flushMicrotasks();
    saveState.mockClear();
    useStore.getState().swapPanesInLayout('tl', 'br');
    await flushMicrotasks();
    expect(saveState).toHaveBeenCalled();
  });

  // Beim Drag hat das mousedown auf dem Pane-Kopf die xterm-Textarea geblurrt,
  // und das Umhaengen der Container nimmt sie kurz aus dem Dokument. Ohne das
  // Nachziehen per focusTerminal sitzt der Rahmen sichtbar auf dem getauschten
  // Pane, waehrend die Tastatureingabe ins Leere geht.
  it('holt den DOM-Fokus nach, wenn das fokussierte Pane getauscht wurde', () => {
    const tlFocus = vi.fn();
    registerTerminalFocus('tl', tlFocus);
    try {
      useStore.getState().swapPanesInLayout('tl', 'br');
      expect(tlFocus).toHaveBeenCalledTimes(1);
    } finally {
      unregisterTerminalFocus('tl');
    }
  });

  it('laesst den Fokus in Ruhe, wenn ein unbeteiligtes Pane fokussiert ist', () => {
    const tlFocus = vi.fn();
    registerTerminalFocus('tl', tlFocus);
    try {
      useStore.setState({ focusedPaneId: 'tl' });
      useStore.getState().swapPanesInLayout('tr', 'br');
      expect(tlFocus).not.toHaveBeenCalled();
    } finally {
      unregisterTerminalFocus('tl');
    }
  });

  it('ist wirkungslos bei gleicher oder unbekannter Id', () => {
    useStore.getState().swapPanesInLayout('tl', 'tl');
    expect(paneOrder()).toEqual(['tl', 'tr', 'bl', 'br']);
    useStore.getState().swapPanesInLayout('tl', 'gibtesnicht');
    expect(paneOrder()).toEqual(['tl', 'tr', 'bl', 'br']);
  });

  // Waehrend eines Drags braucht JEDES Pane die Id der Quelle: nur damit kann
  // es entscheiden, ob es selbst gegriffen ist, Drop-Ziel oder unbeteiligt --
  // und der Hinweis auf dem Ziel nennt die Quelle beim Namen.
  describe('draggingPaneId', () => {
    it('ist ohne laufenden Drag null', () => {
      expect(useStore.getState().draggingPaneId).toBeNull();
    });

    it('merkt sich die Quelle und raeumt sie wieder ab', () => {
      useStore.getState().setDraggingPane('tl');
      expect(useStore.getState().draggingPaneId).toBe('tl');
      useStore.getState().setDraggingPane(null);
      expect(useStore.getState().draggingPaneId).toBeNull();
    });

    // Abgeraeumt wird im dragend, nicht im Tausch: dragend feuert auch dann,
    // wenn gar nicht abgelegt wurde (Escape, Drop ins Leere). Wuerde der Tausch
    // mitraeumen, gaebe es zwei Zustaendige fuer dieselbe Sache.
    it('bleibt vom Tausch selbst unberuehrt', () => {
      useStore.getState().setDraggingPane('tl');
      useStore.getState().swapPanesInLayout('tl', 'br');
      expect(useStore.getState().draggingPaneId).toBe('tl');
      useStore.getState().setDraggingPane(null);
    });
  });
});

// Der Shell-Zustand je Pane. Er speist die Anzeige "hier arbeitet noch etwas"
// am Register und stammt aus dem Prompt-Marker, nicht aus der Heuristik.
describe('Shell-Zustand der Panes im Store', () => {
  beforeEach(() => {
    saveState.mockClear();
    (globalThis as unknown as { window: unknown }).window = {
      api: { saveState, kill: vi.fn() }
    };
    (globalThis as unknown as { requestAnimationFrame: (cb: FrameRequestCallback) => number })
      .requestAnimationFrame = (cb: FrameRequestCallback) => { cb(0); return 0; };
    useStore.setState({
      version: 1,
      workspaces: [{ id: 'w1', name: 'One', cwd: '/tmp', layout: grid() }],
      workspaceGroups: [],
      activeWorkspaceId: 'w1',
      focusedPaneId: 'tl',
      maximizedPaneId: null,
      paneStatus: {},
      paneShell: {},
      paneCwd: {},
      paneAutoTitles: {},
      pendingClosePane: null,
      settings: { themeId: 'default', terminalOpacity: 0.75 }
    });
  });

  it('merkt sich den gemeldeten Zustand je Pane', () => {
    useStore.getState().setPaneShell('tl', 'atPrompt');
    useStore.getState().setPaneShell('tr', 'running');

    expect(useStore.getState().paneShell).toEqual({ tl: 'atPrompt', tr: 'running' });
  });

  it('erzeugt keinen neuen Zustand fuer eine unveraenderte Meldung', () => {
    useStore.getState().setPaneShell('tl', 'running');
    const before = useStore.getState().paneShell;

    useStore.getState().setPaneShell('tl', 'running');

    // Identitaet, nicht nur Gleichheit: die Navigation abonniert diese Map, ein
    // neues Objekt pro Marker waere ein Rendern pro Prompt.
    expect(useStore.getState().paneShell).toBe(before);
  });

  it('wird nicht persistiert', () => {
    useStore.getState().setPaneShell('tl', 'running');
    expect(saveState).not.toHaveBeenCalled();

    useStore.getState().renameWorkspace('w1', 'Neu');
    expect(saveState).toHaveBeenCalledTimes(1);
    expect(saveState.mock.calls[0][0]).not.toHaveProperty('paneShell');
  });

  // Eine tote Pane darf keinen Eintrag hinterlassen: die Map wird ueber
  // Pane-Ids adressiert, und die naechste Pane koennte dieselbe Id tragen.
  it('raeumt den Eintrag beim Schliessen einer Pane ab', () => {
    useStore.getState().setPaneShell('tl', 'running');
    useStore.getState().setPaneShell('tr', 'running');

    useStore.getState().closeActivePane('tl');

    expect(useStore.getState().paneShell).toEqual({ tr: 'running' });
  });

  it('raeumt alle Eintraege beim Loeschen des Workspace ab', () => {
    useStore.getState().setPaneShell('tl', 'running');
    useStore.getState().setPaneShell('br', 'atPrompt');

    useStore.getState().deleteWorkspace('w1');

    expect(useStore.getState().paneShell).toEqual({});
  });
});
