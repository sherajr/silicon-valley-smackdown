import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const portable = process.env.SVS_PORTABLE === '1';
const target = portable ? pathToFileURL(path.resolve('release/Silicon-Valley-Smackdown-Arena/PLAY.html')).href + '?arenaTest=1' : '/?arenaTest=1';
async function app(page: Page) {
  // Some CI sandboxes lack udev controller devices. Keep real rendering/audio; inject only
  // controller state so the native device monitor is never asked to open restricted sockets.
  if (process.env.SVS_SANDBOX_DEVICES === '1') await page.addInitScript(() => {
    (window as any).__pads = [];
    Object.defineProperty(navigator, 'getGamepads', { value: () => (window as any).__pads });
  });
  await page.goto(target);
  await expect(page.locator('#enter')).toBeVisible();
}
async function match(page: Page) {
  await app(page); await page.click('#enter'); await page.selectOption('#mode', 'versus'); await page.click('#fight');
  await page.evaluate(() => { (window as any).__arena.sim.countdown = 0; });
}
/** Holds a direction for a few ticks on both sides of a button press, so a tick between the two key-downs cannot consume it early. */
async function chord(page: Page, hold: string, press: string) {
  await page.keyboard.down(hold); await page.waitForTimeout(60); await page.keyboard.press(press); await page.waitForTimeout(60); await page.keyboard.up(hold);
}
async function closeRange(page: Page) {
  await page.evaluate(() => {
    const a = (window as any).__arena, [p1, p2] = a.sim.fighters;
    for (const f of [p1, p2]) Object.assign(f, { y: 0, prevY: 0, vx: 0, vy: 0, stun: 0, invincible: 0, damage: 0, attack: null, grounded: true });
    p1.x = p1.prevX = 0; p2.x = p2.prevX = 1.25; p1.facing = 1; p2.facing = -1;
    a.sim.freeze = 0;
  });
}

