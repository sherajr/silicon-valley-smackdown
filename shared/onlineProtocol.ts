/**
 * Versioned online room protocol. Shared by the browser and the room server.
 * A public room code invites someone into an empty guest slot. It is not a session.
 * The session token is delivered once, in `welcome`, and is never put in a URL.
 */
import type { Controls } from '../src/arena/controls.ts';
import { noInput } from '../src/arena/controls.ts';

export const PROTOCOL_VERSION = 1;
/** Inputs sampled now are applied this many simulation frames later. */
export const INPUT_DELAY = 2;
/** How far a client may simulate past the latest authoritative remote input. */
export const PREDICTION_LIMIT = 8;
/** Snapshots kept behind the live frame so a late input can still be corrected. */
export const HISTORY_FRAMES = 180;
export const CODE_LENGTH = 8;
export const MAX_MESSAGE_BYTES = 8_192;
export const MAX_INPUT_BATCH = 30;
/** Ten minutes of 60 Hz frames, past any real match including sudden death. */
export const MAX_FRAME = 60 * 60 * 10;
export const REJOIN_GRACE_MS = 10_000;
export const LOBBY_TTL_MS = 10 * 60 * 1000;
export const HEARTBEAT_MS = 5_000;
/** Wall-clock wait after prediction is exhausted before the round is interrupted. */
export const STALL_MS = 3_000;
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export type RoomStatus = 'lobby' | 'preparing' | 'playing' | 'results' | 'interrupted';
export type ErrorCode =
  | 'bad-message' | 'incompatible' | 'room-full' | 'not-found' | 'expired' | 'rate'
  | 'wrong-state' | 'stale-rev' | 'forbidden' | 'desync' | 'oversized' | 'unavailable' | 'conflict';

export interface WireInput {
  x: -1 | 0 | 1;
  u: boolean; d: boolean; j: boolean; a: boolean; s: boolean; h: boolean; g: boolean;
}

export interface InputFrame { n: number; i: WireInput }

export interface MatchDescriptor {
  matchId: string;
  epoch: number;
  rev: number;
  fighters: [number, number];
  stage: number;
  items: boolean;
  mode: 'versus';
  seed: number;
  fingerprint: string;
  delay: number;
  predictionLimit: number;
}

/** Per-connection lobby projection. No tokens, no other room's data. */
export interface RoomView {
  code: string;
  slot: 0 | 1;
  rev: number;
  stage: number;
  items: boolean;
  fighters: [number, number];
  ready: [boolean, boolean];
  occupied: [boolean, boolean];
  connected: [boolean, boolean];
  status: RoomStatus;
  epoch: number;
}

export type ClientMessage =
  | { t: 'hello'; protocol: number; fingerprint: string; resume?: string }
  | { t: 'create' }
  | { t: 'join'; code: string }
  | { t: 'config'; rev: number; fighter?: number; stage?: number; items?: boolean }
  | { t: 'ready'; rev: number; ready: boolean }
  | { t: 'loaded'; matchId: string }
  | { t: 'inputs'; matchId: string; epoch: number; frames: InputFrame[] }
  | { t: 'hash'; matchId: string; epoch: number; frame: number; hash: string }
  | { t: 'result'; matchId: string; epoch: number; frame: number; winner: -1 | 0 | 1; hash: string }
  | { t: 'rematch' }
  | { t: 'lobby' }
  | { t: 'forfeit'; matchId: string; epoch: number }
  | { t: 'leave' }
  | { t: 'ping'; id: number; clientTime: number };

export type ServerMessage =
  | { t: 'welcome'; protocol: number; session: string }
  | { t: 'room'; view: RoomView }
  | { t: 'prepare'; match: MatchDescriptor }
  | { t: 'start'; matchId: string; epoch: number; startAt: number }
  | { t: 'inputs'; matchId: string; epoch: number; slot: 0 | 1; frames: InputFrame[]; ack: number }
  | { t: 'hash'; matchId: string; epoch: number; slot: 0 | 1; frame: number; hash: string }
  | { t: 'result'; matchId: string; epoch: number; frame: number; winner: -1 | 0 | 1; hash: string; reason: 'agreed' | 'forfeit' }
  | { t: 'abort'; matchId: string; epoch: number; reason: string }
  | { t: 'pong'; id: number; clientTime: number; serverTime: number }
  | { t: 'error'; code: ErrorCode; message: string };

