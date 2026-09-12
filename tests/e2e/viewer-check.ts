import { test } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const OUT = path.resolve(process.cwd(), 'docs/handoffs/evidence');
fs.mkdirSync(OUT, { recursive: true });

test('animation viewer loads and responds to controls', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?animviewer=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'viewer-01-idle.png') });

  await page.keyboard.press('ArrowDown'); // walk
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(OUT, 'viewer-02-walk.png') });

  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown'); // -> jump
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(OUT, 'viewer-03-jump-frame0.png') });
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(80);
  await page.screenshot({ path: path.join(OUT, 'viewer-04-jump-frame1.png') });

  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowDown'); // -> basic1 move
  await page.waitForTimeout(100);
  await page.keyboard.press('F'); // flip facing
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(OUT, 'viewer-05-move-flipped.png') });

  await page.keyboard.press('E'); // next character
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, 'viewer-06-next-character.png') });

  await page.keyboard.press('H'); // toggle overlay off
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(OUT, 'viewer-07-overlay-off.png') });

  if (errors.length) throw new Error('Console errors: ' + errors.join(' | '));
});
