/**
 * In-memory private rooms. One process owns every room. Restarting the process
 * drops every match. A second replica would need shared routing, which this MVP does not have.
 */
import { randomBytes } from 'node:crypto';
import { FIGHTERS } from '../src/arena/fighterDefinitions.ts';
import { STAGE_PLATFORMS } from '../src/arena/data.ts';
import { gameplayFingerprint } from '../shared/fingerprint.ts';
import {
  CODE_ALPHABET, CODE_LENGTH, ERROR_TEXT, INPUT_DELAY, LOBBY_TTL_MS, MAX_FRAME, MAX_MESSAGE_BYTES,
  PREDICTION_LIMIT, PROTOCOL_VERSION, REJOIN_GRACE_MS, decodeMessage, normalizeCode, sameWire,
} from '../shared/onlineProtocol.ts';
import type {
  ClientMessage, ErrorCode, InputFrame, MatchDescriptor, RoomStatus, RoomView, ServerMessage, WireInput,
} from '../shared/onlineProtocol.ts';

const MAX_ROOMS = 200;
const CREATE_LIMIT = 8;
const JOIN_LIMIT = 20;
/**
 * Messages per connection per second. A playing client sends one input batch per rendered frame that has new input
 * (at most about 60 a second), a checksum every HASH_INTERVAL frames and a heartbeat ping, so 150 leaves wide headroom.
 * An input batch over the limit is dropped and never resent, which stalls the match, so this must stay above that.
 */
const MESSAGE_LIMIT = 150;
const FUTURE_SLACK = PREDICTION_LIMIT + INPUT_DELAY + 60;

export interface Conn {
  id: string;
  token: string;
  fingerprint: string;
  protocol: number;
  ip: string;
  connected: boolean;
  roomCode: string | null;
  slot: 0 | 1 | null;
  lastSeen: number;
  msgCount: number;
  msgReset: number;
  welcomed: boolean;
  /** Messages for a connection with no socket attached (unit tests). A live connection delivers instead and keeps nothing. */
  out: ServerMessage[];
  deliver?: (message: ServerMessage) => void;
}

interface Rate { n: number; reset: number }

interface Seat {
  conn: Conn | null;
  fighter: number;
  ready: boolean;
  loaded: boolean;
  disconnectAt: number | null;
  result: { frame: number; winner: -1 | 0 | 1; hash: string } | null;
  rematch: boolean;
  inputs: Map<number, WireInput>;
  /** Frames 0..next-1 are all present in `inputs`. Advanced as inputs arrive, never rescanned from frame 0. */
  next: number;
  hashes: Map<number, string>;
}

interface Room {
  code: string;
  fingerprint: string;
  created: number;
  activity: number;
  rev: number;
  stage: number;
  items: boolean;
  status: RoomStatus;
  epoch: number;
  match: MatchDescriptor | null;
  seats: [Seat, Seat];
}

export class RoomHub {
  private rooms = new Map<string, Room>();
  private tokens = new Map<string, { conn: Conn; code: string; slot: 0 | 1 }>();
  private creates = new Map<string, Rate>();
  private joins = new Map<string, Rate>();
  now: () => number = () => Date.now();
  readonly fingerprint = gameplayFingerprint();
  graceMs = REJOIN_GRACE_MS;
  lobbyTtlMs = LOBBY_TTL_MS;

  hello(conn: Conn, protocol: number, fingerprint: string, resume?: string) {
    conn.lastSeen = this.now();
    if (protocol !== PROTOCOL_VERSION || !fingerprint) {
      this.fail(conn, 'incompatible');
      return;
    }
    if (resume) {
      this.resume(conn, resume, fingerprint);
      return;
    }
    if (conn.welcomed) { this.fail(conn, 'wrong-state'); return; }
    conn.protocol = protocol;
    conn.fingerprint = fingerprint;
    conn.token = randomBytes(24).toString('hex');
    conn.welcomed = true;
    this.send(conn, { t: 'welcome', protocol: PROTOCOL_VERSION, session: conn.token });
  }

