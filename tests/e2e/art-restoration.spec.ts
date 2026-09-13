import { test, expect, type Page } from '@playwright/test';
import { collectErrors, gotoGame, tap, waitFor } from './helpers';

/**
 * Runtime proof that the painted production art is loaded AND actually on screen, that the
 * repaired reaction routing selects the frames it claims to, and that hit-stop freezes combat
 * while the round clock keeps running.
 *
 * Everything here reads the live Phaser/CombatSim state in a real browser -- a viewer-only pose
 * or a merely-registered texture is deliberately not accepted as evidence.
 */

const EVIDENCE = 'test-results/evidence';
/** Kevin's authored max health, used so damage assertions stay tied to the real character data. */
const KEVIN_MAX_HEALTH = 210;

/** Boots straight into a fight via the documented skip hook, then waits for the sim to be live. */
async function startFight(page: Page, p1 = 'hunter', p2 = 'kevin', stage = 'castro_street'): Promise<void> {
  await page.goto(`/?e2e=1&skip=fight&p1=${p1}&p2=${p2}&stage=${stage}`, { waitUntil: 'networkidle' });
  await expect.poll(() => page.evaluate(() => !!(window as any).__e2eGame?.scene.isActive('Fight')), { timeout: 15_000 }).toBe(true);
  // The 30-frame intro must finish, or the fighters are still in 'intro' and cannot act.
  await expect.poll(() => fightState(page).then((s) => s.p1.state !== 'intro' && s.p2.state !== 'intro'), { timeout: 10_000 }).toBe(true);
}

/** Reads the live fight scene: which visual source each view resolved, sim counters, and fighter state. */
async function fightState(page: Page) {
  return page.evaluate(() => {
    const game = (window as any).__e2eGame;
    const fight: any = game.scene.getScene('Fight');
    const sim = fight.matchState.sim;
    const view = (v: any) => ({
      source: v.visuals.source,
      texture: v.sprite.texture.key,
      frame: String(v.sprite.frame.name),
      // Real decoded pixels of the texture actually bound to the sprite right now.
      texW: v.sprite.texture.source[0].width,
      texH: v.sprite.texture.source[0].height,
      frameW: v.sprite.frame.width,
      frameH: v.sprite.frame.height,
      originY: v.sprite.originY,
      scaleX: v.sprite.scaleX,
      flipX: v.sprite.flipX,
      screenX: v.sprite.x,
      screenY: v.sprite.y,
      anim: v.sprite.anims?.currentAnim?.key ?? null,
    });
    return {
      stageSource: fight.stageView.source,
      stageTexture: (fight.stageView as any).container.list[0]?.texture?.key ?? null,
      frameCount: sim.frameCount,
      clockFrames: sim.clockFrames,
      freezeFrames: sim.freezeFrames,
      p1: { ...view(fight.p1View), state: sim.p1.state, x: sim.p1.x, y: sim.p1.y, vy: sim.p1.vy, health: sim.p1.health, guard: sim.p1.guard },
      p2: { ...view(fight.p2View), state: sim.p2.state, x: sim.p2.x, y: sim.p2.y, vy: sim.p2.vy, health: sim.p2.health, guard: sim.p2.guard },
    };
  });
}

/**
 * Suspends the Fight scene's own update loop so scripted stepping is the only thing advancing the
 * simulation -- otherwise the scene's fixed-step loop races every assertion about frame counters.
 */
async function takeManualControl(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__e2eGame.scene.pause('Fight'));
  await page.waitForTimeout(60);
}

/** Drives the sim directly for `frames` fixed steps with given inputs, bypassing key timing flakiness. */
async function stepSim(page: Page, frames: number, p1: Record<string, boolean> = {}, p2: Record<string, boolean> = {}) {
  return page.evaluate(
    ({ frames, p1, p2 }) => {
      const game = (window as any).__e2eGame;
      const fight: any = game.scene.getScene('Fight');
      const base = () => ({
        left: false, right: false, up: false, down: false,
        basicPressed: false, basicHeld: false, specialPressed: false, specialHeld: false,
        blockHeld: false, blockPressed: false, grabPressed: false, grabHeld: false,
      });
      const seen: string[] = [];
      for (let i = 0; i < frames; i++) {
        const a = { ...base(), ...p1 };
        const b = { ...base(), ...p2 };
        // Press edges only fire on the first frame, matching a real tap.
        if (i > 0) {
          a.basicPressed = false; a.specialPressed = false; a.grabPressed = false; a.blockPressed = false;
          b.basicPressed = false; b.specialPressed = false; b.grabPressed = false; b.blockPressed = false;
        }
        for (const e of fight.matchState.step(a, b)) seen.push(e.type);
        fight.renderFrame(16.67);
      }
      return seen;
    },
    { frames, p1, p2 },
  );
}

