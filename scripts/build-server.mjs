import { build } from 'vite';

await build({
  // The server serves dist/; copying public/ (models, sprites) into dist-server/ would only duplicate it.
  publicDir: false,
  build: {
    ssr: 'server/index.ts',
    outDir: 'dist-server',
    emptyOutDir: true,
    target: 'node22',
    rollupOptions: { external: ['ws'] },
  },
});
