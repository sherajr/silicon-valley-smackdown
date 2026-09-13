import { describe, expect, it } from 'vitest';
import { CombatSim } from '../../sim/CombatSim';
import { HUNTER } from './hunter';
import { KEVIN } from './kevin';
import { neutralFrameInput, type PlayerFrameInput } from '../../sim/types';

/**
 * Regression coverage for Hunter's basic1/basic2 knockback tuning (1.5 / 1.8 rather than the
 * damage-scaled defaults of 3.28 / 3.64). With the defaults, two jabs pushed the target just out
 * of basic3's reach, so only 2 of the 3 moves in the natural mash string connected.
 *
 * Everything here is driven through CombatSim's own chaining and candidate resolution -- Basic is
 * pressed when a real player could press it, and hits are counted from the sim's own events. No
 * hit is injected and no health is forced.
 */

function inputs(overrides: Partial<PlayerFrameInput> = {}): PlayerFrameInput {
  return { ...neutralFrameInput(), ...overrides };
}

function idleSim(p1Def = HUNTER, p2Def = KEVIN): CombatSim {
  const sim = new CombatSim({ p1Def, p2Def, powerupsEnabled: false, seed: 1 });
  for (const f of [sim.p1, sim.p2]) {
    f.state = 'idle';
    f.stateTimer = 0;
  }
  return sim;
}

interface Recorded {
  started: string[];
  hits: { damage: number }[];
  blocked: { damage: number; guardBreak: boolean }[];
  /** The attacker's facing sampled on every frame a hit or block actually landed. */
  facingAtContact: number[];
}

/**
 * Mashes Basic once per opportunity (only while idle and outside hit-stop, matching how a player
 * actually chains a Basic string) and records what the sim reports back.
 */
function runBasicString(
  sim: CombatSim,
  attacker: 'p1' | 'p2',
  defenderInput: () => PlayerFrameInput,
  wallFrames = 150,
): Recorded {
  const out: Recorded = { started: [], hits: [], blocked: [], facingAtContact: [] };
  let requests = 0;
  for (let wall = 0; wall < wallFrames; wall++) {
    const self = attacker === 'p1' ? sim.p1 : sim.p2;
    const a = inputs();
    if (requests < 3 && self.state === 'idle' && sim.freezeFrames === 0) {
      a.basicPressed = true;
      a.basicHeld = true;
      requests++;
    }
    const p1Input = attacker === 'p1' ? a : defenderInput();
    const p2Input = attacker === 'p1' ? defenderInput() : a;
    for (const e of sim.step(p1Input, p2Input)) {
      if (e.type === 'moveStarted' && e.who === attacker) out.started.push(e.kind);
      if (e.type === 'hit' && e.attacker === attacker) {
        out.hits.push({ damage: e.damage });
        out.facingAtContact.push(self.facing);
      }
      if (e.type === 'blocked' && e.attacker === attacker) {
        out.blocked.push({ damage: e.damage, guardBreak: e.guardBreak });
        out.facingAtContact.push(self.facing);
      }
    }
  }
  return out;
}

describe('Hunter basic string reach', () => {
  it('connects all three basics against an idle Kevin, with Hunter on the left facing right', () => {
    const sim = idleSim();
    sim.p1.x = 200;
    sim.p2.x = 239;

    const run = runBasicString(sim, 'p1', () => inputs());

    expect(run.started).toEqual(['basic1', 'basic2', 'basic3']);
    expect(run.hits).toHaveLength(3);
    // Attacker really is on the left, so every contact happens while facing right.
    expect(run.facingAtContact.every((f) => f === 1)).toBe(true);
    expect(sim.p1.x).toBeLessThan(sim.p2.x);
    expect(sim.p2.health).toBeLessThan(KEVIN.maxHealth);
  });

  it('connects all three basics with Hunter genuinely on the right, facing left', () => {
    // The mirrored case has to put the ATTACKER at the higher x -- facing is derived from
    // relative position, so swapping player slots while leaving Hunter at the lower x leaves him
    // on the left facing right, testing nothing new.
    const sim = idleSim(KEVIN, HUNTER);
    sim.p1.x = 200; // Kevin, the defender, on the left
    sim.p2.x = 239; // Hunter, the attacker, on the right

    const run = runBasicString(sim, 'p2', () => inputs());

    expect(run.started).toEqual(['basic1', 'basic2', 'basic3']);
    expect(run.hits).toHaveLength(3);
    // The point of the mirror: Hunter is to the right of his target and strikes leftward.
    expect(sim.p2.x).toBeGreaterThan(sim.p1.x);
    expect(run.facingAtContact).toHaveLength(3);
    expect(run.facingAtContact.every((f) => f === -1)).toBe(true);
    expect(sim.p1.health).toBeLessThan(KEVIN.maxHealth);
  });

  it('produces blocked chip rather than clean hits against an actively blocking Kevin', () => {
    const sim = idleSim();
    sim.p1.x = 200;
    sim.p2.x = 239;

    const run = runBasicString(sim, 'p1', () => inputs({ blockHeld: true }));

    // Blocked contacts are 'blocked' events, never 'hit' events -- counting chip as unblocked
    // damage is exactly the mistake this assertion guards against.
    expect(run.hits).toHaveLength(0);
    expect(run.blocked.length).toBeGreaterThanOrEqual(3);
    const chip = run.blocked.reduce((sum, b) => sum + b.damage, 0);
    expect(chip).toBeGreaterThan(0);
    expect(chip).toBeLessThan(6); // far below the 6+8+12=26 an unblocked string deals
    expect(run.blocked.some((b) => b.guardBreak)).toBe(false); // three light jabs don't break guard
    expect(sim.p2.guard).toBeGreaterThan(0);
    expect(['idle', 'walk', 'block', 'crouch', 'blockstun']).toContain(sim.p2.state); // never stuck
  });

  it('keeps the finisher knockback clearly stronger than the two jabs that set it up', () => {
    expect(HUNTER.moves.basic1.hits[0].effect.knockback.x).toBe(1.5);
    expect(HUNTER.moves.basic2.hits[0].effect.knockback.x).toBe(1.8);
    expect(HUNTER.moves.basic3.hits[0].effect.knockback.x).toBe(6);
  });
});
