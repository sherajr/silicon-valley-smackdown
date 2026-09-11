import type { Page } from '@playwright/test';

/** Presses and releases a physical key code, holding briefly so the fixed-step sim reliably sees it. */
export async function tap(page: Page, code: string, holdMs = 60, waitMs = 220): Promise<void> {
  await page.keyboard.down(code);
  await page.waitForTimeout(holdMs);
  await page.keyboard.up(code);
  await page.waitForTimeout(waitMs);
}

export interface ConsoleErrors {
  list: string[];
}

/** Attaches pageerror/console.error/requestfailed listeners and returns a live list of messages seen so far. */
export function collectErrors(page: Page): ConsoleErrors {
  const errors: ConsoleErrors = { list: [] };
  page.on('pageerror', (err) => errors.list.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.list.push(`console.error: ${msg.text()}`);
  });
  page.on('requestfailed', (req) => {
    const failure = req.failure();
    if (failure) errors.list.push(`requestfailed: ${req.url()} ${failure.errorText}`);
  });
  return errors;
}

/** Navigates to the game with the e2e test hook enabled (see src/game.ts). */
export async function gotoGame(page: Page): Promise<void> {
  await page.goto('/?e2e=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
}

/** Reads the live CombatSim state from the running Fight scene, or null if not in a fight. */
export async function getSimSnapshot(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as { __e2eGame?: { scene: { getScenes: (active: boolean) => { scene: { key: string } }[] } } };
    const scenes = w.__e2eGame?.scene.getScenes(true) ?? [];
    const fight = scenes.find((s) => s.scene.key === 'Fight') as unknown as { matchState?: { sim: unknown; scoreP1: number; scoreP2: number; matchWinner: string | null } } | undefined;
    const sim = fight?.matchState?.sim as { ended: boolean; result: { winner: string; reason: string } | null; p1: { health: number }; p2: { health: number } } | undefined;
    if (!sim) return null;
    return {
      ended: sim.ended,
      result: sim.result,
      p1Health: sim.p1.health,
      p2Health: sim.p2.health,
      scoreP1: fight!.matchState!.scoreP1,
      scoreP2: fight!.matchState!.scoreP2,
      matchWinner: fight!.matchState!.matchWinner,
    };
  });
}

/** Returns the key of the currently active (non-Boot) scene, e.g. 'Fight' or 'Results'. Requires the e2e hook. */
export async function getActiveSceneKey(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const w = window as unknown as { __e2eGame?: { scene: { getScenes: (active: boolean) => { scene: { key: string } }[] } } };
    const scenes = w.__e2eGame?.scene.getScenes(true) ?? [];
    const top = scenes[scenes.length - 1];
    return top ? top.scene.key : null;
  });
}

/** Polls `check` until it returns a truthy value or the timeout elapses; returns the last (possibly falsy) result. */
export async function waitFor<T>(check: () => Promise<T>, timeoutMs = 8000, intervalMs = 150): Promise<T> {
  const start = Date.now();
  let result = await check();
  while (!result && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, intervalMs));
    result = await check();
  }
  return result;
}

/** Forces the given side's health to 0 so the next sim tick resolves a KO. Requires the e2e hook (gotoGame). */
export async function forceKO(page: Page, loser: 'p1' | 'p2'): Promise<void> {
  await page.evaluate((slot) => {
    const w = window as unknown as { __e2eGame?: { scene: { getScenes: (active: boolean) => { scene: { key: string } }[] } } };
    const scenes = w.__e2eGame?.scene.getScenes(true) ?? [];
    const fight = scenes.find((s) => s.scene.key === 'Fight') as unknown as { matchState?: { sim: Record<string, { health: number }> } } | undefined;
    const sim = fight?.matchState?.sim;
    if (sim) sim[slot].health = 0;
  }, loser);
  await page.waitForTimeout(200);
}
