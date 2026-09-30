/** Shared helpers for input-driven Arena tests. Not imported by the game. */
import { ArenaSim, noInput } from './Simulation';
import type { Controls, Fighter, MatchOptions, MoveId } from './Simulation';

export const make = (extra: Partial<MatchOptions> = {}) => {
  const s = new ArenaSim({ fighters: [0, 1], stage: 0, mode: 'versus', difficulty: 1, items: false, seed: 7, ...extra });
  s.countdown = 0; return s;
};

export const ctl = (c: Partial<Controls> = {}): Controls => ({ ...noInput(), ...c });

/** Steps the simulation `n` ticks with the same controls each tick (a level: holding keys). */
export function run(s: ArenaSim, n: number, p1: Partial<Controls> = {}, p2: Partial<Controls> = {}) {
  for (let i = 0; i < n; i++) s.step([ctl(p1), ctl(p2)]);
}

/** One-tick button taps at chosen ticks (relative to now), neutral otherwise. Keys in a tap are pressed together. */
export type Taps = Record<number, Partial<Controls>>;
export function replay(s: ArenaSim, p1: Taps, total: number, p2: Taps = {}) {
  for (let t = 0; t < total; t++) s.step([ctl(p1[t]), ctl(p2[t])]);
}

/** Clean, close-range setup: both fighters standing on the main stage, facing each other. */
export function faceOff(s: ArenaSim, gap = 1.1, x = 0) {
  const [a, b] = s.fighters;
  for (const f of [a, b]) Object.assign(f, { y: 0, prevY: 0, vx: 0, vy: 0, stun: 0, invincible: 0, damage: 0, attack: null, grounded: true, support: 'main' });
  a.x = a.prevX = x; b.x = b.prevX = x + gap; a.facing = 1; b.facing = -1;
}

/** Ticks until `until` is true (or throws after `max`). Returns the tick count. */
export function runUntil(s: ArenaSim, until: () => boolean, max = 300, p1: Partial<Controls> = {}, p2: Partial<Controls> = {}): number {
  for (let i = 0; i < max; i++) { if (until()) return i; s.step([ctl(p1), ctl(p2)]); }
  throw new Error(`condition not reached in ${max} ticks`);
}

/**
 * Two fighters set up so `actor` (either slot) faces `facing` with `other` in front of them, `gap` apart. Controls are
 * given per role, so the same scenario runs unchanged for both slots and both directions.
 */
export function duel(actorSlot: 0 | 1, facing: 1 | -1, gap = 1.1, extra: Partial<MatchOptions> = {}) {
  const s = make(extra), actor = s.fighters[actorSlot], other = s.fighters[1 - actorSlot];
  for (const f of [actor, other]) Object.assign(f, { y: 0, prevY: 0, vx: 0, vy: 0, grounded: true, support: 'main' });
  actor.x = actor.prevX = 0; other.x = other.prevX = facing * gap; actor.facing = facing; other.facing = -facing;
  const step = (n: number, a: Partial<Controls> = {}, o: Partial<Controls> = {}) => {
    for (let i = 0; i < n; i++) s.step(actorSlot === 0 ? [ctl(a), ctl(o)] : [ctl(o), ctl(a)]);
  };
  const until = (done: () => boolean, max = 300, a: Partial<Controls> = {}, o: Partial<Controls> = {}) => {
    for (let i = 0; i < max; i++) { if (done()) return i; step(1, a, o); }
    throw new Error(`condition not reached in ${max} ticks`);
  };
  return { s, actor, other, step, until, facing };
}

export const attackId = (f: Fighter): MoveId | null => f.attack?.id ?? null;
export const events = (s: ArenaSim, type: string) => s.events.filter(e => e.type === type);

export interface ComboRun { kinds: string[]; comboMax: number; hits: number; damage: number; sim: ArenaSim }
/**
 * Replays a documented combo's input script from the attacker's side against an idle defender, through real controls.
 * `di` makes the defender hold a direction while in hitstun (away from, or toward, the attacker).
 */
export function runCombo(attacker: number, defender: number, percent: number, combo: { script?: Record<number, Partial<Controls>>; hold?: [number, number] }, opts: { facing?: 1 | -1; slot?: 0 | 1; di?: 'none' | 'away' | 'toward'; tail?: number } = {}): ComboRun {
  const facing = opts.facing ?? 1, slot = opts.slot ?? 0;
  const s = make({ fighters: slot === 0 ? [attacker, defender] : [defender, attacker] });
  const a = s.fighters[slot], v = s.fighters[1 - slot];
  a.x = a.prevX = 0; v.x = v.prevX = facing * 1.1; a.facing = facing; v.facing = -facing; v.damage = percent;
  const taps = combo.script ?? {}, last = Math.max(...Object.keys(taps).map(Number));
  const kinds: string[] = []; let comboMax = 0, hits = 0;
  for (let t = 0; t < last + (opts.tail ?? 80); t++) {
    const tap = taps[t];
    const towards = (tap?.x ?? 0) * facing || (combo.hold && t >= combo.hold[0] && t <= combo.hold[1] ? facing : 0);
    const mine = ctl({ ...tap, x: towards });
    const dodge = opts.di && opts.di !== 'none' && v.stun > 0 ? ctl({ x: (opts.di === 'away' ? 1 : -1) * facing }) : ctl();
    s.step(slot === 0 ? [mine, dodge] : [dodge, mine]);
    for (const e of s.events) {
      if (e.type === 'hit' && e.slot === v.slot) { hits++; kinds.push(e.text ?? '?'); }
      if (e.type === 'combo') comboMax = Math.max(comboMax, e.value ?? 0);
    }
    s.events.length = 0;
  }
  return { kinds, comboMax, hits, damage: v.damage - percent, sim: s };
}

/** A replay counts as a confirmed combo when every expected hit landed, in order, without the defender acting. */
export const isTrueCombo = (run: ComboRun, kinds: string[]) => run.hits >= kinds.length && kinds.every((k, i) => run.kinds[i] === k) && (kinds.length < 2 || run.comboMax >= kinds.length);
