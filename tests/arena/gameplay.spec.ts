/**
 * Gameplay through the real keyboard in the real browser: grabs and throws for both players, shield + grab, tech,
 * jab buffering, rolls at a platform edge, combo feedback, training tools and the move list. The simulation's
 * rules are unit-tested; these prove the controls, HUD and rendering are wired to them with no page errors.
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const portable = process.env.SVS_PORTABLE === '1';
const target = portable ? pathToFileURL(path.resolve('release/Silicon-Valley-Smackdown-Arena/PLAY.html')).href + '?arenaTest=1' : '/?arenaTest=1';
const errors = new WeakMap<Page, string[]>();
/**
 * Holds a direction for a few ticks on both sides of a button press. A plain down/press/up lands within a couple of
 * milliseconds, so one 16.7 ms simulation tick between the two key-downs consumes the direction before the button is
 * seen and the chord silently loses it (roughly one run in twelve). This keeps the intent and removes the race.
 */
async function chord(page: Page, hold: string, press: string) {
  await page.keyboard.down(hold); await page.waitForTimeout(60); await page.keyboard.press(press); await page.waitForTimeout(60); await page.keyboard.up(hold);
}


async function app(page: Page) {
  const list: string[] = []; errors.set(page, list); page.on('pageerror', e => list.push(e.message));
  if (process.env.SVS_SANDBOX_DEVICES === '1') await page.addInitScript(() => {
    (window as any).__pads = [];
    Object.defineProperty(navigator, 'getGamepads', { value: () => (window as any).__pads });
  });
  await page.goto(target);
  await expect(page.locator('#enter')).toBeVisible();
}
async function start(page: Page, mode: 'versus' | 'training', fighters: [number, number] = [0, 0]) {
  await app(page); await page.click('#enter'); await page.selectOption('#mode', mode);
  await page.evaluate(([a, b]) => { (window as any).__arena.launch({ fighters: [a, b], stage: 0, mode: (window as any).__arena.mode }); }, fighters);
  await page.evaluate(() => { (window as any).__arena.sim.countdown = 0; });
}
/** A clean close-range face-off on the main stage; `gap` apart. */
async function faceOff(page: Page, gap = 1.1, x = 0) {
  await page.evaluate(([gap, x]) => {
    const a = (window as any).__arena, [p1, p2] = a.sim.fighters;
    for (const f of [p1, p2]) Object.assign(f, { y: 0, prevY: 0, vx: 0, vy: 0, stun: 0, invincible: 0, damage: 0, attack: null, grounded: true, support: 'main', busy: 0, hold: null, heldBy: null, grabProtect: 0, roll: 0 });
    p1.x = p1.prevX = x; p2.x = p2.prevX = x + gap; p1.facing = 1; p2.facing = -1; a.sim.freeze = 0; a.sim.clearInputs();
  }, [gap, x]);
}
/** Records, from inside the page, which moves and events each tick produced, so assertions never race the frame rate. */
async function record(page: Page) {
  await page.evaluate(() => {
    const a = (window as any).__arena, seen = new Set<string>(), step = a.sim.step.bind(a.sim);
    (window as any).__seen = seen;
    a.sim.step = (c: any) => { step(c); for (const f of a.sim.fighters) if (f.attack) seen.add(`p${f.slot + 1}:${f.attack.id}`); for (const e of a.sim.events) seen.add(`event:${e.type}`); };
  });
}
/**
 * Fires genuine KeyboardEvents (handled by the real ArenaInput) at exact simulation ticks, counted from now.
 * This is how frame-exact cadence is tested without racing the browser's frame rate.
 */
