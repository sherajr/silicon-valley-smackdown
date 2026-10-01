import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { gameplayFingerprint } from '../shared/fingerprint.ts';
import { encodeMessage, neutralWire, normalizeCode, parseClientMessage } from '../shared/onlineProtocol.ts';
import type { ServerMessage, WireInput } from '../shared/onlineProtocol.ts';
import { startOnlineServer } from './index.ts';
import { openConn, RoomHub, type Conn } from './rooms.ts';

const fingerprint = gameplayFingerprint();

function player(hub: RoomHub, ip = '127.0.0.1') {
  const conn = openConn(ip);
  hub.hello(conn, 1, fingerprint);
  const welcome = conn.out.find(message => message.t === 'welcome');
  if (!welcome || welcome.t !== 'welcome') throw new Error('no welcome');
  conn.token = welcome.session;
  conn.out.length = 0;
  return conn;
}

function roomCode(conn: Conn) {
  const view = [...conn.out].reverse().find(message => message.t === 'room');
  if (!view || view.t !== 'room') throw new Error('no room');
  return view.view;
}

function messages<T extends ServerMessage['t']>(conn: Conn, type: T) {
  return conn.out.filter((message): message is Extract<ServerMessage, { t: T }> => message.t === type);
}

describe('room protocol', () => {
  it('normalizes codes and rejects malformed messages', () => {
    expect(normalizeCode(' abcd-ef23 ')).toBe('ABCDEF23');
    expect(normalizeCode('ABCD-EF2O')).toBeNull();
    expect(parseClientMessage({ t: 'inputs', matchId: 'x', epoch: 1, frames: [{ n: 1, i: { x: 2, u: false, d: false, j: false, a: false, s: false, h: false, g: false } }] })).toBeNull();
    expect(parseClientMessage({ t: 'join', code: 'nope' })).toBeNull();
    expect(parseClientMessage({ t: 'create' })).toEqual({ t: 'create' });
  });

  it('creates, joins, isolates rooms, and rejects a third player, a bad code, and a version mismatch', () => {
    const hub = new RoomHub();
    const host = player(hub);
    hub.handle(host, { t: 'create' });
    const code = roomCode(host).code;
    const guest = player(hub, '10.0.0.2');
    hub.handle(guest, { t: 'join', code: ` ${code.slice(0, 4)}-${code.slice(4).toLowerCase()} ` });
    expect(roomCode(guest).slot).toBe(1);
    expect(roomCode(host).occupied).toEqual([true, true]);

    const otherHost = player(hub, '10.0.0.3');
    hub.handle(otherHost, { t: 'create' });
    const otherCode = roomCode(otherHost).code;
    expect(otherCode).not.toBe(code);

    const third = player(hub, '10.0.0.4');
    hub.handle(third, { t: 'join', code });
    expect(messages(third, 'error').at(-1)?.code).toBe('room-full');
    expect(roomCode(host).code).toBe(code);

    const stranger = player(hub, '10.0.0.5');
    hub.handle(stranger, { t: 'join', code: 'ZZZZZZZZ' });
    expect(messages(stranger, 'error').at(-1)?.code).toBe('not-found');

    const old = openConn('10.0.0.6');
    hub.hello(old, 99, fingerprint);
    expect(messages(old, 'error').at(-1)?.code).toBe('incompatible');
    const drifted = player(hub, '10.0.0.7');
    drifted.fingerprint = 'different-fingerprint-value';
    hub.handle(drifted, { t: 'join', code });
    expect(messages(drifted, 'error').at(-1)?.code).toBe('incompatible');
    expect(hub.roomCount).toBe(2);
  });

  it('lets only the host change the stage, resets ready on every change, and ignores a stale revision', () => {
    const hub = new RoomHub();
    const host = player(hub);
    const guest = player(hub, '10.0.0.8');
    hub.handle(host, { t: 'create' });
    const code = roomCode(host).code;
    hub.handle(guest, { t: 'join', code });
    hub.handle(guest, { t: 'config', rev: 1, stage: 1 });
    expect(messages(guest, 'error').at(-1)?.code).toBe('forbidden');
    hub.handle(guest, { t: 'config', rev: 1, fighter: 3 });
    expect(roomCode(host).fighters[1]).toBe(3);
    expect(roomCode(host).ready).toEqual([false, false]);
    expect(roomCode(host).rev).toBe(2);
    hub.handle(host, { t: 'config', rev: 2, stage: 2, items: true, fighter: 4 });
    const view = roomCode(host);
    expect(view.stage).toBe(2);
    expect(view.items).toBe(true);
    expect(view.fighters[0]).toBe(4);
    expect(view.rev).toBe(3);
    hub.handle(host, { t: 'ready', rev: 2, ready: true });
    expect(messages(host, 'error').at(-1)?.code).toBe('stale-rev');
    expect(roomCode(host).ready[0]).toBe(false);
  });

  it('starts only after both clients load, agrees the result, rematches, and rejects old packets', () => {
    const hub = new RoomHub();
    const host = player(hub);
    const guest = player(hub, '10.0.0.9');
    hub.handle(host, { t: 'create' });
    hub.handle(guest, { t: 'join', code: roomCode(host).code });
    hub.handle(host, { t: 'ready', rev: roomCode(host).rev, ready: true });
    expect(messages(host, 'prepare')).toHaveLength(0);
    hub.handle(guest, { t: 'ready', rev: roomCode(guest).rev, ready: true });
    const prepared = messages(host, 'prepare').at(-1);
    expect(prepared?.match.mode).toBe('versus');
    expect(prepared?.match.fighters).toEqual([0, 1]);
    hub.handle(host, { t: 'loaded', matchId: prepared!.match.matchId });
    expect(messages(host, 'start')).toHaveLength(0);
    hub.handle(guest, { t: 'loaded', matchId: prepared!.match.matchId });
    expect(messages(host, 'start')).toHaveLength(1);
    expect(messages(guest, 'start')).toHaveLength(1);
    const epoch = prepared!.match.epoch;
    const input = (n: number, attack = false): { n: number; i: WireInput } => ({ n, i: { ...neutralWire(), a: attack } });
    hub.handle(host, { t: 'inputs', matchId: prepared!.match.matchId, epoch, frames: [input(0), input(1, true)] });
    const echoed = messages(guest, 'inputs').at(-1);
    expect(echoed?.slot).toBe(0);
    expect(echoed?.ack).toBe(2);
    hub.handle(host, { t: 'inputs', matchId: prepared!.match.matchId, epoch, frames: [input(1, false)] });
    expect(messages(host, 'error').at(-1)?.code).toBe('conflict');
    hub.handle(host, { t: 'inputs', matchId: prepared!.match.matchId, epoch: epoch - 1, frames: [input(2)] });
    expect(messages(host, 'error').at(-1)?.code).toBe('wrong-state');
    expect(messages(guest, 'inputs').at(-1)?.frames.some(frame => frame.n === 2)).toBe(false);

    hub.handle(host, { t: 'hash', matchId: prepared!.match.matchId, epoch, frame: 2, hash: 'abc' });
    hub.handle(guest, { t: 'hash', matchId: prepared!.match.matchId, epoch, frame: 2, hash: 'abc' });
    hub.handle(host, { t: 'result', matchId: prepared!.match.matchId, epoch, frame: 2, winner: 0, hash: 'abc' });
    expect(messages(host, 'result')).toHaveLength(0);
    hub.handle(guest, { t: 'result', matchId: prepared!.match.matchId, epoch, frame: 2, winner: 0, hash: 'abc' });
    expect(messages(host, 'result').at(-1)?.reason).toBe('agreed');
    hub.handle(host, { t: 'rematch' });
    expect(messages(host, 'prepare').length).toBe(1);
    hub.handle(guest, { t: 'rematch' });
    const again = messages(host, 'prepare').at(-1);
    expect(again?.match.matchId).not.toBe(prepared!.match.matchId);
    expect(again?.match.epoch).toBeGreaterThan(epoch);
    hub.handle(host, { t: 'inputs', matchId: prepared!.match.matchId, epoch, frames: [input(3)] });
    expect(messages(host, 'error').at(-1)?.code).toBe('wrong-state');
  });

  it('interrupts on disconnect, restores only the same session token, and expires the lobby', () => {
    const hub = new RoomHub();
    let now = 1_000;
    hub.now = () => now;
    const host = player(hub);
    const guest = player(hub, '10.0.0.10');
    hub.handle(host, { t: 'create' });
    const code = roomCode(host).code;
    const token = guest.token;
    hub.handle(guest, { t: 'join', code });
    hub.handle(host, { t: 'ready', rev: 1, ready: true });
    hub.handle(guest, { t: 'ready', rev: 1, ready: true });
    const match = messages(host, 'prepare').at(-1)!.match;
    hub.handle(host, { t: 'loaded', matchId: match.matchId });
    hub.handle(guest, { t: 'loaded', matchId: match.matchId });
    hub.disconnect(guest);
    expect(messages(host, 'abort').at(-1)?.reason).toBe('disconnect');
    const intruder = player(hub, '10.0.0.11');
    hub.handle(intruder, { t: 'join', code });
    expect(messages(intruder, 'error').at(-1)?.code).toBe('room-full');
    expect(token).toBe(guest.token);
    const returning = openConn('10.0.0.10');
    hub.hello(returning, 1, fingerprint, guest.token);
    expect(messages(returning, 'room').at(-1)?.view.status).toBe('lobby');
    expect(messages(host, 'room').at(-1)?.view.connected[1]).toBe(true);
    now += hub.graceMs + 5;
    hub.disconnect(returning);
    hub.sweep(now);
    expect(roomCode(host).occupied[1]).toBe(false);
    now += hub.lobbyTtlMs + 5;
    hub.sweep(now);
    expect(hub.roomCount).toBe(0);
  });

  it('never rate limits a client playing at full speed, and relays every one of its inputs', () => {
    const hub = new RoomHub();
    let clock = 1_000_000; hub.now = () => clock;
    const host = player(hub), guest = player(hub, '10.0.0.9');
    hub.handle(host, { t: 'create' });
    hub.handle(guest, { t: 'join', code: roomCode(host).code });
    hub.handle(host, { t: 'ready', rev: roomCode(host).rev, ready: true });
    hub.handle(guest, { t: 'ready', rev: roomCode(guest).rev, ready: true });
    const match = messages(host, 'prepare').at(-1)!.match;
    hub.handle(host, { t: 'loaded', matchId: match.matchId }); hub.handle(guest, { t: 'loaded', matchId: match.matchId });
    // Ten seconds of the busiest honest client: an input batch AND a checksum on every 60 Hz frame (the real client sends
    // a checksum only every HASH_INTERVAL frames), plus a heartbeat. The old limit of 80 messages a second dropped input
    // batches from exactly this traffic; a dropped batch is never resent, so the match stalled.
    for (let n = 0; n < 600; n++) {
      clock += 1000 / 60;
      for (const conn of [host, guest]) {
        hub.handle(conn, { t: 'inputs', matchId: match.matchId, epoch: match.epoch, frames: [{ n, i: neutralWire() }] });
        hub.handle(conn, { t: 'hash', matchId: match.matchId, epoch: match.epoch, frame: n, hash: 'same' });
        if (n % 300 === 0) hub.handle(conn, { t: 'ping', id: n, clientTime: clock });
      }
    }
    expect(messages(host, 'error')).toEqual([]); expect(messages(guest, 'error')).toEqual([]);
    const relayed = new Set(messages(guest, 'inputs').filter(m => m.slot === 0).flatMap(m => m.frames.map(f => f.n)));
    expect(relayed.size).toBe(600);
    expect(messages(guest, 'inputs').at(-1)?.ack).toBe(600);
    // A flood is still refused.
    for (let i = 0; i < 400; i++) hub.handle(host, { t: 'ping', id: i, clientTime: clock });
    expect(messages(host, 'error').some(e => e.code === 'rate')).toBe(true);
  });

  it('keeps nothing in memory for a connection that delivers to a socket', () => {
    const hub = new RoomHub();
    const conn = openConn(); const seen: ServerMessage[] = []; conn.deliver = m => { seen.push(m); };
    hub.hello(conn, 1, fingerprint); hub.handle(conn, { t: 'create' });
    for (let i = 0; i < 50; i++) hub.handle(conn, { t: 'ping', id: i, clientTime: 0 });
    expect(seen.length).toBeGreaterThan(50); expect(conn.out).toEqual([]);
  });

  it('rate limits creates and oversized payloads without dropping another room', () => {
    const hub = new RoomHub();
    const keeper = player(hub, '10.1.0.1');
    hub.handle(keeper, { t: 'create' });
    const code = roomCode(keeper).code;
    const noisy = player(hub, '10.1.0.2');
    for (let i = 0; i < 9; i++) hub.handle(noisy, { t: 'create' });
    expect(messages(noisy, 'error').some(error => error.code === 'rate')).toBe(true);
    hub.handleRaw(noisy, 'x'.repeat(9000));
    expect(messages(noisy, 'error').some(error => error.code === 'oversized')).toBe(true);
    const checker = player(hub, '10.1.0.3');
    hub.handle(checker, { t: 'join', code });
    expect(roomCode(checker).code).toBe(code);
  });
});

