import { describe, it, expect } from 'vitest';
import { paneRects, findPaneInDirection } from '../src/shared/layout-navigate';
import type { LayoutNode } from '../src/shared/types';

const pane = (id: string): LayoutNode => ({ type: 'pane', id });
const split = (id: string, direction: 'h' | 'v', a: LayoutNode, b: LayoutNode, ratio = 0.5): LayoutNode =>
  ({ type: 'split', id, direction, ratio, children: [a, b] });

// 2x2-Gitter:  tl | tr
//              ---+---
//              bl | br
const grid = (): LayoutNode => split('s0', 'v',
  split('s1', 'h', pane('tl'), pane('tr')),
  split('s2', 'h', pane('bl'), pane('br')));

describe('paneRects', () => {
  it('gibt einem einzelnen Pane das ganze Einheitsquadrat', () => {
    expect(paneRects(pane('a'))).toEqual([{ paneId: 'a', x: 0, y: 0, w: 1, h: 1 }]);
  });

  it('liefert [] fuer ein leeres Layout', () => {
    expect(paneRects(null)).toEqual([]);
  });

  it('teilt einen h-Split entlang der Breite', () => {
    expect(paneRects(split('s', 'h', pane('a'), pane('b')))).toEqual([
      { paneId: 'a', x: 0, y: 0, w: 0.5, h: 1 },
      { paneId: 'b', x: 0.5, y: 0, w: 0.5, h: 1 }
    ]);
  });

  it('teilt einen v-Split entlang der Hoehe', () => {
    expect(paneRects(split('s', 'v', pane('a'), pane('b')))).toEqual([
      { paneId: 'a', x: 0, y: 0, w: 1, h: 0.5 },
      { paneId: 'b', x: 0, y: 0.5, w: 1, h: 0.5 }
    ]);
  });

  it('beachtet eine abweichende Ratio', () => {
    expect(paneRects(split('s', 'h', pane('a'), pane('b'), 0.25))).toEqual([
      { paneId: 'a', x: 0, y: 0, w: 0.25, h: 1 },
      { paneId: 'b', x: 0.25, y: 0, w: 0.75, h: 1 }
    ]);
  });

  it('deckt im 2x2-Gitter die Flaeche lueckenlos und ueberschneidungsfrei ab', () => {
    const rects = paneRects(grid());
    expect(rects).toHaveLength(4);
    expect(rects.reduce((sum, r) => sum + r.w * r.h, 0)).toBeCloseTo(1, 10);
    expect(rects.find((r) => r.paneId === 'br')).toEqual({ paneId: 'br', x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
  });
});

describe('findPaneInDirection', () => {
  it('findet im 2x2-Gitter den Nachbarn in jede Richtung', () => {
    const g = grid();
    expect(findPaneInDirection(g, 'tl', 'right')).toBe('tr');
    expect(findPaneInDirection(g, 'tr', 'left')).toBe('tl');
    expect(findPaneInDirection(g, 'tl', 'down')).toBe('bl');
    expect(findPaneInDirection(g, 'bl', 'up')).toBe('tl');
    expect(findPaneInDirection(g, 'br', 'left')).toBe('bl');
    expect(findPaneInDirection(g, 'br', 'up')).toBe('tr');
  });

  it('laeuft am Rand nicht um', () => {
    const g = grid();
    expect(findPaneInDirection(g, 'tl', 'left')).toBeNull();
    expect(findPaneInDirection(g, 'tl', 'up')).toBeNull();
    expect(findPaneInDirection(g, 'br', 'right')).toBeNull();
    expect(findPaneInDirection(g, 'br', 'down')).toBeNull();
  });

  it('gibt bei einem einzelnen Pane in jede Richtung null zurueck', () => {
    expect(findPaneInDirection(pane('a'), 'a', 'left')).toBeNull();
    expect(findPaneInDirection(pane('a'), 'a', 'right')).toBeNull();
    expect(findPaneInDirection(pane('a'), 'a', 'up')).toBeNull();
    expect(findPaneInDirection(pane('a'), 'a', 'down')).toBeNull();
  });

  // links ein hohes Pane, rechts zwei uebereinander mit Ratio 0.7:
  // die obere rechte Haelfte ueberlappt deutlich mehr und gewinnt.
  it('waehlt bei mehreren Nachbarn den mit der groesseren Ueberlappung', () => {
    const tree = split('s0', 'h',
      pane('l'),
      split('s1', 'v', pane('rt'), pane('rb'), 0.7));
    expect(findPaneInDirection(tree, 'l', 'right')).toBe('rt');
    expect(findPaneInDirection(tree, 'rt', 'left')).toBe('l');
    expect(findPaneInDirection(tree, 'rb', 'left')).toBe('l');
  });

  it('nimmt den naechstliegenden, nicht irgendeinen dahinter', () => {
    // drei Spalten nebeneinander: a | b | c
    const tree = split('s0', 'h', pane('a'), split('s1', 'h', pane('b'), pane('c')));
    expect(findPaneInDirection(tree, 'a', 'right')).toBe('b');
    expect(findPaneInDirection(tree, 'c', 'left')).toBe('b');
  });

  it('gibt ohne ueberlappenden Nachbarn in Blickrichtung kein Ergebnis zurueck', () => {
    const tree = split('s0', 'h',
      pane('a'),
      split('s1', 'v', pane('b'), pane('c')));
    // 'a' erstreckt sich ueber die volle Hoehe; nach unten gibt es keinen
    // Kandidaten, der unter 'a' selbst liegt.
    expect(findPaneInDirection(tree, 'a', 'down')).toBeNull();
    // 'b' liegt oben rechts; unter ihm liegt 'c' und ueberlappt auf der
    // Querachse (gleiche x-Spanne).
    expect(findPaneInDirection(tree, 'b', 'down')).toBe('c');
  });

  it('gibt bei unbekannter Pane-ID oder leerem Layout null zurueck', () => {
    expect(findPaneInDirection(grid(), 'gibtesnicht', 'right')).toBeNull();
    expect(findPaneInDirection(null, 'tl', 'right')).toBeNull();
  });

  it('liefert dasselbe Ergebnis unabhaengig von der Traversierungsreihenfolge des Baums', () => {
    // Gleiches 2x2-Gitter wie oben (gleiche Geometrie), aber spaltenweise statt
    // zeilenweise aufgebaut: paneRects() traversiert die Panes dadurch in
    // anderer Reihenfolge (tl, bl, tr, br statt tl, tr, bl, br). Die Auswahl
    // im Overlap-Zweig darf sich trotzdem nicht aendern -- sonst haengt sie
    // von der Baumform statt von der Geometrie ab.
    const gridColumnMajor = (): LayoutNode => split('s0', 'h',
      split('s1', 'v', pane('tl'), pane('bl')),
      split('s2', 'v', pane('tr'), pane('br')));
    const g = gridColumnMajor();
    expect(paneRects(g).map((r) => r.paneId)).toEqual(['tl', 'bl', 'tr', 'br']);
    expect(findPaneInDirection(g, 'tl', 'right')).toBe('tr');
    expect(findPaneInDirection(g, 'tr', 'left')).toBe('tl');
    expect(findPaneInDirection(g, 'tl', 'down')).toBe('bl');
    expect(findPaneInDirection(g, 'bl', 'up')).toBe('tl');
    expect(findPaneInDirection(g, 'br', 'left')).toBe('bl');
    expect(findPaneInDirection(g, 'br', 'up')).toBe('tr');
  });
});
