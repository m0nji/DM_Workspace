import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store';
import { ChangelogModal } from './ChangelogModal';
import { parseChangelog, versionsSince, type ChangelogVersion } from '../../shared/changelog';

function DownloadIcon(): React.JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor"
         strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2.5v7" />
      <path d="M4.5 6.5L8 10l3.5-3.5" />
      <path d="M3 13h10" />
    </svg>
  );
}

// Prominent top-right update indicator. Hidden unless an update is actually
// available/in-flight, so it only draws attention when there's something to do.
// Clicking the "available" badge opens a dialog with the new version's changes
// and a confirm button; confirming downloads + installs (the main process
// relaunches once the download finishes). Downloading/downloaded states surface
// progress and a restart fallback.
export function UpdateBadge(): React.JSX.Element | null {
  const { t } = useTranslation();
  const status = useStore((s) => s.update.status);
  const version = useStore((s) => s.update.version);
  const percent = useStore((s) => s.update.percent);
  const downloadUpdate = useStore((s) => s.downloadUpdate);
  const installUpdate = useStore((s) => s.installUpdate);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [notes, setNotes] = useState<{ versions: ChangelogVersion[]; raw: string | null } | null>(null);

  const openDialog = (): void => {
    setDialogOpen(true);
    setNotes(null); // show the loading hint until the fetch resolves
    if (version) {
      void window.api.fetchUpdateNotes(version).then((body) => {
        // The notes cover the whole changelog, so show every version between the
        // one running here and the one on offer — skipping a release shouldn't
        // hide what it brought. If the span comes out empty (notes that only
        // carry the offered version, or a version we can't place), fall back to
        // the newest section rather than an empty dialog.
        const all = body ? parseChangelog(body) : [];
        const span = versionsSince(all, __APP_VERSION__, version);
        setNotes({
          versions: span.length ? span : all.slice(0, 1),
          // Raw text is only useful as a fallback if nothing parsed at all —
          // otherwise it would dump the entire changelog file into the dialog.
          raw: all.length ? null : body
        });
      }).catch(() => {
        // Failed fetch (offline, GitHub down): show the error text instead of
        // an eternal "loading…" hint — the update itself stays available.
        setNotes({ versions: [], raw: null });
      });
    } else {
      setNotes({ versions: [], raw: null });
    }
  };

  const versionSuffix = version ? ` ${version}` : '';

  if (status === 'available') {
    return (
      <>
        <button type="button" className="update-badge"
                title={t('update.availableTitle', { version: versionSuffix })}
                onClick={openDialog}>
          <DownloadIcon />
          <span>{t('update.availableLabel', { version: versionSuffix })}</span>
        </button>
        {dialogOpen && (
          <ChangelogModal
            title={t('update.dialogTitle', { version: version ? ` – v${version}` : '' })}
            versions={notes?.versions ?? []}
            fallbackText={notes === null
              ? t('update.notesLoading')
              : (notes.raw ?? t('update.notesError'))}
            confirm={{
              label: t('update.updateNow'),
              cancelLabel: t('common.later'),
              onConfirm: () => { downloadUpdate(); setDialogOpen(false); }
            }}
            onClose={() => setDialogOpen(false)}
          />
        )}
      </>
    );
  }
  if (status === 'downloading') {
    return (
      <span className="update-badge downloading" title={t('update.downloadingTitle')}>
        {t('update.downloadingLabel', { percent: percent ?? 0 })}
      </span>
    );
  }
  if (status === 'downloaded') {
    return (
      <button type="button" className="update-badge ready"
              title={t('update.readyTitle', { version: versionSuffix })}
              onClick={installUpdate}>
        <DownloadIcon />
        <span>{t('update.restart')}</span>
      </button>
    );
  }
  return null;
}
