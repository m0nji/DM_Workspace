import React from 'react';
import { useStore } from '../store';

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
// Clicking downloads the available update, then (once downloaded) restarts to
// install — the same actions the Settings panel exposes, surfaced where they're
// visible at a glance.
export function UpdateBadge(): React.JSX.Element | null {
  const status = useStore((s) => s.update.status);
  const version = useStore((s) => s.update.version);
  const percent = useStore((s) => s.update.percent);
  const downloadUpdate = useStore((s) => s.downloadUpdate);
  const installUpdate = useStore((s) => s.installUpdate);

  if (status === 'available') {
    return (
      <button type="button" className="update-badge"
              title={`Update${version ? ` ${version}` : ''} verfügbar – herunterladen`}
              onClick={downloadUpdate}>
        <DownloadIcon />
        <span>Update{version ? ` ${version}` : ''}</span>
      </button>
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
