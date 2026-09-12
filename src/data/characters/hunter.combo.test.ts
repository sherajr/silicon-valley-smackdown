import { describe, expect, it } from 'vitest';
import { CombatSim } from '../../sim/CombatSim';
import { HUNTER } from './hunter';
import { KEVIN } from './kevin';
import { neutralFrameInput, type PlayerFrameInput } from '../../sim/types';

/**
 * Regression coverage for the knockback tuning Codex's evidence-based review proposed and this
 * session applied: Hunter's basic1/basic2 knockback.x reduced from the damage-scaled defaults
 * (3.28/3.64) to 1.5/1.8, so the natural basic1->basic2->basic3 mash string keeps the target in
 * basic3's reach instead of pushing it just out of range after two jabs. Codex's own probe
 * verified this against an idle target only; these tests also cover an actively-blocking
 * defender and the opposite facing, per its explicit caveat that neither was checked.
 */

function inputs(overrides: Partial<PlayerFrameInput> = {}): PlayerFrameInput {
  return { ...neutralFrameInput(), ...overrides };
}

function freshSim(): CombatSim {
  const sim = new CombatSim({ p1Def: HUNTER, p2Def: KEVIN, powerupsEnabled: false, seed: 1 });
  sim.p1.state = 'idle';
  sim.p1.stateTimer = 0;
  sim.p2.state = 'idle';
  sim.p2.stateTimer = 0;
  return sim;
}

/** Mashes Basic once per opportunity (only while idle and not mid-hit-stop, matching how a
 * player actually chains a Basic string) for up to `wallFrames` steps, tracking every
 * moveStarted/hit event the sim produces via its own chaining/candidate resolution -- nothing
 * injected. */
function runBasicString(sim: CombatSim, attacker: 'p1' | 'p2', defenderInput: () => PlayerFrameInput, wallFrames = 150) {
  const events: { simFrame: number; type: string; kind?: string; damage?: number }[] = [];
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
      if (e.type === 'moveStarted' || e.type === 'hit') events.push({ simFrame: sim.frameCount, type: e.type, kind: 'kind' in e ? e.kind : undefined, damage: 'damage' in e ? e.damage : undefined });
    }
  }
  return events;
}

describe('Hunter basic string reach (post-tuning)', () => {
  it('all three basics connect against an idle Kevin (P1 attacks P2)', () => {
    const sim = freshSim();
    sim.p1.x = 200;
    sim.p2.x = 239; // matches the distance used in Codex's own probe

    const events = runBasicString(sim, 'p1', () => inputs());
    const hits = events.filter((e) => e.type === 'hit');
    const started = events.filter((e) => e.type === 'moveStarted').map((e) => e.kind);

    expect(started).toEqual(['basic1', 'basic2', 'basic3']);
    expect(hits).toHaveLength(3);
    expect(sim.p2.health).toBeLessThan(KEVIN.maxHealth);
  });

  it('all three basics connect against an idle Hunter with facing mirrored (P2 attacks P1)', () => {
    const sim = freshSim();
    // Rebuild as Kevin(p1)/Hunter(p2) so the attacking Hunter is on the right, facing left --
    // the opposite facing from the test above.
    const mirrored = new CombatSim({ p1Def: KEVIN, p2Def: HUNTER, powerupsEnabled: false, seed: 1 });
    mirrored.p1.state = 'idle';
    mirrored.p1.stateTimer = 0;
    mirrored.p2.state = 'idle';
    mirrored.p2.stateTimer = 0;
    mirrored.p2.x = 200;
    mirrored.p1.x = 239;

    const events = runBasicString(mirrored, 'p2', () => inputs());
    const hits = events.filter((e) => e.type === 'hit');
    const started = events.filter((e) => e.type === 'moveStarted').map((e) => e.kind);

    expect(started).toEqual(['basic1', 'basic2', 'basic3']);
    expect(hits).toHaveLength(3);
  });

  it('against an actively-blocking Kevin, the same string only chips guard/health and never locks Kevin out of acting', () => {
    const sim = freshSim();
    sim.p1.x = 200;
    sim.p2.x = 239;

    const events = runBasicString(sim, 'p1', () => inputs({ blockHeld: true }));
    const totalDamage = events.filter((e) => e.type === 'hit').reduce((sum, e) => sum + (e.damage ?? 0), 0);

    // Chip damage only, nowhere near a full unblocked string's worth (6+8+12=26).
    expect(totalDamage).toBeLessThan(6);
    expect(sim.p2.guard).toBeGreaterThan(0); // not guard-broken by three light jabs
    expect(['idle', 'walk', 'block', 'crouch', 'blockstun']).toContain(sim.p2.state); // never stuck
  });
});
