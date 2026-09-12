import { test } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { collectErrors, gotoGame, startVersusMatch, tap } from './helpers';

// Evidence-capture script for the CODEX_NEXT.md handoff -- NOT part of `npm run test:e2e`
// (filename deliberately omits .spec./.test. so Playwright's default testMatch skips it).
// Run explicitly: npx playwright test tests/e2e/evidence.capture.ts
//
// Produces numbered screenshots plus one real-gameplay video under docs/handoffs/evidence/.
// Nothing here asserts correctness (see combat-contact.spec.ts for that) -- this only records
// what an actual play session looks/sounds like for human and Codex review.

const OUT = path.resolve(process.cwd(), 'docs/handoffs/evidence');
fs.mkdirSync(OUT, { recursive: true });

test.use({ video: 'on' });

test.describe('evidence capture', () => {
  test('capture menu flow, combat states, and a real-gameplay video', async ({ page }) => {
    collectErrors(page);
    const video = page.video();

    await gotoGame(page);
    await page.screenshot({ path: path.join(OUT, '01-title.png') });

    await tap(page, 'KeyV'); // Title -> Main Menu
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, '02-main-menu.png') });

    await tap(page, 'KeyS', 40); // -> Two Players
    await tap(page, 'KeyV'); // confirm -> Character Select
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, '03-character-select.png') });

    await tap(page, 'KeyV'); // P1 confirms Hunter
    await page.waitForTimeout(200);
    await tap(page, 'Numpad4'); // P2 confirms Kevin
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, '04-stage-select.png') });

    await tap(page, 'KeyV'); // confirm stage
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, '05-versus-intro.png') });
    await page.waitForTimeout(2000); // versus intro auto-advance into Fight

    await page.screenshot({ path: path.join(OUT, '06-fight-neutral-idle.png') });

    // Dash (double-tap moveRight)
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(70);
    await page.keyboard.up('KeyD');
    await page.waitForTimeout(30);
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(50);
    await page.screenshot({ path: path.join(OUT, '07-dash.png') });
    await page.waitForTimeout(150);
    await page.keyboard.up('KeyD');
    await page.waitForTimeout(200);

    // Jump
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(150);
    await page.keyboard.up('KeyW');
    await page.screenshot({ path: path.join(OUT, '08-jump.png') });
    await page.waitForTimeout(400);

    // Special (projectile)
    await page.keyboard.down('KeyB');
    await page.waitForTimeout(40);
    await page.keyboard.up('KeyB');
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT, '09-projectile.png') });
    await page.waitForTimeout(600);

    // Walk into range and land a real Basic (contact + hit spark + hitstun)
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(1500);
    await page.keyboard.up('KeyD');
    await page.waitForTimeout(100);
    await page.keyboard.down('KeyV');
    await page.waitForTimeout(20);
    await page.screenshot({ path: path.join(OUT, '10-attack-contact.png') });
    await page.keyboard.up('KeyV');
    await page.waitForTimeout(400);

    // Block impact
    await page.keyboard.down('Numpad6');
    await page.waitForTimeout(80);
    await page.keyboard.down('KeyV');
    await page.waitForTimeout(20);
    await page.screenshot({ path: path.join(OUT, '11-block-impact.png') });
    await page.keyboard.up('KeyV');
    await page.waitForTimeout(200);
    await page.keyboard.up('Numpad6');
    await page.waitForTimeout(400);

    // Grab -> knockdown -> wakeup
    await page.keyboard.down('KeyM');
    await page.waitForTimeout(30);
    await page.keyboard.up('KeyM');
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT, '12-knockdown.png') });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, '13-wakeup.png') });
    await page.waitForTimeout(700);

    // Best-effort pickup: wait for the first scripted spawn (~10s of match clock) and walk to it.
    const pickup = await page.waitForFunction(
      () => {
        const w = window as unknown as { __e2eGame?: { scene: { getScenes: (a: boolean) => { scene: { key: string } }[] } } };
        const scenes = w.__e2eGame?.scene.getScenes(true) ?? [];
        const fight = scenes.find((s) => s.scene.key === 'Fight') as unknown as { matchState?: { sim: { pickup: { x: number } | null; p1: { x: number } } } } | undefined;
        return fight?.matchState?.sim.pickup ?? null;
      },
      { timeout: 14000, polling: 200 },
    ).catch(() => null);

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
        await page.waitForTimeout(1800);
        await page.keyboard.up(key);
        await page.waitForTimeout(200);
        await page.screenshot({ path: path.join(OUT, '14-pickup.png') });
      }
    } else {
      fs.writeFileSync(path.join(OUT, '14-pickup-NOT-CAPTURED.txt'), 'Pickup did not spawn within the 14s capture window; not demonstrated in this evidence pass.\n');
    }

    // KO + Results (forceKO is fine here -- this is evidence capture, not a correctness assertion)
    await page.evaluate(() => {
      const w = window as unknown as { __e2eGame?: { scene: { getScenes: (a: boolean) => { scene: { key: string } }[] } } };
      const scenes = w.__e2eGame?.scene.getScenes(true) ?? [];
      const fight = scenes.find((s) => s.scene.key === 'Fight') as unknown as { matchState?: { sim: { p2: { health: number } } } } | undefined;
      if (fight?.matchState?.sim) fight.matchState.sim.p2.health = 0;
    });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, '15-ko.png') });
    await page.waitForTimeout(2600);
    await page.screenshot({ path: path.join(OUT, '16-results.png') });
    await page.waitForTimeout(300);

    await page.close();
    if (video) {
      const src = await video.path();
      fs.copyFileSync(src, path.join(OUT, 'gameplay.webm'));
    }
  });
});
