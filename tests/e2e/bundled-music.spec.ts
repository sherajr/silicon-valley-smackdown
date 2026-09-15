import { test, expect, type Page } from '@playwright/test';
import { collectErrors, tap } from './helpers';

/**
 * The bundled soundtrack plays through `new Audio(url)`, which creates a *detached* element that
 * never enters the DOM -- there is nothing to query for. These tests wrap the Audio constructor
 * before the app boots and then read the real element's playback state, which is what proves the
 * track is actually sounding rather than merely present in the bundle.
 */

/** Wraps the Audio constructor so the elements the game creates can be inspected. */
async function instrumentAudio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const els: HTMLAudioElement[] = [];
    (window as any).__audioEls = els;
    const Native = window.Audio;
    (window as any).Audio = class extends Native {
      constructor(src?: string) {
        super(src);
        els.push(this as unknown as HTMLAudioElement);
      }
    };
  });
}

function readAudio(page: Page) {
  return page.evaluate(() =>
    ((window as any).__audioEls as HTMLAudioElement[]).map((e) => ({
      src: e.src,
      paused: e.paused,
      currentTime: e.currentTime,
      duration: Number.isFinite(e.duration) ? e.duration : null,
      readyState: e.readyState,
      loop: e.loop,
      error: e.error ? e.error.code : null,
    })),
  );
}

test('the bundled soundtrack actually plays, and loops, after a user gesture', async ({ page }) => {
  await instrumentAudio(page);
  const errors = collectErrors(page);
  await page.goto('/?e2e=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  // A real user gesture is what satisfies the browser's autoplay policy.
  await tap(page, 'KeyV');
  await expect.poll(async () => (await readAudio(page)).length).toBe(1);
  await expect.poll(async () => (await readAudio(page))[0].readyState, { timeout: 15_000 }).toBe(4); // HAVE_ENOUGH_DATA

  const first = (await readAudio(page))[0];
  expect(first.src).toContain('celtic_arcade');
  expect(first.src).toMatch(/\.mp3(\?.*)?$/);
  expect(first.error, 'the element must not report a MediaError').toBeNull();
  expect(first.duration, 'the file must decode to a real duration').toBeGreaterThan(30);
  expect(first.loop, 'the soundtrack must loop').toBe(true);
  expect(first.paused).toBe(false);

  // The decisive check: playback position advances in real time.
  await page.waitForTimeout(1200);
  const later = (await readAudio(page))[0];
  expect(later.currentTime - first.currentTime, 'playback position should advance').toBeGreaterThan(0.5);

  expect(errors.list).toEqual([]);
});

test('moving between scenes keeps one soundtrack playing rather than stacking copies', async ({ page }) => {
  await instrumentAudio(page);
  const errors = collectErrors(page);
  await page.goto('/?e2e=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  await tap(page, 'KeyV'); // Title -> Main Menu
  await expect.poll(async () => (await readAudio(page)).length).toBe(1);

  // Walk into Settings and back out; the same scene track id is requested repeatedly, which is
  // exactly the path that used to be able to leave a second source running underneath.
  for (let i = 0; i < 4; i++) await tap(page, 'KeyS');
  await tap(page, 'KeyV');
  await expect.poll(() => page.evaluate(() => !!(window as any).__e2eGame.scene.isActive('Settings'))).toBe(true);
  await page.waitForTimeout(400);

  // Settings must name the real recording, never present the synthesized score as the recording.
  const settingsText = await page.evaluate(() =>
    ((window as any).__e2eGame.scene.getScene('Settings') as any).children.list
      .filter((o: any) => o.type === 'Text')
      .map((o: any) => String(o.text))
      .join('\n'),
  );
  expect(settingsText).toContain('Celtic Arcade Run');

  await tap(page, 'KeyN'); // back to Main Menu
  await page.waitForTimeout(400);

  const els = await readAudio(page);
  expect(els.length, 'no second <audio> should be spun up for the same track').toBe(1);
  expect(els[0].paused, 'the soundtrack should still be playing').toBe(false);
  expect(errors.list).toEqual([]);
});
