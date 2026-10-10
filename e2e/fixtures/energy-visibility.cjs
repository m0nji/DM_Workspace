// Run without Playwright's debugger: its foreground emulation masks the native
// Page Visibility API. This exercises the normal application entry point.
const assert = require('node:assert/strict');
const { app, BrowserWindow } = require('electron');
require('../../out/main/index.js');

async function until(check, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

app.whenReady().then(async () => {
  await until(() => BrowserWindow.getAllWindows().length > 0, 'the window');
  const win = BrowserWindow.getAllWindows()[0];
  const read = source => win.webContents.executeJavaScript(source);
  await until(async () => !win.webContents.isLoading() && await read(
    `[...document.querySelectorAll('button')].some(b => b.textContent.trim() === '1 Pane')`
  ), 'the pane chooser');
  await read(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '1 Pane').click()`);
  const buffer = () => read(`window.__bufferText ? [...window.__bufferText.values()][0]?.() ?? '' : ''`);
  const canvases = () => read(`document.querySelectorAll('.xterm canvas').length`);
  await until(async () => (await buffer()).trim().length > 0, 'the shell prompt');
  await until(async () => await canvases() > 0, 'terminal graphics');
  const originalCount = await canvases();
  const paneId = await read(`document.querySelector('.pane').dataset.paneId`);
  assert.ok(paneId);
  await read(`window.__energyHost = document.querySelector('.xterm-host')`);

  win.minimize();
  await until(() => win.isMinimized(), 'native minimization');
  await until(() => read('document.hidden'), 'hidden document');
  await until(async () => await canvases() === 0, 'graphics release');
  // Keep using the real shell/PTY/IPC path while rendering is asleep. The
  // expected string is deliberately absent from the echoed command itself.
  await read(`window.api.input({paneId: ${JSON.stringify(paneId)}, data: 'echo ENERGY_BACKGROUND_"CHECK"\\r'})`);
  await until(async () => (await buffer()).includes('ENERGY_BACKGROUND_CHECK'), 'background shell output');

  win.restore();
  win.show();
  win.focus();
  await until(async () => !(await read('document.hidden')), 'visible document');
  await until(async () => await canvases() === originalCount, 'graphics recovery');
  assert.equal(await read(`window.__energyHost === document.querySelector('.xterm-host')`), true);
  assert.equal(await read(`document.querySelector('.pane').dataset.paneId`), paneId);
  assert.ok((await buffer()).includes('ENERGY_BACKGROUND_CHECK'));
  console.log('ENERGY_VISIBILITY_OK');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => app.quit());
