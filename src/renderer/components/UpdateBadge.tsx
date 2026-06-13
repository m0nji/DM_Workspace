import React, { useState } from 'react';
import { useStore } from '../store';
import { ChangelogModal } from './ChangelogModal';
import { parseChangelog, type ChangelogVersion } from '../../shared/changelog';

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
        setNotes({ versions: body ? parseChangelog(body) : [], raw: body });
      });
    } else {
      setNotes({ versions: [], raw: null });
    }
  };

  if (status === 'available') {
    return (
      <>
        <button type="button" className="update-badge"
                title={`Update${version ? ` ${version}` : ''} verfügbar`}
                onClick={openDialog}>
          <DownloadIcon />
          <span>Update{version ? ` ${version}` : ''}</span>
        </button>
        {dialogOpen && (
          <ChangelogModal
            title={`Update verfügbar${version ? ` – v${version}` : ''}`}
            versions={notes?.versions ?? []}
            fallbackText={notes === null
              ? 'Änderungen werden geladen …'
              : (notes.raw ?? 'Die Änderungshinweise konnten nicht geladen werden. Du kannst das Update trotzdem installieren.')}
            confirm={{
              label: 'Jetzt aktualisieren',
              cancelLabel: 'Später',
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
      <span className="update-badge downloading" title="Update wird heruntergeladen">
        Update lädt… {percent ?? 0}%
      </span>
    );
  }
  if (status === 'downloaded') {
    return (
      <button type="button" className="update-badge ready"
              title={`Update${version ? ` ${version}` : ''} heruntergeladen – neu starten & installieren`}
              onClick={installUpdate}>
        <DownloadIcon />
        <span>Neu starten</span>
      </button>
    );
  }
  return null;
}
