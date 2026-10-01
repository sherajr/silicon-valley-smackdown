#!/usr/bin/env node
// Arena GPU timing: GPU milliseconds per frame from timer queries wrapped around the real render call, in the real
// requestAnimationFrame loop, after a warm-up. Frame-interval timing alone cannot be trusted here: vsync hides cost,
// one shader-compile stall skews any mean, and a laptop GPU downclocks under a light load. So by default the browser is
// launched with vsync and the frame limiter off (the GPU stays at full clocks) and the figure is the median of several
// four-second trials. Hardware only; a software rasterizer has no timer queries (use --software for throughput only).
//
//   node scripts/arena-perf.mjs --dir dist --matrix                 # the standard table, as Markdown
//   node scripts/arena-perf.mjs --dir dist --tier high --w 1920 --h 1080 --dpr 1
//   node scripts/arena-perf.mjs --dir dist --tier high --capped 1   # normal 60 Hz loop instead of uncapped
//   node scripts/arena-perf.mjs --file release/Silicon-Valley-Smackdown-Arena/PLAY.html --tier balanced
import { chromium } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2), opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i < 0 ? d : argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true; };
const software = !!opt('software', false), capped = opt('capped', '0') === '1', trials = +opt('trials', 3), matrix = !!opt('matrix', false);

let base, close = () => {};
if (opt('file', null)) base = pathToFileURL(path.resolve(String(opt('file')))).href + '?arenaTest=1';
else {
  const root = path.resolve(String(opt('dir', 'dist')));
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg' };
  const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(root, p); if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': types[path.extname(f)] ?? 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); close = () => server.close(); base = `http://127.0.0.1:${server.address().port}/?arenaTest=1`;
}
const args = software ? ['--enable-unsafe-swiftshader', '--mute-audio'] : ['--use-angle=d3d11', '--force_high_performance_gpu', '--ignore-gpu-blocklist', '--mute-audio'];
if (!software && !capped) args.push('--disable-gpu-vsync', '--disable-frame-rate-limit');
const browser = await chromium.launch({ headless: true, args });

async function measure({ tier, stage = 0, w = 1920, h = 1080, dpr = 1 }) {
  const page = await (await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr })).newPage();
  await page.addInitScript(t => localStorage.setItem('svs-arena-v1', JSON.stringify({ quality: t })), tier);
  await page.goto(base); await page.waitForSelector('#enter');
  await page.evaluate(s => { const a = window.__arena; a.launch({ fighters: [s * 2, s * 2 + 1], stage: s, mode: 'versus' }); a.sim.countdown = 0; }, stage);
  await page.evaluate(() => {
    const a = window.__arena, v = a.view, gl = v.renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'), orig = v.render.bind(v);
    window.__q = { pending: [], gpu: [], cpu: [] };
    v.render = (...args) => {
      const t0 = performance.now(), q = ext ? gl.createQuery() : null; if (q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      orig(...args); if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); window.__q.pending.push(q); } window.__q.cpu.push(performance.now() - t0);
      const keep = []; for (const p of window.__q.pending) { if (gl.getQueryParameter(p, gl.QUERY_RESULT_AVAILABLE)) { if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) window.__q.gpu.push(gl.getQueryParameter(p, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(p); } else keep.push(p); } window.__q.pending = keep;
    };
  });
  await page.waitForTimeout(software ? 8000 : 6000);          // warm-up: clocks settle, anything lazy has been built
  const rows = [];
  for (let t = 0; t < trials; t++) {
    await page.evaluate(() => { window.__q.gpu.length = 0; window.__q.cpu.length = 0; });
    const ts = await page.evaluate(sec => new Promise(resolve => { const a = []; const end = performance.now() + sec * 1000; const f = x => { a.push(x); if (x < end) requestAnimationFrame(f); else resolve(a); }; requestAnimationFrame(f); }), software ? 8 : 4);
    const r = await page.evaluate(() => { const s = a => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return { p50: b[Math.floor(b.length * 0.5)], p95: b[Math.floor(b.length * 0.95)], n: b.length }; }; return { gpu: s(window.__q.gpu), cpu: s(window.__q.cpu) }; });
    const iv = ts.slice(1).map((v, i) => v - ts[i]);
    rows.push({ gpu50: r.gpu?.p50, gpu95: r.gpu?.p95, cpu50: r.cpu?.p50, fps: 1000 / (iv.reduce((a, b) => a + b, 0) / iv.length), worst: Math.max(...iv) });
  }
  const stats = await page.evaluate(() => { const s = window.__arena.view.stats, g = window.__arena.view.graphics ?? {}; return { draws: s.draws, triangles: s.triangles, geometries: s.geometries, textures: s.textures, pixelRatio: g.pixelRatio ?? null, gpu: g.gpu }; });
  await page.context().close();
  const med = k => { const v = rows.map(r => r[k]).filter(x => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
  return { gpu50: med('gpu50'), gpu95: med('gpu95'), cpu50: med('cpu50'), fps: med('fps'), worst: Math.max(...rows.map(r => r.worst)), ...stats };
}
const fmt = (v, d = 2) => v == null ? 'n/a' : v.toFixed(d);

if (matrix) {
  // The standard table: each preset at 1080p, High at 1.5x, the other arenas, and 720p.
  const cases = [
    ['High', { tier: 'high' }], ['High, 1.5x pixels', { tier: 'high', dpr: 1.5 }], ['High, arena 1 (Sand Hill)', { tier: 'high', stage: 1 }], ['High, arena 2 (Palo Alto)', { tier: 'high', stage: 2 }],
    ['Balanced', { tier: 'balanced' }], ['Balanced, 1.25x pixels', { tier: 'balanced', dpr: 1.25 }], ['Performance', { tier: 'performance' }], ['High, 1280 x 720', { tier: 'high', w: 1280, h: 720 }],
  ];
  console.log(`| Case (${capped ? 'normal 60 Hz loop' : 'uncapped, full clocks'}) | GPU ms p50 | GPU ms p95 | CPU ms in render | frames/s | worst frame ms | draw calls | triangles |\n| --- | --- | --- | --- | --- | --- | --- | --- |`);
  for (const [label, cfg] of cases) { const r = await measure(cfg); console.log(`| ${label} | ${fmt(r.gpu50)} | ${fmt(r.gpu95)} | ${fmt(r.cpu50)} | ${fmt(r.fps, 0)} | ${fmt(r.worst, 0)} | ${r.draws} | ${r.triangles} |`); }
} else {
  const r = await measure({ tier: String(opt('tier', 'high')), stage: +opt('stage', 0), w: +opt('w', 1920), h: +opt('h', 1080), dpr: +opt('dpr', 1) });
  console.log(JSON.stringify(r, null, 2));
}
await browser.close(); close();