test('default entry renders 3D and selects fighters, modes and arenas', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await app(page);
  await page.screenshot({ path: info.outputPath('home.png') });
  await page.click('#enter'); await expect(page.locator('[data-fighter]')).toHaveCount(6);
  expect(await page.locator('.fighter-card img').evaluateAll(imgs => imgs.every(i => (i as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await page.click('[data-fighter="3"]'); await page.click('#slot1'); await page.click('[data-fighter="5"]'); await page.click('[data-stage="2"]');
  await page.selectOption('#mode', 'versus'); await page.screenshot({ path: info.outputPath('selection.png') }); await page.click('#fight');
  await expect(page.locator('.player-hud').first()).toContainText('PRIYA'); await expect(page.locator('.player-hud').last()).toContainText('ELON');
  const state = await page.evaluate(() => ({ fighters: (window as any).__arena.sim.options.fighters, stage: (window as any).__arena.sim.options.stage, meshes: (window as any).__arena.view.rigs.map((r: any) => { let count = 0; r.root.traverse((o: any) => { if (o.isMesh) count++; }); return count; }) }));
  expect(state.fighters).toEqual([3, 5]); expect(state.stage).toBe(2); expect(state.meshes.every((n: number) => n > 40)).toBe(true); expect(errors).toEqual([]);
});

test('real keyboard movement, double jump, melee and P2 controls', async ({ page }, info) => {
  await match(page);
  const before = await page.evaluate(() => (window as any).__arena.sim.fighters[0].x);
  await page.keyboard.down('d');
  await expect.poll(() => page.evaluate(() => (window as any).__arena.sim.fighters[0].x)).toBeGreaterThan(before + 0.5);
  await page.keyboard.up('d');
  // Log each jump as the simulation performs it (with the jump count it reaches). Polling the count instead can miss a whole
  // jump: the fighter is airborne for only about half a second, and a slow round trip can fall on either side of it.
  await page.evaluate(() => {
    const a = (window as any).__arena, emit = a.sim.emit.bind(a.sim); (window as any).__jumpLog = [];
    a.sim.emit = (type: string, f: any, ...rest: any[]) => { if (type === 'jump' && f.slot === 0) (window as any).__jumpLog.push(f.jumps); emit(type, f, ...rest); };
  });
  await page.keyboard.press('w'); await page.waitForTimeout(150); await page.keyboard.press('w');
  await expect.poll(() => page.evaluate(() => (window as any).__jumpLog)).toEqual([1, 2]);
  await closeRange(page); await page.keyboard.press('v');
  await expect.poll(() => page.evaluate(() => (window as any).__arena.sim.fighters[1].damage)).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath('hit.png') });
  await closeRange(page); await page.keyboard.press('j');
  await expect.poll(() => page.evaluate(() => (window as any).__arena.sim.fighters[0].damage)).toBeGreaterThan(0);
});

test('special projectile and rising recovery respond to actual key combinations', async ({ page }) => {
  await match(page); await page.keyboard.press('b');
  await expect.poll(() => page.evaluate(() => (window as any).__arena.sim.shots.length)).toBeGreaterThan(0);
  await page.evaluate(() => {
    const a = (window as any).__arena; a.sim.freeze = 0;
    Object.assign(a.sim.fighters[0], { x: 12, y: -2, vx: 0, vy: -0.01, grounded: false, jumps: 2, attack: null, stun: 0, recovered: false });
    const emit = a.sim.emit.bind(a.sim);
    a.sim.emit = (type: string, f: any, ...rest: any[]) => {
      if (type === 'recovery') (window as any).__recoveryVelocity = f.vy;
      emit(type, f, ...rest);
    };
  });
  await chord(page, 'w', 'b');
  // Assert the launch impulse when the move starts; by the next screenshot/IPC round-trip
  // software-rendered CI may already have carried the fighter past the jump apex.
  await expect.poll(() => page.evaluate(() => (window as any).__recoveryVelocity ?? 0)).toBeGreaterThan(0.35);
});

test('all six models animate and all stages render without sprite fallbacks', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); await app(page);
  for (let i = 0; i < 6; i++) {
    await page.evaluate(i => { const a = (window as any).__arena; a.launch({ fighters: [i, (i + 1) % 6], stage: i % 3, mode: 'versus' }); a.sim.countdown = 0; }, i);
    await page.waitForFunction(() => (window as any).__arena.sim.tick > 3);
    const rest = await page.evaluate(() => (window as any).__arena.view.rigs[0].arms[1].upper.rotation.x);
    await page.evaluate(() => { const a = (window as any).__arena; a.sim.startAttack(a.sim.fighters[0], 'heavy'); });
    await expect.poll(() => page.evaluate(() => (window as any).__arena.view.rigs[0].arms[1].upper.rotation.x)).toBeLessThan(rest - 0.1);
    expect(await page.evaluate(() => (window as any).__arena.view.stats.triangles)).toBeGreaterThan(20000);
    await page.screenshot({ path: info.outputPath(`fighter-${i}-arena-${i % 3}.png`) });
  }
  expect(errors).toEqual([]);
});

test('pause, help, stock loss, winner and rematch work together', async ({ page }) => {
  await match(page); await page.keyboard.press('Escape'); await expect(page.locator('#resume')).toBeVisible();
  const tick = await page.evaluate(() => (window as any).__arena.sim.tick); await page.waitForTimeout(180);
  expect(await page.evaluate(() => (window as any).__arena.sim.tick)).toBe(tick);
  await page.click('#help'); await expect(page.locator('.control-table')).toBeVisible(); await page.keyboard.press('Escape');
  await expect(page.locator('#resume')).toBeVisible(); await page.click('#resume');
  await page.evaluate(() => { const a = (window as any).__arena; a.sim.fighters[1].stocks = 1; a.sim.fighters[1].y = -12; });
  await expect(page.locator('#rematch')).toBeVisible(); await expect(page.locator('.results-modal')).toContainText('Hunter');
  await page.click('#rematch');
  expect(await page.evaluate(() => (window as any).__arena.sim.fighters.map((f: any) => f.stocks))).toEqual([3, 3]);
  expect(await page.evaluate(() => (window as any).__arena.sim.finished)).toBe(false);
});