/**
 * Mashes P1's Basic whenever P1 can actually act (idle, outside hit-stop) and stops on the frame
 * `type` fires, leaving the sim exactly there so the reaction can be sampled. This mirrors how a
 * player chains a string, rather than assuming a press lands on any particular frame.
 */
async function mashUntilEvent(page: Page, type: string, maxFrames: number, defenderBlocks = false): Promise<boolean> {
  return page.evaluate(
    ({ type, maxFrames, defenderBlocks }) => {
      const fight: any = (window as any).__e2eGame.scene.getScene('Fight');
      const base = () => ({
        left: false, right: false, up: false, down: false,
        basicPressed: false, basicHeld: false, specialPressed: false, specialHeld: false,
        blockHeld: false, blockPressed: false, grabPressed: false, grabHeld: false,
      });
      for (let i = 0; i < maxFrames; i++) {
        const sim = fight.matchState.sim;
        const a = base();
        if (sim.p1.state === 'idle' && sim.freezeFrames === 0) {
          a.basicPressed = true;
          a.basicHeld = true;
        }
        const b = base();
        b.blockHeld = defenderBlocks;
        const fired = fight.matchState.step(a, b).some((e: any) => e.type === type);
        fight.renderFrame(16.67);
        if (fired) return true;
      }
      return false;
    },
    { type, maxFrames, defenderBlocks },
  );
}

test('painted fighter art and painted stages are loaded and actually rendered', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoGame(page);

  // Every production sheet and stage image decoded at its real geometry -- not merely registered.
  const assets = await page.evaluate(() => {
    const textures = (window as any).__e2eGame.textures;
    const ids = ['hunter', 'kevin', 'al', 'priya', 'chad', 'elon'];
    const out: Record<string, { w: number; h: number; frames: number } | null> = {};
    for (const id of ids) {
      for (const action of ['idle', 'walk', 'attack', 'poses']) {
        const key = `${id}_${action}_sheet`;
        if (!textures.exists(key)) { out[key] = null; continue; }
        const t = textures.get(key);
        out[key] = { w: t.source[0].width, h: t.source[0].height, frames: t.getFrameNames().length };
      }
    }
    for (const s of ['castro_street', 'sand_hill_road', 'palo_alto']) {
      const key = `stage_${s}`;
      if (!textures.exists(key)) { out[key] = null; continue; }
      const t = textures.get(key);
      out[key] = { w: t.source[0].width, h: t.source[0].height, frames: t.getFrameNames().length };
    }
    return out;
  });

  for (const [key, info] of Object.entries(assets)) {
    expect(info, `${key} must be loaded`).not.toBeNull();
    if (key.startsWith('stage_')) {
      expect(info!.w, key).toBe(480);
      expect(info!.h, key).toBe(270);
    } else {
      expect(info!.w, key).toBe(192);
      expect(info!.h, key).toBe(240);
      expect(info!.frames, key).toBe(4); // four real 96x120 cells
    }
  }

  // No procedural rig texture should exist at all while every sheet is healthy.
  const rigTextures = await page.evaluate(() =>
    (window as any).__e2eGame.textures.getTextureKeys().filter((k: string) => k.startsWith('rig_')),
  );
  expect(rigTextures).toEqual([]);
  expect(errors.list).toEqual([]);
});

test('all three stages render their painted background in a live fight', async ({ page }) => {
  for (const stage of ['castro_street', 'sand_hill_road', 'palo_alto'] as const) {
    await startFight(page, 'hunter', 'kevin', stage);
    const s = await fightState(page);
    expect(s.stageSource, stage).toBe('painted');
    expect(s.stageTexture, stage).toBe(`stage_${stage}`);
    await page.screenshot({ path: `${EVIDENCE}/stage-${stage}.png` });
  }
});