export const ERROR_TEXT: Record<ErrorCode, string> = {
  'bad-message': 'The server did not understand that message.',
  incompatible: 'You and your opponent are running different game versions.',
  'room-full': 'That room already has two players.',
  'not-found': 'That code does not match an open room.',
  expired: 'That room has expired.',
  rate: 'Too many attempts. Wait a moment and try again.',
  'wrong-state': 'That action is not available right now.',
  'stale-rev': 'The lobby changed. Look again, then ready up.',
  forbidden: 'You cannot take that seat.',
  desync: 'The two games disagreed, so the round was stopped.',
  oversized: 'That message was too large.',
  unavailable: 'The online server is unavailable.',
  conflict: 'A gameplay message contradicted one that was already accepted.',
};

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export function normalizeCode(raw: string): string | null {
  const code = raw.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== CODE_LENGTH) return null;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return null;
  return code;
}

export function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

const axis = (value: unknown): -1 | 0 | 1 | null => value === -1 || value === 0 || value === 1 ? value : null;
const bit = (value: unknown): boolean | null => typeof value === 'boolean' ? value : null;
const int = (value: unknown, min: number, max: number): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null;
const text = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;

export function wireFromControls(c: Controls): WireInput {
  const x = c.x > 0 ? 1 : c.x < 0 ? -1 : 0;
  return { x, u: !!c.up, d: !!c.down, j: !!c.jump, a: !!c.attack, s: !!c.special, h: !!c.shield, g: !!c.grab };
}

export function controlsFromWire(i: WireInput): Controls {
  return { x: i.x, up: i.u, down: i.d, jump: i.j, attack: i.a, special: i.s, shield: i.h, grab: i.g };
}

export function neutralWire(): WireInput {
  return wireFromControls(noInput());
}

export function sameWire(a: WireInput, b: WireInput): boolean {
  return a.x === b.x && a.u === b.u && a.d === b.d && a.j === b.j && a.a === b.a && a.s === b.s && a.h === b.h && a.g === b.g;
}

function parseWire(value: unknown): WireInput | null {
  if (!isRecord(value)) return null;
  const x = axis(value.x);
  const u = bit(value.u), d = bit(value.d), j = bit(value.j), a = bit(value.a), s = bit(value.s), h = bit(value.h), g = bit(value.g);
  if (x === null || u === null || d === null || j === null || a === null || s === null || h === null || g === null) return null;
  return { x, u, d, j, a, s, h, g };
}

function parseFrames(value: unknown): InputFrame[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_INPUT_BATCH) return null;
  const frames: InputFrame[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const n = int(item.n, 0, MAX_FRAME);
    const i = parseWire(item.i);
    if (n === null || !i) return null;
    frames.push({ n, i });
  }
  return frames;
}

function parseDescriptor(value: unknown): MatchDescriptor | null {
  if (!isRecord(value)) return null;
  const matchId = text(value.matchId, 64);
  const epoch = int(value.epoch, 1, 1_000_000);
  const rev = int(value.rev, 1, 1_000_000);
  const stage = int(value.stage, 0, 15);
  const seed = int(value.seed, 0, 0xffffffff);
  const fingerprint = text(value.fingerprint, 64);
  const delay = int(value.delay, 0, 8);
  const predictionLimit = int(value.predictionLimit, 1, 60);
  if (!matchId || epoch === null || rev === null || stage === null || seed === null || !fingerprint || delay === null || predictionLimit === null) return null;
  if (!Array.isArray(value.fighters) || value.fighters.length !== 2) return null;
  const f0 = int(value.fighters[0], 0, 15), f1 = int(value.fighters[1], 0, 15);
  if (f0 === null || f1 === null || typeof value.items !== 'boolean' || value.mode !== 'versus') return null;
  return { matchId, epoch, rev, fighters: [f0, f1], stage, items: value.items, mode: 'versus', seed, fingerprint, delay, predictionLimit };
}

