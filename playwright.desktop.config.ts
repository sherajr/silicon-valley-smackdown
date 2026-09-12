import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/desktop',
  testMatch: '**/*.spec.ts',
  // The test launches Electron twice (initial run + a relaunch to check persisted settings).
  // Under Rosetta on Apple Silicon CI a single launch alone was observed taking ~50s, on top of
  // the ~15-20s the actual menu/gameplay/relaunch steps take even at native speed.
  timeout: 240_000,
  // Every expect.poll() in the desktop test relies on this rather than its own per-call timeout;
  // the 5s default was very likely why polling for scene state never even got a real chance to
  // succeed under Rosetta, where each page.evaluate() round-trip is itself far slower.
  expect: { timeout: 60_000 },
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
});
