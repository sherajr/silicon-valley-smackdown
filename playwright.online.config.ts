import { defineConfig } from '@playwright/test';

const gpu = process.env.SVS_GPU === '1';
const gpuArgs = ['--use-angle=d3d11', '--force_high_performance_gpu', '--ignore-gpu-blocklist', '--mute-audio'];
export default defineConfig({
  testDir: './tests/online',
  timeout: gpu ? 60_000 : 180_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  expect: { timeout: 20_000 },
  use: {
    baseURL: 'http://127.0.0.1:5191',
    viewport: { width: 1280, height: 720 },
    trace: 'retain-on-failure',
    launchOptions: { args: gpu ? gpuArgs : ['--enable-unsafe-swiftshader', '--mute-audio'] },
  },
  webServer: {
    command: 'npm run dev:online',
    url: 'http://127.0.0.1:5191',
    timeout: 120_000,
    reuseExistingServer: false,
    env: { SVS_DEV_PORT: '5191' },
  },
});
