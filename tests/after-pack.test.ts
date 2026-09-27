import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const afterPack = require('../build/after-pack.cjs');

let appOutDir: string;
let nodePty: string;

function touch(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, path.basename(file));
}

beforeEach(() => {
  appOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-'));
  nodePty = path.join(appOutDir, 'resources', 'app.asar.unpacked', 'node_modules', 'node-pty');
  for (const arch of ['x64', 'arm64']) {
    touch(path.join(nodePty, 'third_party', 'conpty', '1.23.0', `win10-${arch}`, 'conpty.dll'));
    touch(path.join(nodePty, 'third_party', 'conpty', '1.23.0', `win10-${arch}`, 'OpenConsole.exe'));
  }
});

afterEach(() => fs.rmSync(appOutDir, { recursive: true, force: true }));

describe('after-pack ConPTY restore', () => {
  it('copies the bundled ConPTY next to the rebuilt conpty.node on Windows', async () => {
    touch(path.join(nodePty, 'build', 'Release', 'conpty.node'));
    await afterPack({ electronPlatformName: 'win32', arch: 1, appOutDir });
    const dest = path.join(nodePty, 'build', 'Release', 'conpty');
    expect(fs.readdirSync(dest).sort()).toEqual(['OpenConsole.exe', 'conpty.dll']);
    expect(fs.readFileSync(path.join(dest, 'conpty.dll'), 'utf8')).toBe('conpty.dll');
  });

  it('leaves other platforms alone', async () => {
    touch(path.join(nodePty, 'build', 'Release', 'conpty.node'));
    await afterPack({ electronPlatformName: 'darwin', arch: 3, appOutDir });
    expect(fs.existsSync(path.join(nodePty, 'build', 'Release', 'conpty'))).toBe(false);
  });

  it('fails the build when the bundled ConPTY is missing', async () => {
    touch(path.join(nodePty, 'build', 'Release', 'conpty.node'));
    fs.rmSync(path.join(nodePty, 'third_party'), { recursive: true });
    await expect(afterPack({ electronPlatformName: 'win32', arch: 1, appOutDir })).rejects.toThrow(/ConPTY/);
  });
});
