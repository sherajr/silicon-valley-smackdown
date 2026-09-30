/**
 * Typed Arena move data. Everything the simulation, CPU, renderer and help screens know about a move
 * lives here, so a move's timing, hit volumes, cancels and on-screen description cannot drift apart.
 * No browser or Three.js imports: this module is part of the deterministic simulation.
 *
 * Geometry: boxes are in the attacker's local, facing-relative space. +x is forward, y is up from the
 * feet, both measured from the fighter origin (feet centre). Frames are simulation ticks (60 Hz) counted
 * as `Attack.age`, which is 0 on the tick a move starts.
 */

/** Coarse move category. The first nine are the original Arena move types and stay valid input names. */
export type Move = 'jab' | 'heavy' | 'aerial' | 'upper' | 'sweep' | 'special' | 'recovery' | 'slam' | 'counter' | 'dash' | 'grab' | 'pummel' | 'throw';

/** Specific move slot within one fighter's move set. */
export type MoveId =
  | 'jab1' | 'jab2' | 'jab3' | 'heavy' | 'upper' | 'sweep'
  | 'nair' | 'fair' | 'bair' | 'uair' | 'dair'
  | 'special' | 'recovery' | 'down'
  | 'grab' | 'pummel' | 'fthrow' | 'bthrow' | 'uthrow' | 'dthrow';

export const MOVE_IDS: readonly MoveId[] = ['jab1', 'jab2', 'jab3', 'heavy', 'upper', 'sweep', 'nair', 'fair', 'bair', 'uair', 'dair', 'special', 'recovery', 'down', 'grab', 'pummel', 'fthrow', 'bthrow', 'uthrow', 'dthrow'];

/** Legacy category names map onto a concrete slot; tests, the CPU and debug tools can keep using them. */
const LEGACY: Record<string, MoveId> = { jab: 'jab1', heavy: 'heavy', aerial: 'nair', upper: 'upper', sweep: 'sweep', special: 'special', recovery: 'recovery', slam: 'down', counter: 'down', dash: 'down', grab: 'grab', pummel: 'pummel', throw: 'fthrow' };
export const resolveMoveId = (name: string): MoveId => (MOVE_IDS as readonly string[]).includes(name) ? name as MoveId : LEGACY[name] ?? 'jab1';

import type { Controls } from './controls';

export interface Box { x0: number; x1: number; y0: number; y1: number }
export const box = (x0: number, x1: number, y0: number, y1: number): Box => ({ x0, x1, y0, y1 });

/** Launch speed is (base + targetDamage * growth) / weight. angle: 0 = away along the ground, 90 = straight up. */
export interface Launch { angle: number; base: number; growth: number }

export interface HitWindow {
  /** First and last `Attack.age` on which this window can connect. */
  from: number; to: number;
  box: Box;
  damage: number;
  launch: Launch;
  /** Hitstun = stun + round(launchSpeed * stunScale). Defaults 11 and 38, the original tuning. */
  stun?: number; stunScale?: number;
  /** Hitstop frames for both fighters. Defaults to a value derived from damage. */
  stop?: number;
  /** Frames before this window may hit the same target again. Absent: it can hit a target once per move. */
  rehit?: number;
  /** Horizontal launch direction: away from the attacker (default) or the way the attacker faces. */
  dir?: 'away' | 'facing';
}

/** Buffered follow-up the move may be cancelled into. `on` gates it by what the move has done so far. */
export interface Cancel { into: MoveId | 'jump'; from: number; to?: number; on: 'always' | 'contact' | 'hit' }
/** Forward (facing-relative) velocity applied on frames [from, to]. */
export interface Lunge { from: number; to: number; vx: number }

export interface ProjectileDef {
  /** Launch frame of the move. */
  fire: number;
  vx: number; vy: number; gravity: number; accel?: number; life: number;
  /** Hit volume half-extents around the shot centre. */
  rx: number; ry: number;
  damage: number; launch: Launch; stun?: number; stop?: number;
  spawn: { x: number; y: number };
  /** What the stage's solid roof does to it. Upper platforms never stop a shot. */
  solid: 'break' | 'bounce';
  /** Projectile explodes with this radius multiplier for the impact particle/telegraph. */
  blast?: number;
}
export interface CounterDef { from: number; to: number; damage: number; launch: Launch; stun?: number; stop?: number; /** frames of endlag left after a successful counter */ after: number }
export interface ArmorDef { from: number; to: number; /** hits at or below this damage are absorbed */ limit: number }
export interface DiveDef { /** Fixed fall speed while diving. */ speed: number }
export interface RecoveryDef { vy: number; vx: number; /** per-tick horizontal steering toward held direction while the move is active */ drift: number }
export interface GrabDef { from: number; to: number; box: Box }
export interface ThrowDef { release: number; damage: number; launch: Launch; stun?: number; stop?: number }