  handle(conn: Conn, message: ClientMessage) {
    conn.lastSeen = this.now();
    if (!this.allowMessage(conn)) { this.fail(conn, 'rate'); return; }
    if (!conn.welcomed && message.t !== 'hello') { this.fail(conn, 'wrong-state'); return; }
    switch (message.t) {
      case 'hello': this.hello(conn, message.protocol, message.fingerprint, message.resume); break;
      case 'create': this.create(conn); break;
      case 'join': this.join(conn, message.code); break;
      case 'config': this.configure(conn, message); break;
      case 'ready': this.ready(conn, message.rev, message.ready); break;
      case 'loaded': this.loaded(conn, message.matchId); break;
      case 'inputs': this.inputs(conn, message.matchId, message.epoch, message.frames); break;
      case 'hash': this.hash(conn, message.matchId, message.epoch, message.frame, message.hash); break;
      case 'result': this.result(conn, message.matchId, message.epoch, message.frame, message.winner, message.hash); break;
      case 'rematch': this.rematch(conn); break;
      case 'lobby': this.backToLobby(conn); break;
      case 'forfeit': this.forfeit(conn, message.matchId, message.epoch); break;
      case 'leave': this.leave(conn); break;
      case 'ping': this.send(conn, { t: 'pong', id: message.id, clientTime: message.clientTime, serverTime: this.now() }); break;
      default: break;
    }
  }

  handleRaw(conn: Conn, raw: string) {
    if (raw.length > MAX_MESSAGE_BYTES) { this.fail(conn, 'oversized'); return; }
    const message = decodeMessage(raw, 'client');
    if (!message) { this.fail(conn, 'bad-message'); return; }
    this.handle(conn, message);
  }

  disconnect(conn: Conn) {
    conn.connected = false;
    conn.lastSeen = this.now();
    const room = this.roomOf(conn);
    if (!room || conn.slot === null) return;
    const seat = room.seats[conn.slot];
    if (room.status === 'lobby') {
      this.dropSeat(room, conn.slot, 'The other player left the room.');
      return;
    }
    seat.disconnectAt = this.now();
    seat.conn = conn;
    if (room.status === 'playing' || room.status === 'preparing') this.interrupt(room, 'disconnect');
    this.touch(room);
    this.broadcast(room);
  }

  sweep(now = this.now()) {
    for (const room of [...this.rooms.values()]) {
      for (const slot of [0, 1] as const) {
        const seat = room.seats[slot];
        if (seat.disconnectAt !== null && now - seat.disconnectAt >= this.graceMs) this.dropSeat(room, slot, 'The other player left the room.');
      }
      if (this.rooms.has(room.code) && room.status === 'lobby' && now - room.activity >= this.lobbyTtlMs) this.closeRoom(room, 'expired');
    }
    // One entry per address that ever created or joined; forget the ones whose window has passed.
    for (const map of [this.creates, this.joins]) for (const [ip, rate] of map) if (now >= rate.reset) map.delete(ip);
  }

  get roomCount() { return this.rooms.size; }

  private create(conn: Conn) {
    if (!this.bump(this.creates, conn.ip, CREATE_LIMIT, 60_000)) { this.fail(conn, 'rate'); return; }
    if (conn.roomCode) { this.fail(conn, 'wrong-state'); return; }
    if (this.rooms.size >= MAX_ROOMS) { this.fail(conn, 'unavailable'); return; }
    let code = '';
    for (let i = 0; i < 8 && (!code || this.rooms.has(code)); i++) code = newCode();
    if (this.rooms.has(code)) { this.fail(conn, 'unavailable'); return; }
    const room = this.blankRoom(code, conn.fingerprint);
    this.rooms.set(code, room);
    this.seat(room, conn, 0);
    this.broadcast(room);
  }

