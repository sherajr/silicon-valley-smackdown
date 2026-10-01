import { defineConfig } from '@playwright/test';
const portable = process.env.SVS_PORTABLE === '1';
// Software WebGL by default (works anywhere). SVS_GPU=1 selects the discrete GPU through ANGLE/D3D11 for real-hardware runs.
const gpuArgs = ['--use-angle=d3d11', '--force_high_performance_gpu', '--ignore-gpu-blocklist', '--mute-audio'];
export default defineConfig({
  // A CPU rasterizer renders a few frames per second, so software runs get a longer limit than hardware runs.
  testDir: './tests/arena', timeout: process.env.SVS_GPU === '1' ? 45_000 : 120_000, workers: 1, fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5187', viewport: { width: 1280, height: 720 },
    trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env.SVS_CHROMIUM || undefined, args: process.env.SVS_GPU === '1' ? gpuArgs : ['--enable-unsafe-swiftshader', '--mute-audio'] },
  },
  webServer: portable ? undefined : {
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 5187 --strictPort',
    url: 'http://127.0.0.1:5187', timeout: 120_000, reuseExistingServer: false,
  },
});
