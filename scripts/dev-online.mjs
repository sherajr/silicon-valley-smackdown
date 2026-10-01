import { createServer } from 'vite';

const port = Number(process.env.SVS_DEV_PORT || 5173);
const vite = await createServer({ server: { host: '127.0.0.1', port, strictPort: true } });
await vite.listen();
const loaded = await vite.ssrLoadModule('/server/index.ts');
const online = await loaded.startOnlineServer({ port: 8787, host: '127.0.0.1', staticDir: null });
const address = vite.resolvedUrls?.local?.[0] ?? `http://127.0.0.1:${port}/`;
console.log(`Arena dev ${address}`);
console.log(`Online relay ${online.url}`);
let shutting = false;
const shutdown = async () => {
  if (shutting) return;
  shutting = true;
  await online.close();
  await vite.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
