import { app, Menu, type MenuItemConstructorOptions } from 'electron';

/**
 * Install a minimal application menu. It stays hidden on Windows/Linux
 * (autoHideMenuBar), but its accelerators still work — notably F11 (Windows) /
 * Ctrl+Cmd+F (macOS) for fullscreen, which Electron otherwise only provides via
 * the default menu we'd be replacing.
 *
 * On Windows we deliberately omit the Edit menu: its default Ctrl+C accelerator
 * would hijack the terminal's Ctrl+C (SIGINT). On macOS the Edit menu is safe
 * (copy/paste use Cmd, not Ctrl) and provides the expected app menu roles.
 *
 * reload/forceReload/toggleDevTools are dev-only for the same reason: their
 * default accelerators (Ctrl+R, Ctrl+Shift+R, Ctrl+Shift+I) would hijack the
 * shell's Ctrl+R (reverse-i-search) on Windows/Linux in packaged builds, and an
 * accidental reload tears down every terminal in the window.
 */
export function buildMenuTemplate(isMac: boolean, isPackaged: boolean): MenuItemConstructorOptions[] {
  const devItems: MenuItemConstructorOptions[] = isPackaged
    ? []
    : [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' }
      ];
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([{ role: 'appMenu' }, { role: 'editMenu' }] as MenuItemConstructorOptions[])
      : []),
    {
      label: 'View',
      submenu: [
        ...devItems,
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        // The zoomIn role's default accelerator is CommandOrControl+Plus, which
        // Electron registers as Shift + the =/+ key — so plain Ctrl+Plus does
        // nothing on Windows/Linux (macOS gets a hidden Cmd+= item from Electron
        // itself). These hidden duplicates add the shift-less binding plus the
        // numpad +/- everywhere, matching browser zoom behavior.
        { role: 'zoomIn', accelerator: 'CommandOrControl+=', visible: false },
        { role: 'zoomIn', accelerator: 'CommandOrControl+numadd', visible: false },
        { role: 'zoomOut', accelerator: 'CommandOrControl+numsub', visible: false },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ];
  return template;
}

export function installAppMenu(): void {
  const isMac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate(isMac, app.isPackaged)));
}