  private join(conn: Conn, code: string) {
    const normalized = normalizeCode(code);
    if (!normalized) { this.fail(conn, 'not-found'); return; }
    if (conn.roomCode) { this.fail(conn, 'wrong-state'); return; }
    if (!this.bump(this.joins, conn.ip, JOIN_LIMIT, 60_000)) { this.fail(conn, 'rate'); return; }
    const room = this.rooms.get(normalized);
    if (!room) { this.fail(conn, 'not-found'); return; }
    if (room.fingerprint !== conn.fingerprint) { this.fail(conn, 'incompatible'); return; }
    if (room.seats[1].conn && room.seats[1].conn.connected) { this.fail(conn, 'room-full'); return; }
    if (room.seats[1].conn && !room.seats[1].conn.connected) { this.fail(conn, 'room-full'); return; }
    if (room.status !== 'lobby') { this.fail(conn, 'wrong-state'); return; }
    this.seat(room, conn, 1);
    this.broadcast(room);
  }

  private configure(conn: Conn, message: Extract<ClientMessage, { t: 'config' }>) {
    const room = this.requireRoom(conn);
    if (!room || conn.slot === null) return;
    if (room.status !== 'lobby') { this.fail(conn, 'wrong-state'); return; }
    if (message.rev !== room.rev) { this.fail(conn, 'stale-rev'); return; }
    if ((message.stage !== undefined || message.items !== undefined) && conn.slot !== 0) { this.fail(conn, 'forbidden'); return; }
    if (message.fighter !== undefined && message.fighter >= FIGHTERS.length) { this.fail(conn, 'bad-message'); return; }
    if (message.stage !== undefined && message.stage >= STAGE_PLATFORMS.length) { this.fail(conn, 'bad-message'); return; }
    let changed = false;
    if (message.fighter !== undefined && room.seats[conn.slot].fighter !== message.fighter) { room.seats[conn.slot].fighter = message.fighter; changed = true; }
    if (message.stage !== undefined && room.stage !== message.stage) { room.stage = message.stage; changed = true; }
    if (message.items !== undefined && room.items !== message.items) { room.items = message.items; changed = true; }
    if (!changed) { this.send(conn, { t: 'room', view: this.view(room, conn.slot) }); return; }
    room.rev++;
    room.seats[0].ready = false;
    room.seats[1].ready = false;
    this.touch(room);
    this.broadcast(room);
  }

  private ready(conn: Conn, rev: number, ready: boolean) {
    const room = this.requireRoom(conn);
    if (!room || conn.slot === null) return;
    if (room.status !== 'lobby') { this.fail(conn, 'wrong-state'); return; }
    if (rev !== room.rev) { this.fail(conn, 'stale-rev'); return; }
    if (!room.seats[0].conn || !room.seats[1].conn) { this.fail(conn, 'wrong-state'); return; }
    room.seats[conn.slot].ready = ready;
    this.touch(room);
    if (room.seats[0].ready && room.seats[1].ready) this.freeze(room);
    else this.broadcast(room);
  }

  private loaded(conn: Conn, matchId: string) {
    const room = this.requireRoom(conn);
    if (!room || conn.slot === null || !room.match) return;
    if (room.status !== 'preparing' || room.match.matchId !== matchId) { this.fail(conn, 'wrong-state'); return; }
    room.seats[conn.slot].loaded = true;
    this.touch(room);
    if (room.seats[0].loaded && room.seats[1].loaded && room.seats[0].conn?.connected && room.seats[1].conn?.connected) {
      room.status = 'playing';
      const startAt = this.now() + 350;
      this.broadcast(room);
      this.each(room, seat => { if (seat.conn) this.send(seat.conn, { t: 'start', matchId: room.match!.matchId, epoch: room.epoch, startAt }); });
    } else this.broadcast(room);
  }

  private inputs(conn: Conn, matchId: string, epoch: number, frames: InputFrame[]) {
    const room = this.requireRoom(conn);
    if (!room || conn.slot === null || !room.match) return;
    if (room.status !== 'playing' || room.match.matchId !== matchId) { this.fail(conn, 'wrong-state'); return; }
    if (epoch !== room.epoch) { this.fail(conn, 'wrong-state'); return; }
    const seat = room.seats[conn.slot];
    const fresh: InputFrame[] = [];
    const peerLatest = room.seats[1 - conn.slot].next;
    for (const frame of frames) {
      if (frame.n > peerLatest + FUTURE_SLACK) { this.fail(conn, 'bad-message'); return; }
      const existing = seat.inputs.get(frame.n);
      if (existing) {
        if (!sameWire(existing, frame.i)) { this.fail(conn, 'conflict'); return; }
        continue;
      }
      seat.inputs.set(frame.n, frame.i);
      fresh.push(frame);
    }
    while (seat.inputs.has(seat.next)) seat.next++;
    this.touch(room);
    if (!fresh.length) fresh.push(frames[0]);
    const ack = seat.next;
    const relay = { t: 'inputs' as const, matchId, epoch, slot: conn.slot, frames: fresh, ack };
    this.each(room, other => { if (other.conn?.connected) this.send(other.conn, relay); });
  }

