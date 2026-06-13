// Parser for the project CHANGELOG.md — the single source of truth for both the
// "what's new" view (bundled into the app) and the update dialog (fetched from
// the GitHub release body). Kept dependency-free and pure so it's trivially
// testable and usable from both the renderer and the main process.

export type ChangelogKind = 'feat' | 'fix' | 'other';

export interface ChangelogEntry {
  kind: ChangelogKind;
  text: string;
}

export interface ChangelogVersion {
  version: string;
  date?: string;
  entries: ChangelogEntry[];
}

// "## 0.7.15 – 2026-06-13", "## [v1.2.3] - 2026-01-02", "## 0.1.0"
const VERSION_HEADING = /^##\s+\[?v?([0-9][^\]\s]*)\]?(?:\s*[–—-]\s*(.+?))?\s*$/;
// "- feat: …", "- fix: …" (also feature:/bugfix:), case-insensitive.
const ENTRY = /^[-*]\s+(.*)$/;
const KIND_PREFIX = /^(feat|feature|fix|bugfix)\s*:\s*/i;

function classify(raw: string): ChangelogEntry {
  const m = KIND_PREFIX.exec(raw);
  if (!m) return { kind: 'other', text: raw.trim() };
  const word = m[1].toLowerCase();
  const kind: ChangelogKind = word === 'feat' || word === 'feature' ? 'feat' : 'fix';
  return { kind, text: raw.slice(m[0].length).trim() };
}

export function parseChangelog(md: string): ChangelogVersion[] {
  const versions: ChangelogVersion[] = [];
  let current: ChangelogVersion | null = null;

  for (const line of md.split('\n')) {
    const heading = VERSION_HEADING.exec(line);
    if (heading) {
      current = { version: heading[1], entries: [] };
      if (heading[2]) current.date = heading[2].trim();
      versions.push(current);
      continue;
    }
    if (!current) continue; // skip anything before the first version heading
    const entry = ENTRY.exec(line.trim());
    if (entry) current.entries.push(classify(entry[1]));
  }

  return versions;
}
