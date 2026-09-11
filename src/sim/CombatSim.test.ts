import { describe, expect, it } from 'vitest';
import { CombatSim } from './CombatSim';
import { localBoxToWorld } from './collision';
import { HUNTER } from '../data/characters/hunter';
import { neutralFrameInput, type PlayerFrameInput } from './types';
import { GPU_DAMAGE_MULT, MAX_HYPE } from './constants';

function inputs(overrides: Partial<PlayerFrameInput> = {}): PlayerFrameInput {
  return { ...neutralFrameInput(), ...overrides };
}

function freshSim(seed = 1, powerupsEnabled = false): CombatSim {
  const sim = new CombatSim({ p1Def: HUNTER, p2Def: HUNTER, powerupsEnabled, seed });
  // Skip the intro freeze so tests act on 'idle' fighters immediately.
  sim.p1.state = 'idle';
  sim.p1.stateTimer = 0;
  sim.p2.state = 'idle';
  sim.p2.stateTimer = 0;
  return sim;
}

function pressAndRelease(): PlayerFrameInput[] {
  return [inputs({ basicHeld: true, basicPressed: true }), inputs({ basicHeld: false })];
}

describe('CombatSim basics', () => {
  it('only deals damage during a move active window, and only once per activation', () => {
    const sim = freshSim();
    sim.p1.x = 150;
    sim.p2.x = 150 + 30; // within basic1 range (box x=18..42)
    const startHealth = sim.p2.health;

    // Frame 0: press basic.
    sim.step(inputs({ basicHeld: true, basicPressed: true }), inputs());
    // Startup is 4 frames; active starts at frame 4 for 3 frames. Step through neutral frames.
    let damagedAt = -1;
    for (let i = 1; i <= 15; i++) {
      sim.step(inputs(), inputs());
      if (sim.p2.health < startHealth && damagedAt === -1) damagedAt = i;
    }
    expect(damagedAt).toBeGreaterThan(0);
    const healthAfterFirstHit = sim.p2.health;
    expect(healthAfterFirstHit).toBeLessThan(startHealth);

    // Continue stepping; health should not drop further from the same activation.
    for (let i = 0; i < 10; i++) sim.step(inputs(), inputs());
    expect(sim.p2.health).toBe(healthAfterFirstHit);
  });

  it('mirrors hitboxes correctly when facing left', () => {
    const rightBox = localBoxToWorld({ x: 10, y: -10, w: 5, h: 5 }, 100, 0, 1);
    const leftBox = localBoxToWorld({ x: 10, y: -10, w: 5, h: 5 }, 100, 0, -1);
    expect(rightBox.left).toBe(110);
    expect(leftBox.right).toBe(90);
    expect(rightBox.right - rightBox.left).toBe(leftBox.right - leftBox.left);
  });

  it('lets a left-facing fighter hit an opponent positioned to their left', () => {
    const sim = freshSim();
    sim.p2.x = 300;
    sim.p1.x = 300 - 30;
    sim.p1.facing = -1;
    sim.p2.facing = 1;
    const startHealth = sim.p2.health;
    for (const frame of pressAndRelease()) sim.step(frame, inputs());
    for (let i = 0; i < 12; i++) sim.step(inputs(), inputs());
    expect(sim.p2.health).toBeLessThan(startHealth);
  });

  it('standing block does not stop a low attack, but crouch-block does', () => {
    const simA = freshSim();
    simA.p1.x = 150;
    simA.p2.x = 180;
    const startHealthA = simA.p2.health;
    simA.step(inputs(), inputs({ blockHeld: true }));
    for (let i = 0; i < 3; i++) simA.step(inputs(), inputs({ blockHeld: true }));
    simA.step(inputs({ down: true, basicHeld: true, basicPressed: true }), inputs({ blockHeld: true }));
    for (let i = 0; i < 12; i++) simA.step(inputs({ down: true }), inputs({ blockHeld: true }));
    expect(simA.p2.health).toBeLessThan(startHealthA); // standing block: low still connects

    const simB = freshSim();
    simB.p1.x = 150;
    simB.p2.x = 180;
    const startHealthB = simB.p2.health;
    for (let i = 0; i < 3; i++) simB.step(inputs(), inputs({ blockHeld: true, down: true }));
    simB.step(inputs({ down: true, basicHeld: true, basicPressed: true }), inputs({ blockHeld: true, down: true }));
    for (let i = 0; i < 12; i++) simB.step(inputs({ down: true }), inputs({ blockHeld: true, down: true }));
    // Crouch-block stops a low attack: only small chip damage, never the full hit.
    expect(simB.p2.health).toBeGreaterThan(startHealthB - 2);
    expect(simB.p2.health).toBeLessThan(startHealthA);
  });

  it('a crouching defender evades a high attack entirely (no chip)', () => {
    const sim = freshSim();
    sim.p1.x = 150;
    sim.p2.x = 180;
    sim.p2.state = 'crouch';
    const startHealth = sim.p2.health;
    const startGuard = sim.p2.guard;
    // Hunter's basic3 (chain 3rd hit) is height 'high'; force chain index directly for a simple isolated test instead.
    sim.p1.activeMove = { def: HUNTER.moves.basic3, frame: 0, lastHitFrame: new Map(), isSuper: false };
    sim.p1.state = 'attack';
    for (let i = 0; i < 20; i++) {
      sim.p2.state = 'crouch'; // hold crouch each frame
      sim.step(inputs(), inputs({ down: true }));
    }
    expect(sim.p2.health).toBe(startHealth);
    expect(sim.p2.guard).toBe(startGuard);
  });

  it('grabs beat a standing block, and a grab escape prevents damage', () => {
    const sim = freshSim();
    sim.p1.x = 150;
    sim.p2.x = 170;
    sim.p2.state = 'block';
    sim.p1.activeMove = { def: HUNTER.moves.grab, frame: 0, lastHitFrame: new Map(), isSuper: false };
    sim.p1.state = 'attack';
    const startHealth = sim.p2.health;
    let sawGrabbed = false;
    for (let i = 0; i < 30 && sim.p2.health === startHealth; i++) {
      sim.step(inputs(), inputs({ blockHeld: true }));
      const state: string = sim.p2.state;
      if (state === 'grabbed') sawGrabbed = true;
    }
    expect(sawGrabbed).toBe(true); // block does not prevent the grab from catching them
    expect(sim.p2.health).toBeLessThan(startHealth); // and the throw (unescaped) deals real damage
    expect(sim.p2.state).toBe('knockdown');

    // Escape test: fresh scenario, press grab within the escape window.
    const sim2 = freshSim();
    sim2.p1.x = 150;
    sim2.p2.x = 170;
    sim2.p1.activeMove = { def: HUNTER.moves.grab, frame: 0, lastHitFrame: new Map(), isSuper: false };
    sim2.p1.state = 'attack';
    const startHealth2 = sim2.p2.health;
    for (let i = 0; i < 6; i++) sim2.step(inputs(), inputs());
    // Now p2 should be 'grabbed'. Clear the brief connect hit-stop, then escape within the window.
    expect(sim2.p2.state).toBe('grabbed');
    while (sim2.freezeFrames > 0) sim2.step(inputs(), inputs());
    sim2.step(inputs(), inputs({ grabPressed: true }));
    expect(sim2.p2.state).toBe('idle');
    expect(sim2.p2.health).toBe(startHealth2);
  });

  it('held grab does not auto-escape without a fresh press edge', () => {
    const sim = freshSim();
    sim.p1.x = 150;
    sim.p2.x = 170;
    sim.p1.activeMove = { def: HUNTER.moves.grab, frame: 0, lastHitFrame: new Map(), isSuper: false };
    sim.p1.state = 'attack';
    for (let i = 0; i < 6; i++) sim.step(inputs(), inputs({ grabHeld: true }));
    expect(sim.p2.state).toBe('grabbed');
  });

  it('specials obey cooldown, and a full-meter chord fires exactly one super', () => {
    const sim = freshSim();
    sim.p1.x = 150;
    sim.p2.x = 400; // out of range so nothing actually connects; we only assert move-start behavior
    sim.step(inputs({ specialHeld: true, specialPressed: true }), inputs());
    expect(sim.p1.activeMove?.def.kind).toBe('special');
    expect(sim.p1.cooldowns.special).toBeGreaterThan(0);
    // finish the move and immediately try again while on cooldown
    const total = HUNTER.moves.special.totalFrames;
    for (let i = 0; i < total; i++) sim.step(inputs(), inputs());
    expect(sim.p1.activeMove).toBeNull();
    sim.step(inputs({ specialHeld: true, specialPressed: true }), inputs());
    expect(sim.p1.activeMove).toBeNull(); // still on cooldown, request dropped

    const sim2 = freshSim();
    sim2.p1.x = 150;
    sim2.p2.x = 400;
    sim2.p1.hype = MAX_HYPE;
    sim2.step(inputs({ basicHeld: true, basicPressed: true, specialHeld: true, specialPressed: true }), inputs());
    expect(sim2.p1.activeMove?.def.kind).toBe('super');
    expect(sim2.p1.activeMove?.isSuper).toBe(true);
    expect(sim2.p1.hype).toBe(0);
  });

  it('a chord without full meter resolves as a single ordinary action, not a super', () => {
    const sim = freshSim();
    sim.p1.x = 150;
    sim.p2.x = 400;
    sim.p1.hype = 10;
    sim.step(inputs({ basicHeld: true, basicPressed: true, specialHeld: true, specialPressed: true }), inputs());
    expect(sim.p1.activeMove?.def.kind).not.toBe('super');
    expect(sim.p1.hype).toBe(10);
  });

  it('resolves simultaneous strikes as a trade rather than favoring p1', () => {
    const sim = freshSim();
    sim.p1.x = 150;
    sim.p2.x = 180;
    sim.p2.facing = -1;
    const h1 = sim.p1.health;
    const h2 = sim.p2.health;
    sim.step(
      inputs({ basicHeld: true, basicPressed: true }),
      inputs({ basicHeld: true, basicPressed: true }),
    );
    for (let i = 0; i < 10; i++) sim.step(inputs(), inputs());
    expect(sim.p1.health).toBeLessThan(h1);
    expect(sim.p2.health).toBeLessThan(h2);
  });

  it('ends the round on KO exactly once and freezes further state changes', () => {
    const sim = freshSim();
    sim.p2.health = 5;
    sim.p1.x = 150;
    sim.p2.x = 180;
    sim.step(inputs({ basicHeld: true, basicPressed: true }), inputs());
    for (let i = 0; i < 10; i++) sim.step(inputs(), inputs());
    expect(sim.ended).toBe(true);
    expect(sim.result?.reason).toBe('ko');
    expect(sim.result?.winner).toBe('p1');
    const healthSnapshot = sim.p2.health;
    sim.step(inputs({ basicHeld: true, basicPressed: true }), inputs());
    expect(sim.p2.health).toBe(healthSnapshot);
  });

  it('resolves a timeout by remaining health percentage, and an exact tie as a draw', () => {
    const sim = freshSim();
    sim.p1.health = 100;
    sim.p2.health = 50;
    sim.clockFrames = 1;
    sim.step(inputs(), inputs());
    expect(sim.ended).toBe(true);
    expect(sim.result).toEqual({ winner: 'p1', reason: 'timeout' });

    const draw = freshSim();
    draw.clockFrames = 1;
    draw.step(inputs(), inputs());
    expect(draw.result).toEqual({ winner: 'draw', reason: 'draw' });
  });

  it('caps combos at 5 hits or 35% max health and forces a knockdown', () => {
    const sim = freshSim();
    sim.p1.x = 150;
    sim.p2.x = 176;
    sim.p2.comboCount = 4; // one more scaled hit should hit the cap
    sim.p1.activeMove = { def: HUNTER.moves.basic1, frame: 3, lastHitFrame: new Map(), isSuper: false };
    sim.p1.state = 'attack';
    for (let i = 0; i < 6; i++) sim.step(inputs(), inputs());
    expect(sim.p2.state).toBe('knockdown');
    expect(sim.p2.comboCount).toBe(0);
  });

  it('pickups expire, refresh instead of stacking, and never touch base max health', () => {
    const sim = freshSim(1, true);
    sim.pickup = { kind: 'gpu', x: 150, age: 0, armed: true };
    sim.p1.x = 150;
    sim.step(inputs(), inputs());
    expect(sim.p1.modifiers.damageMult).toBe(GPU_DAMAGE_MULT);
    const framesAfterFirst = sim.p1.modifiers.gpuFrames;

    for (let i = 0; i < 30; i++) sim.step(inputs(), inputs());
    expect(sim.p1.modifiers.gpuFrames).toBeLessThan(framesAfterFirst);

    sim.pickup = { kind: 'gpu', x: 150, age: 0, armed: true };
    sim.step(inputs(), inputs());
    expect(sim.p1.modifiers.damageMult).toBe(GPU_DAMAGE_MULT); // refreshed, not multiplied again
    expect(sim.p1.def.maxHealth).toBe(HUNTER.maxHealth);
  });

  it('clears transient state on round reset', () => {
    const sim = freshSim();
    sim.p1.health = 50;
    sim.p1.modifiers.damageMult = 1.25;
    sim.projectiles.push({} as never);
    sim.resetRound();
    expect(sim.p1.health).toBe(HUNTER.maxHealth);
    expect(sim.p1.modifiers.damageMult).toBe(1);
    expect(sim.projectiles.length).toBe(0);
  });

  it('produces identical results for identical scripted input across two independent runs', () => {
    const script: Array<[PlayerFrameInput, PlayerFrameInput]> = [];
    for (let i = 0; i < 40; i++) {
      script.push([
        inputs({ right: i < 20, basicPressed: i === 20, basicHeld: i === 20 }),
        inputs({ left: i < 15 }),
      ]);
    }
    const a = freshSim(42);
    const b = freshSim(42);
    for (const [p1in, p2in] of script) {
      a.step(p1in, p2in);
      b.step(p1in, p2in);
    }
    expect(a.p1.x).toBe(b.p1.x);
    expect(a.p2.x).toBe(b.p2.x);
    expect(a.p1.health).toBe(b.p1.health);
    expect(a.p2.health).toBe(b.p2.health);
    expect(a.p1.state).toBe(b.p1.state);
  });
});
