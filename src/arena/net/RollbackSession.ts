/**
 * Bounded rollback driver for one online match.
 *
 * Frame F is the input applied by the step that moves `ArenaSim.tick` from F to F+1.
 * The snapshot stored at F is the gameplay state when tick === F, before that input.
 * Frames [0, delay) are neutral for both players. Confirmed count N means inputs
 * 0..N-1 are authoritative, so the state at tick N (and events stamped N) may be shown.
 * Local buttons are sampled only when a new local frame is created, never during replay.
 */
import type { ArenaSim } from '../Simulation';
import type { Controls } from '../controls';
import { noInput } from '../controls';
import type { SimSnapshot } from '../snapshot';
import { hashSnapshot } from '../snapshot';
import { EventJournal } from './EventJournal';
import type { JournalEntry } from './EventJournal';
import {
  HASH_INTERVAL, HISTORY_FRAMES, INPUT_DELAY, MAX_FRAME, PREDICTION_LIMIT, STALL_MS,
  controlsFromWire, sameWire, wireFromControls,
} from '../../../shared/onlineProtocol';
import type { WireInput } from '../../../shared/onlineProtocol';

export interface StepHooks {
  /** Called before a live step only. Replay does not sample input or touch the renderer. */
  beforeLiveStep?: (sim: ArenaSim) => void;
  /** Called once after a correction replay finishes. */
  afterCorrection?: () => void;
}

export interface LocalSubmit { frame: number; input: WireInput }

const sameControls = (a: Controls, b: Controls) =>
  a.x === b.x && a.up === b.up && a.down === b.down && a.jump === b.jump && a.attack === b.attack
  && a.special === b.special && a.shield === b.shield && a.grab === b.grab;

/** Held directions and shield continue. Action buttons are pulses and are never repeated. */
export function predictControls(previous: Controls | undefined): Controls {
  if (!previous) return noInput();
  const x = previous.x > 0 ? 1 : previous.x < 0 ? -1 : 0;
  return { x, up: !!previous.up, down: !!previous.down, shield: !!previous.shield, jump: false, attack: false, special: false, grab: false };
}

export class RollbackSession {
  readonly sim: ArenaSim;
  readonly localSlot: 0 | 1;
  readonly matchId: string;
  readonly epoch: number;
  readonly delay: number;
  readonly predictionLimit: number;
  readonly history: number;
  readonly stallMs: number;
  confirmed = 0;
  waiting = false;
  interrupted: string | null = null;
  corrected = false;
  private readonly local: (WireInput | undefined)[] = [];
  private readonly remote: (WireInput | undefined)[] = [];
  private readonly localAck: boolean[] = [];
  private readonly usedRemote: (Controls | undefined)[] = [];
  private readonly snapshots = new Map<number, SimSnapshot>();
  private readonly journal: EventJournal;
  private readonly outbound: LocalSubmit[] = [];
  private nextSend: number;
  private rollbackTo: number | null = null;
  private remoteHashes = new Map<number, string>();
  private lastHashSent = -1;
  private waitingSince: number | null = null;
  /** Inputs are only ever added, never removed, so these counts can advance in place instead of rescanning from frame 0. */
  private remoteNext = 0;
  private ackNext = 0;
  readonly hashInterval: number;
  private now: () => number;

  constructor(options: {
    sim: ArenaSim; localSlot: 0 | 1; matchId: string; epoch: number;
    delay?: number; predictionLimit?: number; history?: number; stallMs?: number; now?: () => number; hashInterval?: number;
  }) {
    this.hashInterval = Math.max(1, options.hashInterval ?? HASH_INTERVAL);
    this.sim = options.sim;
    this.localSlot = options.localSlot;
    this.matchId = options.matchId;
    this.epoch = options.epoch;
    this.delay = options.delay ?? INPUT_DELAY;
    this.predictionLimit = options.predictionLimit ?? PREDICTION_LIMIT;
    this.history = options.history ?? HISTORY_FRAMES;
    this.stallMs = options.stallMs ?? STALL_MS;
    this.now = options.now ?? (() => Date.now());
    this.journal = new EventJournal();
    const neutral = wireFromControls(noInput());
    for (let frame = 0; frame < this.delay; frame++) {
      this.local[frame] = neutral;
      this.outbound.push({ frame, input: neutral });
    }
    this.nextSend = this.delay;
    this.snapshots.set(this.sim.tick, this.sim.save());
  }

