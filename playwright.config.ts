import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // 30s was marginal once the roster reached seven: several tests drive a full page load per
  // fighter against a bundle that also carries the 3.6MB soundtrack, and the ones that wait on
  // `networkidle` were timing out on a busy machine -- a different test each run, never an
  // assertion failure. The headroom is for load, not for slow assertions.
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  webServer: {
    command: 'npm run build && npm run preview -- --port 5183 --strictPort',
    url: 'http://localhost:5183',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  use: {
    baseURL: 'http://localhost:5183',
    viewport: { width: 480, height: 270 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
