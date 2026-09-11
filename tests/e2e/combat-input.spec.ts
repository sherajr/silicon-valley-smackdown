import { test, expect } from '@playwright/test';
import { collectErrors, gotoGame, tap } from './helpers';

async function startArcadeFight(page: import('@playwright/test').Page) {
  await tap(page, 'KeyV'); // Title -> Main Menu
  await tap(page, 'KeyV'); // Single Player -> Character Select
  await tap(page, 'KeyV'); // confirm Hunter
  await page.waitForTimeout(300);
  await tap(page, 'KeyV'); // confirm Normal difficulty
  await page.waitForTimeout(300);
  await tap(page, 'KeyV'); // skip the opponent card
  await page.waitForTimeout(1200);
}

/**
 * Regression test: FightScene used to call InputManager.captureFrame() twice
 * per render frame (once for a pause check, again inside the fixed-step),
 * which silently consumed every Basic/Special/Grab press edge before the
 * simulation ever saw it. Held actions (block, movement) were unaffected,
 * which made the bug read as "only block does anything."
 */
test('a real, briefly-held Basic press starts an attack (not just held actions like Block)', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoGame(page);
  await startArcadeFight(page);

  const getMoveId = () =>
    page.evaluate(() => {
      const scenes = (window as any).__e2eGame?.scene?.getScenes?.(true) ?? [];
      const fight = scenes.find((s: any) => s.scene.key === 'Fight');
      return fight?.matchState?.sim?.p1?.activeMove?.def?.id ?? null;
    });

  // Give plenty of margin past the round-start freeze, then press Basic like a real player would.
  await page.waitForTimeout(600);
  let sawAttack = false;
  for (let attempt = 0; attempt < 3 && !sawAttack; attempt++) {
    await page.keyboard.down('KeyV');
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyV');
    for (let poll = 0; poll < 12; poll++) {
      if (await getMoveId()) {
        sawAttack = true;
        break;
      }
      await page.waitForTimeout(25);
    }
    if (!sawAttack) await page.waitForTimeout(400);
  }

  expect(sawAttack).toBe(true);
  expect(errors.list).toEqual([]);
});
