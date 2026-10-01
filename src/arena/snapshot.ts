/**
 * Complete gameplay snapshots for ArenaSim.
 *
 * A snapshot is the state when `tick` equals that frame, before the input for that frame is applied.
 * Move and projectile definitions are stored by id and reattached on restore, so a snapshot is not a
 * live simulation by itself. Audio, particles, camera, and graphics preferences are not included.
 */
import { FIGHTERS } from './fighterDefinitions';
import { STAGE_PLATFORMS } from './data';
import { hashData } from '../../shared/hash';
import type { Platform } from './data';
import type { InputState, Request } from './ActionBuffer';
import type { Move, MoveId } from './moveDefinitions';
import type { CpuState } from './cpu';
import type { Attack, DummyMode, Fighter, GameEvent, Hold, MatchOptions, Pickup, Shot } from './Simulation';
import type { ArenaSim } from './Simulation';

export interface AttackSnap {
  kind: Move; id: MoveId; uid: number;
  age: number; duration: number; start: number; active: number;
  damage: number; force: number; reach: number;
  hit: boolean; landed: boolean; blocked: boolean; fired: boolean; diving: boolean; countered: boolean;
  log: Record<string, number>;
}

export interface ShotSnap {
  id: number; owner: number; kind: number; x: number; y: number; vx: number; vy: number; life: number; dir: number; bounces: number;
}

export interface FighterSnap {
  slot: number; character: number; x: number; y: number; prevX: number; prevY: number; vx: number; vy: number;
  facing: number; damage: number; stocks: number; grounded: boolean; support: string | null; jumps: number; recovered: boolean;
  stun: number; invincible: number; respawn: number; shield: number; guarding: boolean; attack: AttackSnap | null;
  jabSequenceIndex: number; jabWindow: number;
  combo: number; comboDamage: number; comboTarget: number;
  drop: number; dropFrom: string | null; roll: number; rollBase: number; ledge: number; ledgeCooldown: number; ledgeGrabs: number;
  buff: number; flash: number; busy: number; busyKind: string;
  hold: Hold | null; heldBy: number | null; grabProtect: number;
  di: number; diY: number;
  input: InputState;
  actionName: string; actionTime: number;
}

export interface SimSnapshot {
  options: MatchOptions;
  platforms: Platform[];
  fighters: [FighterSnap, FighterSnap];
  shots: ShotSnap[];
  pickups: Pickup[];
  events: GameEvent[];
  tick: number;
  remaining: number;
  countdown: number;
  freeze: number;
  finished: boolean;
  winner: number;
  suddenDeath: boolean;
  dummy: DummyMode;
  cpu: CpuState;
  rng: number;
  serial: number;
  itemClock: number;
}

export interface HiddenState { rng: number; serial: number; itemClock: number }

const copyInput = (input: InputState): InputState => ({
  prev: { attack: input.prev.attack, special: input.prev.special, grab: input.prev.grab, jump: input.prev.jump },
  serial: input.serial,
  requests: input.requests.map((r): Request => ({ id: r.id, button: r.button, age: r.age, tick: r.tick, x: r.x, up: r.up, down: r.down })),
});

const copyAttack = (a: Attack): AttackSnap => ({
  kind: a.kind, id: a.id, uid: a.uid, age: a.age, duration: a.duration, start: a.start, active: a.active,
  damage: a.damage, force: a.force, reach: a.reach, hit: a.hit, landed: a.landed, blocked: a.blocked,
  fired: a.fired, diving: a.diving, countered: a.countered, log: { ...a.log },
});

const copyFighter = (f: Fighter): FighterSnap => ({
  slot: f.slot, character: f.character, x: f.x, y: f.y, prevX: f.prevX, prevY: f.prevY, vx: f.vx, vy: f.vy,
  facing: f.facing, damage: f.damage, stocks: f.stocks, grounded: f.grounded, support: f.support, jumps: f.jumps, recovered: f.recovered,
  stun: f.stun, invincible: f.invincible, respawn: f.respawn, shield: f.shield, guarding: f.guarding,
  attack: f.attack ? copyAttack(f.attack) : null,
  jabSequenceIndex: f.jabSequenceIndex, jabWindow: f.jabWindow, combo: f.combo, comboDamage: f.comboDamage, comboTarget: f.comboTarget,
  drop: f.drop, dropFrom: f.dropFrom, roll: f.roll, rollBase: f.rollBase, ledge: f.ledge, ledgeCooldown: f.ledgeCooldown, ledgeGrabs: f.ledgeGrabs,
  buff: f.buff, flash: f.flash, busy: f.busy, busyKind: f.busyKind,
  hold: f.hold ? { target: f.hold.target, age: f.hold.age, tick: f.hold.tick, pummels: f.hold.pummels, gap: f.hold.gap } : null,
  heldBy: f.heldBy, grabProtect: f.grabProtect, di: f.di, diY: f.diY, input: copyInput(f.input),
  actionName: f.actionName, actionTime: f.actionTime,
});