async function tapOnTicks(page: Page, schedule: Record<number, string>) {
  await page.evaluate(plan => {
    const a = (window as any).__arena, step = a.sim.step.bind(a.sim), start = a.sim.tick;
    a.sim.step = (c: any) => { step(c); const code = plan[a.sim.tick - start]; if (code) for (const type of ['keydown', 'keyup']) window.dispatchEvent(new KeyboardEvent(type, { code, key: code })); };
  }, schedule);
}
/** Gives the next catch by `captor` a long hitstop, so a press during it counts as a tech without racing the clock. */
async function freezeOnCatch(page: Page, captor: 0 | 1) {
  await page.evaluate(slot => { const a = (window as any).__arena, step = a.sim.step.bind(a.sim); let done = false; a.sim.step = (c: any) => { step(c); const h = a.sim.fighters[slot].hold; if (h && !done) { done = true; a.sim.freeze = 90; } }; }, captor);
}
const saw = (page: Page, what: string) => page.evaluate(w => (window as any).__seen.has(w), what);
const read = <T>(page: Page, fn: string) => page.evaluate(`(() => { const a = window.__arena, [p1, p2] = a.sim.fighters; return ${fn}; })()`) as Promise<T>;
const noErrors = (page: Page) => expect(errors.get(page)).toEqual([]);

test('P1 grabs with M, holds, and throws on the release frame with a direction key', async ({ page }) => {
  await start(page, 'versus'); await faceOff(page);
  await page.keyboard.press('m');
  await expect.poll(() => read<number | null>(page, 'p2.heldBy')).toBe(0);
  expect(await read<number>(page, 'p2.damage')).toBe(0);                      // the catch deals no damage
  await expect(page.locator('#hint')).toContainText('throw');                  // contextual help while holding
  await chord(page, 'd', 'm');
  await expect.poll(() => read<number>(page, 'p2.damage')).toBe(9);
  expect(await read<number>(page, 'p2.vx')).toBeGreaterThan(0);                // thrown forward
  expect(await read<number | null>(page, 'p2.heldBy')).toBeNull(); expect(await read<unknown>(page, 'p1.hold')).toBeNull();
  noErrors(page);
});

test('P2 grabs with semicolon and back-throws with an arrow key', async ({ page }) => {
  await start(page, 'versus'); await faceOff(page);
  await page.evaluate(() => { const a = (window as any).__arena; a.sim.fighters[1].x = 0; a.sim.fighters[1].prevX = 0; a.sim.fighters[0].x = -1.1; a.sim.fighters[0].prevX = -1.1; });
  await page.keyboard.press(';');
  await expect.poll(() => read<number | null>(page, 'p1.heldBy')).toBe(1);
  expect(await read<number>(page, 'p1.damage')).toBe(0);
  await chord(page, 'ArrowRight', ';');                                          // P2 faces left: right is back
  await expect.poll(() => read<number>(page, 'p1.damage')).toBeGreaterThan(0);
  expect(await read<number>(page, 'p1.vx')).toBeGreaterThan(0);                // launched behind P2, away from where P2 faces
  noErrors(page);
});

test('shield + grab grabs out of shield; shield + jump jumps out of it', async ({ page }) => {
  await start(page, 'versus'); await faceOff(page);
  await record(page);
  await page.keyboard.down('n'); await page.waitForTimeout(120);
  expect(await read<boolean>(page, 'p1.guarding')).toBe(true);
  await page.keyboard.press('m');
  await expect.poll(() => saw(page, 'p1:grab')).toBe(true);                      // a grab started out of shield
  await expect.poll(() => read<number | null>(page, 'p2.heldBy')).toBe(0);     // and it connected
  expect(await read<boolean>(page, 'p1.guarding')).toBe(false);
  await page.keyboard.up('n');
  await faceOff(page);
  await page.keyboard.down('n'); await page.waitForTimeout(120); await page.keyboard.press('Space'); await page.keyboard.up('n');
  await expect.poll(() => read<number>(page, 'p1.jumps')).toBe(1);
  noErrors(page);
});

