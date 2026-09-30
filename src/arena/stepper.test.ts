import { describe, it, expect } from 'vitest';
import { FixedStepper } from './stepper';
import { ArenaSim } from './Simulation';
import { ctl } from './testHelpers';
import type { Controls } from './controls';

/** Delivers a scripted controller to a sim through a FixedStepper on a given display schedule, for an exact tick count. */
function play(displayHz: number, totalTicks: number, stalls: Record<number, number> = {}) {
  const sim = new ArenaSim({ fighters: [0, 1], stage: 0, mode: 'cpu', difficulty: 1, items: false, seed: 5 }); sim.countdown = 0;
  const stepper = new FixedStepper();
  // The controller is sampled per tick, like Input.sample(): edges belong to the tick that consumes them.
  let tick = 0;
  const sample = (): Controls => ctl(tick % 23 === 0 ? { attack: true, x: 1 } : tick % 37 === 0 ? { special: true } : tick % 53 === 0 ? { jump: true } : { x: tick % 90 < 45 ? 1 : -1 });
  for (let frame = 0; tick < totalTicks && frame < 100000; frame++)
    stepper.advance((1 / displayHz) + (stalls[frame] ?? 0), () => { if (tick >= totalTicks) return false; sim.step([sample(), ctl()]); tick++; });
  return { sim, tick, stepper };
}
/** How many ticks a display schedule delivers in a fixed wall-clock time. */
function delivered(displayHz: number, seconds: number, stalls: Record<number, number> = {}) {
  const stepper = new FixedStepper(); let ticks = 0;
  for (let f = 0; f < Math.round(seconds * displayHz); f++) ticks += stepper.advance((1 / displayHz) + (stalls[f] ?? 0), () => {});
  return ticks;
}

describe('FixedStepper', () => {
  it.each([30, 60, 120, 144, 240])('delivers 60 ticks per second at a %s Hz display', hz => {
    expect(Math.abs(delivered(hz, 4) - 240)).toBeLessThanOrEqual(1);
  });
  it.each([30, 60, 120, 144])('the match after the same number of ticks is identical at %s Hz', hz => {
    const reference = play(60, 600), other = play(hz, 600);
    expect(other.sim.tick).toBe(reference.sim.tick);
    expect(JSON.stringify(other.sim.fighters)).toBe(JSON.stringify(reference.sim.fighters));
    expect(JSON.stringify(other.sim.shots)).toBe(JSON.stringify(reference.sim.shots));
  });
  it('the match is also identical when a modest stall delays some frames', () => {
    const reference = play(60, 600), stalled = play(60, 600, { 40: 0.05, 200: 0.06, 330: 0.04 });
    expect(JSON.stringify(stalled.sim.fighters)).toBe(JSON.stringify(reference.sim.fighters));
  });
  it('a modest stall (a few frames late) catches up with whole ticks and loses nothing', () => {
    expect(delivered(60, 3, { 50: 0.05 })).toBeGreaterThanOrEqual(180);
  });
  it('a long stall is clamped to 80 ms, so it owes at most four ticks and leaves no backlog', () => {
    const stepper = new FixedStepper(); let ran = 0;
    const ticks = stepper.advance(5, () => { ran++; });
    expect(ticks).toBe(4); expect(ran).toBe(4);
    expect(stepper.accumulator).toBeLessThan(1 / 60);
  });
  it('even with a generous clamp, no more than five ticks run per frame and the backlog is dropped', () => {
    const stepper = new FixedStepper(60, 5, 1); let ran = 0;
    const ticks = stepper.advance(1, () => { ran++; });
    expect(ticks).toBe(5); expect(ran).toBe(5);
    expect(stepper.accumulator).toBeLessThanOrEqual(1 / 60 + 1e-9);
  });
  it('a caller can abort mid-frame (pause) and leaves no backlog behind', () => {
    const stepper = new FixedStepper(); let n = 0;
    stepper.advance(0.07, () => (++n === 2 ? false : undefined));
    expect(n).toBe(2); expect(stepper.accumulator).toBe(0);
  });
  it('alpha reports the fraction of the next tick for render interpolation', () => {
    const stepper = new FixedStepper();
    stepper.advance(1 / 120, () => {});
    expect(stepper.alpha).toBeCloseTo(0.5, 5);
  });
  it('negative or zero frame times are harmless', () => {
    const stepper = new FixedStepper();
    expect(stepper.advance(-1, () => {})).toBe(0); expect(stepper.advance(0, () => {})).toBe(0);
  });
});
