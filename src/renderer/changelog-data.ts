// The project CHANGELOG.md, bundled into the renderer at build time and parsed
// once. Used by the "what's new" view that opens when clicking the version
// number. (The update dialog instead fetches the offered version's notes from
// its GitHub release.)
import changelogMd from '../../CHANGELOG.md?raw';
import { parseChangelog, type ChangelogVersion } from '../shared/changelog';

export const changelogVersions: ChangelogVersion[] = parseChangelog(changelogMd);
