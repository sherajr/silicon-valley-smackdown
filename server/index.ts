/**
 * One-process room server. It serves the built game and the WebSocket relay on the same port
 * so a deployed match stays on one origin. Development can disable static files and let Vite proxy /ws.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { RoomHub, openConn, type Conn } from './rooms.ts';
import { HEARTBEAT_MS, MAX_MESSAGE_BYTES } from '../shared/onlineProtocol.ts';

export interface ServerOptions {
  port?: number;
  host?: string;
  /** Directory of the built client. Null serves only /health and /ws. */
  staticDir?: string | null;
  basePath?: string;
  allowedOrigins?: string[];
  hub?: RoomHub;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.webm': 'video/webm', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2', '.map': 'application/json',
};

export async function startOnlineServer(options: ServerOptions = {}) {
  const host = options.host ?? process.env.HOST ?? '0.0.0.0';
  const port = options.port ?? Number(process.env.PORT ?? 8787);
  const base = normalizeBase(options.basePath ?? process.env.BASE_PATH ?? '');
  const staticDir = options.staticDir === undefined ? path.resolve(process.cwd(), 'dist') : options.staticDir;
  const allowed = options.allowedOrigins ?? (process.env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const hub = options.hub ?? new RoomHub();
  const grace = Number(process.env.REJOIN_GRACE_MS);
  const ttl = Number(process.env.ROOM_TTL_MS);
  if (Number.isFinite(grace) && grace >= 1000) hub.graceMs = grace;
  if (Number.isFinite(ttl) && ttl >= 1000) hub.lobbyTtlMs = ttl;
  const sockets = new Set<WebSocket>();

  const http = createServer((req, res) => {
    try { handleHttp(req, res); }
    catch (error) {
      console.error('request failed', error instanceof Error ? error.message : 'error');
      if (!res.headersSent) sendText(res, 500, 'Server error'); else res.destroy();
    }
  });
  const handleHttp = (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method === 'GET' && (url.pathname === `${base}/health` || url.pathname === '/health')) {
      const body = JSON.stringify({ ok: true, rooms: hub.roomCount });
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(body);
      return;
    }
    if (!staticDir || req.method !== 'GET' && req.method !== 'HEAD') { sendText(res, 404, 'Not found'); return; }
    serveStatic(res, staticDir, base, url.pathname, req.method === 'HEAD');
  };

  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: MAX_MESSAGE_BYTES });
  http.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const okPath = url.pathname === `${base}/ws` || url.pathname === '/ws';
    if (!okPath || !originAllowed(req, allowed)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, ws => { wss.emit('connection', ws, req); });
  });

  // A connection that dies without a close (Wi-Fi drop, sleeping laptop) still looks connected, and the room would refuse
  // that player's resume. Ping every socket; one that has not answered the previous ping is closed as a disconnect.
  const alive = new WeakMap<WebSocket, boolean>();
  const heartbeat = setInterval(() => {
    for (const ws of sockets) {
      if (alive.get(ws) === false) { ws.terminate(); continue; }
      alive.set(ws, false);
      try { ws.ping(); } catch { /* closing */ }
    }
  }, HEARTBEAT_MS * 2);
  heartbeat.unref?.();

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    sockets.add(ws);
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
    const conn = openConn(clientIp(req));
    conn.deliver = message => {
      if (ws.readyState !== ws.OPEN) return;
      if (ws.bufferedAmount > 1_000_000) { ws.close(1011, 'backpressure'); return; }
      ws.send(JSON.stringify(message));
    };
    ws.on('message', data => {
      const raw = typeof data === 'string' ? data : Buffer.from(data as Buffer).toString('utf8');
      try { hub.handleRaw(conn, raw); }
      catch (error) { console.error('room handler failed', error instanceof Error ? error.message : 'error'); }
    });
    const gone = () => { sockets.delete(ws); if (conn.connected) hub.disconnect(conn); };
    ws.on('close', gone);
    ws.on('error', gone);
  });

  const timer = setInterval(() => hub.sweep(), 1000);
  timer.unref?.();
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(port, host, () => resolve());
  });
  const address = http.address();
  const bound = typeof address === 'object' && address ? address.port : port;
  return {
    port: bound,
    url: `http://127.0.0.1:${bound}${base || ''}`,
    hub,
    close: async () => {
      clearInterval(timer);
      clearInterval(heartbeat);
      for (const ws of sockets) ws.close();
      wss.close();
      await new Promise<void>(resolve => http.close(() => resolve()));
    },
  };
}

function normalizeBase(base: string): string {
  if (!base || base === '/') return '';
  const withSlash = base.startsWith('/') ? base : `/${base}`;
  return withSlash.endsWith('/') ? withSlash.slice(0, -1) : withSlash;
}

function originAllowed(req: IncomingMessage, allowed: string[]): boolean {
  const origin = req.headers.origin;
  if (!origin) return process.env.SVS_ALLOW_NO_ORIGIN === '1';
  if (allowed.includes(origin)) return true;
  try {
    const host = req.headers.host;
    const url = new URL(origin);
    if (host && url.host === host) return true;
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return true;
  } catch { /* not a URL */ }
  return false;
}

function clientIp(req: IncomingMessage): string {
  if (process.env.TRUST_PROXY === '1') {
    const forwarded = req.headers['x-forwarded-for'];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? '0.0.0.0';
}

function serveStatic(res: ServerResponse, root: string, base: string, pathname: string, head: boolean) {
  let rel = pathname;
  if (base && rel.startsWith(base)) rel = rel.slice(base.length);
  if (!rel.startsWith('/')) rel = `/${rel}`;
  // A malformed escape (`/%E0%A4%A`) makes decodeURIComponent throw; uncaught, that would end every room on the server.
  let decoded: string;
  try { decoded = decodeURIComponent(rel); } catch { sendText(res, 400, 'Bad request'); return; }
  const top = path.resolve(root), file = path.resolve(top, `.${decoded}`);
  // Compare against the root plus a separator: a bare prefix test would let `/..%2fdist-server/...` reach a sibling folder.
  if (file !== top && !file.startsWith(top + path.sep)) { sendText(res, 403, 'Forbidden'); return; }
  let target = file;
  if (!existsSync(target) || !statSync(target).isFile()) {
    const fallback = path.join(root, 'index.html');
    if (!existsSync(fallback)) { sendText(res, 404, 'Not found'); return; }
    target = fallback;
  }
  const ext = path.extname(target).toLowerCase();
  res.writeHead(200, { 'content-type': TYPES[ext] ?? 'application/octet-stream', 'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=3600' });
  if (head) { res.end(); return; }
  createReadStream(target).on('error', () => res.destroy()).pipe(res);
}

function sendText(res: ServerResponse, status: number, body: string) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(body);
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
const self = fileURLToPath(import.meta.url);
if (entry && path.resolve(entry) === self) {
  startOnlineServer().then(server => {
    console.log(`Online server listening on ${server.url}`);
  }).catch(error => {
    console.error(error);
    process.exit(1);
  });
}

export type { Conn };
