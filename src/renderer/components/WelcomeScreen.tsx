import React from 'react';
import { useStore } from '../store';
import type { PresetKind } from '../../shared/types';

interface PresetDef { kind: PresetKind; label: string; cols: number; rows: number; cells: number; }

const PRESETS: PresetDef[] = [
  { kind: '1',  label: '1 Pane',       cols: 1, rows: 1, cells: 1 },
  { kind: '2h', label: '2 side by side', cols: 2, rows: 1, cells: 2 },
  { kind: '2v', label: '2 stacked',    cols: 1, rows: 2, cells: 2 },
  { kind: '4',  label: '4 (2×2)',      cols: 2, rows: 2, cells: 4 },
  { kind: '8',  label: '8 (2×4)',      cols: 4, rows: 2, cells: 8 }
];

export function WelcomeScreen(): JSX.Element {
  const applyPreset = useStore((s) => s.applyPreset);
  return (
    <div className="welcome">
      <h2>How many terminals do you want to open?</h2>
      <div className="preset-row">
        {PRESETS.map((p) => (
          <div key={p.kind} className="preset" onClick={() => applyPreset(p.kind)}>
            <div
              className="glyph"
              style={{
                width: p.cols > 2 ? 130 : 90,
                gridTemplateColumns: `repeat(${p.cols}, 1fr)`,
                gridTemplateRows: `repeat(${p.rows}, 1fr)`
              }}
            >
              {Array.from({ length: p.cells }).map((_, i) => <div key={i} className="cell" />)}
            </div>
            <div className="label">{p.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