test('every fighter renders from painted art with feet planted on the ground line', async ({ page }) => {
  for (const id of ['hunter', 'kevin', 'al', 'priya', 'chad', 'elon'] as const) {
    await startFight(page, id, id === 'kevin' ? 'hunter' : 'kevin');
    const s = await fightState(page);
    expect(s.p1.source, id).toBe('art');
    expect(s.p1.texture, id).toMatch(new RegExp(`^${id}_(idle|walk|attack|poses)_sheet$`));
    expect(s.p1.frameW, id).toBe(96);
    expect(s.p1.frameH, id).toBe(120);
    expect(s.p1.texW, id).toBe(192); // the real sheet, never a 128-wide rig canvas
    // Feet land on GROUND_Y (230): origin 0.96 of a 120px cell at 0.72 scale.
    expect(s.p1.screenY, id).toBe(230);
    expect(s.p1.originY, id).toBeCloseTo(0.96, 2);
    expect(s.p1.scaleX, id).toBeCloseTo(0.72, 2);
    await page.screenshot({ path: `${EVIDENCE}/fighter-${id}.png` });
  }
});

test('title, character select and previews all show the painted art', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoGame(page);
  await page.screenshot({ path: `${EVIDENCE}/01-title.png` });

  await tap(page, 'KeyV'); // Title -> Main Menu
  await page.screenshot({ path: `${EVIDENCE}/02-main-menu.png` });
  await tap(page, 'KeyS'); // -> Two Players
  await tap(page, 'KeyV'); // -> Character Select
  await expect.poll(() => page.evaluate(() => !!(window as any).__e2eGame.scene.isActive('CharacterSelect'))).toBe(true);
  await page.waitForTimeout(400);

  const select = await page.evaluate(() => {
    const scene: any = (window as any).__e2eGame.scene.getScene('CharacterSelect');
    return {
      tiles: scene.tileSprites.map((s: any) => ({ key: s.texture.key, w: s.texture.source[0].width })),
      preview: scene.previewP1
        ? { source: scene.previewP1.visuals.source, key: scene.previewP1.sprite.texture.key, anim: scene.previewP1.sprite.anims?.currentAnim?.key ?? null }
        : null,
    };
  });
  expect(select.tiles.length).toBe(6);
  for (const t of select.tiles) {
    expect(t.key).toMatch(/_(idle|walk|attack|poses)_sheet$/);
    expect(t.key.startsWith('rig_')).toBe(false);
    expect(t.w).toBe(192);
  }
  expect(select.preview?.source).toBe('art');
  expect(select.preview?.anim).toBeTruthy(); // preview is animating, not a frozen portrait

  // Layout: portraits must stay inside their tiles, and previews must not cover either player's
  // info panel. Both were broken once the taller painted cells came back at the old scales.
  const layout = await page.evaluate(() => {
    const scene: any = (window as any).__e2eGame.scene.getScene('CharacterSelect');
    const box = (o: any) => {
      const b = o.getBounds();
      return { l: b.left, r: b.right, t: b.top, b: b.bottom };
    };
    return {
      tiles: scene.tileRects.map((r: any, i: number) => ({ rect: box(r), sprite: box(scene.tileSprites[i]) })),
      p1Info: box(scene.p1InfoText),
      p2Info: box(scene.p2InfoText),
      p1Preview: box(scene.previewP1.sprite),
      p2Preview: box(scene.previewP2.sprite),
      status: box(scene.statusText),
    };
  });

  const overlaps = (a: any, b: any) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  layout.tiles.forEach((t: any, i: number) => {
    expect(t.sprite.t, `tile ${i} portrait must not overflow above its tile`).toBeGreaterThanOrEqual(t.rect.t - 1);
    expect(t.sprite.b, `tile ${i} portrait must not overflow below its tile`).toBeLessThanOrEqual(t.rect.b + 1);
    expect(t.sprite.l, `tile ${i} portrait must not overflow left`).toBeGreaterThanOrEqual(t.rect.l - 1);
    expect(t.sprite.r, `tile ${i} portrait must not overflow right`).toBeLessThanOrEqual(t.rect.r + 1);
  });
  expect(overlaps(layout.p1Preview, layout.p1Info), 'P1 preview must not cover P1 info').toBe(false);
  expect(overlaps(layout.p1Preview, layout.p2Info), 'P1 preview must not cover P2 info').toBe(false);
  expect(overlaps(layout.p2Preview, layout.p2Info), 'P2 preview must not cover P2 info').toBe(false);
  expect(overlaps(layout.p2Preview, layout.p1Info), 'P2 preview must not cover P1 info').toBe(false);
  expect(overlaps(layout.p1Preview, layout.status), 'P1 preview must not cover the status line').toBe(false);
  // Everything stays on screen at the 480x270 logical resolution.
  for (const b of [layout.p1Info, layout.p2Info, layout.p1Preview, layout.p2Preview]) {
    expect(b.l).toBeGreaterThanOrEqual(0);
    expect(b.r).toBeLessThanOrEqual(480);
    expect(b.t).toBeGreaterThanOrEqual(0);
    expect(b.b).toBeLessThanOrEqual(270);
  }

  await page.screenshot({ path: `${EVIDENCE}/03-character-select.png` });
  expect(errors.list).toEqual([]);
});

