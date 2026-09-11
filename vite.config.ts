import { defineConfig } from 'vite';

// Base path is overridable via VITE_BASE for GitHub Pages style deployments
// (e.g. VITE_BASE=/silicon-valley-smackdown/ npm run build). Defaults to './'
// so the build works when served from any subpath without configuration.
export default defineConfig({
  base: process.env.VITE_BASE ?? './',
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
