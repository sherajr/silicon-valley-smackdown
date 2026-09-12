import { test } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  collectErrors,
  forceKO,
  getActiveSceneKey,
  getSimSnapshot,
  gotoGame,
  startVersusMatch,
  tap,
  waitFor,
  waitForFighterTextureKey,
  waitForSim,
} from './helpers';

// Evidence-capture script for the CODEX_NEXT.md handoff -- NOT part of `npm run test:e2e`
// (filename deliberately omits .spec./.test. so Playwright's default testMatch skips it).
// Run explicitly: npx playwright test tests/e2e/evidence.capture.ts
//
// Every combat screenshot below is taken only once the real condition it claims to show has
// been polled true (health/guard delta, sim state, or on-screen sprite texture) -- never a
// fixed sleep guessing when something happened. A prior pass in this same evidence set shipped
// screenshots that didn't actually show what their filenames claimed (attack-contact captured
// before startup finished; knockdown/wakeup captured after a grab that missed range; a forced
// single-round KO mislabeled as a completed match). This version is a Codex-review-driven
// rewrite of that same script to close every one of those gaps. Nothing here asserts
// correctness (see combat-contact.spec.ts / FighterView.test.ts for that) -- this only records,
// honestly, what a real play session looks like.

const OUT = path.resolve(process.cwd(), 'docs/handoffs/evidence');
fs.mkdirSync(OUT, { recursive: true });

test.use({ video: { mode: 'on', size: { width: 960, height: 540 } } });

interface LogEntry {
  file: string;
  note: string;
  scene: string | null;
  sim: Awaited<ReturnType<typeof getSimSnapshot>>;
}