  private hash(conn: Conn, matchId: string, epoch: number, frame: number, hash: string) {
    const room = this.requireRoom(conn);
    if (!room || conn.slot === null || !room.match || room.status !== 'playing') return;
    if (room.match.matchId !== matchId || epoch !== room.epoch || frame > MAX_FRAME) { this.fail(conn, 'wrong-state'); return; }
    const seat = room.seats[conn.slot];
    const previous = seat.hashes.get(frame);
    if (previous && previous !== hash) { this.desync(room); return; }
    seat.hashes.set(frame, hash);
    if (seat.hashes.size > 240) {
      const oldest = Math.min(...seat.hashes.keys());
      seat.hashes.delete(oldest);
    }
    const other = room.seats[1 - conn.slot].hashes.get(frame);
    if (other && other !== hash) { this.desync(room); return; }
    const peer = room.seats[1 - conn.slot].conn;
    if (peer?.connected) this.send(peer, { t: 'hash', matchId, epoch, slot: conn.slot, frame, hash });
  }

  private result(conn: Conn, matchId: string, epoch: number, frame: number, winner: -1 | 0 | 1, hash: string) {
    const room = this.requireRoom(conn);
    if (!room || conn.slot === null || !room.match) return;
    if (room.match.matchId !== matchId || epoch !== room.epoch || room.status !== 'playing') { this.fail(conn, 'wrong-state'); return; }
    room.seats[conn.slot].result = { frame, winner, hash };
    const a = room.seats[0].result, b = room.seats[1].result;
    if (!a || !b) return;
    if (a.frame !== b.frame || a.winner !== b.winner || a.hash !== b.hash) { this.desync(room); return; }
    room.status = 'results';
    this.touch(room);
    this.each(room, seat => {
      if (seat.conn?.connected) this.send(seat.conn, { t: 'result', matchId, epoch, frame: a.frame, winner: a.winner, hash: a.hash, reason: 'agreed' });
    });
    this.broadcast(room);
  }

  private forfeit(conn: Conn, matchId: string, epoch: number) {
    const room = this.requireRoom(conn);
    if (!room || conn.slot === null || !room.match) return;
    if (room.match.matchId !== matchId || epoch !== room.epoch) { this.fail(conn, 'wrong-state'); return; }
    if (room.status !== 'playing' && room.status !== 'preparing') { this.fail(conn, 'wrong-state'); return; }
    const winner = (1 - conn.slot) as 0 | 1;
    room.status = 'results';
    this.touch(room);
    this.each(room, seat => {
      if (seat.conn?.connected) this.send(seat.conn, { t: 'result', matchId, epoch, frame: 0, winner, hash: 'forfeit', reason: 'forfeit' });
    });
    this.broadcast(room);
  }

  private rematch(conn: Conn) {
    const room = this.requireRoom(conn);
    if (!room || conn.slot === null) return;
    if (room.status !== 'results') { this.fail(conn, 'wrong-state'); return; }
    room.seats[conn.slot].rematch = true;
    this.touch(room);
    if (!room.seats[0].rematch || !room.seats[1].rematch) { this.broadcast(room); return; }
    if (!room.seats[0].conn?.connected || !room.seats[1].conn?.connected) { this.fail(conn, 'wrong-state'); return; }
    this.openMatch(room);
  }

  private backToLobby(conn: Conn) {
    const room = this.requireRoom(conn);
    if (!room) return;
    if (room.status === 'lobby') { this.broadcast(room); return; }
    this.toLobby(room);
  }