function parseView(value: unknown): RoomView | null {
  if (!isRecord(value)) return null;
  const code = typeof value.code === 'string' ? normalizeCode(value.code) : null;
  const slot = value.slot === 0 || value.slot === 1 ? value.slot : null;
  const rev = int(value.rev, 1, 1_000_000);
  const stage = int(value.stage, 0, 15);
  const epoch = int(value.epoch, 0, 1_000_000);
  const statuses: RoomStatus[] = ['lobby', 'preparing', 'playing', 'results', 'interrupted'];
  if (!code || slot === null || rev === null || stage === null || epoch === null || typeof value.items !== 'boolean') return null;
  if (typeof value.status !== 'string' || !statuses.includes(value.status as RoomStatus)) return null;
  const pair = (key: string): [number, number] | [boolean, boolean] | null => {
    const raw = value[key];
    if (!Array.isArray(raw) || raw.length !== 2) return null;
    return raw as [number, number];
  };
  const fighters = pair('fighters'), ready = pair('ready'), occupied = pair('occupied'), connected = pair('connected');
  if (!fighters || !ready || !occupied || !connected) return null;
  const f0 = int(fighters[0], 0, 15), f1 = int(fighters[1], 0, 15);
  if (f0 === null || f1 === null) return null;
  if (typeof ready[0] !== 'boolean' || typeof ready[1] !== 'boolean') return null;
  if (typeof occupied[0] !== 'boolean' || typeof occupied[1] !== 'boolean') return null;
  if (typeof connected[0] !== 'boolean' || typeof connected[1] !== 'boolean') return null;
  return {
    code, slot, rev, stage, items: value.items, fighters: [f0, f1],
    ready: [ready[0], ready[1]], occupied: [occupied[0], occupied[1]], connected: [connected[0], connected[1]],
    status: value.status as RoomStatus, epoch,
  };
}

export function parseClientMessage(value: unknown): ClientMessage | null {
  if (!isRecord(value) || typeof value.t !== 'string') return null;
  switch (value.t) {
    case 'hello': {
      const protocol = int(value.protocol, 1, 1_000);
      const fingerprint = text(value.fingerprint, 64);
      const resume = value.resume === undefined ? undefined : text(value.resume, 128);
      if (protocol === null || !fingerprint || resume === null) return null;
      return resume === undefined ? { t: 'hello', protocol, fingerprint } : { t: 'hello', protocol, fingerprint, resume };
    }
    case 'create': return { t: 'create' };
    case 'join': {
      if (typeof value.code !== 'string') return null;
      const code = normalizeCode(value.code);
      return code ? { t: 'join', code } : null;
    }
    case 'config': {
      const rev = int(value.rev, 1, 1_000_000);
      if (rev === null) return null;
      const msg: ClientMessage = { t: 'config', rev };
      if (value.fighter !== undefined) {
        const fighter = int(value.fighter, 0, 15);
        if (fighter === null) return null;
        msg.fighter = fighter;
      }
      if (value.stage !== undefined) {
        const stage = int(value.stage, 0, 15);
        if (stage === null) return null;
        msg.stage = stage;
      }
      if (value.items !== undefined) {
        if (typeof value.items !== 'boolean') return null;
        msg.items = value.items;
      }
      return msg;
    }
    case 'ready': {
      const rev = int(value.rev, 1, 1_000_000);
      if (rev === null || typeof value.ready !== 'boolean') return null;
      return { t: 'ready', rev, ready: value.ready };
    }
    case 'loaded': {
      const matchId = text(value.matchId, 64);
      return matchId ? { t: 'loaded', matchId } : null;
    }
    case 'inputs': {
      const matchId = text(value.matchId, 64);
      const epoch = int(value.epoch, 1, 1_000_000);
      const frames = parseFrames(value.frames);
      if (!matchId || epoch === null || !frames) return null;
      return { t: 'inputs', matchId, epoch, frames };
    }
    case 'hash': {
      const matchId = text(value.matchId, 64);
      const epoch = int(value.epoch, 1, 1_000_000);
      const frame = int(value.frame, 0, MAX_FRAME);
      const hash = text(value.hash, 64);
      if (!matchId || epoch === null || frame === null || !hash) return null;
      return { t: 'hash', matchId, epoch, frame, hash };
    }
    case 'result': {
      const matchId = text(value.matchId, 64);
      const epoch = int(value.epoch, 1, 1_000_000);
      const frame = int(value.frame, 0, MAX_FRAME);
      const hash = text(value.hash, 64);
      const winner = value.winner === -1 || value.winner === 0 || value.winner === 1 ? value.winner : null;
      if (!matchId || epoch === null || frame === null || !hash || winner === null) return null;
      return { t: 'result', matchId, epoch, frame, winner, hash };
    }
    case 'rematch': return { t: 'rematch' };
    case 'lobby': return { t: 'lobby' };
    case 'leave': return { t: 'leave' };
    case 'forfeit': {
      const matchId = text(value.matchId, 64);
      const epoch = int(value.epoch, 1, 1_000_000);
      if (!matchId || epoch === null) return null;
      return { t: 'forfeit', matchId, epoch };
    }
    case 'ping': {
      const id = int(value.id, 0, 1_000_000_000);
      const clientTime = typeof value.clientTime === 'number' && Number.isFinite(value.clientTime) ? value.clientTime : null;
      if (id === null || clientTime === null) return null;
      return { t: 'ping', id, clientTime };
    }
    default: return null;
  }
}

