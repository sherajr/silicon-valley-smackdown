import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
// @ts-expect-error plain ESM helpers shared with scripts/arena-evidence.mjs
import { decodePng, frameDifference, speckle } from '../../scripts/lib/png.mjs';
// @ts-expect-error plain ESM helpers shared with scripts/arena-evidence.mjs
import { meanLuma, summarize, surfaceRects, sweepSurface } from '../../scripts/lib/surface.mjs';

/**
 * Arena rendering regressions. These cover what the simulation tests and the original Arena specs cannot: whether the
 * pictures are steady, correctly attached, correctly sized and resource-stable. Test hooks only exist with ?arenaTest=1.
 *
 * Software-rendered browsers are slow and timing-sensitive, so assertions that depend on exact frames drive the renderer
 * directly (view.render with a chosen alpha) instead of racing the real-time loop.
 */
const portable = process.env.SVS_PORTABLE === '1';
const target = portable ? pathToFileURL(path.resolve('release/Silicon-Valley-Smackdown-Arena/PLAY.html')).href + '?arenaTest=1' : '/?arenaTest=1';
/** three's own PMREM shader makes ANGLE's D3D11 compiler print an X4122 precision note. It is a warning from library code, not a defect. */
const knownNote = (text: string) => /X4122/.test(text);
/** Real GPU (SVS_GPU=1) or a CPU rasterizer. Software frames take hundreds of milliseconds, so sweeps are shorter there. */
const gpu = process.env.SVS_GPU === '1';