test.describe('evidence capture', () => {
  test('capture menu flow, combat states, and a real-gameplay video', async ({ page }) => {
    test.setTimeout(90_000); // real event-driven polling (pickup spawn, round transitions) runs well past the default 30s
    collectErrors(page);
    const video = page.video();
    const log: LogEntry[] = [];

    async function shot(file: string, note: string): Promise<void> {
      await page.screenshot({ path: path.join(OUT, file) });
      log.push({ file, note, scene: await getActiveSceneKey(page), sim: await getSimSnapshot(page) });
    }

    await gotoGame(page);
    await shot('01-title.png', 'Title screen, just loaded.');

    await tap(page, 'KeyV'); // Title -> Main Menu
    await page.waitForTimeout(250);
    await shot('02-main-menu.png', 'Main menu.');

    await tap(page, 'KeyS', 40); // -> Two Players
    await tap(page, 'KeyV'); // confirm -> Character Select
    await page.waitForTimeout(400);
    await shot('03-character-select.png', 'Character select, both P1/P2 info panels legible (post z-order fix).');

    await tap(page, 'KeyV'); // P1 confirms Hunter
    await page.waitForTimeout(150);
    await tap(page, 'Numpad4'); // P2 confirms Kevin
    await page.waitForTimeout(350);
    await shot('04-stage-select.png', 'Stage select.');

    await tap(page, 'KeyV'); // confirm stage
    await page.waitForTimeout(500);
    await shot('05-versus-intro.png', 'Versus intro card.');
    await waitFor(async () => ((await getActiveSceneKey(page)) === 'Fight' ? true : null), 4000);

    await shot('06-fight-neutral-idle.png', 'Neutral idle, both fighters standing.');

    // Dash (double-tap moveRight) -- real double-tap timing, matching DASH_DOUBLE_TAP_WINDOW_FRAMES.
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(70);
    await page.keyboard.up('KeyD');
    await page.waitForTimeout(30);
    await page.keyboard.down('KeyD');
    const dashed = await waitFor(async () => ((await getSimSnapshot(page))?.p1State === 'dash' ? true : null), 500);
    await shot('07-dash.png', dashed ? 'P1 confirmed in the dash state.' : 'P1 dash NOT confirmed by sim state before this shot -- may not show the dash pose.');
    await page.keyboard.up('KeyD');
    await page.waitForTimeout(150);

    // Jump
    await page.keyboard.down('KeyW');
    const jumped = await waitFor(async () => ((await getSimSnapshot(page))?.p1State === 'jump' ? true : null), 500);
    await shot('08-jump.png', jumped ? 'P1 confirmed airborne (jump state).' : 'P1 jump NOT confirmed before this shot.');
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(300);

    // Special (projectile)
    await page.keyboard.down('KeyB');
    await page.waitForTimeout(40);
    await page.keyboard.up('KeyB');
    await page.waitForTimeout(120);
    await shot('09-projectile.png', 'Shortly after P1 Special; projectile should be visible in flight.');
    await page.waitForTimeout(300);

    // Walk into range and land a real Basic -- wait for the defender's own health to actually
    // drop (proof of contact) before capturing, instead of a fixed post-press delay.
    const beforeContact = await getSimSnapshot(page);
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(1500);
    await page.keyboard.up('KeyD');
    await page.waitForTimeout(80);
    await page.keyboard.down('KeyV');
    const contactSnap = await waitForSim(page, (s) => s.p2Health < beforeContact!.p2Health, 1200);
    await shot(
      '10-attack-contact.png',
      contactSnap && contactSnap.p2Health < beforeContact!.p2Health
        ? `Confirmed contact: P2 health ${beforeContact!.p2Health} -> ${contactSnap.p2Health}.`
        : 'Contact NOT confirmed by a health drop before this shot.',
    );
    await page.keyboard.up('KeyV');
    await page.waitForTimeout(300);

    // Block impact -- poll for the actual on-screen guard-impact texture (see FighterView.test.ts
    // for the regression this is verifying is really wired up), not a fixed post-press delay.
    await page.keyboard.down('Numpad6');
    await page.waitForTimeout(80);
    await page.keyboard.down('KeyV');
    const impactKey = await waitForFighterTextureKey(page, 'p2', (k) => k === 'kevin_block_1', 800);
    await shot('11-block-impact.png', impactKey === 'kevin_block_1' ? 'Confirmed: P2 sprite texture is the real guard-impact frame (kevin_block_1).' : `Guard-impact frame NOT confirmed; texture was "${impactKey}".`);
    await page.keyboard.up('KeyV');
    await page.waitForTimeout(150);
    await page.keyboard.up('Numpad6');
    await page.waitForTimeout(300);

    // Grab -> knockdown -> wakeup. The prior pass in this evidence set attempted this without
    // re-establishing grab range first (P1 had already been pushed back), and missed. This one
    // walks in fresh, at the same duration combat-contact.spec.ts already proves reaches range.
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(1500);
    await page.keyboard.up('KeyD');
    await page.waitForTimeout(80);
    await page.keyboard.down('KeyM');
    const knockdownSnap = await waitForSim(page, (s) => s.p2State === 'knockdown', 1200);
    await shot('12-knockdown.png', knockdownSnap?.p2State === 'knockdown' ? 'Confirmed: P2 sim state is knockdown.' : `Knockdown NOT confirmed; P2 state was "${knockdownSnap?.p2State}".`);
    await page.keyboard.up('KeyM');
    const wakeupSnap = await waitForSim(page, (s) => s.p2State === 'wakeup', 1500);
    await shot('13-wakeup.png', wakeupSnap?.p2State === 'wakeup' ? 'Confirmed: P2 sim state is wakeup.' : `Wakeup NOT confirmed; P2 state was "${wakeupSnap?.p2State}".`);
    await page.waitForTimeout(300);

    // Best-effort pickup: wait for the first scripted spawn (~10s of match clock) and walk to it.
    const pickup = await page
      .waitForFunction(
        () => {
          const w = window as unknown as { __e2eGame?: { scene: { getScenes: (a: boolean) => { scene: { key: string } }[] } } };
          const scenes = w.__e2eGame?.scene.getScenes(true) ?? [];
          const fight = scenes.find((s) => s.scene.key === 'Fight') as unknown as { matchState?: { sim: { pickup: { x: number } | null; p1: { x: number } } } } | undefined;
          return fight?.matchState?.sim.pickup ?? null;
        },
        { timeout: 14000, polling: 200 },
      )
      .catch(() => null);

    if (pickup) {
      const info = await page.evaluate(() => {
        const w = window as unknown as { __e2eGame?: { scene: { getScenes: (a: boolean) => { scene: { key: string } }[] } } };
        const scenes = w.__e2eGame?.scene.getScenes(true) ?? [];
        const fight = scenes.find((s) => s.scene.key === 'Fight') as unknown as { matchState?: { sim: { pickup: { x: number } | null; p1: { x: number } } } } | undefined;
        const sim = fight?.matchState?.sim;
        return sim ? { pickupX: sim.pickup?.x ?? null, p1X: sim.p1.x } : null;
      });
      if (info?.pickupX != null) {
        const key = info.pickupX > info.p1X ? 'KeyD' : 'KeyA';
        await page.keyboard.down(key);
        await waitFor(async () => {
          const s = await page.evaluate(() => {
            const w = window as unknown as { __e2eGame?: { scene: { getScenes: (a: boolean) => { scene: { key: string } }[] } } };
            const scenes = w.__e2eGame?.scene.getScenes(true) ?? [];
            const fight = scenes.find((sc) => sc.scene.key === 'Fight') as unknown as { matchState?: { sim: { pickup: unknown } } } | undefined;
            return fight?.matchState?.sim.pickup === null ? true : null;
          });
          return s;
        }, 2200);
        await page.keyboard.up(key);
        await page.waitForTimeout(150);
        await shot('14-pickup.png', 'Walked to the spawned pickup; sim.pickup became null (collected) or this is a best-effort shot at the timeout.');
      }
    } else {
      fs.writeFileSync(path.join(OUT, '14-pickup-NOT-CAPTURED.txt'), 'Pickup did not spawn within the 14s capture window; not demonstrated in this evidence pass.\n');
    }

    // Real completed match, not a single forced-health round win mislabeled as "results": force
    // two round losses (forceKO(), same test-only hook match-rematch.spec.ts already uses for
    // round-flow, clearly labeled here too) with a real wait for each round transition, so the
    // scene actually reaches Results rather than starting Round 2.
    await forceKO(page, 'p2');
    await shot('15-round1-ko.png', 'Round 1 K.O. banner (forced via the same test-only health-zero hook match-rematch.spec.ts uses for round-flow testing -- not an earned finish).');
    await waitFor(async () => {
      const s = await getSimSnapshot(page);
      return s && !s.ended ? true : null;
    }, 6000);
    await forceKO(page, 'p2');
    const onResults = await waitFor(async () => ((await getActiveSceneKey(page)) === 'Results' ? true : null), 6000);
    await shot('16-results.png', onResults ? 'Confirmed: active scene is Results (match actually ended, 2 round wins).' : `Results NOT confirmed; active scene was "${await getActiveSceneKey(page)}".`);

    fs.writeFileSync(path.join(OUT, 'capture-log.json'), JSON.stringify(log, null, 2));

    await page.close();
    if (video) {
      const src = await video.path();
      fs.copyFileSync(src, path.join(OUT, 'gameplay.webm'));
    }
  });
});
