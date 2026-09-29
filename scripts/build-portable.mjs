import { build } from 'vite';
import { readFile, writeFile, readdir, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'release', 'Silicon-Valley-Smackdown-Arena');
const temporary = path.join(root, '.scratch', 'portable-build');
await mkdir(output, { recursive: true });
// A single IIFE, with no module imports, fetches, or external assets. file:// works on Windows.
await build({
  configFile: false, root, publicDir: false,
  build: {
    outDir: temporary, emptyOutDir: true, target: 'es2020', cssCodeSplit: false,
    lib: { entry: path.join(root, 'src/arena/portable.ts'), name: 'SVSArena', formats: ['iife'], fileName: 'arena' },
    minify: true, sourcemap: false,
  },
});
const files = await readdir(temporary);
const js = (await readFile(path.join(temporary, files.find(f => f.endsWith('.js'))), 'utf8')).replace(/<\/script/gi, '<\\/script');
const css = (await Promise.all(files.filter(f => f.endsWith('.css')).map(f => readFile(path.join(temporary, f), 'utf8')))).join('\n');
const icon = Buffer.from(await readFile(path.join(root, 'public/favicon.svg'))).toString('base64');
await writeFile(path.join(output, 'PLAY.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; connect-src 'none';">
<link rel="icon" href="data:image/svg+xml;base64,${icon}"><title>Silicon Valley Smackdown — Arena Edition</title>
<style>${css}</style></head><body><div id="app">Loading Silicon Valley Smackdown…</div><script>${js}</script></body></html>`);
await copyFile(path.join(root, 'docs/arena-quick-start.txt'), path.join(output, 'START-HERE.txt'));
await writeFile(path.join(output, 'THIRD-PARTY-NOTICES.txt'), `Silicon Valley Smackdown — Arena Edition\n\nOriginal characters, arenas, procedural models, and synthesized audio belong to this project.\nThe reference for the platform-fighter direction was JRickey/BattleShip, a Smash 64 PC port.\nNo BattleShip, Nintendo, or ROM-derived code or assets are used in this standalone game.\n\nRendering: Three.js\nhttps://threejs.org/\n\n${await readFile(path.join(root, 'node_modules/three/LICENSE'), 'utf8')}\n`);
console.log(`Portable game: ${path.join(output, 'PLAY.html')}`);
