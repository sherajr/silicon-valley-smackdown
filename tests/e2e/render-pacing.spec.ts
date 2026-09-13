import { test, expect, type Page } from '@playwright/test';
import { tap } from './helpers';

/**
 * Combat must advance on the fixed 60 Hz simulation clock, not the display refresh rate. These
 * drive the REAL FightScene.update() loop with the frame deltas a 30/60/120/144 Hz display would
 * produce, for the same total simulated elapsed time, and check the simulation advanced the same
 * amount -- so cosmetic frame rate cannot change how often moves come out or how fast the round
 * clock runs.
 */

const REFRESH_RATES = [30, 60, 120, 144];
/** Long enough to cross many fixed steps, short enough to stay well inside one round. */
const ELAPSED_MS = 2000;

async function bootFight(page: Page): Promise<void> {
  await page.goto('/?e2e=1&skip=fight&p1=hunter&p2=kevin&stage=castro_street', { waitUntil: 'networkidle' });
  await expect.poll(() => page.evaluate(() => !!(window as any).__e2eGame?.scene.isActive('Fight')), { timeout: 15_000 }).toBe(true);
  // Stop the scene's own update loop so the scripted deltas below are the only thing driving it.
  await page.evaluate(() => (window as any).__e2eGame.scene.pause('Fight'));
  await page.waitForTimeout(80);
}

/** Runs the real scene update loop at `hz` for ELAPSED_MS, returning how far the sim advanced. */
async function runAtRefreshRate(page: Page, hz: number) {
  return page.evaluate(
    ({ hz, elapsedMs }) => {
      const fight: any = (window as any).__e2eGame.scene.getScene('Fight');
      fight.matchState.sim.resetRound();
      fight.accumulator = 0;
      const startFrame = fight.matchState.sim.frameCount;
      const startClock = fight.matchState.sim.clockFrames;
      const delta = 1000 / hz;
      const ticks = Math.round(elapsedMs / delta);
      let time = 0;
      for (let i = 0; i < ticks; i++) {
        time += delta;
        fight.update(time, delta); // the real loop, including its bounded catch-up policy
      }
      return {
        simFrames: fight.matchState.sim.frameCount - startFrame,
        clockFrames: startClock - fight.matchState.sim.clockFrames,
        renderedFrames: ticks,
      };
    },
    { hz, elapsedMs: ELAPSED_MS },
  );
}

test('combat and the round clock advance identically at 30, 60, 120 and 144 Hz', async ({ page }) => {
  await bootFight(page);

  const results: Record<number, { simFrames: number; clockFrames: number; renderedFrames: number }> = {};
  for (const hz of REFRESH_RATES) results[hz] = await runAtRefreshRate(page, hz);

  // Roughly 60 sim ticks per simulated second, whatever the display was doing.
  const expected = Math.round((ELAPSED_MS / 1000) * 60);
  for (const hz of REFRESH_RATES) {
    const r = results[hz];
    expect(r.renderedFrames, `${hz}Hz should render ~${hz * (ELAPSED_MS / 1000)} frames`).toBe(Math.round(ELAPSED_MS / (1000 / hz)));
    // One step of slack for accumulator rounding at the end of the window.
    expect(Math.abs(r.simFrames - expected), `${hz}Hz ran ${r.simFrames} sim frames, expected ~${expected}`).toBeLessThanOrEqual(1);
    expect(Math.abs(r.clockFrames - expected), `${hz}Hz clock ran ${r.clockFrames} frames, expected ~${expected}`).toBeLessThanOrEqual(1);
  }

  // 144 Hz renders nearly 5x as many frames as 30 Hz yet simulates the same amount.
  expect(results[144].renderedFrames).toBeGreaterThan(results[30].renderedFrames * 4);
  expect(Math.abs(results[144].simFrames - results[30].simFrames)).toBeLessThanOrEqual(1);
});

test('a stalled display cannot be made up with unbounded catch-up steps', async ({ page }) => {
  await bootFight(page);

  const stall = await page.evaluate(() => {
    const fight: any = (window as any).__e2eGame.scene.getScene('Fight');
    fight.matchState.sim.resetRound();
    fight.accumulator = 0;
    const before = fight.matchState.sim.frameCount;
    // One enormous frame, as if the tab were backgrounded for two seconds.
    fight.update(2000, 2000);
    return { stepsTaken: fight.matchState.sim.frameCount - before, accumulator: fight.accumulator };
  });

  // The bounded catch-up policy caps a single display frame's work rather than replaying the
  // whole stall as a burst of damage-processing ticks.
  expect(stall.stepsTaken).toBeLessThanOrEqual(6);
  expect(stall.stepsTaken).toBeGreaterThan(0);
  // And the leftover time is dropped, not carried forward into another burst.
  expect(stall.accumulator).toBe(0);
});

test('resuming from pause does not replay the paused time as a burst of simulation', async ({ page }) => {
  await page.goto('/?e2e=1&skip=fight&p1=hunter&p2=kevin&stage=castro_street', { waitUntil: 'networkidle' });
  await expect.poll(() => page.evaluate(() => !!(window as any).__e2eGame?.scene.isActive('Fight')), { timeout: 15_000 }).toBe(true);
  await page.waitForTimeout(400);

  const read = () =>
    page.evaluate(() => {
      const fight: any = (window as any).__e2eGame.scene.getScene('Fight');
      return { phase: fight.phase, frame: fight.matchState.sim.frameCount, clock: fight.matchState.sim.clockFrames };
    });

  await tap(page, 'Escape'); // held briefly: an instant press can fall between two input samples
  const paused = await read();
  expect(paused.phase).toBe('paused');

  // Sit paused for a while: neither combat nor the round clock may move.
  await page.waitForTimeout(1200);
  const stillPaused = await read();
  expect(stillPaused.frame).toBe(paused.frame);
  expect(stillPaused.clock).toBe(paused.clock);

  await tap(page, 'Escape');
  const justResumed = await read();
  expect(justResumed.phase).toBe('playing');
  // The 1.2s spent paused must not arrive as ~72 catch-up ticks the instant play resumes.
  expect(justResumed.frame - paused.frame).toBeLessThan(20);
});