  private leave(conn: Conn) {
    conn.connected = false;
    const room = this.roomOf(conn);
    if (!room || conn.slot === null) { conn.roomCode = null; conn.slot = null; return; }
    this.dropSeat(room, conn.slot, 'The other player left the room.');
  }

  private resume(conn: Conn, token: string, fingerprint: string) {
    const saved = this.tokens.get(token);
    if (!saved || saved.conn.connected) { this.fail(conn, saved ? 'forbidden' : 'expired'); return; }
    const room = this.rooms.get(saved.code);
    if (!room || fingerprint !== room.fingerprint) { this.fail(conn, room ? 'incompatible' : 'expired'); return; }
    const previous = saved.conn;
    conn.token = previous.token;
    conn.fingerprint = fingerprint;
    conn.protocol = PROTOCOL_VERSION;
    conn.welcomed = true;
    conn.roomCode = room.code;
    conn.slot = saved.slot;
    conn.connected = true;
    room.seats[saved.slot].conn = conn;
    room.seats[saved.slot].disconnectAt = null;
    saved.conn = conn;
    this.tokens.set(token, saved);
    if (room.status === 'playing' || room.status === 'preparing' || room.status === 'interrupted') this.toLobby(room);
    else this.broadcast(room);
    this.send(conn, { t: 'welcome', protocol: PROTOCOL_VERSION, session: conn.token });
  }

  private freeze(room: Room) {
    room.epoch++;
    room.match = {
      matchId: randomBytes(8).toString('hex'),
      epoch: room.epoch,
      rev: room.rev,
      fighters: [room.seats[0].fighter, room.seats[1].fighter],
      stage: room.stage,
      items: room.items,
      mode: 'versus',
      seed: randomBytes(4).readUInt32BE(0),
      fingerprint: room.fingerprint,
      delay: INPUT_DELAY,
      predictionLimit: PREDICTION_LIMIT,
    };
    this.resetMatchData(room);
    room.status = 'preparing';
    this.touch(room);
    this.broadcast(room);
    this.each(room, seat => { if (seat.conn) this.send(seat.conn, { t: 'prepare', match: room.match! }); });
  }

  private openMatch(room: Room) {
    room.seats[0].ready = false;
    room.seats[1].ready = false;
    room.seats[0].rematch = false;
    room.seats[1].rematch = false;
    this.freeze(room);
  }

  private toLobby(room: Room) {
    room.epoch++;
    room.match = null;
    room.status = 'lobby';
    this.resetMatchData(room);
    room.seats[0].ready = false;
    room.seats[1].ready = false;
    room.seats[0].rematch = false;
    room.seats[1].rematch = false;
    this.touch(room);
    this.broadcast(room);
  }

  private interrupt(room: Room, reason: string) {
    if (room.status === 'interrupted') { this.broadcast(room); return; }
    room.status = 'interrupted';
    const matchId = room.match?.matchId ?? '';
    this.each(room, seat => {
      if (seat.conn?.connected && room.match) this.send(seat.conn, { t: 'abort', matchId, epoch: room.epoch, reason });
    });
  }

  private desync(room: Room) {
    this.interrupt(room, 'desync');
    this.broadcast(room);
  }

  private dropSeat(room: Room, slot: 0 | 1, message: string) {
    const seat = room.seats[slot];
    const conn = seat.conn;
    if (conn) {
      this.tokens.delete(conn.token);
      conn.roomCode = null;
      conn.slot = null;
      conn.connected = false;
    }
    if (slot === 0) { this.closeRoom(room, 'expired', message); return; }
    room.seats[1] = emptySeat(1);
    room.seats[0].ready = false;
    room.seats[1].ready = false;
    if (room.status !== 'lobby') this.toLobby(room);
    else { this.touch(room); this.broadcast(room); }
  }

  private closeRoom(room: Room, code: ErrorCode, message = ERROR_TEXT[code]) {
    for (const seat of room.seats) {
      if (seat.conn?.connected) this.send(seat.conn, { t: 'error', code, message });
      if (seat.conn) {
        this.tokens.delete(seat.conn.token);
        seat.conn.roomCode = null;
        seat.conn.slot = null;
      }
    }
    this.rooms.delete(room.code);
  }

