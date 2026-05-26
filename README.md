# DM Workspace

A cross-platform tiling terminal multiplexer for macOS (and Windows next), built with
Electron, React and TypeScript. Open multiple real shells in a tiled grid, organize them
into named workspaces, and rearrange them with the mouse.

![App icon](build/icon.png)

## Features

- **Workspace manager** — multiple named workspaces in the sidebar; switch, rename, delete.
  Each workspace keeps its terminals alive in the background.
- **Welcome screen** — pick a layout when a workspace is empty: 1, 2 side‑by‑side,
  2 stacked, 4 (2×2) or 8 (2×4).
- **Tiling panes** — every pane is a real system shell (zsh on macOS, PowerShell on Windows).
  Split a pane left/right or top/bottom, drag the dividers to resize, maximize/restore,
  and close — all with the mouse.
- **Per‑workspace working directory** — choose the folder new terminals start in.
- **Terminal theme** — set the terminal background color and opacity; lower opacity reveals
  a blurred backdrop (macOS vibrancy), like the native Terminal app.
- **Persistence** — workspaces, names, layouts, sizes and settings are restored on restart.

## Tech stack

- [Electron](https://www.electronjs.org/) + [electron-vite](https://electron-vite.org/)
- [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- [xterm.js](https://xtermjs.org/) for terminal rendering, [node-pty](https://github.com/microsoft/node-pty) for real shells
- [zustand](https://github.com/pmndrs/zustand) for renderer state
- [Vitest](https://vitest.dev/) (unit) and [Playwright](https://playwright.dev/) (E2E)

## Development

```bash
npm install      # installs deps and rebuilds node-pty for Electron
npm run dev      # launch the app with hot reload
npm test         # run unit tests
npm run e2e      # build + run the Playwright smoke test
npm run build    # production bundle into out/
```

## Packaging (macOS)

```bash
npm run dist:mac     # build a .dmg (signed + notarized when credentials are set)
```

Code signing uses a Developer ID Application certificate from the keychain.
Notarization uses an App Store Connect API key — see `scripts/notarize-build.sh`
and `build/.notarize.env.example`. Secrets are never committed.

## Releases & auto-update

The app checks GitHub Releases for updates on startup and from **Settings → Updates**
(via [electron-updater](https://www.electron.build/auto-update)). When an update is
available the user downloads and installs it in one click.

Releases are built by the **Release** GitHub Actions workflow (`.github/workflows/release.yml`)
on a `v*` tag or manual dispatch: it builds the signed + notarized macOS app and the
Windows app and publishes them to a draft GitHub Release. Required repository secrets:
`APPLE_CERTIFICATE` (base64 .p12), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_API_KEY` (base64 .p8),
`APPLE_API_KEY_ID`, `APPLE_API_ISSUER`.

## License

Private project.
