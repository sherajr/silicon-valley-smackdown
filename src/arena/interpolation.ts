import type { ArenaSim, Shot } from './Simulation';

/**
 * Render-time interpolation between 60 Hz simulation ticks. The simulation stays authoritative: collision, hit
 * volumes, velocity units and move timing are never touched. This module only decides what to *draw* at a fractional
 * point between the last two ticks, and it does so once per display frame so the fighter model, camera, contact
 * shadow, projected label and effects all agree on where a fighter is.
 *
 * The caller calls `capture(sim)` immediately before every `sim.step()` (it remembers what the tick advances from)
 * and `fighter()` / `shot()` at draw time with the stepper's alpha.
 */

/** A one-tick jump bigger than this is a teleport (respawn, reset), never motion, so it is drawn without a sweep. */
export const TELEPORT_DISTANCE = 2.4;

export interface RenderedFighter {
  x: number; y: number;
  /** Distance moved over the last tick, in the same render space (for trail and stride logic). */
  dx: number; dy: number;
  /** Fractional move age while a move is playing, else null. Never blends across two different moves. */
  attackAge: number | null;
  /** True when this frame jumped rather than moved (respawn, reset, ledge snap). */
  snapped: boolean;
}
export interface RenderedShot { x: number; y: number; fresh: boolean }

interface PrevShot { x: number; y: number; stamp: number }

export const newRenderedFighter = (): RenderedFighter => ({ x: 0, y: 0, dx: 0, dy: 0, attackAge: null, snapped: true });

export class VisualInterpolator {
  private attacks: ({ uid: number; age: number } | null)[] = [null, null];
  private shots = new Map<number, PrevShot>();
  private snapSlots = [false, false];
  private stamp = 0;

  /** Records the state the next tick advances from. Call right before `sim.step()`. */
  capture(sim: ArenaSim) {
    this.stamp++;
    for (let i = 0; i < 2; i++) {
      const a = sim.fighters[i].attack;
      this.attacks[i] = a ? { uid: a.uid, age: a.age } : null;
      this.snapSlots[i] = false;
    }
    for (const s of sim.shots) {
      const prev = this.shots.get(s.id);
      if (prev) { prev.x = s.x; prev.y = s.y; prev.stamp = this.stamp; } else this.shots.set(s.id, { x: s.x, y: s.y, stamp: this.stamp });
    }
    for (const [id, prev] of this.shots) if (prev.stamp !== this.stamp) this.shots.delete(id);
  }

  /** The simulation moved this fighter discontinuously during the last tick (a ledge grab); draw it there without a sweep. */
  markSnap(slot: number) { this.snapSlots[slot] = true; }

  /** Forget everything: the next frame is drawn exactly at the simulation state (new match, stage change). */
  reset() { this.attacks[0] = this.attacks[1] = null; this.shots.clear(); this.snapSlots[0] = this.snapSlots[1] = false; this.stamp++; }

  fighter(sim: ArenaSim, slot: number, alpha: number, out: RenderedFighter = newRenderedFighter()): RenderedFighter {
    const f = sim.fighters[slot], a = Math.min(1, Math.max(0, alpha));
    const dx = f.x - f.prevX, dy = f.y - f.prevY;
    const snapped = this.snapSlots[slot] || dx * dx + dy * dy > TELEPORT_DISTANCE * TELEPORT_DISTANCE;
    if (snapped) { out.x = f.x; out.y = f.y; out.dx = 0; out.dy = 0; } else { out.x = f.prevX + dx * a; out.y = f.prevY + dy * a; out.dx = dx; out.dy = dy; }
    out.snapped = snapped;
    const attack = f.attack, before = this.attacks[slot];
    // Only interpolate inside one move instance. A new or different move starts exactly on its own first frame, so a
    // state change can never blend a stale age into an active pose.
    out.attackAge = !attack ? null : before && before.uid === attack.uid && attack.age >= before.age ? before.age + (attack.age - before.age) * a : attack.age;
    return out;
  }

  shot(s: Shot, alpha: number, out: RenderedShot = { x: 0, y: 0, fresh: true }): RenderedShot {
    const prev = this.shots.get(s.id), a = Math.min(1, Math.max(0, alpha));
    if (!prev) { out.x = s.x; out.y = s.y; out.fresh = true; return out; }
    out.x = prev.x + (s.x - prev.x) * a; out.y = prev.y + (s.y - prev.y) * a; out.fresh = false; return out;
  }
}
