import { test, expect } from '@playwright/test';
import { collectErrors, forceKO, getActiveSceneKey, getSimSnapshot, gotoGame, tap, waitFor } from './helpers';

async function startVersusMatch(page: import('@playwright/test').Page) {
  await tap(page, 'KeyV'); // Title -> Main Menu
  await tap(page, 'KeyS', 40); // -> Two Players
  await tap(page, 'KeyV'); // confirm -> Character Select
  await tap(page, 'KeyV'); // P1 confirms Hunter
  await page.waitForTimeout(150);
  await tap(page, 'Numpad4'); // P2 confirms Kevin
  await page.waitForTimeout(300);
  await tap(page, 'KeyV'); // confirm stage
  await page.waitForTimeout(300);
  await page.waitForTimeout(2200); // versus intro auto-advance
}

/** Wins one round for `winner` by forcing the loser's health to 0 and waiting for the KO to register. */
async function winRound(page: import('@playwright/test').Page, loser: 'p1' | 'p2') {
  const snap = await waitFor(async () => {
    if ((await getActiveSceneKey(page)) !== 'Fight') return null;
    await forceKO(page, loser);
    const s = await getSimSnapshot(page);
    return s?.ended ? s : null;
  });
  expect(snap?.ended).toBe(true);
}

test('a full versus match resolves and Rematch resets combat state', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoGame(page);
  await startVersusMatch(page);

  await winRound(page, 'p2'); // round 1: P1 (Hunter) beats P2 (Kevin)
  // Wait for the round-end banner to clear and the second round to actually reset (still not the match yet: 1-0).
  await waitFor(async () => {
    const s = await getSimSnapshot(page);
    return s && !s.ended ? true : null;
  }, 6000);
  await winRound(page, 'p2'); // round 2: match point

  const onResults = await waitFor(async () => ((await getActiveSceneKey(page)) === 'Results' ? true : null), 6000);
  expect(onResults).toBe(true);

  // First menu item on the versus Results screen is Rematch.
  await tap(page, 'KeyV');

  const backInFight = await waitFor(async () => ((await getActiveSceneKey(page)) === 'Fight' ? true : null), 6000);
  expect(backInFight).toBe(true);

  const rematchSnap = await waitFor(async () => {
    const s = await getSimSnapshot(page);
    return s && !s.ended ? s : null;
  });
  expect(rematchSnap).not.toBeNull();
  expect(rematchSnap!.p1Health).toBeGreaterThan(190); // fresh round, near-full health
  expect(rematchSnap!.p2Health).toBeGreaterThan(190);
  expect(rematchSnap!.scoreP1).toBe(0); // Rematch resets the session score, unlike Continue
  expect(rematchSnap!.scoreP2).toBe(0);

  expect(errors.list).toEqual([]);
});
