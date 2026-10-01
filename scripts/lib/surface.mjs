// Shared by scripts/arena-evidence.mjs and tests/arena/graphics.spec.ts: measuring whether a platform surface is steady.
//
// Z-fighting is intermittent and depends on the exact camera position, so one clean frame proves nothing. The surface is
// sampled over a sweep of tiny camera moves, always over the same patch of the platform top (re-projected for each camera
// position). A stable surface keeps a steady mean brightness; two coincident faces of different colours swing it by tens
// of levels from one frame to the next.
import { decodePng, speckle } from './png.mjs';

/** Screen rectangles (CSS pixels) inscribed in a world-space patch of the main and an upper platform top. */
export const surfaceRects = (page, mainOffset = 0) => page.evaluate(mainOffset => {
  const a = window.__arena, v = a.view, V = v.camera.position.constructor, w = innerWidth, h = innerHeight;
  const proj = (x, y, z) => { const q = new V(x, y, z).project(v.camera); return [(q.x + 1) / 2 * w, (1 - q.y) / 2 * h]; };
  const rect = (cx, y, hx, hz) => {
    const tl = proj(cx - hx, y, -hz), tr = proj(cx + hx, y, -hz), br = proj(cx + hx, y, hz), bl = proj(cx - hx, y, hz);
    const x0 = Math.max(tl[0], bl[0]), x1 = Math.min(tr[0], br[0]), y0 = Math.max(tl[1], tr[1]), y1 = Math.min(bl[1], br[1]);
    return { x: Math.round(x0), y: Math.round(y0), width: Math.max(4, Math.round(x1 - x0)), height: Math.max(4, Math.round(y1 - y0)) };
  };
  const main = a.sim.platforms.find(p => p.solid), up = a.sim.platforms.find(p => !p.solid);
  return { main: rect(main.x + mainOffset, main.y, mainOffset ? 2.2 : 4.5, 2.4), upper: rect(up.x, up.y, up.w / 2 - 0.9, 0.7) };
}, mainOffset);

export const meanLuma = im => { let s = 0; const n = im.width * im.height; for (let i = 0; i < n; i++) s += 0.2126 * im.data[i * 4] + 0.7152 * im.data[i * 4 + 1] + 0.0722 * im.data[i * 4 + 2]; return s / n; };
const mean = xs => xs.reduce((p, c) => p + c, 0) / xs.length;

/** Stability numbers for a sequence of same-region frames. `lumaRange` is the one that exposes flicker. */
export function summarize(seq) {
  const lumas = seq.map(meanLuma), sp = seq.map(speckle), steps = lumas.slice(1).map((v, i) => Math.abs(v - lumas[i]));
  return {
    frames: seq.length, size: [seq[0].width, seq[0].height],
    lumaRange: +(Math.max(...lumas) - Math.min(...lumas)).toFixed(3), lumaStep: +mean(steps).toFixed(3),
    speckleMean: +mean(sp.map(x => x.speckle)).toFixed(3), speckleMax: +Math.max(...sp.map(x => x.speckle)).toFixed(3), outlierMax: +Math.max(...sp.map(x => x.outliers)).toFixed(4),
  };
}

const frames = (page, n = 2) => page.evaluate(n => new Promise(r => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

/**
 * Sweeps the camera in a slow orbit (about 0.5 world units) over a hidden-fighter, held-still match and returns
 * `{ main, upper }` stability summaries. The camera is placed with the test hook, so the same call works on any build.
 * `onFrame(i, buffers)` receives the raw PNG buffers if the caller wants to save a few.
 */
export async function sweepSurface(page, { steps = 36, onFrame } = {}) {
  await page.evaluate(() => { const a = window.__arena; a.paused = true; for (const f of a.sim.fighters) f.respawn = 9999; });
  await page.addStyleTag({ content: '#arena-ui{visibility:hidden!important}' });
  const base = { pos: [0, 11, 17], target: [0, 2.2, 0] }, seqs = { main: [], upper: [] };
  for (let i = 0; i < steps; i++) {
    const t = i / steps * Math.PI * 2;
    await page.evaluate(([p, tg]) => window.__arena.view.setCameraOverride(p, tg), [[base.pos[0] + 0.3 * Math.sin(t), base.pos[1] + 0.14 * Math.cos(t), base.pos[2] + 0.25 * Math.sin(t * 1.5)], [base.target[0] + 0.3 * Math.sin(t), base.target[1], base.target[2]]]);
    await frames(page, 2);
    const rects = await surfaceRects(page), buffers = {};
    for (const k of Object.keys(rects)) { buffers[k] = await page.screenshot({ clip: rects[k] }); seqs[k].push(decodePng(buffers[k])); }
    onFrame?.(i, buffers);
  }
  await page.evaluate(() => window.__arena.view.setCameraOverride(null, null));
  return { main: summarize(seqs.main), upper: summarize(seqs.upper), seqs };
}
