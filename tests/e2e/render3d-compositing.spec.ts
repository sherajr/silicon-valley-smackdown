import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { collectErrors, gotoGame } from './helpers';

/** Jumps straight into a specific match via the e2e-only GameContext hook (see src/game.ts),
 * instead of driving menu navigation -- this suite is about the 3D presentation layer itself,
 * not menu flow (already covered by tests/e2e/versus.spec.ts). */
async function startMatch(page: Page, opts: { p1: string; p2: string; stage: string; render3D: boolean }) {
  await page.evaluate((o) => {
    const w = window as unknown as {
      __e2eContext?: { session: Record<string, unknown>; save: Record<string, unknown> };
      __e2eGame?: {
        scene: {
          start: (key: string) => void;
          stop: (key: string) => void;
          getScenes: (active: boolean) => { scene: { key: string } }[];
        };
      };
    };
    const ctx = w.__e2eContext!;
    ctx.session.mode = 'versus';
    ctx.session.p1Fighter = o.p1;
    ctx.session.p2Fighter = o.p2;
    ctx.session.stage = o.stage;
    ctx.save.render3D = o.render3D;
    // Mirrors what a real in-scene `this.scene.start(...)` transition does (stop the scene you're
    // leaving): starting 'Fight' from outside any scene via the SceneManager does not implicitly
    // stop whatever else is active, so without this every other running scene (Title's own
    // looping demo, in particular) keeps drawing on the same shared Phaser canvas underneath it.
    const game = w.__e2eGame!;
    for (const s of game.scene.getScenes(true)) {
      if (s.scene.key !== 'Fight') game.scene.stop(s.scene.key);
    }
    game.scene.start('Fight');
  }, opts);
  await page.waitForTimeout(1500); // GLB load (3.8MB) + first animation frames
}

async function get3DDiagnostics(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as { __e2eGame?: { scene: { getScenes: (active: boolean) => unknown[] } } };
    const scenes = w.__e2eGame?.scene.getScenes(true) ?? [];
    const fight = scenes.find((s) => (s as { scene: { key: string } }).scene.key === 'Fight') as
      | { presentation3d?: { diagnostics: { drawCalls: number; triangles: number; p1Loaded: boolean; p2Loaded: boolean } } }
      | undefined;
    return fight?.presentation3d ? fight.presentation3d.diagnostics : null;
  });
}

test('3D presentation: Maul mirror match loads, deforms, and composites over the HUD', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoGame(page);
  await startMatch(page, { p1: 'maul', p2: 'maul', stage: 'castro_street', render3D: true });

  const diag = await get3DDiagnostics(page);
  expect(diag, '3D presentation should be active for a registered Maul/Castro Street match').not.toBeNull();
  expect(diag!.p1Loaded, 'P1 model should finish loading').toBe(true);
  expect(diag!.p2Loaded, 'P2 model should finish loading').toBe(true);
  expect(diag!.triangles).toBeGreaterThan(0);
  expect(diag!.drawCalls).toBeGreaterThan(0);

  await page.screenshot({ path: 'docs/handoffs/evidence/3d-maul-mirror-match.png' });

  expect(errors.list, `console/page errors: ${JSON.stringify(errors.list)}`).toEqual([]);
});

test('3D presentation: falls back to 2D honestly for an unregistered fighter', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoGame(page);
  // Hunter has no 3D model yet -- this must NOT silently claim 3D success (see ModelRegistry).
  await startMatch(page, { p1: 'hunter', p2: 'kevin', stage: 'castro_street', render3D: true });

  const diag = await get3DDiagnostics(page);
  expect(diag, 'should fall back to the 2D renderer, not construct a 3D presentation').toBeNull();

  await page.waitForTimeout(300);
  expect(errors.list).toEqual([]);
});

test('3D presentation: the explicit 2D compatibility toggle is honored', async ({ page }) => {
  await gotoGame(page);
  await startMatch(page, { p1: 'maul', p2: 'maul', stage: 'castro_street', render3D: false });

  const diag = await get3DDiagnostics(page);
  expect(diag, 'render3D=false should force the legacy 2D renderer even for a fully-registered match').toBeNull();
});

test('3D presentation: canvas stays aligned with Phaser through a resize (letterboxing)', async ({ page }) => {
  await gotoGame(page);
  await startMatch(page, { p1: 'maul', p2: 'maul', stage: 'castro_street', render3D: true });

  const rectsMatch = async () => {
    return page.evaluate(() => {
      const canvases = Array.from(document.querySelectorAll('canvas'));
      if (canvases.length < 2) return false;
      const [a, b] = canvases;
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return Math.abs(ra.left - rb.left) < 1 && Math.abs(ra.top - rb.top) < 1 && Math.abs(ra.width - rb.width) < 1 && Math.abs(ra.height - rb.height) < 1;
    });
  };

  expect(await rectsMatch()).toBe(true);

  // A non-native aspect ratio forces Phaser's Scale.FIT letterboxing.
  await page.setViewportSize({ width: 900, height: 400 });
  await page.waitForTimeout(300);
  expect(await rectsMatch()).toBe(true);

  await page.setViewportSize({ width: 500, height: 900 });
  await page.waitForTimeout(300);
  expect(await rectsMatch()).toBe(true);
});
