import { build } from 'vite';

await build({
  build: {
    ssr: 'server/index.ts',
    outDir: 'dist-server',
    emptyOutDir: true,
    target: 'node22',
    rollupOptions: { external: ['ws'] },
  },
});