function restoreAttack(character: number, snap: AttackSnap): Attack {
  const def = FIGHTERS[character]?.moves[snap.id];
  if (!def) throw new Error(`Unknown move ${snap.id} for fighter ${character}`);
  return { ...snap, log: { ...snap.log }, def };
}

function restoreShot(snap: ShotSnap): Shot {
  const def = FIGHTERS[snap.kind]?.moves.special.projectile;
  if (!def) throw new Error(`Fighter ${snap.kind} has no projectile to restore`);
  return { ...snap, def };
}

export function buildSnapshot(sim: ArenaSim, hidden: HiddenState): SimSnapshot {
  return {
    options: { ...sim.options, fighters: [...sim.options.fighters] },
    platforms: sim.platforms.map(p => ({ ...p })),
    fighters: [copyFighter(sim.fighters[0]), copyFighter(sim.fighters[1])],
    shots: sim.shots.map(s => ({ id: s.id, owner: s.owner, kind: s.kind, x: s.x, y: s.y, vx: s.vx, vy: s.vy, life: s.life, dir: s.dir, bounces: s.bounces })),
    pickups: sim.pickups.map(p => ({ ...p })),
    events: sim.events.map(e => ({ ...e })),
    tick: sim.tick, remaining: sim.remaining, countdown: sim.countdown, freeze: sim.freeze,
    finished: sim.finished, winner: sim.winner, suddenDeath: sim.suddenDeath,
    dummy: sim.dummy, cpu: { ...sim.cpu }, ...hidden,
  };
}

export function applySnapshot(sim: ArenaSim, snap: SimSnapshot): HiddenState {
  const fighters: [Fighter, Fighter] = [
    { ...snap.fighters[0], attack: snap.fighters[0].attack ? restoreAttack(snap.fighters[0].character, snap.fighters[0].attack) : null, input: copyInput(snap.fighters[0].input), hold: snap.fighters[0].hold ? { ...snap.fighters[0].hold } : null },
    { ...snap.fighters[1], attack: snap.fighters[1].attack ? restoreAttack(snap.fighters[1].character, snap.fighters[1].attack) : null, input: copyInput(snap.fighters[1].input), hold: snap.fighters[1].hold ? { ...snap.fighters[1].hold } : null },
  ];
  sim.options = { ...snap.options, fighters: [...snap.options.fighters] };
  sim.fighters = fighters;
  sim.shots = snap.shots.map(restoreShot);
  sim.pickups = snap.pickups.map(p => ({ ...p }));
  sim.events = snap.events.map(e => ({ ...e }));
  sim.tick = snap.tick; sim.remaining = snap.remaining; sim.countdown = snap.countdown; sim.freeze = snap.freeze;
  sim.finished = snap.finished; sim.winner = snap.winner; sim.suddenDeath = snap.suddenDeath;
  sim.dummy = snap.dummy; sim.cpu = { ...snap.cpu };
  const known = STAGE_PLATFORMS[snap.options.stage];
  const sameStage = known && known.length === snap.platforms.length && known.every((p, i) => p.id === snap.platforms[i].id && p.x === snap.platforms[i].x && p.y === snap.platforms[i].y && p.w === snap.platforms[i].w && p.solid === snap.platforms[i].solid);
  sim.setPlatforms(sameStage ? known : snap.platforms.map(p => ({ ...p })));
  return { rng: snap.rng, serial: snap.serial, itemClock: snap.itemClock };
}

/**
 * Checksum over the gameplay that decides the future: fighters, RNG, ids, projectiles, pickups, timers.
 * The event list is restored with the snapshot but omitted here, because the session drains it into a
 * journal and an offline replay may still be holding the same events in the live buffer.
 */
export function hashSnapshot(snap: SimSnapshot): string {
  const { events: _events, ...gameplay } = snap;
  return hashData(gameplay);
}
