import React, { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'brand' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Centered confirmation modal built on the shared .modal-backdrop / .modal
 * pattern. Backdrop click and Escape cancel; Enter confirms. The confirm
 * button receives focus on open so Enter works immediately.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  tone = 'brand',
  onConfirm,
  onCancel,
}: ConfirmDialogProps): React.JSX.Element {
  const { t } = useTranslation();
  const confirmText = confirmLabel ?? t('common.close');
  const cancelText = cancelLabel ?? t('common.cancel');
  const confirmRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const messageId = useId();

  // Callers regularly pass inline onConfirm/onCancel closures, which get a new
  // identity on every parent render — including renders triggered by unrelated
  // state (e.g. a terminal status flip while this dialog is open). Reading the
  // latest handlers through a ref keeps the mount effect below stable, so it
  // grabs focus exactly once instead of re-stealing it back onto "confirm" on
  // every parent re-render (which could turn a Tab-to-Cancel + stray Enter into
  // an accidental confirm of a destructive action).
  const handlers = useRef({ onConfirm, onCancel });
  useEffect(() => { handlers.current = { onConfirm, onCancel }; });

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); handlers.current.onCancel(); }
      else if (e.key === 'Enter') { e.preventDefault(); handlers.current.onConfirm(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div
        className={`modal confirm-modal confirm-modal-${tone}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div id={titleId} className="modal-header confirm-title">{title}</div>
        <p id={messageId} className="confirm-message">{message}</p>
        <div className="confirm-actions">
          <button type="button" className="confirm-btn" onClick={onCancel}>
            {cancelText}
          </button>
          <button
            type="button"
            ref={confirmRef}
            className={`confirm-btn ${tone === 'danger' ? 'confirm-btn-danger' : 'primary'}`}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
