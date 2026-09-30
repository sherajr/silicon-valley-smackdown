/**
 * Fixed-timestep driver: turns variable display frames into whole 60 Hz simulation ticks.
 *
 * Stall policy (documented behaviour, tested in stepper.test.ts):
 * - a single display frame is clamped to `maxFrame` seconds (default 80 ms), so a long stall never queues more
 *   than a few ticks;
 * - at most `maxTicks` (default 5) ticks run per display frame;
 * - if that cap is reached the remaining backlog is dropped down to one tick, so the game never spirals.
 * Simulation results depend only on the ticks delivered, never on the display rate that delivered them.
 */
export class FixedStepper {
  accumulator = 0;
  readonly hz: number;
  readonly maxTicks: number;
  readonly maxFrame: number;
  constructor(hz = 60, maxTicks = 5, maxFrame = 0.08) { this.hz = hz; this.maxTicks = maxTicks; this.maxFrame = maxFrame; }
  /** Advances by `dt` seconds of wall clock and calls `tick` once per whole simulation step owed. Returns ticks run. */
  advance(dt: number, tick: () => void | false): number {
    const step = 1 / this.hz;
    this.accumulator += Math.min(this.maxFrame, Math.max(0, dt));
    let ticks = 0;
    while (this.accumulator >= step - 1e-9 && ticks < this.maxTicks) {
      if (tick() === false) { this.accumulator = 0; return ticks; }       // the caller aborted (for example, the game paused)
      this.accumulator -= step; ticks++;
    }
    if (ticks >= this.maxTicks) this.accumulator = Math.min(this.accumulator, step);
    return ticks;
  }
  /** Fraction of the next tick already elapsed, for render interpolation. */
  get alpha() { return Math.max(0, Math.min(1, this.accumulator * this.hz)); }
  reset() { this.accumulator = 0; }
}
