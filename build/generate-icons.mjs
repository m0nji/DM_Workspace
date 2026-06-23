import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const svg = join(dir, 'icon-master.svg');
const iconset = join(dir, 'icon.iconset');
// Linux: electron-builder reads a directory of <size>x<size>.png files and
// installs each into the matching /usr/share/icons/hicolor/<size>x<size>/apps.
// These MUST be standard hicolor sizes — a lone 1024px png lands in a size the
// theme index doesn't list, so the .desktop Icon= fails to resolve and GNOME
// falls back to a generic icon. (build/icon.png stays the 1024px runtime icon.)
const linuxIcons = join(dir, 'icons');
const linuxSizes = [16, 24, 32, 48, 64, 128, 256, 512];

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

// Windows .ico. The macOS/Linux art keeps Apple's safe-area margin (the squircle
// fills ~80% of the 1024 canvas). On the Windows taskbar/Explorer that margin sits
// next to full-bleed neighbours (Chrome, etc.), so our icon looks small and cropped
// — and downscaling a lone 256px frame to 16/24/32px makes it blurry. For Windows we
// (a) scale the art up to fill the canvas and (b) bake every taskbar size as its own
// frame so each is crisp. macOS (.icns/.png) and Linux (icons/) stay untouched.
const WIN_FILL = 1.214; // squircle (824px) -> ~1000px on the 1024 canvas
const svgInner = readFileSync(svg, 'utf8')
  .replace(/^[\s\S]*?<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '');
const winSvg = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><g transform="translate(512 512) scale(${WIN_FILL}) translate(-512 -512)">${svgInner}</g></svg>`;
const renderWin = (size) => sharp(Buffer.from(winSvg), { density: 384 }).resize(size, size).png().toBuffer();
const winSizes = [16, 24, 32, 48, 64, 128, 256];
const winPngs = [];
for (const size of winSizes) winPngs.push(await renderWin(size));
writeFileSync(join(dir, 'icon.ico'), await pngToIco(winPngs));

rmSync(linuxIcons, { recursive: true, force: true });
mkdirSync(linuxIcons, { recursive: true });
for (const size of linuxSizes) {
  writeFileSync(join(linuxIcons, `${size}x${size}.png`), await render(size));
}
console.log('Icons generated: build/icon.icns, build/icon.ico, build/icon.png, build/icons/');
