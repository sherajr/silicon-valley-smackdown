#!/usr/bin/env node
// Arena graphics evidence: screenshots at several viewports, surface-flicker metrics, draw/resource statistics and
// frame timing. It works against any build of Arena (it feature-detects the test hooks), so the same script produced
// the "before" and "after" evidence. Hooks are only present with ?arenaTest=1.
//
//   node scripts/arena-evidence.mjs --label after --dir dist --out .scratch/evidence/after [--only home,stages,crops,perf]
//   node scripts/arena-evidence.mjs --label portable --file release/Silicon-Valley-Smackdown-Arena/PLAY.html --out ...
//
// By default it launches Chromium on the discrete GPU (D3D11). Pass --software for SwiftShader.
import { chromium } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { decodePng } from './lib/png.mjs';
import { meanLuma, summarize, surfaceRects } from './lib/surface.mjs';

const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i < 0 ? fallback : argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true; };
const label = opt('label', 'run'), out = path.resolve(opt('out', `.scratch/evidence/${label}`)), only = String(opt('only', 'home,select,stages,fighters,crops,fx,perf')).split(',');
const software = !!opt('software', false), dirArg = opt('dir', null), fileArg = opt('file', null), tier = opt('quality', null);
fs.mkdirSync(out, { recursive: true });

const VIEWPORTS = { w1080: [1080, 762], w1227: [1227, 832], hd720: [1280, 720], fhd1080: [1920, 1080], ultrawide: [2560, 1080], narrow: [420, 860] };
const GPU_ARGS = ['--use-angle=d3d11', '--force_high_performance_gpu', '--ignore-gpu-blocklist', '--mute-audio'];
const SOFT_ARGS = ['--enable-unsafe-swiftshader', '--mute-audio'];
const results = { label, when: new Date().toISOString(), software, quality: tier, notes: [], console: [] };

function serve(root) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.mp3': 'audio/mpeg', '.glb': 'model/gltf-binary' };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
    const file = path.join(root, p); if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

let target, closeServer = () => {};
if (fileArg) target = pathToFileURL(path.resolve(String(fileArg))).href + '?arenaTest=1';
else {
  const { server, base } = await serve(path.resolve(String(dirArg ?? 'dist'))); closeServer = () => server.close(); target = `${base}/?arenaTest=1`;
}

const browser = await chromium.launch({ headless: true, args: software ? SOFT_ARGS : GPU_ARGS });

async function open(size, dpr = 1, extra = {}) {
  const context = await browser.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: dpr, ...extra });
  const page = await context.newPage();
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') results.console.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
  page.on('pageerror', e => results.console.push(`[pageerror] ${String(e.message).slice(0, 300)}`));
  if (tier) await page.addInitScript(t => { try { localStorage.setItem('svs-arena-v1', JSON.stringify({ quality: t, high: t !== 'performance' })); } catch { /* ignore */ } }, tier);
  await page.goto(target); await page.waitForSelector('#enter');
  await page.addStyleTag({ content: '#arena-ui.hidden-ui{visibility:hidden!important}' });
  await page.evaluate(() => {
    const v = window.__arena.view;
    if (typeof v.setCameraOverride !== 'function') {
      // Older builds: wrap lookAt so the harness can place the camera after the game's own camera logic has run.
      const cam = v.camera, original = cam.lookAt.bind(cam);
      cam.lookAt = (...a) => { const o = window.__camOverride; if (o) { cam.position.set(...o.pos); original(...o.target); } else original(...a); };
      v.setCameraOverride = (pos, target) => { window.__camOverride = pos ? { pos, target } : null; };
    }
  });
  return { context, page };
}
const frames = (page, n = 2) => page.evaluate(n => new Promise(r => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const ui = (page, visible) => page.evaluate(v => document.getElementById('arena-ui').classList.toggle('hidden-ui', !v), visible);
const shot = async (page, name, clip) => { const file = path.join(out, `${name}.png`); const buffer = await page.screenshot({ path: file, clip }); return buffer; };
const startMatch = (page, fighters, stage, mode = 'versus') => page.evaluate(([f, s, m]) => { const a = window.__arena; a.launch({ fighters: f, stage: s, mode: m }); a.sim.countdown = 0; }, [fighters, stage, mode]);
const setCam = (page, pos, target) => page.evaluate(([p, t]) => window.__arena.view.setCameraOverride(p, t), [pos, target]);
const clearCam = page => page.evaluate(() => window.__arena.view.setCameraOverride(null, null));

async function rendererInfo(page) {
  return page.evaluate(() => {
    const gl = window.__arena.view.renderer.getContext(), e = gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), samples: gl.getParameter(gl.SAMPLES), drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight] };
  });
}

