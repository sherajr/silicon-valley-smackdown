import { defineConfig } from '@playwright/test';
const portable = process.env.SVS_PORTABLE === '1';
export default defineConfig({
  testDir: './tests/arena', timeout: 45_000, workers: 1, fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5187', viewport: { width: 1280, height: 720 },
    trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env.SVS_CHROMIUM || undefined, args: ['--enable-unsafe-swiftshader', '--mute-audio'] },
  },
  webServer: portable ? undefined : {
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 5187 --strictPort',
    url: 'http://127.0.0.1:5187', timeout: 120_000, reuseExistingServer: false,
  },
});
