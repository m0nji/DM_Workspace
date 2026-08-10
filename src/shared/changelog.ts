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

// Numeric-segment comparison ("0.10.0" > "0.9.41", which a string compare gets
// wrong). Tolerates a "v" prefix, missing segments and a "-beta.1" style
// prerelease suffix, which sorts below the matching final release.
export function compareVersions(a: string, b: string): number {
  const split = (v: string): [number[], string[]] => {
    const [core, pre = ''] = v.trim().replace(/^v/i, '').split('-', 2);
    return [core.split('.').map((n) => parseInt(n, 10) || 0), pre ? pre.split('.') : []];
  };
  const [coreA, preA] = split(a);
  const [coreB, preB] = split(b);

  for (let i = 0; i < Math.max(coreA.length, coreB.length); i++) {
    const diff = (coreA[i] ?? 0) - (coreB[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  // Same core: a version without a prerelease suffix is the later one.
  if (!preA.length || !preB.length) return (preA.length ? 0 : 1) - (preB.length ? 0 : 1);
  for (let i = 0; i < Math.max(preA.length, preB.length); i++) {
    const x = preA[i], y = preB[i];
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const both = /^\d+$/.test(x) && /^\d+$/.test(y);
    return (both ? Number(x) - Number(y) : x.localeCompare(y)) < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * The sections a user upgrading from `installed` to `target` has not seen yet:
 * everything newer than what they run, up to and including what they're offered.
 * Someone on 0.10.0 who skipped 0.11.0 gets both 0.11.1 and 0.11.0, not just the
 * offered version's own section. Document order (newest first) is preserved.
 */
export function versionsSince(
  versions: ChangelogVersion[],
  installed: string,
  target: string
): ChangelogVersion[] {
  return versions.filter(
    (v) =>
      compareVersions(v.version, target) <= 0 &&
      (!installed.trim() || compareVersions(v.version, installed) > 0)
  );
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