// --- Home, selection ------------------------------------------------------------------------------------------
async function home() {
  for (const [name, size] of Object.entries(VIEWPORTS)) {
    const { context, page } = await open(size); await page.waitForTimeout(2400);
    await shot(page, `home-${name}-${size[0]}x${size[1]}`);
    if (name === 'fhd1080' || name === 'hd720') { await ui(page, false); await frames(page, 3); await shot(page, `home3d-${name}`); await ui(page, true); }
    // Everything the player must reach has to be inside the viewport.
    const reach = await page.evaluate(() => {
      const box = s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) }; };
      return { w: innerWidth, h: innerHeight, enter: box('#enter'), how: box('#how'), title: box('h1'), tag: box('.location-tag'), footer: box('.bottom-strip') };
    });
    (results.reach ??= {})[name] = reach; await context.close();
  }
}
async function select() {
  for (const name of ['hd720', 'fhd1080', 'narrow']) {
    const size = VIEWPORTS[name], { context, page } = await open(size); await page.click('#enter'); await page.waitForTimeout(1500);
    await shot(page, `select-${name}`); await context.close();
  }
}

// --- Gameplay stills -------------------------------------------------------------------------------------------
async function stages() {
  for (const name of ['fhd1080', 'hd720']) {
    const size = VIEWPORTS[name], { context, page } = await open(size);
    for (let s = 0; s < 3; s++) {
      await startMatch(page, [s * 2, s * 2 + 1], s); await page.waitForTimeout(2600);
      await page.evaluate(() => { const f = window.__arena.sim.fighters; f[1].damage = 87; f[0].damage = 12; });
      await frames(page, 3); await shot(page, `match-${name}-stage${s}`);
      if (name === 'fhd1080') { await ui(page, false); await frames(page, 3); await shot(page, `match3d-stage${s}`); await ui(page, true); }
    }
    await context.close();
  }
}
async function fighters() {
  const { context, page } = await open(VIEWPORTS.fhd1080);
  for (let i = 0; i < 6; i++) {
    await startMatch(page, [i, (i + 1) % 6], i % 3); await page.waitForTimeout(900); await ui(page, false);
    const pos = await page.evaluate(() => window.__arena.sim.fighters[0].x);
    await setCam(page, [pos + 2.6, 2.4, 7.0], [pos - 0.1, 1.45, 0]); await frames(page, 6);
    await shot(page, `fighter-${i}-closeup`); await setCam(page, [pos + 6, 3.4, 13], [pos, 1.7, 0]); await frames(page, 6); await shot(page, `fighter-${i}-medium`);
    await clearCam(page); await ui(page, true);
  }
  await context.close();
}

