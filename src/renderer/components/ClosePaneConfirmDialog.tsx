import React from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store';
import { ConfirmDialog } from './ConfirmDialog';

// Global so every close entry point (header button, context menu, palette and
// shortcut) gets the same confirmation instead of duplicating local state.
export function ClosePaneConfirmDialog(): React.JSX.Element | null {
  const { t } = useTranslation();
  const paneId = useStore((s) => s.pendingClosePaneId);
  const cancel = useStore((s) => s.cancelClosePane);
  const close = useStore((s) => s.closeActivePane);

  if (!paneId) return null;

  return (
    <ConfirmDialog
      title={t('pane.closeTitle')}
      message={t('pane.closeMessage')}
      confirmLabel={t('pane.closeConfirm')}
      onConfirm={() => close(paneId)}
      onCancel={cancel}
    />
  );
}