test('combat reactions select the repaired frames in a live fight', async ({ page }) => {
  await startFight(page);
  await takeManualControl(page);

  // Put the two fighters in jab range, facing each other.
  await page.evaluate(() => {
    const sim: any = ((window as any).__e2eGame.scene.getScene('Fight') as any).matchState.sim;
    sim.p1.x = 200; sim.p2.x = 239;
    sim.p1.state = 'idle'; sim.p2.state = 'idle';
    sim.p1.stateTimer = 0; sim.p2.stateTimer = 0;
  });

  // --- A real, unblocked hit lands, and the defender shows the hurt cell (poses#3). ---
  expect(await mashUntilEvent(page, 'hit', 120)).toBe(true);
  let s = await fightState(page);
  expect(s.p2.state).toBe('hitstun');
  expect(s.p2.texture).toBe('kevin_poses_sheet');
  expect(s.p2.frame).toBe('3'); // hurt cell, not the block cell
  expect(s.p2.health).toBeLessThan(KEVIN_MAX_HEALTH);
  await page.screenshot({ path: `${EVIDENCE}/04-hit-reaction.png` });

  // --- A standing block shows the guard cell (poses#2), never the hurt cell. ---
  await startFight(page);
  await takeManualControl(page);
  await page.evaluate(() => {
    const sim: any = ((window as any).__e2eGame.scene.getScene('Fight') as any).matchState.sim;
    sim.p1.x = 200; sim.p2.x = 239;
    sim.p1.state = 'idle'; sim.p2.state = 'idle';
    sim.p1.stateTimer = 0; sim.p2.stateTimer = 0;
  });
  expect(await mashUntilEvent(page, 'blocked', 120, true)).toBe(true);
  s = await fightState(page);
  // Chip only: a blocked jab shaves a sliver, nothing like a clean hit.
  expect(s.p2.health).toBeLessThan(KEVIN_MAX_HEALTH);
  expect(s.p2.health).toBeGreaterThan(KEVIN_MAX_HEALTH - 2);
  expect(['block', 'blockstun']).toContain(s.p2.state);
  expect(s.p2.texture).toBe('kevin_poses_sheet');
  expect(s.p2.frame).toBe('2'); // guard cell -- routing blockstun through the hurt cell was the bug
  await page.screenshot({ path: `${EVIDENCE}/05-block-impact.png` });

  // --- A guard break renders as a recoil (hurt cell), not as another guard pose. ---
  await page.evaluate(() => {
    const sim: any = ((window as any).__e2eGame.scene.getScene('Fight') as any).matchState.sim;
    sim.p2.guard = 1; // one more blocked hit breaks it
  });
  expect(await mashUntilEvent(page, 'blocked', 240, true)).toBe(true);
  s = await fightState(page);
  expect(s.p2.state).toBe('guardbreak');
  expect(s.p2.frame).toBe('3'); // stagger, via the hurt cell
  await page.screenshot({ path: `${EVIDENCE}/06-guard-break.png` });
});

