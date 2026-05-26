import { Menu, type MenuItemConstructorOptions } from 'electron';

/**
 * Install a minimal application menu. It stays hidden on Windows/Linux
 * (autoHideMenuBar), but its accelerators still work — notably F11 (Windows) /
 * Ctrl+Cmd+F (macOS) for fullscreen, which Electron otherwise only provides via
 * the default menu we'd be replacing.
 *
 * On Windows we deliberately omit the Edit menu: its default Ctrl+C accelerator
 * would hijack the terminal's Ctrl+C (SIGINT). On macOS the Edit menu is safe
 * (copy/paste use Cmd, not Ctrl) and provides the expected app menu roles.
 */
export function installAppMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([{ role: 'appMenu' }, { role: 'editMenu' }] as MenuItemConstructorOptions[])
      : []),
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
