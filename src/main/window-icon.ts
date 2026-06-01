// Which icon file to set as the explicit BrowserWindow icon, by platform.
// macOS sets the dock/window icon from the signed .app bundle, so the explicit
// icon only matters on Windows (.ico) and Linux. On Linux an .ico renders poorly
// as the X11/Wayland window icon, so we use the 1024×1024 PNG instead. The file
// is resolved against process.resourcesPath (packaged) or build/ (dev) by the
// caller; both locations ship icon.ico and icon.png (see package.json build).
export function windowIconFile(platform: NodeJS.Platform): string {
  return platform === 'linux' ? 'icon.png' : 'icon.ico';
}
