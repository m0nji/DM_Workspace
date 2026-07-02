// Pure path helpers usable in the renderer (no node:path). Supports posix
// '/'-rooted paths and Windows drive paths ('C:\...' or 'C:/...'); Windows paths
// are handled separator-agnostically and a drive root ('C:/') acts as the walk
// boundary the way '/' does on posix. UNC paths ('\\server\share') remain a
// known limitation. Crumb/parent paths are emitted with forward slashes, which
// Node accepts on Windows too.
export interface Crumb { label: string; path: string; }

// Normalize separators for segment logic — but only on drive-letter paths, so a
// posix filename that happens to contain '\' stays intact.
function normSeps(p: string): string {
  return /^[A-Za-z]:[\\/]/.test(p) ? p.replace(/\\/g, '/') : p;
}

/** True for '/' and Windows drive roots ('C:', 'C:/', 'C:\'). */
export function isFsRoot(abs: string): boolean {
  const norm = normSeps(abs);
  return norm === '/' || /^[A-Za-z]:\/?$/.test(norm);
}

export function breadcrumbSegments(abs: string): Crumb[] {
  const norm = normSeps(abs).replace(/\/+$/, '');
  const parts = norm.split('/');
  const crumbs: Crumb[] = [];
  let cur = '';
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];
    if (i === 0) {
      if (seg === '') {
        cur = '/';
        crumbs.push({ label: '/', path: '/' });
        continue;
      }
      if (/^[A-Za-z]:$/.test(seg)) {
        // Drive root: keep the trailing slash in the path ('C:' alone would be
        // drive-relative and resolve to the drive's current directory).
        cur = `${seg}/`;
        crumbs.push({ label: seg, path: cur });
        continue;
      }
      cur = seg;
      crumbs.push({ label: cur, path: cur });
      continue;
    }
    if (seg === '') continue;
    cur = cur.endsWith('/') ? `${cur}${seg}` : `${cur}/${seg}`;
    crumbs.push({ label: seg, path: cur });
  }
  return crumbs;
}

export function parentDir(abs: string): string {
  const norm = normSeps(abs).replace(/\/+$/, '');
  if (/^[A-Za-z]:$/.test(norm)) return `${norm}/`; // drive root is its own parent
  const idx = norm.lastIndexOf('/');
  if (idx <= 0) return '/';
  const parent = norm.slice(0, idx);
  return /^[A-Za-z]:$/.test(parent) ? `${parent}/` : parent;
}

export function basename(abs: string): string {
  const norm = abs.replace(/[\\/]+$/, '');
  const idx = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'));
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}
