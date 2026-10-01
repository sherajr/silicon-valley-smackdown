import { expect, test, type Browser, type Page } from '@playwright/test';

type Debug = { confirmed: number; hash: string | null; interrupted: string | null; epoch: number };
const debug = (frame?: number) => (window as unknown as { __arena: { onlineDebug: (frame?: number) => Debug } }).__arena.onlineDebug(frame);

async function context(browser: Browser) {
  return browser.newContext({ viewport: { width: 960, height: 540 } });
}
async function openOnline(page: Page) {
  await page.goto('/?arenaTest=1');
  await page.locator('#online').click();
}

// The first online test confirms about 20 frames. This one plays a real exchange for 15 seconds, long enough to hit
// anything that only shows up once a match is running: rate limits, a growing per-frame cost, or a slow desync.
test('a 15-second match with both players pressing keys stays confirmed, in sync and uninterrupted', async ({ browser }) => {
  test.setTimeout(120_000);
  const host = await context(browser), guest = await context(browser);
  const hostPage = await host.newPage(), guestPage = await guest.newPage();
  const status: string[] = [];
  for (const p of [hostPage, guestPage]) p.on('pageerror', e => status.push(`[pageerror] ${e.message}`));
  await openOnline(hostPage);
  await hostPage.locator('#create-room').click();
  const code = await hostPage.locator('#room-code').inputValue();
  await openOnline(guestPage);
  await guestPage.locator('#join-code').fill(code);
  await guestPage.locator('#join-room').click();
  await expect(guestPage.locator('#room-code')).toHaveValue(code);
  await hostPage.locator('#quality').selectOption('performance');
  await guestPage.locator('#quality').selectOption('performance');
  await hostPage.locator('#ready').click();
  await guestPage.locator('#ready').click();
  await expect.poll(async () => (await hostPage.evaluate(debug)).confirmed, { timeout: 30_000 }).toBeGreaterThan(10);

  const start = Date.now();
  // Walk in, strike, hop, then walk back, so both fighters stay on the stage and keep trading instead of running off it.
  const play = async (page: Page, toward: string, away: string) => {
    while (Date.now() - start < 15_000) {
      await page.keyboard.down(toward); await page.waitForTimeout(350); await page.keyboard.up(toward);
      await page.keyboard.press('v'); await page.waitForTimeout(150); await page.keyboard.press('w'); await page.waitForTimeout(250);
      await page.keyboard.down(away); await page.waitForTimeout(350); await page.keyboard.up(away);
    }
  };
  const before = await hostPage.evaluate(debug);
  await Promise.all([play(hostPage, 'd', 'a'), play(guestPage, 'a', 'd')]);
  const [h, g] = await Promise.all([hostPage.evaluate(debug), guestPage.evaluate(debug)]);
  expect(h.interrupted).toBeNull(); expect(g.interrupted).toBeNull();
  // 15 seconds at 60 Hz is 900 frames; allow for start-up and the prediction window.
  expect(h.confirmed - before.confirmed).toBeGreaterThan(780);
  expect(h.tick, 'the match should still be running').toBeGreaterThan(before.tick + 780);
  // A frame both clients have confirmed and simulated (no state exists past a finished match's last tick).
  const common = Math.min(h.confirmed, g.confirmed, h.tick, g.tick) - 1;
  const [hh, gh] = await Promise.all([hostPage.evaluate(debug, common), guestPage.evaluate(debug, common)]);
  const detail = JSON.stringify({ h, g, common, hh, gh });
  expect(hh.hash, detail).toBeTruthy(); expect(gh.hash, detail).toBe(hh.hash);
  const pills = await Promise.all([hostPage, guestPage].map(p => p.locator('#net-pill').textContent()));
  expect(pills.join(' ')).not.toMatch(/too many|attempts/i);
  expect(status).toEqual([]);
  await host.close(); await guest.close();
});
