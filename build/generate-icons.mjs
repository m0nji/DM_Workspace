import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const svg = join(dir, 'icon-master.svg');
const iconset = join(dir, 'icon.iconset');

const render = (size) => sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();

const variants = [
  ['icon_16x16.png', 16], ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32], ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128], ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256], ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512], ['icon_512x512@2x.png', 1024]
];
rmSync(iconset, { recursive: true, force: true });
mkdirSync(iconset, { recursive: true });
for (const [name, size] of variants) {
  writeFileSync(join(iconset, name), await render(size));
}
execSync(`iconutil -c icns -o "${join(dir, 'icon.icns')}" "${iconset}"`);
writeFileSync(join(dir, 'icon.png'), await render(1024));
writeFileSync(join(dir, 'icon-256.png'), await render(256));
const ico = await pngToIco([join(dir, 'icon-256.png')]);
writeFileSync(join(dir, 'icon.ico'), ico);
rmSync(join(dir, 'icon-256.png'), { force: true });
console.log('Icons generated: build/icon.icns, build/icon.ico, build/icon.png');
