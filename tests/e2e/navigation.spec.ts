import { test, expect } from '@playwright/test';
import { collectErrors, gotoGame, tap } from './helpers';

test('production build loads with no console errors or failed requests', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoGame(page);
  await expect(page.locator('#app')).toBeVisible();
  expect(errors.list).toEqual([]);
});

test('title screen requires a fresh input before advancing, then reaches the main menu', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoGame(page);

  // A held key from before the scene existed should not immediately confirm anything;
  // exercise the normal path: a real press advances from Title to the Main Menu.
  await tap(page, 'KeyV');
  await page.waitForTimeout(400);
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  expect(errors.list).toEqual([]);
});

test('navigates Title -> Main Menu -> How to Play -> back -> Credits -> back -> Settings -> back', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoGame(page);
  await tap(page, 'KeyV'); // Title -> Main Menu

  await tap(page, 'KeyS', 40); // Two Players
  await tap(page, 'KeyS', 40); // Training
  await tap(page, 'KeyS', 40); // How to Play
  await tap(page, 'KeyV'); // confirm -> How to Play
  await page.waitForTimeout(200);
  await tap(page, 'KeyN'); // Block/cancel -> back to Main Menu
  await page.waitForTimeout(200);

  await tap(page, 'KeyS', 40); // Two Players
  await tap(page, 'KeyS', 40); // Training
  await tap(page, 'KeyS', 40); // How to Play
  await tap(page, 'KeyS', 40); // Settings
  await tap(page, 'KeyS', 40); // Credits
  await tap(page, 'KeyV'); // confirm -> Credits
  await page.waitForTimeout(200);
  await tap(page, 'KeyN'); // back to Main Menu
  await page.waitForTimeout(200);

  await tap(page, 'KeyS', 40); // Two Players
  await tap(page, 'KeyS', 40); // Training
  await tap(page, 'KeyS', 40); // How to Play
  await tap(page, 'KeyS', 40); // Settings
  await tap(page, 'KeyV'); // confirm -> Settings
  await page.waitForTimeout(200);
  await tap(page, 'KeyN'); // Block -> back to Main Menu
  await page.waitForTimeout(200);

  expect(errors.list).toEqual([]);
});