// --- Surface flicker: platform-top regions while the camera moves slowly ---------------------------------------------
// Z-fighting is intermittent and depends on the exact camera position, so one clean frame proves nothing. Each region
// is captured over a sweep of tiny camera moves. A stable surface has a steady mean brightness; two coincident faces of
// different colours swing it by tens of levels from frame to frame.
async function menuSweep() {
  // The real menu camera, no override: a slow orbit. Frames are captured back to back over a few seconds.
  const { context, page } = await open(VIEWPORTS.fhd1080); await page.waitForTimeout(1500); await ui(page, false);
  const seq = { main: [], upper: [] };
  for (let i = 0; i < 60; i++) {
    const rects = await surfaceRects(page, -4.6);
    for (const k of Object.keys(rects)) seq[k].push(decodePng(await page.screenshot({ clip: rects[k] })));
    await page.waitForTimeout(60);
  }
  results.crops['menu-orbit'] = { main: summarize(seq.main), upper: summarize(seq.upper) };
  await context.close();
}
async function crops() {
  results.crops = {};
  for (const dpr of [1, 2]) {
    const { context, page } = await open(VIEWPORTS.fhd1080, dpr);
    for (let s = 0; s < 3; s++) {
      await startMatch(page, [s * 2, s * 2 + 1], s); await page.waitForTimeout(1200);
      // Hide the fighters (so only the surfaces are analysed) and hold the simulation still.
      await page.evaluate(() => { const a = window.__arena; a.paused = true; for (const f of a.sim.fighters) f.respawn = 9999; });
      await ui(page, false);
      const base = { pos: [0, 11, 17], target: [0, 2.2, 0] };
      const seqs = { main: [], upper: [] }, N = 48;
      for (let i = 0; i < N; i++) {
        const t = i / N * Math.PI * 2;      // a slow orbit of about 0.5 units: sub-pixel to few-pixel motion
        await setCam(page, [base.pos[0] + 0.3 * Math.sin(t), base.pos[1] + 0.14 * Math.cos(t), base.pos[2] + 0.25 * Math.sin(t * 1.5)], [base.target[0] + 0.3 * Math.sin(t), base.target[1], base.target[2]]); await frames(page, 2);
        const rects = await surfaceRects(page);
        for (const k of Object.keys(rects)) {
          const buf = await page.screenshot({ clip: rects[k] }); if (i === 0 || i === 12) fs.writeFileSync(path.join(out, `crop-${k}-dpr${dpr}-stage${s}-f${i}.png`), buf);
          seqs[k].push(decodePng(buf));
        }
      }
      results.crops[`dpr${dpr}-stage${s}`] = { main: summarize(seqs.main), upper: summarize(seqs.upper) };
      // Save the frame whose floor brightness departs furthest from the sweep's median: the clearest picture of any flicker.
      const lumas = seqs.main.map(meanLuma), median = [...lumas].sort((p, c) => p - c)[Math.floor(lumas.length / 2)];
      const worst = lumas.reduce((best, v, i) => (Math.abs(v - median) > Math.abs(lumas[best] - median) ? i : best), 0), tw = worst / N * Math.PI * 2;
      await setCam(page, [base.pos[0] + 0.3 * Math.sin(tw), base.pos[1] + 0.14 * Math.cos(tw), base.pos[2] + 0.25 * Math.sin(tw * 1.5)], [base.target[0] + 0.3 * Math.sin(tw), base.target[1], base.target[2]]); await frames(page, 3);
      fs.writeFileSync(path.join(out, `flicker-worst-dpr${dpr}-stage${s}.png`), await page.screenshot({ clip: { x: 160, y: 120, width: 1600, height: 840 } }));
      results.crops[`dpr${dpr}-stage${s}`].worstFrame = { index: worst, luma: +lumas[worst].toFixed(2), median: +median.toFixed(2) };
      await setCam(page, base.pos, base.target); await frames(page, 3);
      fs.writeFileSync(path.join(out, `surface-dpr${dpr}-stage${s}.png`), await page.screenshot({ clip: { x: 160, y: 120, width: 1600, height: 840 } }));
      await clearCam(page);
    }
    await context.close();
  }
  await menuSweep();
}

// --- Combat effects --------------------------------------------------------------------------------------------
// Builds with an effect clock (view.effects) are photographed deterministically: the app is paused, the event is spawned and
// the clock advanced by hand to a chosen age, so every frame is the same instant of the effect. Older builds fall back to
// racing a screenshot against a short-lived effect.
async function fx() {
  const { context, page } = await open(VIEWPORTS.fhd1080); await startMatch(page, [0, 1], 0); await page.waitForTimeout(2200); await ui(page, false);
  const kinds = { hit: { age: 0.07, value: 20 }, ko: { age: 0.15, x: 19, y: 4 }, block: { age: 0.08 }, counter: { age: 0.1 }, impact: { age: 0.12, y: 1 }, land: { age: 0.12, y: 1 }, catch: { age: 0.08 } };
  const deterministic = await page.evaluate(() => !!window.__arena.view.effects);
  for (const [type, k] of Object.entries(kinds)) {
    if (deterministic) {
      // Every shot starts from the same pinned scene: the target fighter standing still at a fixed spot and the app paused, so
      // nothing drifts between shots (an earlier version gave the fighter a velocity and let the app run, and later shots
      // framed an empty street).
      await page.evaluate(([type, k]) => {
        const a = window.__arena, v = a.view, f = a.sim.fighters[1]; a.paused = true; a.sim.freeze = 0;
        f.x = f.prevX = 4.5; f.y = f.prevY = 0; f.vx = f.vy = 0; f.grounded = true; f.support = 'main'; f.stun = 0;
        v.effects.clear();
        const ex = k.x ?? f.x, ey = k.y ?? f.y + 1.2;
        v.event({ type, x: ex, y: ey, slot: 1, value: k.value ?? 12 }, a.sim); v.effects.clock += k.age;
        v.setCameraOverride(...(type === 'ko' ? [[12.5, 4.6, 15], [17.2, 4, 0]] : [[ex + 3.2, 3.2, 10.5], [ex - 0.2, 1.6, 0]]));
      }, [type, k]);
      await page.waitForTimeout(450); await shot(page, `fx-${type}`, { x: 160, y: 120, width: 1600, height: 840 });
      await page.evaluate(() => { const a = window.__arena; a.view.setCameraOverride(null, null); a.view.effects.clear(); a.paused = false; }); await page.waitForTimeout(300);
    } else {
      await page.evaluate(([t]) => { const a = window.__arena, f = a.sim.fighters[1]; a.sim.freeze = 0; a.view.event({ type: t, x: f.x, y: f.y + 1.2, slot: 1, value: 12 }); }, [type]);
      await page.waitForTimeout(70); await shot(page, `fx-${type}`, { x: 560, y: 300, width: 800, height: 480 });
    }
  }
  await context.close();
}