test('training and arcade progression remain playable', async ({ page }) => {
  await app(page); await page.click('#enter'); await page.selectOption('#mode', 'training'); await page.click('#fight');
  await page.evaluate(() => { const a = (window as any).__arena; a.sim.countdown = 0; a.sim.fighters[0].y = -12; });
  await expect.poll(() => page.evaluate(() => (window as any).__arena.sim.fighters[0].respawn)).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as any).__arena.sim.fighters[0].stocks)).toBe(3);
  await page.keyboard.press('Escape'); await page.click('#dummy-damage');
  expect(await page.evaluate(() => (window as any).__arena.sim.fighters[1].damage)).toBe(50);
  await page.click('#quit'); await page.selectOption('#mode', 'arcade'); await page.click('#fight');
  const first = await page.evaluate(() => (window as any).__arena.sim.fighters[1].character);
  await page.evaluate(() => { const a = (window as any).__arena; a.sim.countdown = 0; a.sim.fighters[1].stocks = 1; a.sim.fighters[1].y = -12; });
  await expect(page.locator('#rematch')).toHaveText(/NEXT CHALLENGER/); await page.click('#rematch');
  expect(await page.evaluate(() => (window as any).__arena.sim.fighters[1].character)).not.toBe(first);
  await expect(page.locator('.clock')).toContainText('ARCADE 2/');
});

test('portable file has no remote dependencies and works with network blocked', async ({ page }) => {
  test.skip(!portable, 'Direct file delivery is tested after build:portable.');
  const remote: string[] = [], errors: string[] = [];
  page.on('request', r => { if (/^https?:/.test(r.url())) remote.push(r.url()); }); page.on('pageerror', e => errors.push(e.message));
  await page.route(/^https?:\/\//, route => route.abort());
  await app(page);
  await expect(page.locator('#online')).toHaveCount(0);
  expect(await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')).toContain("connect-src 'none'");
  await page.click('#enter'); await page.click('#fight');
  await expect(page.locator('#arena-canvas')).toBeVisible();
  await page.waitForFunction(() => (window as any).__arena.sim.tick > 10);
  expect(remote).toEqual([]); expect(errors).toEqual([]);
});

test('synthetic standard controller movement and button edges route to both slots', async ({ page }) => {
  test.skip(process.env.SVS_SANDBOX_DEVICES !== '1', 'This test uses synthetic controller state.');
  await match(page); await closeRange(page);
  await page.evaluate(() => { (window as any).__pads = [{ index: 0, axes: [0, 0], buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: i === 2, value: i === 2 ? 1 : 0 })) }]; });
  await expect.poll(() => page.evaluate(() => (window as any).__arena.sim.fighters[1].damage)).toBeGreaterThan(0);
  await page.evaluate(() => { (window as any).__pads[0].buttons[2] = { pressed: false, value: 0 }; });
  await closeRange(page);
  await page.evaluate(() => { (window as any).__pads.push({ index: 1, axes: [0, 0], buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: i === 2, value: i === 2 ? 1 : 0 })) }); });
  await expect.poll(() => page.evaluate(() => (window as any).__arena.sim.fighters[0].damage)).toBeGreaterThan(0);
});

test('window blur pauses, and repeated stage and roster changes reach a steady resource count', async ({ page }) => {
  await match(page);
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await expect(page.locator('#resume')).toBeVisible(); await page.click('#resume');
  // Arenas are built once and kept (three at most), so counts rise during the first pass and then stay flat however long
  // the player keeps changing arena and roster. That plateau, not "dispose every match", is what bounds GPU memory.
  const cycle = async () => {
    for (let i = 0; i < 6; i++) {
      await page.evaluate(i => { (window as any).__arena.launch({ fighters: [i, (i + 1) % 6], stage: i % 3, mode: 'versus' }); }, i);
      await page.waitForFunction(() => (window as any).__arena.sim.tick > 2);
    }
  };
  await cycle(); const warm = await page.evaluate(() => (window as any).__arena.view.stats);
  await cycle(); await cycle(); await cycle();
  const after = await page.evaluate(() => (window as any).__arena.view.stats);
  expect(after.geometries).toBe(warm.geometries); expect(after.textures).toBe(warm.textures);
});
