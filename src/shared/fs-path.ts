// Pure path helpers usable in the renderer (no node:path). Posix-first; basename
// also tolerates Windows backslashes. Breadcrumb/parent assume posix '/'-rooted
// paths, which is what readDir returns on macOS/Linux. (Windows breadcrumb is a
// known limitation flagged for manual verification.)
export interface Crumb { label: string; path: string; }

export function breadcrumbSegments(abs: string): Crumb[] {
  const norm = abs.replace(/\/+$/, '');
  const parts = norm.split('/');
  const crumbs: Crumb[] = [];
  let cur = '';
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];
    if (i === 0) {
      cur = seg === '' ? '/' : seg;
      crumbs.push({ label: seg === '' ? '/' : seg, path: cur });
      continue;
    }
    if (seg === '') continue;
    cur = cur === '/' ? `/${seg}` : `${cur}/${seg}`;
    crumbs.push({ label: seg, path: cur });
  }
  return crumbs;
}

export function parentDir(abs: string): string {
  const norm = abs.replace(/\/+$/, '');
  const idx = norm.lastIndexOf('/');
  if (idx <= 0) return '/';
  return norm.slice(0, idx);
}

export function basename(abs: string): string {
  const norm = abs.replace(/[\\/]+$/, '');
  const idx = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'));
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}
