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
    const sim = fight?.matchState?.sim as
      | {
          ended: boolean;
          result: { winner: string; reason: string } | null;
          p1: { health: number; guard: number; state: string };
          p2: { health: number; guard: number; state: string };
        }
      | undefined;
    if (!sim) return null;
    return {
      ended: sim.ended,
      result: sim.result,
      p1Health: sim.p1.health,
      p2Health: sim.p2.health,
      p1Guard: sim.p1.guard,
      p2Guard: sim.p2.guard,
      p1State: sim.p1.state,
      p2State: sim.p2.state,
      scoreP1: fight!.matchState!.scoreP1,
      scoreP2: fight!.matchState!.scoreP2,
      matchWinner: fight!.matchState!.matchWinner,
    };
  });
}

/** Reads the currently displayed texture key for a fighter's live Phaser sprite -- the actual
 * rendered frame, not sim state -- so a test can prove which pose is on screen right now
 * (a guard-meter/health assertion alone cannot catch a reaction-routing/rendering bug). */
export async function getFighterTextureKey(page: Page, slot: 'p1' | 'p2'): Promise<string | null> {
  return page.evaluate((s) => {
    const w = window as unknown as { __e2eGame?: { scene: { getScenes: (active: boolean) => { scene: { key: string } }[] } } };
    const scenes = w.__e2eGame?.scene.getScenes(true) ?? [];
    const fight = scenes.find((sc) => sc.scene.key === 'Fight') as unknown as
      | { p1View?: { sprite: { texture: { key: string } } }; p2View?: { sprite: { texture: { key: string } } } }
      | undefined;
    const view = s === 'p1' ? fight?.p1View : fight?.p2View;
    return view?.sprite.texture.key ?? null;
  }, slot);
}

/** Polls getFighterTextureKey() until it matches `predicate` or the timeout elapses. */
export async function waitForFighterTextureKey(
  page: Page,
  slot: 'p1' | 'p2',
  predicate: (key: string) => boolean,
  timeoutMs = 1500,
  intervalMs = 15,
): Promise<string | null> {
  const start = Date.now();
  let key = await getFighterTextureKey(page, slot);
  while (Date.now() - start < timeoutMs) {
    if (key && predicate(key)) return key;
    await new Promise((r) => setTimeout(r, intervalMs));
    key = await getFighterTextureKey(page, slot);
  }
  return key;
}

/** Navigates Title -> Main Menu -> Two Players -> Character Select (P1 Hunter, P2 Kevin) -> Stage -> Fight, using only real input, identical to a human clicking through Versus. */
export async function startVersusMatch(page: Page): Promise<void> {
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

/** Polls getSimSnapshot() until `predicate` matches a snapshot or the timeout elapses; returns the last snapshot seen. */
export async function waitForSim(
  page: Page,
  predicate: (s: NonNullable<Awaited<ReturnType<typeof getSimSnapshot>>>) => boolean,
  timeoutMs = 2000,
  intervalMs = 30,
): Promise<Awaited<ReturnType<typeof getSimSnapshot>>> {
  const start = Date.now();
  let snap = await getSimSnapshot(page);
  while (Date.now() - start < timeoutMs) {
    if (snap && predicate(snap)) return snap;
    await new Promise((r) => setTimeout(r, intervalMs));
    snap = await getSimSnapshot(page);
  }
  return snap;
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
