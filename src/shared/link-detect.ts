// src/shared/link-detect.ts

export interface LinkMatch {
  text: string;
  startIndex: number;
  length: number;
}

export type PreviewKind = 'markdown' | 'web';

export interface PreviewSource {
  kind: PreviewKind;
  target: string;
}

// Matches http(s) URLs and bare file paths ending in .md/.html/.htm.
// Path chars: anything except whitespace and quotes, ending in the extension.
const LINK_RE = /(https?:\/\/[^\s"'<>]+)|([^\s"'<>]+\.(?:md|html|htm))\b/gi;

export function findLinks(line: string): LinkMatch[] {
  const out: LinkMatch[] = [];
  LINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LINK_RE.exec(line)) !== null) {
    const text = m[0];
    out.push({ text, startIndex: m.index, length: text.length });
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

export function resolveSource(raw: string, cwd: string): PreviewSource | null {
  if (/^https?:\/\//i.test(raw)) return { kind: 'web', target: raw };

  const abs = isAbsolute(raw) ? raw : joinPath(cwd, raw);
  if (/\.md$/i.test(raw)) return { kind: 'markdown', target: abs };
  if (/\.html?$/i.test(raw)) return { kind: 'web', target: `file://${abs.startsWith('/') ? abs : `/${abs}`}` };
  return null;
}
