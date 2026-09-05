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
 * pattern. Enter activates the focused button; destructive actions start on
 * Cancel. Focus stays in the dialog and returns to its trigger when it closes.
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
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
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
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current!;
    const initial = tone === 'danger' ? cancelRef.current : confirmRef.current;
    // Make everything outside this modal inert, including screen-reader and
    // mouse navigation. Preserve existing inert state for nested dialogs.
    const outside: Array<{ element: HTMLElement; inert: boolean }> = [];
    let branch: HTMLElement = dialog.parentElement!;
    while (branch.parentElement) {
      for (const sibling of Array.from(branch.parentElement.children)) {
        if (sibling !== branch && sibling instanceof HTMLElement) {
          outside.push({ element: sibling, inert: sibling.inert });
          sibling.inert = true;
        }
      }
      branch = branch.parentElement;
    }
    initial?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        handlers.current.onCancel();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        e.stopImmediatePropagation();
        const buttons = [cancelRef.current!, confirmRef.current!];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(index + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
      }
    };
    const onFocus = (e: FocusEvent) => {
      if (!dialog.contains(e.target as Node)) initial?.focus();
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocus);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocus);
      for (const { element, inert } of outside) element.inert = inert;
      if (previous?.isConnected) previous.focus();
    };
    // Tone is fixed for this dialog's lifetime. Callback changes must not steal focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div
        ref={dialogRef}
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
          <button type="button" ref={cancelRef} className="confirm-btn" onClick={onCancel}>
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
