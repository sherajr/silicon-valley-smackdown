import { test, expect } from '@playwright/test';
import { collectErrors, gotoGame, tap } from './helpers';

test('volume and key binding changes persist across a reload', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoGame(page);

  await tap(page, 'KeyV'); // Title -> Main Menu
  await tap(page, 'KeyS', 40);
  await tap(page, 'KeyS', 40);
  await tap(page, 'KeyS', 40);
  await tap(page, 'KeyS', 40); // Settings
  await tap(page, 'KeyV'); // confirm -> Settings, Audio tab

  // Bump Master volume up once (Basic cycles +10%, wrapping).
  await tap(page, 'KeyV');

  await tap(page, 'KeyD', 40); // -> Display tab
  await tap(page, 'KeyD', 40); // -> Controls P1
  await tap(page, 'KeyV'); // start remapping first row (moveLeft)
  await page.waitForTimeout(150);
  await page.keyboard.down('KeyG');
  await page.waitForTimeout(60);
  await page.keyboard.up('KeyG');
  await page.waitForTimeout(300);

  const savedBefore = await page.evaluate(() => localStorage.getItem('svs.save.v1'));
  expect(savedBefore).toBeTruthy();
  const parsedBefore = JSON.parse(savedBefore!);
  expect(parsedBefore.bindings.p1.moveLeft).toEqual(['KeyG']);
  expect(parsedBefore.volumes.master).toBeGreaterThan(0.75);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  const savedAfter = await page.evaluate(() => localStorage.getItem('svs.save.v1'));
  const parsedAfter = JSON.parse(savedAfter!);
  expect(parsedAfter.bindings.p1.moveLeft).toEqual(['KeyG']);
  expect(parsedAfter.volumes.master).toBe(parsedBefore.volumes.master);

  expect(errors.list).toEqual([]);
});