describe('websocket server', () => {
  const closers: (() => Promise<void>)[] = [];
  afterEach(async () => { while (closers.length) await closers.pop()!(); });

  it('answers a malformed address with 400 instead of crashing, and never serves a file outside the game folder', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'svs-static-'));
    fs.mkdirSync(path.join(root, 'dist')); fs.mkdirSync(path.join(root, 'dist-server'));
    fs.writeFileSync(path.join(root, 'dist', 'index.html'), '<!doctype html><title>game</title>');
    fs.writeFileSync(path.join(root, 'dist-server', 'secret.js'), 'SECRET');
    const server = await startOnlineServer({ host: '127.0.0.1', port: 0, staticDir: path.join(root, 'dist'), allowedOrigins: [] });
    closers.push(async () => { await server.close(); fs.rmSync(root, { recursive: true, force: true }); });
    expect((await fetch(`${server.url}/%E0%A4%A`)).status).toBe(400);
    expect((await fetch(`${server.url}/health`)).status).toBe(200);              // still up
    for (const probe of ['/..%2fdist-server%2fsecret.js', '/..%5cdist-server%5csecret.js', '/%2e%2e/dist-server/secret.js']) {
      const res = await fetch(`${server.url}${probe}`);
      expect(await res.text(), probe).not.toContain('SECRET');
    }
    expect(await (await fetch(`${server.url}/`)).text()).toContain('game');
  });

  it('completes a real socket handshake and serves health without room codes', async () => {
    const server = await startOnlineServer({ host: '127.0.0.1', port: 0, staticDir: null, allowedOrigins: ['http://127.0.0.1'] });
    closers.push(server.close);
    const health = await fetch(`${server.url}/health`);
    expect(await health.json()).toEqual({ ok: true, rooms: 0 });
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, { origin: 'http://127.0.0.1' });
    const welcome = await new Promise<ServerMessage>((resolve, reject) => {
      ws.on('message', data => { const parsed = JSON.parse(String(data)) as ServerMessage; if (parsed.t === 'welcome') resolve(parsed); });
      ws.on('error', reject);
      ws.on('open', () => ws.send(encodeMessage({ t: 'hello', protocol: 1, fingerprint })));
    });
    expect(welcome.t).toBe('welcome');
    expect(JSON.stringify(welcome)).not.toContain('code');
    ws.close();
  });
});