test('a fresh grab press breaks a hold, even one made during the catch hitstop', async ({ page }) => {
  await start(page, 'versus'); await faceOff(page); await record(page);
  // Give the catch a long hitstop so the 8-frame window cannot race the test; presses during it count.
  await freezeOnCatch(page, 0);
  await page.keyboard.press('m');
  await expect.poll(() => read<number | null>(page, 'p2.heldBy')).toBe(0);
  await page.keyboard.press(';');                                               // P2 taps grab while the catch is frozen
  await expect.poll(() => saw(page, 'event:tech'), { timeout: 8000 }).toBe(true);
  expect(await read<unknown>(page, 'p1.hold')).toBeNull();
  expect(await read<number>(page, 'p2.damage')).toBe(0);
  await expect(page.locator('#toast')).toContainText('BREAKS THE GRAB');
  noErrors(page);
});

test('tapping V three times chains a jab string and shows the combo counter', async ({ page }) => {
  await start(page, 'versus'); await faceOff(page); await record(page);
  await page.evaluate(() => { const c = document.getElementById('combo0')!; (window as any).__comboText = []; new MutationObserver(() => { if (c.textContent) (window as any).__comboText.push(c.textContent); }).observe(c, { childList: true, characterData: true, subtree: true }); });
  await tapOnTicks(page, { 1: 'KeyV', 8: 'KeyV', 15: 'KeyV' });                  // a natural three-tap cadence, exact to the frame
  await expect.poll(() => read<number>(page, 'p2.damage')).toBe(5 + 7 + 9);
  await expect.poll(() => saw(page, 'event:combo')).toBe(true);                   // hits that keep the defender in hitstop and stun are a confirmed combo
  expect((await page.evaluate(() => (window as any).__comboText)).join(' ')).toContain('HITS');
  noErrors(page);
});

test('holding V does not auto-repeat', async ({ page }) => {
  await start(page, 'versus'); await faceOff(page, 6);
  await page.evaluate(() => { (window as any).__started = new Set(); const a = (window as any).__arena; const step = a.sim.step.bind(a.sim); a.sim.step = (c: any) => { step(c); const at = a.sim.fighters[0].attack; if (at) (window as any).__started.add(at.uid); }; });
  await page.keyboard.down('v'); await page.waitForTimeout(900); await page.keyboard.up('v');
  expect(await page.evaluate(() => (window as any).__started.size)).toBe(1);
  noErrors(page);
});

test('a roll toward the edge of the main stage stops at the edge instead of sailing off', async ({ page }) => {
  await start(page, 'versus'); await faceOff(page, 6, 9.0);
  await page.keyboard.down('n'); await page.keyboard.down('d'); await page.waitForTimeout(700); await page.keyboard.up('d'); await page.keyboard.up('n');
  const p1 = await read<{ x: number; y: number; grounded: boolean; stocks: number; respawn: number }>(page, '({ x: p1.x, y: p1.y, grounded: p1.grounded, stocks: p1.stocks, respawn: p1.respawn })');
  expect(p1.x).toBeLessThanOrEqual(9.5); expect(p1.y).toBe(0); expect(p1.grounded).toBe(true); expect(p1.stocks).toBe(3); expect(p1.respawn).toBe(0);
  noErrors(page);
});

test('the solid roof blocks a fighter rising from below', async ({ page }) => {
  await start(page, 'versus'); await faceOff(page, 6);
  await page.evaluate(() => { const a = (window as any).__arena; Object.assign(a.sim.fighters[0], { x: 0, prevX: 0, y: -4, prevY: -4, vy: 0.9, grounded: false, support: null }); });
  await page.waitForTimeout(400);
  expect(await read<number>(page, 'p1.y')).toBeLessThan(0);
  noErrors(page);
});