// --- Draw statistics and frame timing ----------------------------------------------------------------------------------
async function bench(page, n = 150) {
  return page.evaluate(async n => {
    const a = window.__arena, gl = a.view.renderer.getContext(), px = new Uint8Array(4), real = window.requestAnimationFrame;
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'), queries = [];
    window.requestAnimationFrame = () => 0;                       // the app's own loop keeps its pending callback; we drive frames by hand
    let now = a.last || performance.now(); const cpu = [];
    for (let i = 0; i < n; i++) {
      now += 1000 / 60; const q = ext ? gl.createQuery() : null; if (q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      const t0 = performance.now(); a.frame(now);
      if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); queries.push(q); }
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); cpu.push(performance.now() - t0);
    }
    window.requestAnimationFrame = real;
    await new Promise(r => setTimeout(r, 300));
    const gpu = [];
    if (ext && !gl.getParameter(ext.GPU_DISJOINT_EXT)) for (const q of queries) if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
    const stat = xs => { if (!xs.length) return null; const s = [...xs].sort((p, c) => p - c), m = xs.reduce((p, c) => p + c, 0) / xs.length; return { mean: +m.toFixed(3), p50: +s[Math.floor(s.length * 0.5)].toFixed(3), p95: +s[Math.floor(s.length * 0.95)].toFixed(3), max: +s[s.length - 1].toFixed(3) }; };
    return { fullFrameMsSynced: stat(cpu.slice(10)), gpuMs: stat(gpu.slice(10)) };
  }, n);
}
async function perf() {
  results.perf = {};
  for (const [name, dpr, size] of [['1080p-dpr1', 1, VIEWPORTS.fhd1080], ['1080p-dpr1.5', 1.5, VIEWPORTS.fhd1080], ['720p-dpr1', 1, VIEWPORTS.hd720]]) {
    const { context, page } = await open(size, dpr); results.perf[name] = {}; results.gpu ??= await rendererInfo(page);
    await page.waitForTimeout(1500);
    const sample = async key => {
      await frames(page, 4);
      const stats = await page.evaluate(() => { const s = window.__arena.view.stats; return { ...s }; });
      const intervals = await page.evaluate(() => new Promise(resolve => { const ts = []; const f = t => { ts.push(t); if (ts.length < 181) requestAnimationFrame(f); else resolve(ts.slice(1).map((v, i) => v - ts[i])); }; requestAnimationFrame(f); }));
      const s = [...intervals].sort((p, c) => p - c);
      results.perf[name][key] = { stats, rafMs: { mean: +(intervals.reduce((p, c) => p + c, 0) / intervals.length).toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2), max: +s[s.length - 1].toFixed(2) }, ...(await bench(page)) };
    };
    await sample('menu');
    for (let st = 0; st < 3; st++) { await startMatch(page, [st * 2, st * 2 + 1], st); await page.waitForTimeout(1800); await sample(`match-stage${st}`); }
    // Heavy simultaneous effects.
    await page.evaluate(() => { const a = window.__arena; for (let i = 0; i < 14; i++) a.view.event({ type: i % 3 ? 'hit' : 'ko', x: (i - 7) * 1.2, y: 2 + (i % 4), slot: i % 2, value: 15 }); });
    await sample('match-effects-burst');
    await context.close();
  }
}

const steps = { home, select, stages, fighters, crops, fx, perf };
for (const name of only) { if (!steps[name]) continue; process.stdout.write(`${label}: ${name}…\n`); try { await steps[name](); } catch (e) { results.notes.push(`${name} failed: ${String(e.stack ?? e).split('\n').slice(0, 4).join(' | ')}`); console.error(e); } }
fs.writeFileSync(path.join(out, `results-${only.length === 7 ? 'all' : only.join('+')}.json`), JSON.stringify(results, null, 2));
console.log(JSON.stringify({ gpu: results.gpu, crops: results.crops, perf: results.perf && Object.fromEntries(Object.entries(results.perf).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([m, r]) => [m, { draws: r.stats?.draws, tris: r.stats?.triangles, ms: r.fullFrameMsSynced?.mean, gpuMs: r.gpuMs?.mean }]))])), console: results.console.slice(0, 10), notes: results.notes }, null, 2));
await browser.close(); closeServer();
