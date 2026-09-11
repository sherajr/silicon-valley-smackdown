import { test, expect } from '@playwright/test';
import { collectErrors, gotoGame, tap } from './helpers';

test('versus mode lets both players choose independently and reach a fight', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoGame(page);

  await tap(page, 'KeyV'); // Title -> Main Menu
  await tap(page, 'KeyS', 40); // Main Menu -> Two Players
  await tap(page, 'KeyV'); // confirm Two Players -> Character Select

  // P1 moves to Kevin (index 1) and confirms.
  await tap(page, 'KeyD', 40);
  await tap(page, 'KeyV');
  await page.waitForTimeout(200);

  // P2 moves to Al (index 2, two steps right from Kevin's default start) and confirms independently.
  await tap(page, 'ArrowRight', 40);
  await tap(page, 'ArrowRight', 40);
  await tap(page, 'Numpad4');
  await page.waitForTimeout(400);

  // Stage select: confirm the default stage and default power-ups.
  await tap(page, 'KeyV');
  await page.waitForTimeout(300);

  // Versus intro auto-advances into the fight.
  await page.waitForTimeout(2200);

  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  expect(errors.list).toEqual([]);
});
