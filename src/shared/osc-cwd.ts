// Parse the working directory out of the OSC escape sequences that shells emit
// for "current directory" reporting. xterm hands an OSC handler the payload
// AFTER the leading identifier, i.e. everything between "ESC ] <id> ;" and the
// terminator (BEL or ST).
//
//   OSC 7   : ESC ] 7 ; file://<host>/<path> ST   -> handler id 7, payload "file://host/path"
//   OSC 9;9 : ESC ] 9 ; 9 ; <path> BEL            -> handler id 9, payload "9;<path>"
//
// We use OSC 9;9 from PowerShell (plain native path) and OSC 7 from POSIX shells
// (a file:// URL). Both resolve to a filesystem path for the pane title.
//
// Windows drive paths are normalized to forward slashes ("C:/Users/me") so every
// downstream consumer (breadcrumbs, link resolution, fs IPC) deals with a single
// separator; Node accepts forward slashes on Windows. Only drive-letter paths are
// rewritten — a POSIX filename may legally contain a backslash.

import { isUncPath } from './link-detect';

function normalizeDrivePath(path: string): string {
  return /^[A-Za-z]:[\\/]/.test(path) ? path.replace(/\\/g, '/') : path;
}

// Das Arbeitsverzeichnis kommt aus beliebiger Terminalausgabe. Ein UNC-Pfad
// ("\\host\share", "//host/share", auch aus "file:////host/share") würde später
// vom Datei-Panel und von der Link-Auflösung geöffnet — unter Windows per SMB,
// mit NTLM-Hash an den Host. Kein Programm meldet legitim ein UNC-Verzeichnis.
function dropUnc(path: string): string | null {
  return isUncPath(path) ? null : path;
}

/**
 * Parse an OSC 7 payload (`file://host/path`, or a bare path as a fallback).
 * Returns the decoded filesystem path, or null if it can't be parsed.
 */
export function parseOsc7(payload: string): string | null {
  if (!payload) return null;
  const p = payload.trim();
  const m = /^file:\/\/[^/]*(\/.*)$/.exec(p);
  if (m) {
    let path = m[1];
    try {
      path = decodeURIComponent(path);
    } catch {
      /* leave the raw path if it isn't valid percent-encoding */
    }
    // file:///C:/Users -> C:/Users (drop the slash that precedes a drive letter)
    if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1);
    return dropUnc(path);
  }
  // Bare absolute path fallback (POSIX "/..." or Windows "C:\...").
  if (!(p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p))) return null;
  return dropUnc(normalizeDrivePath(p));
}

/**
 * Parse an OSC 9;9 payload, which xterm delivers as "9;<path>" (the second "9"
 * is part of the payload because the handler id is the first field).
 */
export function parseOsc9(payload: string): string | null {
  if (!payload) return null;
  const m = /^9;(.*)$/s.exec(payload);
  if (!m) return null;
  const path = m[1].trim();
  return path ? dropUnc(normalizeDrivePath(path)) : null;
}
