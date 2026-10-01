#!/usr/bin/env node
// Records a short clip of Arena with Playwright's video recorder: the live menu orbit, then a CPU match in each of the three
// arenas with Player 1 driven by real key presses. It works against any build (it only uses the ?arenaTest=1 launch hook), so
// the same script produced the "before" and "after" clips.
//
//   node scripts/arena-video.mjs --dir .scratch/baseline-dist --out .scratch/evidence/video/before.webm
//   node scripts/arena-video.mjs --dir dist --out docs/evidence/arena-graphics/after.webm
//
// The recorder is a screencast: it captures fewer frames per second than the page renders and costs some speed, so the clips
// show how the game looks and moves, not how fast it runs (scripts/arena-perf.mjs measures that).
import { chromium } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i < 0 ? fallback : argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true; };
const out = path.resolve(String(opt('out', '.scratch/evidence/video/clip.webm'))), software = !!opt('software', false);
const size = { width: +opt('w', 1280), height: +opt('h', 720) };
fs.mkdirSync(path.dirname(out), { recursive: true });

let target, close = () => {};
if (opt('file', null)) target = pathToFileURL(path.resolve(String(opt('file')))).href + '?arenaTest=1';
else {
  const root = path.resolve(String(opt('dir', 'dist')));
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg' };
  const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(root, p); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': types[path.extname(f)] ?? 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); close = () => server.close(); target = `http://127.0.0.1:${server.address().port}/?arenaTest=1`;
}

const browser = await chromium.launch({ headless: true, args: software ? ['--enable-unsafe-swiftshader', '--mute-audio'] : ['--use-angle=d3d11', '--force_high_performance_gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-video-'));
const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1, recordVideo: { dir: tmp, size } });
const page = await context.newPage();
await page.goto(target); await page.waitForSelector('#enter');

const wait = ms => page.waitForTimeout(ms);
const tap = async (code, hold = 70) => { await page.keyboard.down(code); await wait(hold); await page.keyboard.up(code); };
// A fixed rhythm for Player 1: close the distance, a short string of strikes, a special, a hop and a shield. The CPU answers, so
// every run differs a little, but the build under test sees the same inputs.
async function fight(ms) {
  const end = Date.now() + ms, left = () => end - Date.now() > 0;
  const hold = async (code, time) => { await page.keyboard.down(code); await wait(time); await page.keyboard.up(code); };
  while (left()) {
    await hold('KeyD', 600);
    for (let i = 0; i < 3 && left(); i++) { await tap('KeyV'); await wait(240); }
    if (left()) { await tap('KeyB'); await wait(420); }
    if (left()) { await tap('KeyW', 90); await wait(380); await tap('KeyV'); await wait(380); }
    if (left()) await hold('KeyN', 450);
    if (left()) await hold('KeyA', 400);
  }
}

await wait(4000);                                                    // the live menu: showcase fighters and the slow camera drift
for (const [stage, fighters, ms] of [[0, [0, 1], 6000], [1, [2, 3], 5000], [2, [4, 5], 5000]]) {
  await page.evaluate(([s, f]) => { const a = window.__arena; a.launch({ fighters: f, stage: s, mode: 'cpu' }); a.sim.countdown = 0; }, [stage, fighters]);
  await wait(300); await fight(ms);
}
await context.close();                                               // finalises the video file
fs.copyFileSync(await page.video().path(), out);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${out}  ${(fs.statSync(out).size / 1048576).toFixed(2)} MB`);
await browser.close(); close();