  /**
   * Another local frame may be sampled. Inputs can be buffered up to the delay plus the prediction
   * window without stepping. The live pump should still sample once per stepped frame.
   */
  wantsLocal(): boolean {
    if (this.interrupted || this.sim.finished) return false;
    const ahead = this.sim.tick + this.delay + this.predictionLimit;
    const cap = this.remoteContiguous() + this.predictionLimit + this.delay;
    return this.nextSend <= ahead && this.nextSend <= cap && this.nextSend <= MAX_FRAME;
  }

  /** Frame number the next `submitLocal` call fills. */
  get nextLocalFrame(): number { return this.nextSend; }

  submitLocal(controls: Controls): LocalSubmit | null {
    if (!this.wantsLocal()) return null;
    const input = wireFromControls(controls);
    const frame = this.nextSend++;
    this.local[frame] = input;
    const packet = { frame, input };
    this.outbound.push(packet);
    return packet;
  }

  takeOutbound(): LocalSubmit[] {
    return this.outbound.splice(0, this.outbound.length);
  }

  /** Server accepted this slot's input. Identical duplicates are ignored. A different value aborts the round. */
  ackLocal(frame: number, input: WireInput) {
    if (this.interrupted || frame < 0 || frame > MAX_FRAME) return;
    const mine = this.local[frame];
    if (mine && !sameWire(mine, input)) { this.interrupt('conflict'); return; }
    if (!mine) this.local[frame] = input;
    this.localAck[frame] = true;
    this.noteAuthority();
  }

  /** Authoritative input for the other slot. */
  pushRemote(frame: number, input: WireInput) {
    if (this.interrupted || frame < 0 || frame > MAX_FRAME) return;
    if (frame > this.sim.tick + this.predictionLimit + this.delay + 120) return;
    const existing = this.remote[frame];
    if (existing) {
      if (!sameWire(existing, input)) this.interrupt('conflict');
      return;
    }
    const oldest = this.sim.tick - this.history;
    if (frame < oldest) {
      const used = this.usedRemote[frame];
      if (used && !sameControls(used, controlsFromWire(input))) this.interrupt('out-of-history');
      return;
    }
    this.remote[frame] = input;
    const used = this.usedRemote[frame];
    if (used && !sameControls(used, controlsFromWire(input))) {
      this.rollbackTo = this.rollbackTo === null ? frame : Math.min(this.rollbackTo, frame);
    }
    this.noteAuthority();
  }

  noteRemoteHash(frame: number, hash: string) {
    if (this.interrupted) return;
    this.remoteHashes.set(frame, hash);
    this.compareHash(frame);
  }

  /** One simulation frame, after any required correction. Does not sample input. */
  stepOne(hooks: StepHooks = {}): 'stepped' | 'wait' | 'stop' {
    if (this.interrupted) return 'stop';
    if (this.rollbackTo !== null) this.correct(hooks);
    if (this.interrupted) return 'stop';
    // A predicted finish must not spin. A later remote input can still roll it back.
    if (this.sim.finished) { this.waiting = false; this.waitingSince = null; return 'wait'; }
    if (!this.canAdvance()) {
      this.waiting = true;
      if (this.waitingSince === null) this.waitingSince = this.now();
      else if (this.now() - this.waitingSince >= this.stallMs) this.interrupt('stall');
      return this.interrupted ? 'stop' : 'wait';
    }
    this.waiting = false;
    this.waitingSince = null;
    const frame = this.sim.tick;
    hooks.beforeLiveStep?.(this.sim);
    this.advanceFrame(frame);
    this.prune();
    return 'stepped';
  }

  drainEvents(): JournalEntry[] {
    return this.journal.drain(this.confirmed);
  }

  /** Hash of the confirmed state at `frame`, if that frame is confirmed and still stored. */
  hashAt(frame: number): string | null {
    if (frame > this.confirmed) return null;
    const snap = this.snapshots.get(frame);
    return snap ? hashSnapshot(snap) : null;
  }