test('jump phases, both facings, and knockdown/wakeup are driven by the live simulation', async ({ page }) => {
  await startFight(page);
  await takeManualControl(page);

  // Jump: the rendered cell is the painted jump pose while airborne.
  await stepSim(page, 1, { up: true });
  await stepSim(page, 5);
  let s = await fightState(page);
  expect(s.p1.state).toBe('jump');
  expect(s.p1.y).toBeLessThan(0); // genuinely off the ground
  expect(s.p1.texture).toBe('hunter_poses_sheet');
  expect(s.p1.frame).toBe('0'); // jump cell
  await page.screenshot({ path: `${EVIDENCE}/07-jump.png` });

  // Facing: P1 starts left of P2 and faces right; swap sides and the sprite mirrors.
  await startFight(page);
  await takeManualControl(page);
  s = await fightState(page);
  expect(s.p1.screenX).toBeLessThan(s.p2.screenX);
  expect(s.p1.flipX).toBe(false);
  expect(s.p2.flipX).toBe(true);

  await page.evaluate(() => {
    const sim: any = ((window as any).__e2eGame.scene.getScene('Fight') as any).matchState.sim;
    sim.p1.x = 320; sim.p2.x = 160;
  });
  await stepSim(page, 4);
  s = await fightState(page);
  expect(s.p1.screenX).toBeGreaterThan(s.p2.screenX);
  expect(s.p1.flipX).toBe(true); // now on the right, facing left
  expect(s.p2.flipX).toBe(false);
  await page.screenshot({ path: `${EVIDENCE}/08-facing-mirrored.png` });

  // Knockdown -> wakeup runs through real sim states with real frames bound.
  await page.evaluate(() => {
    const sim: any = ((window as any).__e2eGame.scene.getScene('Fight') as any).matchState.sim;
    sim.p2.state = 'knockdown';
    sim.p2.stateTimer = 40;
  });
  await stepSim(page, 2);
  s = await fightState(page);
  expect(s.p2.state).toBe('knockdown');
  expect(s.p2.texture).toBe('kevin_poses_sheet');
  await page.screenshot({ path: `${EVIDENCE}/09-knockdown.png` });

  const reached = await waitFor(async () => {
    await stepSim(page, 5);
    const cur = await fightState(page);
    return cur.p2.state === 'wakeup' || cur.p2.state === 'idle' ? cur.p2.state : null;
  }, 6000);
  expect(['wakeup', 'idle']).toContain(reached);
  await page.screenshot({ path: `${EVIDENCE}/10-wakeup.png` });
});

test('hit-stop freezes move progress while the round clock keeps counting down', async ({ page }) => {
  await startFight(page);
  await takeManualControl(page);
  await page.evaluate(() => {
    const sim: any = ((window as any).__e2eGame.scene.getScene('Fight') as any).matchState.sim;
    sim.p1.x = 200; sim.p2.x = 239;
    sim.p1.state = 'idle'; sim.p2.state = 'idle';
    sim.p1.stateTimer = 0; sim.p2.stateTimer = 0;
  });

  // Land a hit; hit-stop is armed on exactly that frame.
  expect(await mashUntilEvent(page, 'hit', 120)).toBe(true);
  const before = await fightState(page);
  expect(before.freezeFrames).toBeGreaterThan(0);

  await stepSim(page, 1);
  const after = await fightState(page);
  // Combat is frozen: the animation/move clock holds. The round clock does not.
  expect(after.frameCount).toBe(before.frameCount);
  expect(after.clockFrames).toBe(before.clockFrames - 1);
  expect(after.freezeFrames).toBe(before.freezeFrames - 1);

  // Outside hit-stop both advance together.
  await stepSim(page, 20);
  const a = await fightState(page);
  await stepSim(page, 10);
  const b = await fightState(page);
  expect(b.frameCount).toBeGreaterThan(a.frameCount);
  expect(b.clockFrames).toBeLessThan(a.clockFrames);
});

