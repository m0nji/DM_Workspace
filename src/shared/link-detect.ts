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
const LINK_RE = /(https?:\/\/[^\s"'<>()[\]]+)|([^\s"'<>()[\]]+\.(?:md|html|htm))\b/gi;

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

// True for files the preview panel can render: markdown goes through the
// markdown renderer, html/htm through the sandboxed <webview>. Kept next to
// resolveSource so the extension→kind mapping lives in exactly one place.
export function isPreviewableFile(name: string): boolean {
  return /\.(md|markdown|mdx|html?)$/i.test(name);
}

function isAbsolute(p: string): boolean {
  return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p);
}

// Join cwd + relative path with a single forward slash, collapsing a leading "./".
// A Windows drive cwd ('C:\Users\me') is normalized to forward slashes first so
// the result doesn't mix separators.
function joinPath(cwd: string, rel: string): string {
  const norm = /^[A-Za-z]:[\\/]/.test(cwd) ? cwd.replace(/\\/g, '/') : cwd;
  const base = norm.replace(/\/+$/, '');
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

// A path opening with two separators is a UNC path ("//server/share",
// "\\server\share"). Links come from untrusted terminal output, and on Windows
// opening one makes the OS fetch it over SMB from the named host — which
// auto-negotiates NTLM and hands that host the user's password hash. Chromium
// does it for a <webview src>, readFileSync does it for a markdown preview.
// Nothing legitimate in a preview names a remote host, so these are refused
// outright rather than sanitized.
export function isUncPath(raw: string): boolean {
  return /^[\\/]{2}/.test(raw);
}

// Which URLs the preview <webview> may attach to. Lives here next to
// resolveSource — the place that builds these targets — so the policy and the
// construction stay in one file; the main process enforces it at attach time.
export function isAllowedPreviewUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol === 'http:' || url.protocol === 'https:') return true;
    if (url.protocol !== 'file:') return false;
    // A file: URL must stay local: no authority, and no path that re-introduces
    // one by starting with a second slash ("file:////host/share" parses to an
    // empty host with a "//host/share" path, which Windows resolves as UNC).
    return url.host === '' && !url.pathname.startsWith('//');
  } catch {
    return false;
  }
}

export function resolveSource(raw: string, cwd: string): PreviewSource | null {
  if (/^https?:\/\//i.test(raw)) return { kind: 'web', target: raw, resolved: true };
  if (isUncPath(raw)) return null;

  const rel = isAbsolute(raw) ? undefined : raw;
  const abs = isAbsolute(raw) ? raw : joinPath(cwd, raw);
  if (/\.(md|markdown|mdx)$/i.test(raw)) return { kind: 'markdown', target: abs, ...(rel ? { rel } : {}), resolved: true };
  if (/\.html?$/i.test(raw)) return { kind: 'web', target: fileTarget('web', abs), ...(rel ? { rel } : {}), resolved: true };
  return null;
}
