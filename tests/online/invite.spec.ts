import { expect, test, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const evidence = path.resolve('docs/evidence/online');
fs.mkdirSync(evidence, { recursive: true });

function watch(page: Page, errors: string[]) {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().includes('X4122')) errors.push(message.text());
  });
}

async function openOnline(page: Page) {
  await page.goto('/?arenaTest=1');
  await page.locator('#online').click();
}

test('two invited players share one match, then rematch', async ({ browser }) => {
  const errors: string[] = [];
  const host = await context(browser);
  const guest = await context(browser);
  const hostPage = await host.newPage();
  const guestPage = await guest.newPage();
  watch(hostPage, errors);
  watch(guestPage, errors);
  await openOnline(hostPage);
  await hostPage.locator('#create-room').click();
  await expect(hostPage.locator('#room-code')).toBeVisible();
  const code = await hostPage.locator('#room-code').inputValue();
  expect(code.replace(/-/g, '')).toMatch(/^[A-Z2-9]{8}$/);
  await hostPage.screenshot({ path: path.join(evidence, 'host-lobby.png') });

  await openOnline(guestPage);
  await guestPage.locator('#join-code').fill(code);
  await guestPage.locator('#join-room').click();
  await expect(guestPage.locator('#room-code')).toHaveValue(code);
  await guestPage.screenshot({ path: path.join(evidence, 'guest-lobby.png') });

  const frames: Record<string, { x: number; attack?: boolean }> = {};
  for (let i = 0; i < 90; i++) frames[String(i)] = { x: i > 30 ? 1 : 0, attack: i === 70 };
  await hostPage.evaluate(script => (window as unknown as { __arena: { installOnlineFixture: (frames: typeof script) => void } }).__arena.installOnlineFixture(script), frames);
  await guestPage.evaluate(script => (window as unknown as { __arena: { installOnlineFixture: (frames: typeof script) => void } }).__arena.installOnlineFixture(script), frames);
  await hostPage.locator('#quality').selectOption('performance');
  await guestPage.locator('#quality').selectOption('performance');
  await hostPage.locator('#ready').click();
  await guestPage.locator('#ready').click();
  await expect(hostPage.locator('#net-pill')).toBeVisible();
  await expect(hostPage.locator('.slot-label', { hasText: 'YOU' })).toBeVisible();
  await expect(guestPage.locator('.slot-label', { hasText: 'YOU' })).toBeVisible();
  await expect(guestPage.locator('.slot-label', { hasText: 'OPP' })).toBeVisible();
  const debug = (frame?: number) => (window as unknown as { __arena: { onlineDebug: (frame?: number) => { confirmed: number; hash: string | null; interrupted: string | null; epoch: number } } }).__arena.onlineDebug(frame);
  await expect.poll(async () => (await hostPage.evaluate(debug)).confirmed, { timeout: 30_000 }).toBeGreaterThan(20);
  await expect.poll(async () => (await guestPage.evaluate(debug)).confirmed, { timeout: 30_000 }).toBeGreaterThan(20);
  const hostState = await hostPage.evaluate(debug, 20);
  const guestState = await guestPage.evaluate(debug, 20);
  expect(hostState.interrupted).toBeNull();
  expect(guestState.interrupted).toBeNull();
  expect(guestState.hash).toBe(hostState.hash);
  expect(hostState.hash).toBeTruthy();
  await hostPage.screenshot({ path: path.join(evidence, 'host-match.png') });
  await guestPage.screenshot({ path: path.join(evidence, 'guest-match.png') });

  await hostPage.keyboard.press('Escape');
  await expect(hostPage.getByText('The fight keeps going.')).toBeVisible();
  await expect.poll(async () => (await hostPage.evaluate(debug)).confirmed).toBeGreaterThan(hostState.confirmed);
  await hostPage.locator('#online-forfeit').click();
  await expect(hostPage.getByRole('heading', { name: /forfeit/i })).toBeVisible();
  await expect(guestPage.getByRole('heading', { name: /forfeit/i })).toBeVisible();
  await hostPage.screenshot({ path: path.join(evidence, 'forfeit.png') });
  await hostPage.locator('#online-rematch').click();
  await guestPage.locator('#online-rematch').click();
  await expect.poll(async () => (await hostPage.evaluate(debug)).epoch).toBeGreaterThan(hostState.epoch);
  expect(errors).toEqual([]);
  await host.close();
  await guest.close();
});

test('rejects a bad code and a third player', async ({ browser }) => {
  const host = await context(browser);
  const other = await context(browser);
  const stranger = await context(browser);
  const hostPage = await host.newPage();
  const otherPage = await other.newPage();
  const strangerPage = await stranger.newPage();
  await openOnline(otherPage);
  await otherPage.locator('#join-code').fill('ZZZZZZZZ');
  await otherPage.locator('#join-room').click();
  await expect(otherPage.locator('#online-status')).toContainText('does not match');

  await openOnline(hostPage);
  await hostPage.locator('#create-room').click();
  const code = await hostPage.locator('#room-code').inputValue();
  await openOnline(strangerPage);
  await strangerPage.locator('#join-code').fill(code);
  await strangerPage.locator('#join-room').click();
  await expect(strangerPage.locator('#room-code')).toHaveValue(code);
  const third = await context(browser);
  const thirdPage = await third.newPage();
  await openOnline(thirdPage);
  await thirdPage.locator('#join-code').fill(code);
  await thirdPage.locator('#join-room').click();
  await expect(thirdPage.locator('#online-status')).toContainText('already has two players');
  await third.close();
  await stranger.close();
  await other.close();
  await host.close();
});

test('a disconnect names no winner, and local play still opens', async ({ browser, page }) => {
  const host = await context(browser);
  const guest = await context(browser);
  const hostPage = await host.newPage();
  const guestPage = await guest.newPage();
  await openOnline(hostPage);
  await hostPage.locator('#create-room').click();
  const code = await hostPage.locator('#room-code').inputValue();
  await openOnline(guestPage);
  await guestPage.locator('#join-code').fill(code);
  await guestPage.locator('#join-room').click();
  await hostPage.locator('#quality').selectOption('performance');
  await guestPage.locator('#quality').selectOption('performance');
  await hostPage.locator('#ready').click();
  await guestPage.locator('#ready').click();
  await expect(hostPage.locator('#net-pill')).toBeVisible();
  await guest.close();
  await expect(hostPage.getByRole('heading', { name: 'No winner.' })).toBeVisible();
  await hostPage.screenshot({ path: path.join(evidence, 'disconnect.png') });
  await host.close();

  await page.goto('/');
  await page.locator('#enter').click();
  await expect(page.getByRole('heading', { name: 'Choose your disruptor.' })).toBeVisible();
});

test('the home screen keeps online and local entry on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#enter')).toBeVisible();
  await expect(page.locator('#online')).toBeVisible();
  await page.screenshot({ path: path.join(evidence, 'home-mobile.png') });
});

function context(browser: Browser) {
  return browser.newContext({ viewport: { width: 1280, height: 720 }, baseURL: 'http://127.0.0.1:5191' });
}