export interface MoveDef {
  id: MoveId;
  name: string;
  kind: Move;
  duration: number;
  hits: HitWindow[];
  lunge?: Lunge[];
  /** Fraction of normal air steering kept while the move is active. */
  air?: number;
  /** Ground velocity multiplier per tick while the move is active (default 0.8). */
  slide?: number;
  /** Frames of landing lag when an aerial touches down before it finishes. */
  landing?: number;
  cancels?: Cancel[];
  projectile?: ProjectileDef;
  counter?: CounterDef;
  armor?: ArmorDef;
  dive?: DiveDef;
  recovery?: RecoveryDef;
  grab?: GrabDef;
  throwing?: ThrowDef;
  /** Pummel damage. */
  pummel?: number;
  /** Derived timing: first active frame and number of active frames. */
  start: number;
  active: number;
  /** True for moves usable in the air. */
  aerial: boolean;
}

export type MoveSpec = Omit<MoveDef, 'id' | 'name' | 'start' | 'active' | 'aerial' | 'hits' | 'kind'> & { hits?: HitWindow[]; kind?: Move; aerial?: boolean };

const span = (d: Omit<MoveDef, 'start' | 'active'>): { start: number; active: number } => {
  if (d.projectile) return { start: d.projectile.fire, active: 1 };
  if (d.counter) return { start: d.counter.from, active: d.counter.to - d.counter.from + 1 };
  if (d.grab) return { start: d.grab.from, active: d.grab.to - d.grab.from + 1 };
  if (d.throwing) return { start: d.throwing.release, active: 1 };
  if (d.hits.length) { const from = Math.min(...d.hits.map(h => h.from)), to = Math.max(...d.hits.map(h => h.to)); return { start: from, active: to - from + 1 }; }
  return { start: d.lunge?.[0]?.from ?? 0, active: d.lunge ? d.lunge[d.lunge.length - 1].to - d.lunge[0].from + 1 : 1 };
};

const KIND_OF: Record<MoveId, Move> = {
  jab1: 'jab', jab2: 'jab', jab3: 'jab', heavy: 'heavy', upper: 'upper', sweep: 'sweep', nair: 'aerial', fair: 'aerial', bair: 'aerial', uair: 'aerial', dair: 'aerial',
  special: 'special', recovery: 'recovery', down: 'slam', grab: 'grab', pummel: 'pummel', fthrow: 'throw', bthrow: 'throw', uthrow: 'throw', dthrow: 'throw',
};

/** Builds a complete move definition; derives the category, active span and aerial flag. */
export function defineMove(id: MoveId, name: string, spec: MoveSpec): MoveDef {
  const base = { ...spec, id, name, kind: spec.kind ?? KIND_OF[id], hits: spec.hits ?? [], aerial: spec.aerial ?? (id === 'nair' || id === 'fair' || id === 'bair' || id === 'uair' || id === 'dair') };
  return { ...base, ...span(base) };
}

/** A single-window melee move: timing is [startup, activeFrames, duration]. */
export interface MeleeSpec {
  t: [number, number, number];
  box: [number, number, number, number];
  dmg: number;
  /** [angle, base, growth] */
  kb: [number, number, number];
  stun?: number; stunScale?: number; stop?: number; dir?: 'away' | 'facing';
}
export const window = (from: number, to: number, bx: Box, damage: number, kb: [number, number, number], extra: Partial<HitWindow> = {}): HitWindow =>
  ({ from, to, box: bx, damage, launch: { angle: kb[0], base: kb[1], growth: kb[2] }, ...extra });

export function melee(id: MoveId, name: string, m: MeleeSpec, extra: Partial<MoveSpec> = {}): MoveDef {
  const [startup, active, duration] = m.t;
  const hit = window(startup, startup + active - 1, box(...m.box), m.dmg, m.kb, { stun: m.stun, stunScale: m.stunScale, stop: m.stop, dir: m.dir });
  return defineMove(id, name, { duration, hits: [hit], ...extra });
}

export const launch = (angle: number, base: number, growth: number): Launch => ({ angle, base, growth });

/** Derived hitstop: heavier hits freeze longer, within a readable range. */
export const defaultStop = (damage: number) => Math.max(4, Math.min(9, Math.round(3 + damage * 0.28)));

/** Furthest forward reach of a move's hit volumes, measured from the attacker's centre. */
export const moveReach = (m: MoveDef): number => {
  let reach = 0;
  for (const h of m.hits) reach = Math.max(reach, h.box.x1);
  if (m.grab) reach = Math.max(reach, m.grab.box.x1);
  if (m.projectile) reach = Math.max(reach, m.projectile.spawn.x + m.projectile.vx * m.projectile.life * 0.5);
  return reach;
};

export interface ComboInfo {
  name: string;
  /** Human-readable input sequence using P1's key names. "→" means toward the opponent. */
  inputs: string;
  /** true: the defender cannot act between hits. pressure: strong but escapable. read: needs a guess about the opponent. */
  kind: 'true' | 'pressure' | 'read';
  /** One-tick presses the tests replay: tick -> controls (x: 1 means toward the opponent). Present on verified routes. */
  script?: Record<number, Partial<Controls>>;
  /** Ticks between which "toward the opponent" is held while replaying the script. */
  hold?: [number, number];
  /** Hit kinds the replay must produce, in order. */
  kinds?: string[];
  /**
   * Highest damage percent at which the route stays a true combo on an average-weight defender (Hunter, weight 1.0):
   * with no DI, and with the defender holding away. -1 means it never connects against that. Verified by combos.test.ts.
   */
  limits?: { none: number; away: number };
  note: string;
}
