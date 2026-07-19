import { readdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Prefixes every temp dir an e2e run can create:
//   dmws-e2e-*     the app's own throwaway userData (src/main/index.ts, DMWS_E2E)
//   dmws-e2e-fb-*  … plus the working folders file-browser.spec creates
//   dmws-env-*     shell-env.spec         dmws-restart-*  restart-scrollback.spec
//   dmws-probe-*   restart-probe.spec     dmtask-*        task-board.spec
const PREFIXES = ['dmws-e2e-', 'dmws-env-', 'dmws-restart-', 'dmws-probe-', 'dmtask-'];

// Why this lives in the harness rather than in the app:
//
// The app deletes its DMWS_E2E userData dir on shutdown, and that delete really
// does succeed — but Electron's native shutdown writes the Chromium profile
// (Local State, Preferences, Session Storage) back afterwards, recreating the
// directory. That write happens after every JavaScript exit hook the main
// process has, so no in-process point is late enough to win the race. The only
// reliable moment is once the process is gone entirely, which is here.
export default function globalTeardown(): void {
  const root = tmpdir();
  let removed = 0;
  for (const name of readdirSync(root)) {
    if (!PREFIXES.some((p) => name.startsWith(p))) continue;
    const path = join(root, name);
    try {
      if (!statSync(path).isDirectory()) continue;
      rmSync(path, { recursive: true, force: true });
      removed++;
    } catch { /* another run may have removed it already */ }
  }
  if (removed) console.log(`[teardown] removed ${removed} e2e temp dir(s)`);
}
