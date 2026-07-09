---
name: verify
description: Build and drive DM_Workspace (Electron) to verify a change end-to-end with Playwright.
---

# Verify DM_Workspace changes

Build, then drive the real app with Playwright's Electron driver. Do not verify
via vitest/tsc alone — launch the app.

## Build & launch

```bash
npm run build          # electron-vite build → out/
```

Launch from a Node script (playwright is available via the repo's node_modules):

```js
import { createRequire } from 'module';
const require = createRequire('/Users/thomas/Projects/DM_Workspace/package.json');
const { _electron: electron } = require('playwright');

const env = { ...process.env, DMWS_USERDATA: tmpDir, DMWS_DISABLE_WEBGL: '1' };
delete env.DMWS_E2E; // E2E flag redirects userData unless DMWS_USERDATA is set
const app = await electron.launch({ args: ['out/main/index.js'], env, cwd: repoRoot });
const win = await app.firstWindow();
```

## Gotchas

- `DMWS_USERDATA=<mktemp dir>` gives an isolated, persistent profile — reuse the
  same dir across `electron.launch()` calls to test restart persistence
  (state lives in `<userdata>/state.json`).
- `DMWS_DISABLE_WEBGL=1` keeps xterm on the DOM renderer so terminal text is
  assertable/screenshotable.
- Wait for `.root[data-brand-design]` + ~800ms for hydration/i18n before asserting.
- Settings opens via the titlebar gear: `.titlebar .icon-btn[title="Settings"]`
  (or `title="Einstellungen"` when the OS locale is German — match both).
- App-design attribute lives on `.root` as `data-brand-design` (graphite | black | standard).
- Persisted settings changes flush async — wait ~400ms after a settings click
  before `app.close()`.

## Flows worth driving

- Welcome screen: preset buttons ("1 Pane" …) create layouts.
- Settings → Appearance: language / app design / terminal theme / opacity.
- Restart persistence: relaunch with the same `DMWS_USERDATA` and assert state.
