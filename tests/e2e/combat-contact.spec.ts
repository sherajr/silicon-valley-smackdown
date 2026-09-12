import { test, expect } from '@playwright/test';
import { collectErrors, getSimSnapshot, gotoGame, startVersusMatch, waitForSim } from './helpers';

/**
 * The earlier review found that browser combat coverage only proved an attack
 * *state* started (activeMove set), never that it actually connected. These
 * tests drive real key presses -- walking into range and throwing an attack --
 * and assert on the resulting health/guard/state changes the simulation itself
 * produced, never on values injected by a test hook. forceKO() (used elsewhere
 * for round-flow tests) is deliberately not used here.
 */

test.describe('real combat contact (P1 Hunter vs P2 Kevin)', () => {
  test('a real P1 Basic attack closes distance under its own movement and lands on P2, reducing health', async ({ page }) => {
    const errors = collectErrors(page);
    await gotoGame(page);
    await startVersusMatch(page);

    const before = await getSimSnapshot(page);
    expect(before).not.toBeNull();

    await page.keyboard.down('KeyD'); // P1 walks right toward P2
    await page.waitForTimeout(1500);
    await page.keyboard.up('KeyD');
    await page.waitForTimeout(100);
    await page.keyboard.down('KeyV'); // P1 Basic, a single real tap
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyV');

    const after = await waitForSim(page, (s) => s.p2Health < before!.p2Health, 2000);

    expect(after).not.toBeNull();
    expect(after!.p2Health).toBeLessThan(before!.p2Health);
    expect(before!.p2Health - after!.p2Health).toBeGreaterThan(3); // a real unblocked basic (~6 dmg), not chip damage
    expect(errors.list).toEqual([]);
  });

  test('a real P2 Basic attack (opposite facing, numpad input) closes distance and lands on P1', async ({ page }) => {
    const errors = collectErrors(page);
    await gotoGame(page);
    await startVersusMatch(page);

    const before = await getSimSnapshot(page);
    expect(before).not.toBeNull();

    await page.keyboard.down('ArrowLeft'); // P2 starts on the right, walks left toward P1
    await page.waitForTimeout(1500);
    await page.keyboard.up('ArrowLeft');
    await page.waitForTimeout(100);
    await page.keyboard.down('Numpad4'); // P2 Basic
    await page.waitForTimeout(50);
    await page.keyboard.up('Numpad4');

    const after = await waitForSim(page, (s) => s.p1Health < before!.p1Health, 2000);

    expect(after).not.toBeNull();
    expect(after!.p1Health).toBeLessThan(before!.p1Health);
    expect(before!.p1Health - after!.p1Health).toBeGreaterThan(2); // a real unblocked Kevin basic
    expect(errors.list).toEqual([]);
  });

  test('P2 holding Block absorbs a P1 Basic attack: chip damage only, not a full unblocked hit', async ({ page }) => {
    const errors = collectErrors(page);
    await gotoGame(page);
    await startVersusMatch(page);

    const before = await getSimSnapshot(page);
    expect(before).not.toBeNull();

    await page.keyboard.down('Numpad6'); // P2 holds Block first
    await page.waitForTimeout(80);
    await page.keyboard.down('KeyD'); // P1 walks into range
    await page.waitForTimeout(1500);
    await page.keyboard.up('KeyD');
    await page.waitForTimeout(100);
    await page.keyboard.down('KeyV'); // P1 Basic into the block
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyV');
    await page.waitForTimeout(500);
    await page.keyboard.up('Numpad6');

    const after = await getSimSnapshot(page);
    expect(after).not.toBeNull();

    const chip = before!.p2Health - after!.p2Health;
    // A blocked hit still chips a little health and guard (proving contact was recognized),
    // but nowhere near the ~6 damage of the unblocked-hit test above.
    expect(chip).toBeGreaterThanOrEqual(0);
    expect(chip).toBeLessThan(3);
    expect(after!.p2Guard).toBeLessThan(before!.p2Guard);
    expect(errors.list).toEqual([]);
  });

  test('a real P1 Grab connects at close range and forces a knockdown (throw outcome)', async ({ page }) => {
    const errors = collectErrors(page);
    await gotoGame(page);
    await startVersusMatch(page);

    const before = await getSimSnapshot(page);
    expect(before).not.toBeNull();

    await page.keyboard.down('KeyD'); // P1 walks into grab range
    await page.waitForTimeout(1500);
    await page.keyboard.up('KeyD');
    await page.waitForTimeout(100);
    await page.keyboard.down('KeyM'); // P1 Grab, a single real tap
    await page.waitForTimeout(50);
    await page.keyboard.up('KeyM');

    const after = await waitForSim(page, (s) => s.p2State === 'knockdown', 2000);

    expect(after).not.toBeNull();
    expect(after!.p2State).toBe('knockdown');
    expect(after!.p2Health).toBeLessThan(before!.p2Health);
    expect(errors.list).toEqual([]);
  });
});
