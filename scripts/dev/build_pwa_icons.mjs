// --- FILE: scripts/dev/build_pwa_icons.mjs ---
// Иконки приложения (таск 24.2): конь из набора rhosgfx (CC0-1.0, ATTRIBUTION.md) на тёмном фоне «шахматной
// комнаты» в рамке цвета самшита — как favicon.svg, но рисунком, а не буквой шрифта (шрифт с ♞ есть не везде).
// Пишет frontend/public/icons/icon.svg и PNG нужных размеров; растеризует Chromium из Playwright фронтенда.
//
//   cd frontend && node ../scripts/dev/build_pwa_icons.mjs
//
// maskable — без скруглений и рамки, конь в «безопасной зоне» (80 % по центру): Android сам обрезает иконку кругом
// или каплей.

import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUBLIC = join(ROOT, 'frontend', 'public');
const OUT = join(PUBLIC, 'icons');
const require = createRequire(join(ROOT, 'frontend', 'package.json'));
const {chromium} = require('@playwright/test');

const BG = '#1A120B';
const FRAME = '#D0A972';

const knightSvg = readFileSync(join(PUBLIC, 'assets', 'pieces', 'rhosgfx', 'wN.svg'), 'utf8');
const knightBody = knightSvg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const knightBox = /viewBox="([^"]+)"/.exec(knightSvg)?.[1] ?? '0 0 72 72';

/** Иконка 512×512: plain — со скруглением и рамкой, maskable — фон до краёв, конь мельче. */
function icon(kind) {
    const maskable = kind === 'maskable';
    const size = maskable ? 300 : 360;
    const offset = (512 - size) / 2;
    const background = maskable
        ? `<rect width="512" height="512" fill="${BG}"/>`
        : `<rect width="512" height="512" rx="112" fill="${BG}"/>
  <rect x="44" y="44" width="424" height="424" rx="80" fill="none" stroke="${FRAME}" stroke-width="20"/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  ${background}
  <svg x="${offset}" y="${offset + 6}" width="${size}" height="${size}" viewBox="${knightBox}">${knightBody}</svg>
</svg>
`;
}

const TARGETS = [
    {file: 'icon-192.png', kind: 'plain', size: 192},
    {file: 'icon-512.png', kind: 'plain', size: 512},
    {file: 'icon-maskable-512.png', kind: 'maskable', size: 512},
    // iOS сам скругляет углы и не любит прозрачность — фон до краёв, как у maskable.
    {file: 'apple-touch-icon.png', kind: 'maskable', size: 180},
];

mkdirSync(OUT, {recursive: true});
writeFileSync(join(OUT, 'icon.svg'), icon('plain'));

const browser = await chromium.launch();
try {
    for (const target of TARGETS) {
        const page = await browser.newPage({viewport: {width: target.size, height: target.size}});
        const svg = icon(target.kind).replace('viewBox="0 0 512 512"', `viewBox="0 0 512 512" width="${target.size}" height="${target.size}"`);
        await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
        await page.screenshot({path: join(OUT, target.file), omitBackground: true, clip: {x: 0, y: 0, width: target.size, height: target.size}});
        await page.close();
        console.log('icons/' + target.file);
    }
} finally {
    await browser.close();
}
