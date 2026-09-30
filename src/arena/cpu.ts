/**
 * CPU opponent. It produces ordinary `Controls`, so every action passes through the same input buffer and legality
 * rules as a human's: it cannot act during hitstun, grab in the air, repeat a spent recovery, or react instantly.
 * Decisions read the fighter's move definitions, so each character is played to its own ranges and tools.
 * Seeded: all randomness comes from the simulation's generator.
 */
import { FIGHTERS } from './fighterDefinitions';
import { noInput } from './controls';
import type { Controls } from './controls';
import type { ArenaSim, Fighter } from './Simulation';

export interface CpuState { action: number; techAt: number }

/** Distance between centres at which a move's forward hit volume reaches an opponent of this width. */
const reachOf = (f: Fighter, id: 'jab1' | 'heavy' | 'fair', opponentHw: number) => FIGHTERS[f.character].moves[id].hits[0].box.x1 + opponentHw;

/** Chance the CPU takes an optional follow-up, by difficulty (Intern, Founder, Board member). */
const FOLLOW_UP = [0.25, 0.55, 0.85];
const TECH_CHANCE = [0.12, 0.4, 0.7];

export function cpuControls(sim: ArenaSim): Controls {
  const c = noInput(), f = sim.fighters[1], o = sim.fighters[0], st = sim.cpu;
  if (f.respawn || f.stocks === 0) return c;
  const def = FIGHTERS[f.character], ai = def.ai, level = sim.options.difficulty;
  const dx = o.x - f.x, dy = o.y - f.y, dist = Math.abs(dx);

  // Caught: usually try to tech, never instantly and never perfectly.
  if (f.heldBy === 0 && o.hold) {
    if (o.hold.age <= 1 && st.techAt < 0) st.techAt = sim.random() < TECH_CHANCE[level] ? 1 + Math.floor(sim.random() * (6 - level)) : 99;
    if (o.hold.age === st.techAt) c.grab = true;
    return c;
  }
  st.techAt = -1;

  // Holding someone: maybe one pummel, then a throw chosen for the situation.
  if (f.hold) {
    if (f.attack) return c;
    const h = f.hold;
    if (h.pummels < 1 && h.age >= 2 && h.age < 6 && level > 0 && sim.random() < 0.5) { c.attack = true; return c; }
    if (h.age < 10) return c;
    c.grab = true;
    let dir = ai.throwDir;
    // A heavily damaged opponent near an edge gets thrown off it.
    if (o.damage > 90 && Math.abs(o.x) > 5) dir = Math.sign(o.x) === f.facing ? 'f' : 'b';
    if (dir === 'b') c.x = -f.facing; else if (dir === 'u') c.up = true; else if (dir === 'd') c.down = true;
    return c;
  }

  const offstage = Math.abs(f.x) > 9.0 || f.y < -0.15;
  if (offstage) {
    c.x = -Math.sign(f.x);
    sim.faceToward(f, c.x);
    if (f.vy < 0.06 && sim.tick % 10 === 0 && f.jumps < 2) c.jump = true;
    if (f.y < -1.2 && f.vy < 0.08 && f.jumps >= 2 && !f.recovered) { c.up = true; c.special = true; }
    return c;
  }

  sim.faceToward(f, dx);
  c.x = dist > ai.spacing ? Math.sign(dx) : 0;
  if (Math.abs(f.x) > 8.5 && c.x === Math.sign(f.x)) c.x = 0;
  if (dy > 1.5 && f.vy <= 0.01 && f.jumps < 2 && sim.tick % 23 === 0) c.jump = true;
  if (dy < -1.8 && f.grounded && f.y > 0) c.down = true;

  // Follow-up routes: when a move lands, sometimes take its on-hit cancel instead of letting the string end.
  const a = f.attack;
  if (a) {
    const cancel = a.def.cancels?.find(k => a.age === k.from && (k.on === 'always' || (k.on === 'hit' && a.landed) || (k.on === 'contact' && a.hit)));
    if (cancel && sim.random() < FOLLOW_UP[level] + (a.kind === 'jab' ? 0.15 : 0)) {
      if (cancel.into === 'jump') c.jump = true;
      else if (cancel.into === 'upper') { c.attack = true; c.up = true; }
      else if (cancel.into === 'heavy') { c.attack = true; c.x = Math.sign(dx); }
      else if (cancel.into === 'special') c.special = true;
      else if (cancel.into === 'grab') c.grab = true;
      else c.attack = true;
    }
    return c;
  }
  // Airborne with the opponent in hitstun beside or above: follow up with an aerial toward them.
  if (!f.grounded && o.stun > 0 && dist < reachOf(f, 'fair', def.hurt.hw) + 0.2 && Math.abs(dy) < 2.6) {
    c.attack = true; c.x = Math.sign(dx);
    if (dy > 1.4) c.up = true; else if (dy < -1.2) c.down = true;
    return c;
  }

  if (--st.action <= 0) {
    st.action = 12 + (2 - level) * 9 + Math.floor(sim.random() * 12);
    const closeToPoke = dist < reachOf(f, 'jab1', FIGHTERS[o.character].hurt.hw) + 0.55 && Math.abs(dy) < 1.7;
    const special = def.moves.down;
    if (closeToPoke) {
      if (o.guarding && f.grounded && Math.abs(dy) < 0.3 && sim.random() < 0.7) c.grab = true;
      else if (special.kind === 'counter' && o.attack && level > 0 && sim.random() < 0.35) { c.special = true; c.down = true; }
      else if (special.kind === 'slam' && sim.random() < 0.12 && f.grounded) { c.special = true; c.down = true; }
      else { c.attack = true; if (sim.random() < 0.35) c.x = Math.sign(dx); }
    } else if (dist > ai.zone && Math.abs(dy) < 1.6 && sim.random() < 0.5 + level * 0.15) c.special = true;
    else if (special.kind === 'dash' && dist > 3 && f.grounded && sim.random() < 0.3) { c.special = true; c.down = true; }
    if (f.grounded && sim.random() < 0.10 + level * 0.06) c.jump = true;
  }
  if (level > 0 && o.attack && dist < 2.9 && Math.abs(dy) < 1.6 && sim.tick % 80 < 25 + level * 8) { c.shield = true; c.x = 0; }
  return c;
}
