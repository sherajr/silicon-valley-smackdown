#!/usr/bin/env node
// Builds before/after comparison images and contact sheets from screenshots produced by scripts/arena-evidence.mjs.
//
//   node scripts/arena-compare.mjs --before .scratch/evidence/before --after .scratch/evidence/after --out docs/evidence/arena-graphics
//
// Pairs share a file name in both folders. Output is JPEG, kept small enough to commit. Everything is drawn on a canvas in
// headless Chromium, so no image library is needed.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2), opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i < 0 ? d : argv[i + 1]; };
const before = path.resolve(opt('before', '.scratch/evidence/before')), after = path.resolve(opt('after', '.scratch/evidence/after')), out = path.resolve(opt('out', 'docs/evidence/arena-graphics'));
fs.mkdirSync(out, { recursive: true });

/** Pairs: [output name, file name in both folders, optional crop {x,y,w,h} of the source]. */
const PAIRS = [
  ['menu-1920x1080', 'home-fhd1080-1920x1080.png'],
  ['menu-1227x832', 'home-w1227-1227x832.png'],
  ['arena-castro-street', 'match-fhd1080-stage0.png'],
  ['arena-sand-hill-road', 'match-fhd1080-stage1.png'],
  ['arena-palo-alto-launch-night', 'match-fhd1080-stage2.png'],
  ['selection-1280x720', 'select-hd720.png'],
  ['floor-flicker-worst-frame-castro', 'flicker-worst-dpr1-stage0.png'],
  ['floor-flicker-worst-frame-sand-hill', 'flicker-worst-dpr1-stage1.png'],
  ['floor-flicker-worst-frame-palo-alto', 'flicker-worst-dpr1-stage2.png'],
];
const SHEETS = [
  ['fighters-closeup', Array.from({ length: 6 }, (_, i) => [`${['Hunter', 'Kevin', 'Al', 'Priya', 'Chad', 'Elon'][i]}`, `fighter-${i}-closeup.png`]), 3],
  ['menu-viewports', [['1080 x 762', 'home-w1080-1080x762.png'], ['1227 x 832', 'home-w1227-1227x832.png'], ['2560 x 1080 ultrawide', 'home-ultrawide-2560x1080.png'], ['420 x 860 narrow', 'home-narrow-420x860.png']], 2],
  ['effects', [['Heavy hit', 'fx-hit.png'], ['KO burst', 'fx-ko.png'], ['Block', 'fx-block.png'], ['Counter', 'fx-counter.png'], ['Slam impact', 'fx-impact.png'], ['Landing dust', 'fx-land.png']], 3],
];

const read = (dir, name) => { const f = path.join(dir, name); return fs.existsSync(f) ? `data:image/png;base64,${fs.readFileSync(f).toString('base64')}` : null; };
const browser = await chromium.launch({ headless: true }), page = await browser.newPage();
await page.setContent('<canvas id="c"></canvas>');

async function compose(name, cells, cols, cellWidth, caption) {
  const jpeg = await page.evaluate(async ({ cells, cols, cellWidth }) => {
    const load = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    const imgs = await Promise.all(cells.map(c => c.src ? load(c.src) : null));
    const heights = imgs.map(i => i ? Math.round(cellWidth * i.height / i.width) : 0), rows = Math.ceil(cells.length / cols), gap = 10, head = 30;
    const rowH = Array.from({ length: rows }, (_, r) => Math.max(...heights.slice(r * cols, r * cols + cols)) + head);
    const c = document.getElementById('c'); c.width = cols * cellWidth + (cols + 1) * gap; c.height = rowH.reduce((a, b) => a + b, 0) + (rows + 1) * gap;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#0d1a24'; ctx.fillRect(0, 0, c.width, c.height);
    let y = gap;
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < cols; k++) {
        const i = r * cols + k; if (i >= cells.length) break; const x = gap + k * (cellWidth + gap);
        ctx.fillStyle = cells[i].tint ?? '#b7f57a'; ctx.font = '700 15px Segoe UI, Arial'; ctx.fillText(cells[i].label, x, y + 20);
        if (imgs[i]) ctx.drawImage(imgs[i], x, y + head, cellWidth, heights[i]); else { ctx.fillStyle = '#3a4a55'; ctx.fillRect(x, y + head, cellWidth, 120); }
      }
      y += rowH[r] + gap;
    }
    return c.toDataURL('image/jpeg', 0.84);
  }, { cells, cols, cellWidth });
  fs.writeFileSync(path.join(out, `${name}.jpg`), Buffer.from(jpeg.split(',')[1], 'base64')); console.log(`${name}.jpg  ${(fs.statSync(path.join(out, `${name}.jpg`)).size / 1024).toFixed(0)} KB ${caption ?? ''}`);
}

for (const [name, file] of PAIRS) {
  const b = read(before, file), a = read(after, file);
  if (!a) { console.log(`skip ${name}: ${file} missing in after`); continue; }
  await compose(`${name}-before-after`, [{ label: 'BEFORE (main at abeba74)', src: b, tint: '#ff9a7a' }, { label: 'AFTER', src: a, tint: '#b7f57a' }], 2, 900);
}
for (const [name, items, cols] of SHEETS) {
  const cells = items.map(([label, file]) => ({ label, src: read(after, file) })).filter(c => c.src);
  if (cells.length) await compose(name, cells, cols, cols === 3 ? 620 : 900);
}
await browser.close();
