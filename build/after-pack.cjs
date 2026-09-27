// electron-builder afterPack hook (runs before signing).
//
// Windows panes spawn with node-pty's useConptyDll, which loads
// conpty\conpty.dll next to the conpty.node that node-pty picked. node-pty's
// postinstall puts the DLL into build/Release/conpty, but electron-builder
// rebuilds node-pty for Electron while packing, and that rebuild empties
// build/Release. Copy the bundled ConPTY back next to every packed
// conpty.node, and fail the build if it cannot be done: without the DLL no
// terminal starts.
const fs = require('fs');
const path = require('path');

const ARCH_NAMES = { 1: 'x64', 3: 'arm64' };

function restoreConptyDll(nodePtyDir, arch) {
  const thirdParty = path.join(nodePtyDir, 'third_party', 'conpty');
  const versions = fs.existsSync(thirdParty) ? fs.readdirSync(thirdParty) : [];
  if (versions.length !== 1) {
    throw new Error(`after-pack: expected one ConPTY version in ${thirdParty}, found ${versions.length}`);
  }
  const source = path.join(thirdParty, versions[0], `win10-${arch}`);
  const release = path.join(nodePtyDir, 'build', 'Release');
  if (!fs.existsSync(path.join(release, 'conpty.node'))) return [];
  const dest = path.join(release, 'conpty');
  fs.mkdirSync(dest, { recursive: true });
  const copied = [];
  for (const file of ['conpty.dll', 'OpenConsole.exe']) {
    fs.copyFileSync(path.join(source, file), path.join(dest, file));
    copied.push(path.join(dest, file));
  }
  return copied;
}

async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const arch = ARCH_NAMES[context.arch];
  if (!arch) throw new Error(`after-pack: no bundled ConPTY for arch ${context.arch}`);
  const nodePtyDir = path.join(context.appOutDir, 'resources', 'app.asar.unpacked', 'node_modules', 'node-pty');
  const copied = restoreConptyDll(nodePtyDir, arch);
  for (const file of copied) console.log(`  • restored ConPTY  file=${path.relative(context.appOutDir, file)}`);
}

module.exports = afterPack;
module.exports.default = afterPack;
module.exports.restoreConptyDll = restoreConptyDll;