type Collector = { problems: string[] };
function watch(page: Page): Collector {
  const c: Collector = { problems: [] };
  page.on('pageerror', e => c.problems.push(`[pageerror] ${e.message}`));
  page.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !knownNote(m.text())) c.problems.push(`[${m.type()}] ${m.text().slice(0, 240)}`); });
  return c;
}
async function open(page: Page, quality?: string) {
  if (process.env.SVS_SANDBOX_DEVICES === '1') await page.addInitScript(() => { (window as any).__pads = []; Object.defineProperty(navigator, 'getGamepads', { value: () => (window as any).__pads }); });
  if (quality) await page.addInitScript(q => { try { localStorage.setItem('svs-arena-v1', JSON.stringify({ quality: q })); } catch { /* ignore */ } }, quality);
  await page.goto(target); await expect(page.locator('#enter')).toBeVisible();
}
const frames = (page: Page, n = 2) => page.evaluate(n => new Promise<void>(r => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const launch = async (page: Page, fighters: number[], stage: number, mode = 'versus') => {
  await page.evaluate(([f, s, m]) => { const a = (window as any).__arena; a.launch({ fighters: f, stage: s, mode: m }); a.sim.countdown = 0; }, [fighters, stage, mode] as const);
  await page.waitForFunction(() => (window as any).__arena.sim.tick > 3);
};
const hideUi = (page: Page) => page.addStyleTag({ content: '#arena-ui{visibility:hidden!important}' });
const mean = async (page: Page) => meanLuma(decodePng(await page.screenshot()));
const glErrors = (page: Page) => page.evaluate(() => { const gl = (window as any).__arena.view.renderer.getContext(); const errs: number[] = []; for (let i = 0; i < 8; i++) { const e = gl.getError(); if (!e) break; errs.push(e); } return errs; });

test.describe('debug surface', () => {
  test('test hooks are absent in normal play', async ({ page }) => {
    test.skip(portable, 'The portable file is always opened with the test flag.');
    await page.goto('/'); await expect(page.locator('#enter')).toBeVisible();
    expect(await page.evaluate(() => (window as any).__arena)).toBeUndefined();
  });
});

test.describe('geometry and cost', () => {
  test('every platform slab in the live scene matches the simulation record, with batched scenery', async ({ page }) => {
    const c = watch(page); await open(page);
    for (let s = 0; s < 3; s++) {
      await launch(page, [s, (s + 1) % 6], s);
      const r = await page.evaluate(() => {
        const a = (window as any).__arena, stage = a.view.stage;
        return { platforms: a.sim.platforms.map((p: any) => { const m = stage.slabs.get(p.id), g = m.geometry.parameters; return { id: p.id, p, top: m.position.y + g.height / 2, bottom: m.position.y - g.height / 2, w: g.width, x: m.position.x }; }), stats: stage.stats, cost: a.view.stats };
      });
      for (const { p, top, bottom, w, x } of r.platforms) { expect(top).toBeCloseTo(p.y, 5); expect(bottom).toBeCloseTo(p.y - p.thickness, 5); expect(w).toBeCloseTo(p.w, 5); expect(x).toBeCloseTo(p.x, 5); }
      expect(r.stats.meshes).toBeLessThan(80); expect(r.stats.casters).toBeLessThan(25);
      // A whole frame, every pass included: far fewer than the roughly 560 draw calls before.
      expect(r.cost.draws).toBeLessThan(380); expect(r.cost.triangles).toBeLessThan(260000);
    }
    expect(c.problems).toEqual([]);
  });

  test('the High preset runs the full pipeline: HDR target, multisampling, bloom, real shadows', async ({ page }) => {
    await open(page, 'high'); await launch(page, [0, 1], 0);
    const g = await page.evaluate(() => (window as any).__arena.view.graphics);
    expect(g.tier).toBe('high'); expect(g.shadowSize).toBe(2048); expect(g.pixelRatio).toBeLessThanOrEqual(1.5);
    expect(g.post.hdr).toBe(true); expect(g.post.passes).toEqual(expect.arrayContaining(['render', 'bloom', 'output']));
    expect(g.post.samples === 0 ? g.post.smaa : g.post.samples >= 2).toBe(true);        // multisampled, or SMAA as the tested fallback
  });
});

test.describe('surface stability', () => {
  for (const stage of [0, 1, 2]) {
    test(`arena ${stage}: floor and upper platforms hold a steady brightness under slow camera motion`, async ({ page }, info) => {
      const c = watch(page); await open(page); await launch(page, [stage * 2, stage * 2 + 1], stage); await page.waitForTimeout(600);
      const { main, upper } = await sweepSurface(page, { steps: gpu ? 30 : 12, onFrame: (i: number, b: any) => { if (i === 0) void info.attach(`floor-arena${stage}`, { body: b.main, contentType: 'image/png' }); } });
      // Before the fix the mean brightness of these regions swung by about 60 and 55-117 levels (and 14-35 per frame).
      expect(main.lumaRange).toBeLessThan(8); expect(main.lumaStep).toBeLessThan(3);
      expect(upper.lumaRange).toBeLessThan(6); expect(upper.lumaStep).toBeLessThan(1.5);
      expect(c.problems).toEqual([]);
    });
  }

  test('the live menu camera orbit does not flicker the floor', async ({ page }) => {
    await open(page); await page.waitForTimeout(1200); await hideUi(page);
    const seq: any[] = [];
    for (let i = 0; i < (gpu ? 40 : 14); i++) { const r = await surfaceRects(page, -4.6); seq.push(decodePng(await page.screenshot({ clip: r.main }))); await page.waitForTimeout(50); }
    const s = summarize(seq); expect(s.lumaRange).toBeLessThan(6); expect(s.lumaStep).toBeLessThan(1.5);      // was 67 and 16 before
  });

  test('identical frozen states render identical frames', async ({ page }) => {
    await open(page); await launch(page, [0, 1], 0);
    await page.evaluate(() => { const a = (window as any).__arena; a.paused = true; a.view.setCameraOverride([0, 9, 20], [0, 2.5, 0]); });
    await hideUi(page); await frames(page, 6);
    const a = decodePng(await page.screenshot()), b = decodePng(await page.screenshot());
    expect(frameDifference(a, b)).toBeLessThan(0.02);
    await frames(page, 30); const c = decodePng(await page.screenshot()); expect(frameDifference(a, c)).toBeLessThan(0.02);     // nothing drifts or shimmers on its own
  });

  test('surfaces stay clean at 2x device scale', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 }), page = await ctx.newPage();
    await open(page); await launch(page, [0, 1], 0); await page.waitForTimeout(500);
    const { main, upper } = await sweepSurface(page, { steps: gpu ? 18 : 8 });
    expect(main.lumaRange).toBeLessThan(8); expect(upper.lumaRange).toBeLessThan(6);
    await ctx.close();
  });

  test('the floor is smooth: painted seams are broad and low contrast, with no speckle', async ({ page }) => {
    await open(page); await launch(page, [0, 1], 2); await page.waitForTimeout(500);
    const { main } = await sweepSurface(page, { steps: gpu ? 6 : 4 });
    expect(main.speckleMax).toBeLessThan(5); expect(main.outlierMax).toBeLessThan(0.05);
  });
});

test.describe('readable invulnerability', () => {
  test('the fighter stays visible and glowing gently while the simulation protection counts down unchanged', async ({ page }) => {
    await open(page); await launch(page, [0, 1], 0);
    const log = await page.evaluate(async () => {
      const a = (window as any).__arena, f = a.sim.fighters[0], rig = a.view.rigs[0]; f.invincible = 600; a.sim.freeze = 0;
      const rows: any[] = []; const t0 = a.sim.tick, i0 = f.invincible;
      for (let i = 0; i < 14; i++) {
        await new Promise<void>(r => requestAnimationFrame(() => r()));
        let em = 0; rig.root.traverse((o: any) => { if (o.isMesh && o.material?.isMeshStandardMaterial && !em && o.material.emissiveIntensity > 0) em = o.material.emissiveIntensity; });
        rows.push({ visible: rig.root.visible && rig.body.visible, halo: rig.halo.visible, em, inv: f.invincible, ticks: a.sim.tick - t0 });
      }
      return { rows, i0 };
    });
    expect(log.rows.every(r => r.visible && r.halo)).toBe(true);
    expect(Math.max(...log.rows.map(r => r.em))).toBeLessThan(0.32);
    // Protection counts down one per simulation tick, exactly as before: the visual change did not touch it.
    for (const r of log.rows) expect(r.inv).toBeGreaterThanOrEqual(log.i0 - r.ticks - 1);
    expect(log.rows.at(-1)!.inv).toBeLessThan(log.i0);
  });

  test('a respawning fighter is hidden until they return, then protected and visible', async ({ page }) => {
    await open(page); await launch(page, [0, 1], 0);
    await page.evaluate(() => { const a = (window as any).__arena; a.sim.fighters[1].y = -12; });
    await page.waitForFunction(() => (window as any).__arena.sim.fighters[1].respawn > 0);
    expect(await page.evaluate(() => (window as any).__arena.view.rigs[1].root.visible)).toBe(false);
    await page.waitForFunction(() => (window as any).__arena.sim.fighters[1].respawn === 0 && (window as any).__arena.sim.fighters[1].invincible > 0, undefined, { timeout: 15000 });
    await frames(page, 3);
    expect(await page.evaluate(() => { const v = (window as any).__arena.view; return [v.rigs[1].root.visible, v.rigs[1].halo.visible]; })).toEqual([true, true]);
  });
});

