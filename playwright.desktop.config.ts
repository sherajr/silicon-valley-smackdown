import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/desktop',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
});
