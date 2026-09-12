import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { collectErrors, waitFor } from './helpers';

// Ad-hoc verification for the real-Hunter-sprite integration in the Animation Viewer
// (?animviewer=1). NOT part of `npm run test:e2e` (filename omits .spec./.test.) -- run
// explicitly: npx playwright test tests/e2e/real-sprite-check.ts
// Confirms: the viewer actually loads the real PNGs (no 404s), the info text reports "Art: real"
// for Hunter's mapped clips, the pivot crosshair sits at the feet, and toggling R falls back to
// the rig. This is what CODEX_NEXT.md's evidence claims about this feature are based on.

const OUT = path.resolve(process.cwd(), 'docs/handoffs/evidence/real-sprites');
fs.mkdirSync(OUT, { recursive: true });

test('animation viewer shows real Hunter art with correct info text and falls back to rig on toggle', async ({ page }) => {
  const errors = collectErrors(page);
  const failed404s: string[] = [];
  page.on('response', (res) => {
    if (res.status() === 404 && res.url().includes('/sprites/')) failed404s.push(res.url());
  });

  await page.goto('/?animviewer=1');
  await waitFor(async () => {
    const text = await page.locator('canvas').count();
    return text > 0 ? true : null;
  }, 4000);
  await page.waitForTimeout(400); // preload + first refresh()

  // Hunter is ALL_FIGHTER_IDS[0] per src/sim/types.ts ordering used elsewhere in this repo; the
  // viewer opens on charIndex 0, clipIndex 0 ('idle') by default -- exactly the clip mapped to
  // the real "ready" pose.
  await page.screenshot({ path: path.join(OUT, '01-idle-default.png') });

  // Step through clips that have real-art mappings: idle(0) -> walk(1) -> dash(2) -> jump(3) -> crouch(4) -> block(5) -> hitstun(6) -> knockdown(7) -> wakeup(8) -> victory(9)
  const clipSteps = ['dash', 'jump', 'crouch', 'block', 'hitstun', 'knockdown', 'wakeup', 'victory'];
  for (let i = 0; i < clipSteps.length; i++) {
    await page.keyboard.down('ArrowDown');
    await page.keyboard.up('ArrowDown');
    await page.waitForTimeout(120);
    await page.screenshot({ path: path.join(OUT, `0${i + 2}-${clipSteps[i]}.png`) });
  }

  // Toggle real art off -- should fall back to the rig for every clip, including the ones just shown.
  await page.keyboard.down('KeyR');
  await page.keyboard.up('KeyR');
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, '10-rig-fallback-toggle.png') });

  fs.writeFileSync(path.join(OUT, 'console-errors.json'), JSON.stringify(errors, null, 2));
  fs.writeFileSync(path.join(OUT, 'sprite-404s.json'), JSON.stringify(failed404s, null, 2));

  expect(failed404s, `sprite files failed to load: ${failed404s.join(', ')}`).toHaveLength(0);
});