export function parseServerMessage(value: unknown): ServerMessage | null {
  if (!isRecord(value) || typeof value.t !== 'string') return null;
  switch (value.t) {
    case 'welcome': {
      const protocol = int(value.protocol, 1, 1_000);
      const session = text(value.session, 128);
      if (protocol === null || !session) return null;
      return { t: 'welcome', protocol, session };
    }
    case 'room': {
      const view = parseView(value.view);
      return view ? { t: 'room', view } : null;
    }
    case 'prepare': {
      const match = parseDescriptor(value.match);
      return match ? { t: 'prepare', match } : null;
    }
    case 'start': {
      const matchId = text(value.matchId, 64);
      const epoch = int(value.epoch, 1, 1_000_000);
      const startAt = typeof value.startAt === 'number' && Number.isFinite(value.startAt) ? value.startAt : null;
      if (!matchId || epoch === null || startAt === null) return null;
      return { t: 'start', matchId, epoch, startAt };
    }
    case 'inputs': {
      const matchId = text(value.matchId, 64);
      const epoch = int(value.epoch, 1, 1_000_000);
      const slot = value.slot === 0 || value.slot === 1 ? value.slot : null;
      const ack = int(value.ack, 0, MAX_FRAME + 1);
      const frames = parseFrames(value.frames);
      if (!matchId || epoch === null || slot === null || ack === null || !frames) return null;
      return { t: 'inputs', matchId, epoch, slot, frames, ack };
    }
    case 'hash': {
      const matchId = text(value.matchId, 64);
      const epoch = int(value.epoch, 1, 1_000_000);
      const slot = value.slot === 0 || value.slot === 1 ? value.slot : null;
      const frame = int(value.frame, 0, MAX_FRAME);
      const hash = text(value.hash, 64);
      if (!matchId || epoch === null || slot === null || frame === null || !hash) return null;
      return { t: 'hash', matchId, epoch, slot, frame, hash };
    }
    case 'result': {
      const matchId = text(value.matchId, 64);
      const epoch = int(value.epoch, 1, 1_000_000);
      const frame = int(value.frame, 0, MAX_FRAME);
      const hash = text(value.hash, 64);
      const winner = value.winner === -1 || value.winner === 0 || value.winner === 1 ? value.winner : null;
      if (!matchId || epoch === null || frame === null || !hash || winner === null) return null;
      if (value.reason !== 'agreed' && value.reason !== 'forfeit') return null;
      return { t: 'result', matchId, epoch, frame, winner, hash, reason: value.reason };
    }
    case 'abort': {
      const matchId = text(value.matchId, 64);
      const epoch = int(value.epoch, 1, 1_000_000);
      const reason = text(value.reason, 64);
      if (!matchId || epoch === null || !reason) return null;
      return { t: 'abort', matchId, epoch, reason };
    }
    case 'pong': {
      const id = int(value.id, 0, 1_000_000_000);
      const clientTime = typeof value.clientTime === 'number' && Number.isFinite(value.clientTime) ? value.clientTime : null;
      const serverTime = typeof value.serverTime === 'number' && Number.isFinite(value.serverTime) ? value.serverTime : null;
      if (id === null || clientTime === null || serverTime === null) return null;
      return { t: 'pong', id, clientTime, serverTime };
    }
    case 'error': {
      const code = typeof value.code === 'string' && value.code in ERROR_TEXT ? value.code as ErrorCode : null;
      const message = text(value.message, 240);
      if (!code || !message) return null;
      return { t: 'error', code, message };
    }
    default: return null;
  }
}

export function encodeMessage(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}

export function decodeMessage(raw: string, side: 'client'): ClientMessage | null;
export function decodeMessage(raw: string, side: 'server'): ServerMessage | null;
export function decodeMessage(raw: string, side: 'client' | 'server'): ClientMessage | ServerMessage | null {
  if (raw.length > MAX_MESSAGE_BYTES) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return side === 'client' ? parseClientMessage(value) : parseServerMessage(value);
  } catch {
    return null;
  }
}
