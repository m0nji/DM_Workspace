import React, { useEffect, useRef } from 'react';
import type { ChangelogVersion, ChangelogKind } from '../../shared/changelog';

interface ConfirmAction {
  label: string;
  onConfirm: () => void;
  cancelLabel?: string;
}

interface Props {
  title: string;
  versions: ChangelogVersion[];
  // Highlight the version matching the running app (the "you are here" marker).
  highlightVersion?: string;
  // Shown when there are no parsed versions (e.g. release notes that aren't in
  // the changelog format, or couldn't be loaded).
  fallbackText?: string;
  // When set, the footer shows a primary confirm button (e.g. "Jetzt
  // aktualisieren") plus a cancel; otherwise a single "Schließen" button.
  confirm?: ConfirmAction;
  onClose: () => void;
}

const KIND_LABEL: Record<ChangelogKind, string> = { feat: 'Feature', fix: 'Fix', other: 'Änderung' };

// A modal that renders parsed changelog entries with per-entry Feature/Fix
// badges. Reused for the "what's new" view (version click) and the update
// dialog (confirm action set).
export function ChangelogModal({ title, versions, highlightVersion, fallbackText, confirm, onClose }: Props): React.JSX.Element {
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    primaryRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === 'Enter' && confirm) { e.preventDefault(); confirm.onConfirm(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, confirm]);

  const hasContent = versions.length > 0;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal changelog-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>{title}</span>
          <button type="button" className="modal-close" title="Schließen" onClick={onClose}>✕</button>
        </div>

        <div className="changelog-body">
          {!hasContent && <div className="changelog-fallback">{fallbackText ?? 'Keine Änderungen gefunden.'}</div>}
          {versions.map((v) => (
            <div key={v.version} className="changelog-version">
              <div className="changelog-version-head">
                <span className="changelog-version-num">
                  v{v.version}
                  {highlightVersion === v.version && <span className="changelog-current">aktuell</span>}
                </span>
                {v.date && <span className="changelog-date">{v.date}</span>}
              </div>
              <ul className="changelog-entries">
                {v.entries.map((e, i) => (
                  <li key={i} className="changelog-entry">
                    <span className={`changelog-badge badge-${e.kind}`}>{KIND_LABEL[e.kind]}</span>
                    <span className="changelog-entry-text">{e.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="changelog-actions">
          {confirm ? (
            <>
              <button type="button" className="btn-secondary" onClick={onClose}>{confirm.cancelLabel ?? 'Später'}</button>
              <button type="button" ref={primaryRef} className="btn-primary" onClick={confirm.onConfirm}>{confirm.label}</button>
            </>
          ) : (
            <button type="button" ref={primaryRef} className="btn-primary" onClick={onClose}>Schließen</button>
          )}
        </div>
      </div>
    </div>
  );
}