test('training tools: dummy behaviour, damage presets, hitboxes, state readout and frame step', async ({ page }) => {
  await start(page, 'training', [0, 1]);
  await expect(page.locator('#training')).toBeVisible();
  await page.selectOption('#t-dummy', 'shield');
  await expect.poll(() => read<boolean>(page, 'p2.guarding')).toBe(true);
  await page.click('#t-p100'); expect(await read<number>(page, 'p2.damage')).toBe(100);
  await page.click('#t-reset-pos'); expect(await read<number>(page, 'p1.x')).toBe(-4);
  await page.check('#t-boxes'); expect(await page.evaluate(() => (window as any).__arena.view.debug.visible)).toBe(true);
  await page.check('#t-info');
  await expect(page.locator('#t-readout')).toContainText('SHIELD');
  await page.check('#t-step');
  const tick = await read<number>(page, 'a.sim.tick');
  await page.waitForTimeout(250);
  expect(await read<number>(page, 'a.sim.tick')).toBe(tick);                    // frozen until told to advance
  await page.keyboard.press('.');
  await expect.poll(() => read<number>(page, 'a.sim.tick')).toBe(tick + 1);
  await page.click('#t-next');
  await expect.poll(() => read<number>(page, 'a.sim.tick')).toBe(tick + 2);
  await page.uncheck('#t-step');
  await expect.poll(() => read<number>(page, 'a.sim.tick')).toBeGreaterThan(tick + 10);
  // The shield dummy really is shielded, but a grab gets through it.
  await faceOff(page);
  await page.keyboard.press('m');
  await expect.poll(() => read<number | null>(page, 'p2.heldBy')).toBe(0);
  // P2 keys still drive the dummy.
  await page.evaluate(() => { const a = (window as any).__arena; a.sim.resetPositions(); });
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(250); await page.keyboard.up('ArrowRight');
  expect(await read<number>(page, 'p2.x')).toBeGreaterThan(4);
  noErrors(page);
});

test('the move list shows every move with frame data, and verified routes marked true, pressure or read', async ({ page }) => {
  await start(page, 'versus', [1, 3]);
  await page.keyboard.press('Escape'); await expect(page.locator('#moves')).toBeVisible();
  await page.click('#moves');
  await expect(page.locator('.modal.wide h2')).toContainText('Kevin');            // opens on player 1's fighter
  await expect(page.locator('.control-table.moves tbody tr')).toHaveCount(20);
  await expect(page.locator('.modal.wide')).toContainText('Rebuttal');
  await expect(page.locator('.control-table.combos')).toContainText('Stay of Execution route');
  await expect(page.locator('.control-table.combos .badge.true').first()).toBeVisible();
  await expect(page.locator('.control-table.combos .badge.read').first()).toBeVisible();
  await page.click('[data-fighter-tab="0"]');
  await expect(page.locator('.modal.wide h2')).toContainText('Hunter');
  await expect(page.locator('.control-table.combos')).toContainText('Growth Hack route');
  await page.keyboard.press('Escape');                                            // back to the pause menu
  await expect(page.locator('#resume')).toBeVisible();
  noErrors(page);
});

test('every fighter can grab, pummel and throw without page errors, on every arena', async ({ page }) => {
  await app(page);
  for (let c = 0; c < 6; c++) {
    await page.evaluate(c => { const a = (window as any).__arena; a.launch({ fighters: [c, (c + 2) % 6], stage: c % 3, mode: 'versus' }); a.sim.countdown = 0; }, c);
    await faceOff(page, 1.05);
    await page.keyboard.press('m');
    await expect.poll(() => read<number | null>(page, 'p2.heldBy'), { timeout: 4000 }).toBe(0);
    await page.keyboard.press('v'); await page.waitForTimeout(150);
    await chord(page, 'w', 'm');
    await expect.poll(() => read<number>(page, 'p2.damage'), { timeout: 4000 }).toBeGreaterThan(0);
    await page.waitForTimeout(120);
  }
  noErrors(page);
});

