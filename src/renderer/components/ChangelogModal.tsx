import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChangelogVersion, ChangelogKind } from '../../shared/changelog';
import { Icon } from './Icon';

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

// A modal that renders parsed changelog entries with per-entry Feature/Fix
// badges. Reused for the "what's new" view (version click) and the update
// dialog (confirm action set).
export function ChangelogModal({ title, versions, highlightVersion, fallbackText, confirm, onClose }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const kindLabel: Record<ChangelogKind, string> = {
    feat: t('changelog.kindFeat'),
    fix: t('changelog.kindFix'),
    other: t('changelog.kindOther'),
  };
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
          <button type="button" className="modal-close" title={t('common.close')} onClick={onClose}><Icon name="close" size={16} /></button>
        </div>

        <div className="changelog-body">
          {!hasContent && <div className="changelog-fallback">{fallbackText ?? t('changelog.noChanges')}</div>}
          {versions.map((v) => (
            <div key={v.version} className="changelog-version">
              <div className="changelog-version-head">
                <span className="changelog-version-num">
                  v{v.version}
                  {highlightVersion === v.version && <span className="changelog-current">{t('changelog.current')}</span>}
                </span>
                {v.date && <span className="changelog-date">{v.date}</span>}
              </div>
              <ul className="changelog-entries">
                {v.entries.map((e, i) => (
                  <li key={i} className="changelog-entry">
                    <span className={`changelog-badge badge-${e.kind}`}>{kindLabel[e.kind]}</span>
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
              <button type="button" className="btn-secondary" onClick={onClose}>{confirm.cancelLabel ?? t('common.later')}</button>
              <button type="button" ref={primaryRef} className="btn-primary" onClick={confirm.onConfirm}>{confirm.label}</button>
            </>
          ) : (
            <button type="button" ref={primaryRef} className="btn-primary" onClick={onClose}>{t('common.close')}</button>
          )}
        </div>
      </div>
    </div>
  );
}