test.describe('attached visuals follow the drawn position', () => {
  test('model, label, contact shadow and effects all use the interpolated position, for both slots', async ({ page }) => {
    await open(page); await launch(page, [2, 3], 1);
    const r = await page.evaluate(() => {
      const a = (window as any).__arena, v = a.view, out: any[] = [];
      a.paused = true;
      for (const slot of [0, 1]) {
        const f = a.sim.fighters[slot]; Object.assign(f, { x: 1 + slot * 4, prevX: 0 + slot * 4, y: 0.5, prevY: 0, grounded: false });
        for (const alpha of [0, 0.25, 0.5, 1]) {
          v.render(a.sim, { dt: 0, time: 1, menu: false, alpha, paused: true, stepping: false });
          const drawn = v.rendered[slot], rig = v.rigs[slot], anchor = v.anchor(slot, 2.9), direct = v.project(drawn.x, drawn.y + 2.9);
          out.push({ slot, alpha, expectedX: f.prevX + (f.x - f.prevX) * alpha, drawnX: drawn.x, rigX: rig.root.position.x, rigY: rig.root.position.y, drawnY: drawn.y, anchorOff: Math.hypot(anchor.x - direct.x, anchor.y - direct.y) });
        }
      }
      return out;
    });
    for (const row of r) { expect(row.drawnX).toBeCloseTo(row.expectedX, 6); expect(row.rigX).toBeCloseTo(row.drawnX, 6); expect(row.rigY).toBeCloseTo(row.drawnY, 6); expect(row.anchorOff).toBeLessThan(0.01); }
  });

  test('a floating label is positioned from the same drawn position the model uses (checked while walking)', async ({ page }) => {
    await open(page); await launch(page, [0, 1], 0);
    await page.keyboard.down('d');
    const worst = await page.evaluate(async () => {
      const a = (window as any).__arena, v = a.view; let worst = 0;
      for (let i = 0; i < 40; i++) {
        await new Promise<void>(r => requestAnimationFrame(() => r()));
        const m = (document.getElementById('marker0') as HTMLElement).style.transform.match(/translate3d\(([-\d.]+)px,([-\d.]+)px/), p = v.anchor(0, 2.9);
        if (m) worst = Math.max(worst, Math.abs(Number(m[1]) - Math.max(22, Math.min(v.size.width - 22, p.x))));
      }
      return worst;
    });
    await page.keyboard.up('d');
    expect(worst).toBeLessThan(2);
  });

  test('a held opponent is drawn in the captor\'s hands through a real grab, pummel and throw', async ({ page }) => {
    await open(page); await launch(page, [0, 1], 0);
    await page.evaluate(() => { const a = (window as any).__arena, [p1, p2] = a.sim.fighters; for (const f of [p1, p2]) Object.assign(f, { y: 0, prevY: 0, vx: 0, vy: 0, stun: 0, invincible: 0, damage: 0, attack: null, grounded: true }); p1.x = p1.prevX = 0; p2.x = p2.prevX = 1.25; p1.facing = 1; p2.facing = -1; a.sim.freeze = 0; });
    await page.keyboard.press('m');
    await page.waitForFunction(() => (window as any).__arena.sim.fighters[1].heldBy === 0, undefined, { timeout: 8000 });
    await frames(page, 4);
    const gap = await page.evaluate(() => {
      const v = (window as any).__arena.view, T = v.camera.position.constructor, hand = new T(), chest = new T();
      v.rigs[0].root.updateMatrixWorld(true); v.rigs[1].root.updateMatrixWorld(true); v.rigs[0].handMidpoint(hand); v.rigs[1].chestWorld(chest);
      return hand.distanceTo(chest);
    });
    expect(gap).toBeLessThan(0.75);
  });

  test('every move, shield, grab, throw, KO and respawn draws without errors, for both slots', async ({ page }) => {
    const c = watch(page); await open(page); await launch(page, [4, 5], 2);
    const moves = ['jab1', 'jab2', 'jab3', 'heavy', 'upper', 'sweep', 'nair', 'fair', 'bair', 'uair', 'dair', 'special', 'recovery', 'down', 'grab', 'pummel', 'fthrow', 'bthrow', 'uthrow', 'dthrow'];
    const bad = await page.evaluate(async moves => {
      const a = (window as any).__arena, v = a.view, problems: string[] = [];
      for (const slot of [0, 1]) for (const id of moves) {
        const f = a.sim.fighters[slot]; Object.assign(f, { attack: null, stun: 0, respawn: 0, x: -2 + slot * 4, prevX: -2 + slot * 4, y: id.includes('air') ? 2 : 0, prevY: id.includes('air') ? 2 : 0, grounded: !id.includes('air') });
        try { a.sim.startAttack(f, id); } catch (e) { problems.push(`start ${slot}/${id}: ${e}`); continue; }
        for (let i = 0; i < 3; i++) await new Promise<void>(r => requestAnimationFrame(() => r()));
        const rig = v.rigs[slot]; let ok = true; rig.root.traverse((o: any) => { if (o.isObject3D && !Number.isFinite(o.rotation.x + o.rotation.y + o.rotation.z + o.position.x + o.position.y + o.position.z)) ok = false; });
        if (!ok) problems.push(`non-finite pose ${slot}/${id}`);
      }
      return problems;
    }, moves);
    expect(bad).toEqual([]);
    // Shield with a block ripple (drawn from a paused state, since the simulation recomputes guarding every tick), then a KO burst and a respawn.
    const shield = await page.evaluate(() => { const a = (window as any).__arena, v = a.view, f = a.sim.fighters[0]; a.paused = true; f.attack = null; f.guarding = true; f.shield = 70; v.event({ type: 'block', x: f.x, y: f.y + 1, slot: 0 }, a.sim); v.render(a.sim, { dt: 0.05, time: 1, menu: false, alpha: 1, paused: true, stepping: false }); const ripple = v.rigs[0].shield.material.uniforms.uRippleAge.value; f.guarding = false; a.paused = false; return { visible: v.rigs[0].shield.visible, ripple }; });
    expect(shield.visible).toBe(true); expect(shield.ripple).toBeLessThan(1);
    await page.evaluate(() => { const a = (window as any).__arena; a.sim.fighters[0].guarding = false; a.sim.fighters[1].y = -12; });
    await page.waitForFunction(() => (window as any).__arena.sim.fighters[1].respawn > 0);
    expect(await page.evaluate(() => (window as any).__arena.view.effects.alive.glow)).toBeGreaterThan(0);        // the KO burst is alive
    expect(await glErrors(page)).toEqual([]); expect(c.problems).toEqual([]);
  });

  test('a launched fighter gets a trail that follows their drawn path, and projectiles get theirs', async ({ page }) => {
    await open(page); await launch(page, [0, 1], 0);
    await page.evaluate(() => { const a = (window as any).__arena; a.sim.freeze = 0; Object.assign(a.sim.fighters[1], { stun: 30, vx: 0.9, vy: 0.6, grounded: false }); a.sim.fighters[1].y = 3; a.sim.fighters[1].prevY = 3; });
    await page.waitForFunction(() => (window as any).__arena.view.trails.active > 0, undefined, { polling: 'raf', timeout: 8000 });
    await page.evaluate(() => { const a = (window as any).__arena; Object.assign(a.sim.fighters[1], { stun: 0, vx: 0, vy: 0 }); });
    await page.waitForFunction(() => (window as any).__arena.view.trails.active === 0, undefined, { polling: 'raf', timeout: 8000 });     // the launch trail fades out and frees its slot
    await page.keyboard.press('b');
    await page.waitForFunction(() => (window as any).__arena.sim.shots.length > 0);
    await page.waitForFunction(() => (window as any).__arena.view.trails.active > 0, undefined, { polling: 'raf', timeout: 8000 });
  });
});

test.describe('timing, pause and hitstop', () => {
  test('pause holds the picture still: no animation, effects clock or shake advance', async ({ page }) => {
    await open(page); await launch(page, [0, 1], 0);
    await page.evaluate(() => { const a = (window as any).__arena; a.view.event({ type: 'hit', x: 0, y: 1, slot: 1, value: 20 }, a.sim); });
    await page.keyboard.press('Escape'); await expect(page.locator('#resume')).toBeVisible();
    const a = await page.evaluate(() => { const v = (window as any).__arena.view; return { clock: v.effects.clock, y: v.rigs[0].body.position.y, off: v.cameraRig.offset.toArray(), shake: v.cameraRig.shaking }; });
    await page.waitForTimeout(400);
    const b = await page.evaluate(() => { const v = (window as any).__arena.view; return { clock: v.effects.clock, y: v.rigs[0].body.position.y, off: v.cameraRig.offset.toArray(), shake: v.cameraRig.shaking }; });
    expect(b).toEqual(a); expect(b.shake).toBe(false); expect(b.off).toEqual([0, 0, 0]);
  });

  test('hitstop freezes fighters and trails but not the spark effects', async ({ page }) => {
    await open(page); await launch(page, [0, 1], 0); await page.waitForTimeout(500);
    // A long hitstop, so the pose has time to ease onto the frozen frame (smoothing settling is not movement).
    await page.evaluate(() => { const a = (window as any).__arena; a.sim.freeze = 400; a.view.event({ type: 'hit', x: 0, y: 1, slot: 1, value: 14 }, a.sim); });
    await page.waitForTimeout(700);
    const r = await page.evaluate(async () => {
      const a = (window as any).__arena, v = a.view;
      v.event({ type: 'hit', x: 0, y: 1, slot: 1, value: 14 }, a.sim);               // a fresh spark during the freeze
      const read = () => ({ body: v.rigs[0].body.position.y, torso: v.rigs[0].torso.rotation.x, head: v.rigs[0].head.rotation.y, anim: v.animClock, fx: v.effects.clock });
      await new Promise<void>(r => requestAnimationFrame(() => r())); const s0 = read();
      for (let i = 0; i < 8; i++) await new Promise<void>(r => requestAnimationFrame(() => r()));
      return { s0, s1: read(), freeze: a.sim.freeze };
    });
    expect(r.freeze).toBeGreaterThan(0);
    expect(r.s1.anim).toBe(r.s0.anim); expect(r.s1.body).toBeCloseTo(r.s0.body, 5); expect(r.s1.head).toBeCloseTo(r.s0.head, 5);    // the fighter holds still
    expect(r.s1.fx).toBeGreaterThan(r.s0.fx);                                                                                     // the sparks keep playing
  });

  test('training frame advance moves exactly one simulation frame and the picture matches that frame', async ({ page }) => {
    await open(page); await page.click('#enter'); await page.selectOption('#mode', 'training'); await page.click('#fight');
    await page.evaluate(() => { (window as any).__arena.sim.countdown = 0; }); await page.waitForFunction(() => (window as any).__arena.sim.tick > 5);
    await page.check('#t-step'); const before = await page.evaluate(() => (window as any).__arena.sim.tick);
    await page.waitForTimeout(250); expect(await page.evaluate(() => (window as any).__arena.sim.tick)).toBe(before);
    await page.keyboard.press('Period'); await page.waitForFunction(b => (window as any).__arena.sim.tick === b + 1, before);
    await page.waitForTimeout(250); expect(await page.evaluate(() => (window as any).__arena.sim.tick)).toBe(before + 1);
    const lit = await mean(page); expect(lit).toBeGreaterThan(20);
  });

  test('hiding the tab pauses the match and nothing is left shaking', async ({ page }) => {
    await open(page); await launch(page, [0, 1], 0);
    await page.evaluate(() => { const a = (window as any).__arena; a.view.cameraRig.addShake(0.3); Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await expect(page.locator('#resume')).toBeVisible();
    await frames(page, 3); expect(await page.evaluate(() => (window as any).__arena.view.cameraRig.shaking)).toBe(false);
  });
});

test.describe('sizing, quality and portraits', () => {
  test('resizing keeps the renderer, camera, post targets and picture in step, with no black frames', async ({ page }) => {
    const c = watch(page); await open(page); await launch(page, [0, 1], 0);
    for (const [w, h] of [[1280, 720], [900, 640], [1600, 900], [640, 960], [1280, 720]]) {
      await page.setViewportSize({ width: w, height: h });
      // Straight away, before the next frame: the canvas is already redrawn, not cleared or stretched.
      const luma = await mean(page); expect(luma).toBeGreaterThan(20);
      await frames(page, 3);
      const s = await page.evaluate(() => { const v = (window as any).__arena.view, gl = v.renderer.getContext(), el = v.renderer.domElement, rt = v.post?.composer?.renderTarget1; return { size: v.size, canvas: [el.clientWidth, el.clientHeight], buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight], aspect: v.camera.aspect, rt: rt ? [rt.width, rt.height] : null, win: [innerWidth, innerHeight] }; });
      expect(s.size.width).toBe(w); expect(s.size.height).toBe(h); expect(s.canvas).toEqual([w, h]);
      expect(s.buffer).toEqual([Math.round(w * s.size.pixelRatio), Math.round(h * s.size.pixelRatio)]);
      expect(s.aspect).toBeCloseTo(w / h, 5); if (s.rt) expect(s.rt).toEqual(s.buffer);
    }
    expect(await glErrors(page)).toEqual([]); expect(c.problems).toEqual([]);
  });

  test('the menu keeps its title, buttons, location tag and footer inside the window, with the buttons reachable, at common sizes', async ({ page }) => {
    await open(page);
    for (const [w, h] of [[1080, 762], [1227, 832], [1280, 720], [1920, 1080], [2560, 1080], [420, 860]]) {
      await page.setViewportSize({ width: w, height: h }); await frames(page, 2);
      const parts = await page.evaluate(() => ['#enter', '#how', 'h1', '.location-tag', '.bottom-strip'].map(sel => {
        const node = document.querySelector(sel) as HTMLElement, b = node.getBoundingClientRect();
        // The topmost element at the middle of the box must be the thing itself (or part of it): nothing is laid over it.
        const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return { sel, left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height, uncovered: !!top && (top === node || node.contains(top)) };
      }));
      for (const p of parts) {
        const where = `${p.sel} at ${w} x ${h}`;
        expect(p.width, where).toBeGreaterThan(0); expect(p.height, where).toBeGreaterThan(0);
        expect(p.left, where).toBeGreaterThanOrEqual(-0.5); expect(p.top, where).toBeGreaterThanOrEqual(-0.5);
        expect(p.right, where).toBeLessThanOrEqual(w + 0.5); expect(p.bottom, where).toBeLessThanOrEqual(h + 0.5);
        if (p.sel.startsWith('#')) expect(p.uncovered, `${where} is covered`).toBe(true);
      }
    }
  });

  test('a change of device scale is applied to the buffers, capped by the preset', async ({ browser }) => {
    for (const [dpr, cap] of [[1, 1], [2, 1.5], [3, 1.5]] as const) {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 600 }, deviceScaleFactor: dpr }), page = await ctx.newPage();
      await open(page, 'high'); await frames(page, 3);
      const r = await page.evaluate(() => (window as any).__arena.view.size);
      expect(r.pixelRatio).toBeCloseTo(Math.min(dpr, cap), 5); await ctx.close();
    }
  });

  test('a live change of device scale and window size (browser zoom) resizes every buffer together, with no black frame', async ({ page }) => {
    const c = watch(page); await open(page, 'high'); await launch(page, [0, 1], 0);
    const cdp = await page.context().newCDPSession(page);
    // Browser zoom changes the pixel ratio and the CSS size of the window at the same moment, on a page that keeps running.
    for (const [w, h, dpr] of [[1000, 600, 1], [500, 300, 2], [800, 480, 1.25], [1250, 750, 0.8], [1000, 600, 1]]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: false });
      await frames(page, 4);
      const s = await page.evaluate(() => { const v = (window as any).__arena.view, gl = v.renderer.getContext(), rt = v.post?.composer?.renderTarget1; return { size: v.size, buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight], rt: rt ? [rt.width, rt.height] : null, ratio: window.devicePixelRatio, win: [innerWidth, innerHeight] }; });
      const where = `${w} x ${h} at ${dpr}x`;
      expect(s.win, where).toEqual([w, h]); expect(s.ratio, where).toBeCloseTo(dpr, 5);
      expect(s.size.width, where).toBe(w); expect(s.size.height, where).toBe(h); expect(s.size.pixelRatio, where).toBeCloseTo(Math.min(dpr, 1.5), 5);
      // three.js sizes the canvas with floor(size * ratio); the browser reports the ratio as a float32 (0.8 reads as 0.80000001), so
      // the composer's targets can carry a fraction of a pixel that the GPU allocation drops. Compare whole pixels.
      expect(s.buffer, where).toEqual([Math.floor(w * s.size.pixelRatio), Math.floor(h * s.size.pixelRatio)]); if (s.rt) expect(s.rt.map(Math.floor), where).toEqual(s.buffer);
      expect(await mean(page), where).toBeGreaterThan(20);
    }
    expect(await glErrors(page)).toEqual([]); expect(c.problems).toEqual([]);
  });

  test('fullscreen and menu/match transitions leave the sizes and camera consistent', async ({ page }) => {
    await open(page); await launch(page, [0, 1], 0);
    await page.evaluate(() => (document.documentElement.requestFullscreen?.() ?? Promise.resolve()).catch(() => {})); await frames(page, 4);
    const s1 = await page.evaluate(() => { const v = (window as any).__arena.view; return [v.size.width, v.size.height, innerWidth, innerHeight]; });
    expect(s1[0]).toBe(s1[2]); expect(s1[1]).toBe(s1[3]);
    await page.keyboard.press('Escape'); await page.click('#quit'); await expect(page.locator('#fight')).toBeVisible();
    await page.click('#back'); await expect(page.locator('#enter')).toBeVisible(); await frames(page, 4);
    const t = await page.evaluate(() => { const v = (window as any).__arena.view; return { shaking: v.cameraRig.shaking, shift: v.cameraRig.shift }; });
    expect(t.shaking).toBe(false); expect(t.shift).toBeGreaterThanOrEqual(0);
  });

  for (const tier of ['high', 'balanced', 'performance'] as const) {
    test(`${tier}: renders cleanly with the right pipeline, from the settings control`, async ({ page }, info) => {
      const c = watch(page); await open(page); await page.click('#enter'); await page.selectOption('#quality', tier);
      await page.click('#fight'); await page.evaluate(() => { (window as any).__arena.sim.countdown = 0; }); await page.waitForTimeout(700);
      const g = await page.evaluate(() => (window as any).__arena.view.graphics);
      expect(g.tier).toBe(tier);
      if (tier === 'performance') { expect(g.post).toBeNull(); expect(g.shadowSize).toBe(0); expect(g.pixelRatio).toBe(1); } else { expect(g.post.passes).toContain('output'); expect(g.shadowSize).toBe(tier === 'high' ? 2048 : 1024); }
      expect(await mean(page)).toBeGreaterThan(25);
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('svs-arena-v1')!).quality)).toBe(tier);        // remembered
      await info.attach(`${tier}.png`, { body: await page.screenshot(), contentType: 'image/png' });
      expect(await glErrors(page)).toEqual([]); expect(c.problems).toEqual([]);
    });
  }

  test('the offline file with HTTP and HTTPS blocked: every preset, the portraits and the effects work and nothing remote is requested', async ({ page }) => {
    test.skip(!portable, 'Direct file delivery is tested after build:portable.');
    test.setTimeout(gpu ? 60_000 : 300_000);        // three presets, each compiled from scratch: slow on a software rasterizer
    const c = watch(page), remote: string[] = [];
    page.on('request', r => { if (/^https?:/.test(r.url())) remote.push(r.url()); });
    await page.route(/^https?:\/\//, route => route.abort());
    await open(page); await page.click('#enter'); await expect(page.locator('[data-fighter]')).toHaveCount(6);
    // Portraits are drawn offscreen at start-up and shown on the cards.
    expect(await page.locator('.fighter-card img').evaluateAll(imgs => imgs.every(i => (i as HTMLImageElement).naturalWidth > 0))).toBe(true);
    for (const tier of ['high', 'balanced', 'performance']) {
      await page.selectOption('#quality', tier); await page.click('#fight');
      await page.evaluate(() => { const a = (window as any).__arena; a.sim.countdown = 0; for (const type of ['hit', 'ko', 'block', 'counter', 'impact', 'land', 'catch']) a.view.event({ type, x: 0, y: 1.5, slot: 1, value: 20 }, a.sim); });
      await page.waitForTimeout(600); await frames(page, 4);
      expect((await page.evaluate(() => (window as any).__arena.view.graphics)).tier).toBe(tier);
      expect(await mean(page)).toBeGreaterThan(25); expect(await glErrors(page)).toEqual([]);
      await page.keyboard.press('Escape'); await page.click('#quit');
    }
    expect(remote).toEqual([]); expect(c.problems).toEqual([]);
  });

  test('changing quality repeatedly neither loses the picture nor leaks resources', async ({ page }) => {
    const c = watch(page); await open(page); await launch(page, [0, 1], 0);
    const cycle = async () => { for (const t of ['balanced', 'performance', 'high', 'performance', 'high']) { await page.evaluate(t => (window as any).__arena.view.setQuality(t), t); await frames(page, 3); expect(await mean(page)).toBeGreaterThan(25); } };
    const read = () => page.evaluate(() => (window as any).__arena.view.stats);
    await cycle(); const warm = await read(); await cycle(); const second = await read(); await cycle(); const third = await read();
    // Each cycle is five preset switches, so a leak of even one resource per switch would add five or more per cycle.
    expect(third.geometries).toBeLessThanOrEqual(second.geometries + 1); expect(second.geometries).toBeLessThanOrEqual(warm.geometries + 2);
    expect(third.textures).toBeLessThanOrEqual(second.textures + 1); expect(second.textures).toBeLessThanOrEqual(warm.textures + 2); expect(third.programs).toBeLessThanOrEqual(warm.programs + 4);
    expect(await glErrors(page)).toEqual([]); expect(c.problems).toEqual([]);
  });

  test('portraits are drawn offscreen with the right colour and leave the renderer untouched', async ({ page }) => {
    await open(page); await frames(page, 3);
    const r = await page.evaluate(() => {
      const v = (window as any).__arena.view, el = v.renderer.domElement, before = { size: v.size, w: el.width, h: el.height, exposure: v.renderer.toneMappingExposure, target: v.renderer.getRenderTarget(), ratio: v.renderer.getPixelRatio() };
      const imgs: string[] = v.portraits();
      return { count: imgs.length, unique: new Set(imgs).size, lengths: imgs.map(s => s.length), before, after: { size: v.size, w: el.width, h: el.height, exposure: v.renderer.toneMappingExposure, target: v.renderer.getRenderTarget(), ratio: v.renderer.getPixelRatio() }, first: imgs[0] };
    });
    expect(r.count).toBe(6); expect(r.unique).toBe(6); for (const n of r.lengths) expect(n).toBeGreaterThan(8000);
    expect(r.after).toEqual(r.before); expect(r.after.target).toBeNull();
    // Correct colour, not black or blown out: sample the image in a throwaway page.
    const tone = await page.evaluate(async src => { const img = new Image(); img.src = src; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d')!; x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let s = 0, mx = 0; for (let i = 0; i < d.length; i += 4) { const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; s += l; mx = Math.max(mx, l); } return { mean: s / (d.length / 4), max: mx, size: [img.width, img.height] }; }, r.first);
    expect(tone.mean).toBeGreaterThan(25); expect(tone.mean).toBeLessThan(200); expect(tone.max).toBeGreaterThan(120); expect(tone.size[0]).toBe(tone.size[1]);
  });
});

test.describe('stability under load', () => {
  test('stage, roster and heavy-effect churn reaches a steady resource count', async ({ page }) => {
    const c = watch(page); await open(page); await launch(page, [0, 1], 0);
    const cycle = async () => {
      for (let i = 0; i < 6; i++) {
        await page.evaluate(i => { const a = (window as any).__arena; a.launch({ fighters: [i, (i + 1) % 6], stage: i % 3, mode: 'versus' }); a.sim.countdown = 0; for (let k = 0; k < 14; k++) a.view.event({ type: ['hit', 'ko', 'counter', 'impact', 'land'][k % 5], x: (k - 7) * 1.1, y: 2 + (k % 4), slot: k % 2, value: 15 }, a.sim); }, i);
        await page.waitForFunction(() => (window as any).__arena.sim.tick > 2); await frames(page, 4);
      }
    };
    await cycle(); const warm = await page.evaluate(() => (window as any).__arena.view.stats);          // every arena has been built and cached once
    await cycle(); await cycle(); const after = await page.evaluate(() => (window as any).__arena.view.stats);
    expect(after.geometries).toBe(warm.geometries); expect(after.textures).toBe(warm.textures); expect(after.programs).toBeLessThanOrEqual(warm.programs + 3);
    // Heavy simultaneous effects stay inside their fixed buffers and the draw count does not grow with them.
    const burst = await page.evaluate(() => { const a = (window as any).__arena, v = a.view; for (let k = 0; k < 80; k++) v.event({ type: ['hit', 'ko', 'counter', 'impact'][k % 4], x: (k % 9 - 4) * 1.4, y: 2 + (k % 5), slot: k % 2, value: 18 }, a.sim); return { alive: v.effects.alive, cap: v.effects.capacity }; });
    expect(burst.alive.glow).toBeLessThanOrEqual(burst.cap.glow); expect(burst.alive.dust).toBeLessThanOrEqual(burst.cap.dust);
    await frames(page, 4); expect((await page.evaluate(() => (window as any).__arena.view.stats)).draws).toBeLessThan(380);
    expect(await glErrors(page)).toEqual([]); expect(c.problems).toEqual([]);
  });

  test('the first hit, shield, projectile, trail and effects never stall a frame (shaders are built ahead of time)', async ({ page }) => {
    await open(page); await launch(page, [0, 1], 0); await page.waitForTimeout(500);
    // Every one of these used to compile a shader the first time it appeared, a stall of a second or more mid-fight.
    const worst = await page.evaluate(async () => {
      const a = (window as any).__arena, v = a.view, ts: number[] = [];
      let n = 0; await new Promise<void>(resolve => { const f = (t: number) => { ts.push(t); n++;
        if (n === 5) { v.event({ type: 'hit', x: 0, y: 1, slot: 1, value: 20 }, a.sim); v.event({ type: 'ko', x: 20, y: 5, slot: 1, value: 90 }, a.sim); v.event({ type: 'land', x: 0, y: 1, slot: 0 }, a.sim); }
        if (n === 8) { Object.assign(a.sim.fighters[1], { stun: 30, vx: 1, vy: 0.5, grounded: false }); }
        if (n === 12) { a.sim.fighters[0].guarding = true; v.rigs[0].shieldHit(1); }
        if (n === 16) a.sim.startAttack(a.sim.fighters[0], 'special');
        if (n < 90) requestAnimationFrame(f); else resolve(); }; requestAnimationFrame(f); });
      return Math.max(...ts.slice(1).map((t, i) => t - ts[i]));
    });
    expect(worst).toBeLessThan(700);
  });

  test('all three arenas and all six fighters render in view, with screenshots attached', async ({ page }, info) => {
    const c = watch(page); await open(page);
    for (let s = 0; s < 3; s++) {
      await launch(page, [s * 2, s * 2 + 1], s); await page.waitForTimeout(900);
      const luma = await mean(page); expect(luma).toBeGreaterThan(30); expect(luma).toBeLessThan(215);
      await info.attach(`arena-${s}.png`, { body: await page.screenshot(), contentType: 'image/png' });
    }
    expect(c.problems).toEqual([]);
  });

  test('the shadow comparison hook changes only the shadows', async ({ page }) => {
    await open(page, 'high'); await launch(page, [0, 1], 0);
    await page.evaluate(() => { const a = (window as any).__arena; a.paused = true; a.view.setCameraOverride([0, 9, 20], [0, 2.5, 0]); });
    await hideUi(page); await frames(page, 5);
    const withShadows = decodePng(await page.screenshot());
    await page.evaluate(() => { (window as any).__arena.view.debugShadowsOff = true; }); await frames(page, 5);
    const without = decodePng(await page.screenshot());
    await page.evaluate(() => { (window as any).__arena.view.debugShadowsOff = false; }); await frames(page, 5);
    const back = decodePng(await page.screenshot());
    expect(frameDifference(withShadows, without)).toBeGreaterThan(0.2); expect(frameDifference(withShadows, back)).toBeLessThan(0.02);
    expect(speckle(withShadows).speckle).toBeLessThan(speckle(without).speckle + 5);
  });
});
