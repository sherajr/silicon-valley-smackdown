import { describe, expect, it } from 'vitest';
import { FIGHTERS } from './fighterDefinitions';
import { STAGE_PLATFORMS } from './data';
import { ArenaSim } from './Simulation';
import type { Controls } from './controls';
import { ctl, faceOff } from './testHelpers';

const pattern = (tick: number, slot: number): Controls => ctl({
  x: ((Math.floor(tick / 18) + slot) % 3) - 1,
  up: tick % 29 === slot,
  down: tick % 37 === 4,
  jump: tick % 47 === 8 + slot,
  attack: tick % 23 === 6 + slot,
  special: tick % 41 === 11,
  shield: tick % 33 < (slot === 0 ? 4 : 2),
  grab: tick % 53 === 15 + slot,
});

function play(seed: number, fighters: [number, number], stage: number, frames: number, items: boolean) {
  const sim = new ArenaSim({ fighters, stage, mode: 'versus', difficulty: 1, items, seed });
  sim.countdown = 0;
  const hashes: string[] = [];
  for (let t = 0; t < frames; t++) {
    sim.step([pattern(t, 0), pattern(t, 1)]);
    if (t % 50 === 49) hashes.push(sim.hashState());
  }
  return { sim, hashes };
}

describe('gameplay snapshots', () => {
  it('restores a live match so the future matches a match that was never saved', () => {
    const fighters: [number, number] = [2, 5];
    const continuous = play(99, fighters, 1, 280, true);
    const sim = new ArenaSim({ fighters, stage: 1, mode: 'versus', difficulty: 1, items: true, seed: 99 });
    sim.countdown = 0;
    for (let t = 0; t < 160; t++) sim.step([pattern(t, 0), pattern(t, 1)]);
    const saved = sim.save();
    for (let t = 160; t < 280; t++) sim.step([pattern(t, 0), pattern(t, 1)]);
    sim.load(saved);
    expect(sim.hashState()).toBe(hashAt(fighters, 1, 99, true, 160));
    for (let t = 160; t < 280; t++) sim.step([pattern(t, 0), pattern(t, 1)]);
    expect(sim.hashState()).toBe(continuous.sim.hashState());
    expect(sim.tick).toBe(continuous.sim.tick);
    expect(sim.fighters.map(f => [f.damage, f.stocks, f.x, f.y])).toEqual(continuous.sim.fighters.map(f => [f.damage, f.stocks, f.x, f.y]));
  });

  it('keeps RNG, projectile ids, holds and hitstop across a round trip', () => {
    const sim = new ArenaSim({ fighters: [0, 0], stage: 0, mode: 'versus', difficulty: 1, items: true, seed: 3 });
    sim.countdown = 0;
    faceOff(sim, 1.05);
    sim.step([ctl({ grab: true }), ctl()]);
    for (let i = 0; i < 8; i++) sim.step([ctl(), ctl()]);
    expect(sim.fighters[1].heldBy).toBe(0);
    sim.step([ctl({ grab: true, x: 1 }), ctl()]);
    for (let i = 0; i < 40 && sim.fighters[1].damage === 0; i++) sim.step([ctl(), ctl()]);
    expect(sim.fighters[1].damage).toBeGreaterThan(0);
    for (let i = 0; i < 30; i++) sim.step([ctl({ special: i === 0 }), ctl({ x: 1 })]);
    const before = sim.save();
    const hash = sim.hashState();
    sim.step([ctl({ attack: true, jump: true }), ctl({ shield: true })]);
    sim.load(before);
    expect(sim.hashState()).toBe(hash);
    expect(sim.shots.map(s => s.id)).toEqual(before.shots.map(s => s.id));
    expect(sim.shots.every(s => s.def === FIGHTERS[s.kind].moves.special.projectile)).toBe(true);
    expect(sim.save().rng).toBe(before.rng);
    expect(sim.save().serial).toBe(before.serial);
    expect(sim.save().itemClock).toBe(before.itemClock);
  });

  it('agrees across every fighter pair and every stage for a long seeded stream', () => {
    for (let stage = 0; stage < STAGE_PLATFORMS.length; stage++) {
      for (let a = 0; a < FIGHTERS.length; a++) {
        const b = (a + 3) % FIGHTERS.length;
        const left = play(1000 + a + stage * 17, [a, b], stage, 220, a % 2 === 0);
        const right = play(1000 + a + stage * 17, [a, b], stage, 220, a % 2 === 0);
        expect(right.hashes).toEqual(left.hashes);
        expect(right.sim.hashState()).toBe(left.sim.hashState());
      }
    }
  });
});

function hashAt(fighters: [number, number], stage: number, seed: number, items: boolean, frames: number) {
  const sim = new ArenaSim({ fighters, stage, mode: 'versus', difficulty: 1, items, seed });
  sim.countdown = 0;
  for (let t = 0; t < frames; t++) sim.step([pattern(t, 0), pattern(t, 1)]);
  return sim.hashState();
}