  /** The checksum for the newest confirmed frame on the shared schedule (multiples of `hashInterval`), once each. */
  takeHash(): { frame: number; hash: string } | null {
    const frame = Math.floor(this.confirmed / this.hashInterval) * this.hashInterval;
    if (frame <= this.lastHashSent) return null;
    const hash = this.hashAt(frame);
    if (!hash) return null;
    this.lastHashSent = frame;
    return { frame, hash };
  }

  /**
   * Winner of the fully confirmed state. A predicted finish on `sim` is not a result:
   * a late input can still overturn it.
   */
  confirmedResult(): { frame: number; winner: number; hash: string } | null {
    // Inputs may already exist past a timeout. The confirmed state is the newest simulated tick
    // whose inputs are authoritative, which is where a finish is actually stored.
    const frame = Math.min(this.confirmed, this.sim.tick);
    const snap = this.snapshots.get(frame);
    if (!snap?.finished) return null;
    return { frame, winner: snap.winner, hash: hashSnapshot(snap) };
  }

  interrupt(reason: string) {
    if (!this.interrupted) this.interrupted = reason;
  }

  /** Remote controls actually applied to a frame, including a prediction. Test hook. */
  appliedRemote(frame: number): Controls | undefined {
    return this.usedRemote[frame];
  }

  get snapshotCount() { return this.snapshots.size; }

  private canAdvance(): boolean {
    const frame = this.sim.tick;
    if (this.local[frame] === undefined) return false;
    if (frame >= this.remoteContiguous() + this.predictionLimit) return false;
    if (frame >= this.localAckContiguous() + this.predictionLimit) return false;
    return true;
  }

  private remoteContiguous(): number {
    while (this.remote[this.remoteNext]) this.remoteNext++;
    return this.remoteNext;
  }

  private localAckContiguous(): number {
    while (this.localAck[this.ackNext]) this.ackNext++;
    return this.ackNext;
  }

  private noteAuthority() {
    const n = Math.min(this.remoteContiguous(), this.localAckContiguous());
    if (n > this.confirmed) {
      this.confirmed = n;
      for (const frame of this.remoteHashes.keys()) this.compareHash(frame);
    }
  }

  private compareHash(frame: number) {
    const theirs = this.remoteHashes.get(frame);
    if (!theirs || frame > this.confirmed) return;
    const mine = this.hashAt(frame);
    if (mine && mine !== theirs) this.interrupt('desync');
  }

  private controlsFor(frame: number): [Controls, Controls] {
    const local = controlsFromWire(this.local[frame] ?? wireFromControls(noInput()));
    let remoteWire = this.remote[frame];
    let remote: Controls;
    if (remoteWire) remote = controlsFromWire(remoteWire);
    else {
      remote = predictControls(this.previousRemote(frame));
      remoteWire = wireFromControls(remote);
    }
    this.usedRemote[frame] = remote;
    return this.localSlot === 0 ? [local, remote] : [remote, local];
  }

  private previousRemote(frame: number): Controls | undefined {
    for (let i = frame - 1; i >= 0 && i >= frame - 8; i--) {
      if (this.remote[i]) return controlsFromWire(this.remote[i]!);
      if (this.usedRemote[i]) return this.usedRemote[i];
    }
    return undefined;
  }

  private advanceFrame(frame: number) {
    if (!this.snapshots.has(frame)) this.snapshots.set(frame, this.sim.save());
    if (this.sim.finished) return;
    this.sim.step(this.controlsFor(frame));
    this.journal.add(this.sim.tick, this.sim.events, this.matchId, this.epoch);
    this.sim.events.length = 0;
    this.snapshots.set(this.sim.tick, this.sim.save());
  }

  private correct(hooks: StepHooks) {
    const frame = this.rollbackTo!;
    this.rollbackTo = null;
    const snap = this.snapshots.get(frame);
    if (!snap) { this.interrupt('out-of-history'); return; }
    const target = this.sim.tick;
    this.sim.load(snap);
    this.journal.truncate(frame);
    for (let key of [...this.snapshots.keys()]) if (key > frame) this.snapshots.delete(key);
    this.snapshots.set(frame, this.sim.save());
    for (let f = frame; f < target; f++) this.advanceFrame(f);
    this.corrected = true;
    hooks.afterCorrection?.();
  }

  private prune() {
    const min = this.sim.tick - this.history;
    if (min <= 1) return;
    for (const key of this.snapshots.keys()) if (key < min) this.snapshots.delete(key);
  }
}
