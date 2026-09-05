import React from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from './ConfirmDialog';

interface Props { remote?: boolean; onConfirm: () => void; onCancel: () => void; }

// Gemeinsamer Bestätigungstext für lokales Schließen (Kopf-Button, Kontextmenü,
// Palette, Shortcut) und für das Schließen einer Remote-Pane — Letzteres betrifft
// alle Verbundenen, deshalb der eigene `remote`-Textsatz.
export function ClosePaneConfirmDialog({ remote, onConfirm, onCancel }: Props): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <ConfirmDialog
      tone="danger"
      title={t(remote ? 'pane.closeRemoteTitle' : 'pane.closeTitle')}
      message={t(remote ? 'pane.closeRemoteMessage' : 'pane.closeMessage')}
      confirmLabel={t(remote ? 'pane.closeRemoteConfirm' : 'pane.closeConfirm')}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
