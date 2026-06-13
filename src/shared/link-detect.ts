// src/shared/link-detect.ts

export interface LinkMatch {
  text: string;
  startIndex: number;
  length: number;
}

export type PreviewKind = 'markdown' | 'web';

export interface PreviewSource {
  kind: PreviewKind;
  target: string;       // best known target (may be dead when resolved === false)
  rel?: string;         // original relative path, kept so a picked folder can re-resolve base/rel
  resolved: boolean;    // true here; the renderer sets false when link:resolve finds no existing file → panel shows the "not found" fix UI
}

// Matches http(s) URLs and bare file paths ending in .md/.html/.htm.
// Path chars: anything except whitespace and quotes, ending in the extension.
const LINK_RE = /(https?:\/\/[^\s"'<>()\[\]]+)|([^\s"'<>()\[\]]+\.(?:md|html|htm))\b/gi;

export function findLinks(line: string): LinkMatch[] {
  const out: LinkMatch[] = [];
  LINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LINK_RE.exec(line)) !== null) {
    let text = m[0];
    let length = text.length;
    const trimmed = text.replace(/[.,;:!?)]+$/, '');
    if (trimmed.length > 0) { length = trimmed.length; text = trimmed; }
    out.push({ text, startIndex: m.index, length });
  }
  return out;
}

function isAbsolute(p: string): boolean {
  return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p);
}

// Join cwd + relative path with a single forward slash, collapsing a leading "./".
function joinPath(cwd: string, rel: string): string {
  const base = cwd.replace(/\/+$/, '');
  const clean = rel.replace(/^\.\//, '');
  return `${base}/${clean}`;
}

// Build a preview target from a resolved absolute fs path: markdown reads the path
// directly; web (html) needs a file:// url with a leading slash.
function fileUrl(abs: string): string {
  let path = abs.replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(path)) path = `/${path}`;
  if (!path.startsWith('/')) path = `/${path}`;
  const encoded = path.split('/').map((part, index) => {
    if (index === 1 && /^[A-Za-z]:$/.test(part)) return part;
    return encodeURIComponent(part);
  }).join('/');
  return `file://${encoded}`;
}

export function fileTarget(kind: PreviewKind, abs: string): string {
  if (kind === 'web') return fileUrl(abs);
  return abs;
}

// True when `abs` ends with the relative path `rel` at a segment boundary.
// "specs/foo.md" matches ".../specs/foo.md" but not ".../myspecs/foo.md".
export function pathEndsWith(abs: string, rel: string): boolean {
  const segs = (p: string) => p.replace(/\\/g, '/').split('/').filter(Boolean);
  const a = segs(abs);
  const r = segs(rel);
  if (r.length === 0 || r.length > a.length) return false;
  const offset = a.length - r.length;
  for (let i = 0; i < r.length; i++) {
    if (a[offset + i] !== r[i]) return false;
  }
  return true;
}

export function resolveSource(raw: string, cwd: string): PreviewSource | null {
  if (/^https?:\/\//i.test(raw)) return { kind: 'web', target: raw, resolved: true };

  const rel = isAbsolute(raw) ? undefined : raw;
  const abs = isAbsolute(raw) ? raw : joinPath(cwd, raw);
  if (/\.md$/i.test(raw)) return { kind: 'markdown', target: abs, ...(rel ? { rel } : {}), resolved: true };
  if (/\.html?$/i.test(raw)) return { kind: 'web', target: fileTarget('web', abs), ...(rel ? { rel } : {}), resolved: true };
  return null;
}