test('a press captured during hitstop is flushed by pausing, and repeated rematches leave no stale holds', async ({ page }) => {
  await start(page, 'versus'); await faceOff(page, 6);
  await page.evaluate(() => { (window as any).__arena.sim.freeze = 600; });
  await page.keyboard.press('m');                                                 // captured during the long freeze
  await page.keyboard.press('Escape'); await expect(page.locator('#resume')).toBeVisible(); await page.keyboard.press('Escape');
  await page.evaluate(() => { (window as any).__arena.sim.freeze = 0; });
  await page.waitForTimeout(400);
  expect(await read<string | null>(page, 'p1.attack && p1.attack.id')).toBeNull();   // the old press did not fire after the pause
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => { const a = (window as any).__arena; a.launch({ fighters: [0, 1], stage: 0, mode: 'versus' }); a.sim.countdown = 0; });
    expect(await read<unknown>(page, 'p1.hold')).toBeNull(); expect(await read<unknown>(page, 'p2.heldBy')).toBeNull();
  }
  noErrors(page);
});

test('synthetic controllers: grab, directional throw and tech route to the right players', async ({ page }) => {
  test.skip(process.env.SVS_SANDBOX_DEVICES !== '1', 'This test uses synthetic controller state.');
  await start(page, 'versus'); await faceOff(page);
  const pad = (index: number, pressed: number[], axes = [0, 0]) => ({ index, axes, buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })) });
  const set = (pads: unknown[]) => page.evaluate(p => { (window as any).__pads = p; }, pads);
  await set([pad(0, [3])]);                                                         // pad 0 = P1: Y is grab
  await expect.poll(() => read<number | null>(page, 'p2.heldBy')).toBe(0);
  await set([pad(0, [], [1, 0])]); await set([pad(0, [3], [1, 0])]);                // stick right + a fresh Y: forward throw
  await expect.poll(() => read<number>(page, 'p2.damage')).toBe(9);
  expect(await read<number>(page, 'p2.vx')).toBeGreaterThan(0);
  await set([pad(0, []), pad(1, [])]); await faceOff(page); await freezeOnCatch(page, 1);
  await set([pad(0, []), pad(1, [3])]);                                             // pad 1 = P2 grabs P1
  await expect.poll(() => read<number | null>(page, 'p1.heldBy')).toBe(1);
  await set([pad(0, [3]), pad(1, [3])]);                                            // P1 taps Y and breaks the hold
  await expect.poll(() => read<unknown>(page, 'p2.hold')).toBeNull();
  expect(await read<number>(page, 'p1.damage')).toBe(0);
  noErrors(page);
});

test('GPU resources stay flat across many catches and throws', async ({ page }) => {
  await start(page, 'versus'); await faceOff(page);
  const cycle = async () => {
    await faceOff(page);
    await page.keyboard.press('m');
    await expect.poll(() => read<number | null>(page, 'p2.heldBy'), { timeout: 4000 }).toBe(0);
    await page.keyboard.press('m');
    await expect.poll(() => read<number>(page, 'p2.damage'), { timeout: 4000 }).toBeGreaterThan(0);
  };
  await cycle(); await page.waitForTimeout(700);                                    // warm up: effect geometry uploads lazily on first use
  const before = await page.evaluate(() => (window as any).__arena.view.stats);
  for (let i = 0; i < 12; i++) {
    await faceOff(page);
    await page.evaluate(() => { const a = (window as any).__arena; a.sim.fighters[0].facing = 1; });
    await page.keyboard.press('m');
    await expect.poll(() => read<number | null>(page, 'p2.heldBy'), { timeout: 4000 }).toBe(0);
    await page.keyboard.press('m');
    await expect.poll(() => read<number>(page, 'p2.damage'), { timeout: 4000 }).toBeGreaterThan(0);
  }
  await page.waitForTimeout(700);                                                   // let the last particles expire
  const after = await page.evaluate(() => (window as any).__arena.view.stats);
  expect(after.geometries).toBeLessThanOrEqual(before.geometries + 2); expect(after.textures).toBeLessThanOrEqual(before.textures + 1);
  noErrors(page);
});
