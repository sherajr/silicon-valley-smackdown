import { test, expect } from '@playwright/test';
import { collectErrors } from './helpers';

test('clock pauses, expires, and resets; arcade screens render cleanly', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?e2e=1&skip=fight');
  await page.waitForFunction(() => (window as any).__e2eGame?.scene.isActive('Fight'));
  await page.waitForTimeout(900);
  const before = await page.evaluate(() => {
    const fight = (window as any).__e2eGame.scene.getScene('Fight');
    fight.enterPause();
    return {clock: fight.matchState.sim.clockFrames, text: fight.hud.timerText.text};
  });
  expect(before.clock).toBeGreaterThan(28680);
  expect(['8:00', '7:59', '7:58']).toContain(before.text);
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => (window as any).__e2eGame.scene.getScene('Fight').matchState.sim.clockFrames)).toBe(before.clock);
  await page.screenshot({path:'.scratch/arcade-pause.png'});
  await page.evaluate(() => {
    const fight = (window as any).__e2eGame.scene.getScene('Fight');
    fight.toggleMoveList();
  });
  await page.screenshot({path:'.scratch/arcade-move-data.png'});
  await page.evaluate(() => {
    const fight = (window as any).__e2eGame.scene.getScene('Fight');
    fight.exitPause();
    if (fight.moveListContainer.visible) throw new Error('Move list remained visible after resume');
    fight.matchState.sim.clockFrames = 1;
    fight.matchState.sim.p2.health = 100;
  });
  await page.waitForFunction(() => (window as any).__e2eGame.scene.getScene('Fight').matchState.sim.ended);
  expect(await page.evaluate(() => {
    const fight = (window as any).__e2eGame.scene.getScene('Fight');
    return {text:fight.hud.timerText.text,result:fight.matchState.sim.result};
  })).toEqual({text:'0:00',result:{winner:'p1',reason:'timeout'}});
  await page.waitForFunction(() => !(window as any).__e2eGame.scene.getScene('Fight').matchState.sim.ended);
  expect(await page.evaluate(() => (window as any).__e2eGame.scene.getScene('Fight').matchState.sim.clockFrames)).toBeGreaterThan(28740);
  await page.waitForTimeout(1100);
  await page.screenshot({path:'.scratch/arcade-fight.png'});
  for (const stage of ['sand_hill_road', 'palo_alto']) {
    await page.goto('/?e2e=1&skip=fight&stage=' + stage + '&p1=al&p2=chad');
    await page.waitForFunction(() => (window as any).__e2eGame?.scene.isActive('Fight'));
    await page.waitForTimeout(1400);
    await page.screenshot({path:'.scratch/arcade-' + stage + '.png'});
  }
  await page.goto('/?e2e=1');
  await page.waitForFunction(() => (window as any).__e2eGame?.scene.isActive('Title'));
  await page.screenshot({path:'.scratch/arcade-title.png'});
  await page.mouse.click(240, 135);
  await page.waitForFunction(() => (window as any).__e2eGame?.scene.isActive('MainMenu'));
  await page.screenshot({path:'.scratch/arcade-menu.png'});
  expect(errors.list).toEqual([]);
});
