import React from 'react';
import type { DockSide } from '../../shared/layout-tree';

// Eigener MIME-Typ statt text/plain: eine aus dem Terminal gezogene
// Textauswahl traegt ihn nicht und kann deshalb keinen Tausch ausloesen.
export const PANE_DRAG_TYPE = 'application/x-dm-pane';

// Kasten mit hervorgehobener linker Haelfte: dorthin kommt das gezogene Pane.
// Fuer die anderen Seiten wird dasselbe Bild gedreht.
const DOCK_ROTATION: Record<DockSide, number> = { left: 0, top: 90, right: 180, bottom: 270 };

export function DockIcon({ side }: { side: DockSide }): React.JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <g transform={`rotate(${DOCK_ROTATION[side]} 8 8)`}>
        <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
        <rect x="2" y="2.5" width="5" height="11" rx="1.5" fill="currentColor" stroke="none" />
      </g>
    </svg>
  );
}
