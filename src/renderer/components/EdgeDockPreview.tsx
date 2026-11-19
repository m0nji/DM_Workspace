import React from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store';
import { DockIcon } from './pane-drag-ui';

// Vorschau fuers Andocken am Aussenrand des ganzen Layouts. Sie deckt die
// Haelfte des Workspaces, die das gezogene Pane bekommt -- so sieht man vor dem
// Loslassen, dass es ueber die volle Breite bzw. Hoehe gehen wird. Welche Seite,
// meldet das Ziel-Pane unter dem Zeiger (siehe Pane.tsx, edgeDockHover).
// pointer-events aus: sonst schluckt die Vorschau dragover/drop der Panes.
export function EdgeDockPreview(): React.JSX.Element | null {
  const { t } = useTranslation();
  const side = useStore((s) => (s.draggingPaneId ? s.edgeDockHover?.side ?? null : null));
  if (!side) return null;
  return (
    <div className={`layout-edge-preview dock-${side}`} aria-hidden="true">
      <span className="pane-drop-hint-inner">
        <DockIcon side={side} />
        <span className="pane-drop-hint-text">{t(`pane.dockEdge.${side}`)}</span>
      </span>
    </div>
  );
}