test('the pause move list opens, pages, and closes without leaving a stale overlay or resuming combat', async ({ page }) => {
  await page.goto('/?e2e=1&skip=fight&p1=hunter&p2=kevin&stage=castro_street', { waitUntil: 'networkidle' });
  await expect.poll(() => page.evaluate(() => !!(window as any).__e2eGame?.scene.isActive('Fight')), { timeout: 15_000 }).toBe(true);
  await page.waitForTimeout(500);

  const ui = () =>
    page.evaluate(() => {
      const f: any = (window as any).__e2eGame.scene.getScene('Fight');
      const bounds = f.moveListContainer.getBounds();
      const body = f.moveListBody;
      return {
        phase: f.phase,
        paused: f.pauseContainer.visible,
        listVisible: f.moveListContainer.visible,
        title: f.moveListTitle.text,
        header: f.moveListHeader.text,
        body: body.text,
        footer: f.moveListFooter.text,
        panel: { l: bounds.left, r: bounds.right, t: bounds.top, b: bounds.bottom },
        textRight: body.x + body.width,
        textBottom: f.moveListFooter.y,
        frameCount: f.matchState.sim.frameCount,
      };
    });

  await tap(page, 'Escape'); // pause
  expect((await ui()).phase).toBe('paused');
  await tap(page, 'KeyS'); // -> Move List
  await tap(page, 'KeyV'); // open it
  let m = await ui();
  expect(m.listVisible).toBe(true);
  expect(m.paused).toBe(false);
  expect(m.title).toContain('HUNTER');
  expect(m.title).toContain('P1');
  // Zero-based active ranges are labelled, and Block/Grab bindings are present again.
  expect(m.header).toContain('inclusive 0-based move frames');
  expect(m.footer).toContain('Block ');
  expect(m.footer).toContain('Grab ');
  expect(m.body.split('\n').length).toBeGreaterThan(3);

  // Header columns must line up with the data columns -- both are built from the same shared
  // widths, so every row is exactly as long as the header the reader is scanning against.
  const headerCols = m.header.split('\n')[0];
  for (const row of m.body.split('\n')) {
    expect(row.length, `row "${row.trim()}" must match the header width`).toBe(headerCols.length);
  }
  // Nothing is truncated: the three Disruptive Innovation moves stay distinguishable, and the
  // longest command survives intact.
  expect(m.body).toContain('Disruptive Innovation III');
  expect(m.body).toContain('Super (Basic+Special)');
  // Multi-window supers report every window; projectiles and grabs report what they really do.
  expect(m.body).toMatch(/\d+-\d+,\d+-\d+,\d+-\d+,\d+-\d+/);
  expect(m.body).toContain('shot@');
  expect(m.body).toContain('grab ');
  // Text stays inside the panel at the game's 480x270 logical resolution.
  expect(m.textRight).toBeLessThanOrEqual(m.panel.r);
  expect(m.panel.l).toBeGreaterThanOrEqual(0);
  expect(m.panel.r).toBeLessThanOrEqual(480);
  expect(m.panel.t).toBeGreaterThanOrEqual(0);
  expect(m.panel.b).toBeLessThanOrEqual(270);
  await page.screenshot({ path: `${EVIDENCE}/11-move-list-p1.png` });

  // Block switches to P2's set in versus... this is training mode, so Block backs out instead.
  await tap(page, 'KeyM'); // Grab -> next page
  m = await ui();
  expect(m.title).toMatch(/page \d\/\d/);
  await page.screenshot({ path: `${EVIDENCE}/12-move-list-page2.png` });

  const frozenAt = m.frameCount;
  await tap(page, 'KeyB'); // Special -> back to the pause menu
  m = await ui();
  expect(m.listVisible).toBe(false);
  expect(m.paused).toBe(true);
  expect(m.phase).toBe('paused');
  expect(m.frameCount).toBe(frozenAt); // combat never advanced while paused

  await tap(page, 'Escape'); // resume
  m = await ui();
  expect(m.phase).toBe('playing');
  expect(m.listVisible).toBe(false); // no stale overlay left behind
  await page.waitForTimeout(300);
  expect((await ui()).frameCount).toBeGreaterThan(frozenAt); // combat really resumed
});

test('versus mode exposes both players move sets from the pause list', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoGame(page);
  await tap(page, 'KeyV');
  await tap(page, 'KeyS');
  await tap(page, 'KeyV'); // Character Select
  await tap(page, 'KeyV'); // P1 confirms Hunter
  await page.waitForTimeout(150);
  await tap(page, 'Numpad4'); // P2 confirms Kevin
  await page.waitForTimeout(300);
  await tap(page, 'KeyV'); // stage
  await page.waitForTimeout(2600); // versus intro
  await expect.poll(() => page.evaluate(() => !!(window as any).__e2eGame?.scene.isActive('Fight')), { timeout: 15_000 }).toBe(true);

  await tap(page, 'Escape');
  await tap(page, 'KeyS');
  await tap(page, 'KeyV'); // open move list
  const titleOf = () => page.evaluate(() => ((window as any).__e2eGame.scene.getScene('Fight') as any).moveListTitle.text);
  expect(await titleOf()).toContain('P1');
  await tap(page, 'KeyN'); // Block -> switch player
  const p2Title = await titleOf();
  expect(p2Title).toContain('P2');
  expect(p2Title).toContain('KEVIN');
  await page.screenshot({ path: `${EVIDENCE}/13-move-list-p2.png` });
  expect(errors.list).toEqual([]);
});
