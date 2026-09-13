import { test, expect, type Page } from '@playwright/test';
import { collectErrors, gotoGame, tap } from './helpers';

/**
 * Layout coverage for the scenes that draw fighters outside the arena. Restoring the painted art
 * changed the cell height every one of them was scaled against, so each is checked for staying on
 * screen and clear of its own captions rather than trusted to a hardcoded scale number.
 */

const EVIDENCE = 'test-results/evidence';

/** Bounds of every visible Text and Sprite in the active scene, for overlap/containment checks. */
async function sceneBoxes(page: Page, key: string) {
  return page.evaluate((sceneKey) => {
    const scene: any = (window as any).__e2eGame.scene.getScene(sceneKey);
    const out: { kind: string; text: string; l: number; r: number; t: number; b: number }[] = [];
    for (const obj of scene.children.list as any[]) {
      if (!obj.visible || typeof obj.getBounds !== 'function') continue;
      const type = obj.type;
      if (type !== 'Text' && type !== 'Sprite') continue;
      const bb = obj.getBounds();
      if (bb.width <= 0 || bb.height <= 0) continue;
      out.push({ kind: type, text: type === 'Text' ? String(obj.text).slice(0, 40) : obj.texture.key, l: bb.left, r: bb.right, t: bb.top, b: bb.bottom });
    }
    return out;
  }, key);
}

function overlaps(a: { l: number; r: number; t: number; b: number }, b: { l: number; r: number; t: number; b: number }): boolean {
  return a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
}

/** Fighters must stay fully on screen and must not sit on top of any caption. */
function assertFightersClear(boxes: Awaited<ReturnType<typeof sceneBoxes>>, label: string): void {
  const sprites = boxes.filter((b) => b.kind === 'Sprite');
  const texts = boxes.filter((b) => b.kind === 'Text');
  expect(sprites.length, `${label}: expected at least one fighter sprite`).toBeGreaterThan(0);
  for (const s of sprites) {
    expect(s.t, `${label}: ${s.text} runs off the top`).toBeGreaterThanOrEqual(0);
    expect(s.b, `${label}: ${s.text} runs off the bottom`).toBeLessThanOrEqual(270);
    expect(s.l, `${label}: ${s.text} runs off the left`).toBeGreaterThanOrEqual(0);
    expect(s.r, `${label}: ${s.text} runs off the right`).toBeLessThanOrEqual(480);
    for (const t of texts) {
      expect(overlaps(s, t), `${label}: fighter ${s.text} covers text "${t.text}"`).toBe(false);
    }
  }
}

test('the title screen roster line renders painted art fully on screen', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoGame(page);
  const boxes = await sceneBoxes(page, 'Title');
  const sprites = boxes.filter((b) => b.kind === 'Sprite');
  expect(sprites).toHaveLength(6);
  for (const s of sprites) {
    expect(s.text).toMatch(/_idle_sheet$/);
    expect(s.text.startsWith('rig_')).toBe(false);
    expect(s.t).toBeGreaterThanOrEqual(0);
    expect(s.b).toBeLessThanOrEqual(270);
  }
  await page.screenshot({ path: `${EVIDENCE}/14-title-roster.png` });
  expect(errors.list).toEqual([]);
});

test('the versus intro shows both painted fighters without covering the captions', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoGame(page);
  await tap(page, 'KeyV');
  await tap(page, 'KeyS'); // Two Players
  await tap(page, 'KeyV'); // Character Select
  await tap(page, 'KeyV'); // P1 confirms
  await page.waitForTimeout(150);
  await tap(page, 'Numpad4'); // P2 confirms
  await page.waitForTimeout(300);
  await tap(page, 'KeyV'); // stage confirm -> Versus intro
  await expect.poll(() => page.evaluate(() => !!(window as any).__e2eGame.scene.isActive('VersusIntro'))).toBe(true);
  await page.waitForTimeout(250);

  const boxes = await sceneBoxes(page, 'VersusIntro');
  assertFightersClear(boxes, 'VersusIntro');
  await page.screenshot({ path: `${EVIDENCE}/15-versus-intro.png` });
  expect(errors.list).toEqual([]);
});

test('the arcade intermission shows the opponent clear of its name plate', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoGame(page);
  await tap(page, 'KeyV');
  await tap(page, 'KeyV'); // Single Player -> Character Select
  await expect.poll(() => page.evaluate(() => !!(window as any).__e2eGame.scene.isActive('CharacterSelect'))).toBe(true);
  await tap(page, 'KeyV'); // confirm fighter
  await page.waitForTimeout(300);
  await expect.poll(() => page.evaluate(() => !!(window as any).__e2eGame.scene.isActive('ArcadeIntermission')), { timeout: 10_000 }).toBe(true);
  // The intermission opens on a difficulty menu; the opponent card is built only after a choice.
  await tap(page, 'KeyV');
  await expect.poll(() =>
    page.evaluate(() =>
      ((window as any).__e2eGame.scene.getScene('ArcadeIntermission') as any).children.list.some((o: any) => o.type === 'Sprite'),
    ),
  ).toBe(true);
  await page.waitForTimeout(250);

  const boxes = await sceneBoxes(page, 'ArcadeIntermission');
  assertFightersClear(boxes, 'ArcadeIntermission');
  await page.screenshot({ path: `${EVIDENCE}/16-arcade-intermission.png` });
  expect(errors.list).toEqual([]);
});

test('the arcade ending shows the winning fighter clear of the ending text', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoGame(page);
  // Drive straight to the ending scene; it reads the arcade fighter from session state.
  await page.evaluate(() => {
    const game = (window as any).__e2eGame;
    game.scene.start('Ending');
  });
  await expect.poll(() => page.evaluate(() => !!(window as any).__e2eGame.scene.isActive('Ending')), { timeout: 10_000 }).toBe(true);
  await page.waitForTimeout(300);

  const boxes = await sceneBoxes(page, 'Ending');
  assertFightersClear(boxes, 'Ending');
  await page.screenshot({ path: `${EVIDENCE}/17-arcade-ending.png` });
  expect(errors.list).toEqual([]);
});
