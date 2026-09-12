import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/desktop',
  testMatch: '**/*.spec.ts',
  // The test launches Electron twice (initial run + a relaunch to check persisted settings).
  // Under Rosetta on Apple Silicon CI a single launch alone was observed taking ~50s, on top of
  // the ~15-20s the actual menu/gameplay/relaunch steps take even at native speed.
  timeout: 240_000,
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
});
