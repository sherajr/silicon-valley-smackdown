import { describe, expect, it } from 'vitest';
import { CombatSim } from '../../sim/CombatSim';
import { MAUL } from './maul';
import { KEVIN } from './kevin';
import { HUNTER } from './hunter';
import { neutralFrameInput, type PlayerFrameInput } from '../../sim/types';

/**
 * Maul's basic string has the same failure mode Hunter's did (see hunter.combo.test.ts): the
 * damage-scaled default knockback on the first two links pushes the target out of reach of the
 * third, so a natural Basic mash lands 2 of 3. He is more exposed to it than Hunter because
 * basic3 is a whirl centred on the body rather than a reaching poke.
 *
 * Driven entirely through CombatSim's own chaining -- Basic is pressed only when a player could
 * press it, and hits are counted from the sim's events. Nothing is injected or forced.
 */

function inputs(overrides: Partial<PlayerFrameInput> = {}): PlayerFrameInput {
  return { ...neutralFrameInput(), ...overrides };
}

function idleSim(p1Def = MAUL, p2Def = KEVIN): CombatSim {
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
  facingAtContact: number[];
}

function runBasicString(sim: CombatSim, attacker: 'p1' | 'p2', defenderInput: () => PlayerFrameInput): Recorded {
  const out: Recorded = { started: [], hits: [], facingAtContact: [] };
  let requests = 0;
  for (let wall = 0; wall < 150; wall++) {
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
    }
  }
  return out;
}

describe('Maul basic string reach', () => {
  it('connects all three basics against an idle Kevin, with Maul on the left facing right', () => {
    const sim = idleSim();
    sim.p1.x = 200;
    sim.p2.x = 245;

    const run = runBasicString(sim, 'p1', () => inputs());

    expect(run.started).toEqual(['basic1', 'basic2', 'basic3']);
    expect(run.hits).toHaveLength(3);
    expect(run.facingAtContact.every((f) => f === 1)).toBe(true);
    expect(sim.p2.health).toBeLessThan(KEVIN.maxHealth);
  });

  it('connects all three with Maul genuinely on the right, facing left', () => {
    // Facing is derived from relative position, so the mirror has to put the ATTACKER at the
    // higher x -- swapping player slots alone would leave him on the left, testing nothing new.
    const sim = idleSim(KEVIN, MAUL);
    sim.p1.x = 200; // Kevin, the defender
    sim.p2.x = 245; // Maul, the attacker

    const run = runBasicString(sim, 'p2', () => inputs());

    expect(run.started).toEqual(['basic1', 'basic2', 'basic3']);
    expect(run.hits).toHaveLength(3);
    expect(sim.p2.x).toBeGreaterThan(sim.p1.x);
    expect(run.facingAtContact.every((f) => f === -1)).toBe(true);
  });

  it('keeps the finisher knockback clearly stronger than the two jabs that set it up', () => {
    expect(MAUL.moves.basic1.hits[0].effect.knockback.x).toBe(1.5);
    expect(MAUL.moves.basic2.hits[0].effect.knockback.x).toBe(1.8);
    expect(MAUL.moves.basic3.hits[0].effect.knockback.x).toBe(6.5);
  });
});

describe('Maul reach and fragility', () => {
  it('outranges Hunter on the equivalent normals, which is what REACH 5 is claiming', () => {
    const reachOf = (def: typeof MAUL, kind: 'basic1' | 'forwardBasic') => {
      const b = def.moves[kind].hits[0].box;
      return b.x + b.w;
    };
    expect(reachOf(MAUL, 'basic1')).toBeGreaterThan(reachOf(HUNTER, 'basic1'));
    expect(reachOf(MAUL, 'forwardBasic')).toBeGreaterThan(reachOf(HUNTER, 'forwardBasic'));
    expect(MAUL.reach).toBe(5);
  });

  it('pays for that reach with the shortest health bar among the regular roster', () => {
    for (const def of [HUNTER, KEVIN]) expect(MAUL.maxHealth).toBeLessThan(def.maxHealth);
  });
});