  private seat(room: Room, conn: Conn, slot: 0 | 1) {
    conn.roomCode = room.code;
    conn.slot = slot;
    conn.connected = true;
    room.seats[slot].conn = conn;
    room.seats[slot].disconnectAt = null;
    this.tokens.set(conn.token, { conn, code: room.code, slot });
    this.touch(room);
  }

  private blankRoom(code: string, fingerprint: string): Room {
    const now = this.now();
    return {
      code, fingerprint, created: now, activity: now, rev: 1, stage: 0, items: false,
      status: 'lobby', epoch: 0, match: null, seats: [emptySeat(0), emptySeat(1)],
    };
  }

  private resetMatchData(room: Room) {
    for (const seat of room.seats) {
      seat.loaded = false;
      seat.result = null;
      seat.inputs = new Map();
      seat.next = 0;
      seat.hashes = new Map();
    }
  }

  private requireRoom(conn: Conn): Room | null {
    const room = this.roomOf(conn);
    if (!room) { this.fail(conn, 'wrong-state'); return null; }
    return room;
  }

  private roomOf(conn: Conn): Room | null {
    if (!conn.roomCode || conn.slot === null) return null;
    const room = this.rooms.get(conn.roomCode);
    if (!room || room.seats[conn.slot].conn !== conn) return null;
    return room;
  }

  private view(room: Room, slot: 0 | 1): RoomView {
    return {
      code: room.code, slot, rev: room.rev, stage: room.stage, items: room.items, epoch: room.epoch, status: room.status,
      fighters: [room.seats[0].fighter, room.seats[1].fighter],
      ready: [room.seats[0].ready, room.seats[1].ready],
      occupied: [!!room.seats[0].conn, !!room.seats[1].conn],
      connected: [!!room.seats[0].conn?.connected, !!room.seats[1].conn?.connected],
    };
  }

  private broadcast(room: Room) {
    this.each(room, (seat, slot) => { if (seat.conn?.connected) this.send(seat.conn, { t: 'room', view: this.view(room, slot) }); });
  }

  private each(room: Room, fn: (seat: Seat, slot: 0 | 1) => void) {
    fn(room.seats[0], 0); fn(room.seats[1], 1);
  }

  private touch(room: Room) { room.activity = this.now(); }

  private fail(conn: Conn, code: ErrorCode) {
    this.send(conn, { t: 'error', code, message: ERROR_TEXT[code] });
  }

  private send(conn: Conn, message: ServerMessage) {
    if (conn.deliver) conn.deliver(message);
    else conn.out.push(message);
  }

  private allowMessage(conn: Conn): boolean {
    const now = this.now();
    if (now >= conn.msgReset) { conn.msgReset = now + 1000; conn.msgCount = 0; }
    conn.msgCount++;
    return conn.msgCount <= MESSAGE_LIMIT;
  }

  private bump(map: Map<string, Rate>, ip: string, limit: number, windowMs: number): boolean {
    const now = this.now();
    const rate = map.get(ip);
    if (!rate || now >= rate.reset) { map.set(ip, { n: 1, reset: now + windowMs }); return true; }
    rate.n++;
    return rate.n <= limit;
  }
}

function emptySeat(fighter: number): Seat {
  return { conn: null, fighter, ready: false, loaded: false, disconnectAt: null, result: null, rematch: false, inputs: new Map(), next: 0, hashes: new Map() };
}

function newCode(): string {
  let code = '';
  // 32 symbols divide 256 evenly, so one byte modulo the alphabet is unbiased.
  const bytes = randomBytes(CODE_LENGTH);
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return code;
}

export function openConn(ip = '127.0.0.1'): Conn {
  return {
    id: randomBytes(4).toString('hex'), token: '', fingerprint: '', protocol: 0, ip, connected: true,
    roomCode: null, slot: null, lastSeen: 0, msgCount: 0, msgReset: 0, welcomed: false, out: [],
  };
}
