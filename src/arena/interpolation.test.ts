import { describe, expect, it } from 'vitest';
import { TELEPORT_DISTANCE, VisualInterpolator, newRenderedFighter } from './interpolation';
import { ctl, faceOff, make } from './testHelpers';
import type { ArenaSim } from './Simulation';
import type { Controls } from './Simulation';

/** One captured tick, the way the app does it. */
function tick(s: ArenaSim, v: VisualInterpolator, p1: Partial<Controls> = {}, p2: Partial<Controls> = {}) { v.capture(s); s.step([ctl(p1), ctl(p2)]); }

describe('fighter position', () => {
  it('draws a point on the line between the last two ticks and the exact state at alpha 1', () => {
    const s = make(), v = new VisualInterpolator(); faceOff(s, 4, -3);
    for (let i = 0; i < 6; i++) tick(s, v, { x: 1 });
    const f = s.fighters[0], r = v.fighter(s, 0, 0.5);
    expect(f.x).toBeGreaterThan(f.prevX);
    expect(r.x).toBeCloseTo((f.prevX + f.x) / 2, 10);
    expect(v.fighter(s, 0, 1).x).toBeCloseTo(f.x, 10); expect(v.fighter(s, 0, 0).x).toBeCloseTo(f.prevX, 10);
    expect(r.snapped).toBe(false); expect(r.dx).toBeCloseTo(f.x - f.prevX, 10);
  });

  it('clamps alpha so a late frame can never extrapolate beyond the simulation', () => {
    const s = make(), v = new VisualInterpolator(); faceOff(s, 4, -3); for (let i = 0; i < 4; i++) tick(s, v, { x: 1 });
    const f = s.fighters[0];
    expect(v.fighter(s, 0, 7).x).toBeCloseTo(f.x, 10); expect(v.fighter(s, 0, -3).x).toBeCloseTo(f.prevX, 10);
  });

  it('draws a respawn, a reset and an explicit ledge snap at the destination, not as a sweep', () => {
    const s = make(), v = new VisualInterpolator(); faceOff(s, 4, -3);
    const f = s.fighters[0]; f.prevX = 0; f.prevY = -12; f.x = -3; f.y = 7;
    const r = v.fighter(s, 0, 0.5);
    expect(Math.hypot(f.x - f.prevX, f.y - f.prevY)).toBeGreaterThan(TELEPORT_DISTANCE);
    expect(r.snapped).toBe(true); expect([r.x, r.y]).toEqual([-3, 7]); expect([r.dx, r.dy]).toEqual([0, 0]);
    f.prevX = 1; f.prevY = 0; f.x = 1.8; f.y = 0.6;                       // a ledge-sized hop: interpolated unless flagged
    expect(v.fighter(s, 0, 0.5).snapped).toBe(false);
    v.markSnap(0); expect(v.fighter(s, 0, 0.5)).toMatchObject({ snapped: true, x: 1.8, y: 0.6 });
    v.capture(s); expect(v.fighter(s, 0, 0.5).snapped).toBe(false);       // the flag lasts one tick
  });

  it('does not move while the simulation is frozen in hitstop', () => {
    const s = make(), v = new VisualInterpolator(); faceOff(s, 4, -3);
    for (let i = 0; i < 4; i++) tick(s, v, { x: 1 });
    s.freeze = 5; tick(s, v, { x: 1 });
    const f = s.fighters[0]; expect(f.x).toBe(f.prevX);
    expect(v.fighter(s, 0, 0.5).x).toBe(f.x); expect(v.fighter(s, 0, 0.5).dx).toBe(0);
  });
});

describe('attack age', () => {
  it('advances smoothly within one move instance', () => {
    const s = make(), v = new VisualInterpolator(); faceOff(s, 4, -3);
    tick(s, v, { attack: true }); tick(s, v); tick(s, v);
    const a = s.fighters[0].attack!; expect(a.age).toBeGreaterThan(1);
    const half = v.fighter(s, 0, 0.5).attackAge!;
    expect(half).toBeCloseTo(a.age - 0.5, 10); expect(v.fighter(s, 0, 1).attackAge).toBe(a.age); expect(v.fighter(s, 0, 0).attackAge).toBe(a.age - 1);
  });

  it('starts a new move on its own first frame instead of blending from the previous one', () => {
    const s = make(), v = new VisualInterpolator(); faceOff(s, 4, -3);
    v.capture(s); const old = s.fighters[0].attack;
    expect(old).toBeNull();
    tick(s, v, { attack: true });                         // the move starts this tick
    const a = s.fighters[0].attack!;
    // The previous tick had no move: the first frame shows the move's own age, whatever alpha is.
    expect(v.fighter(s, 0, 0.25).attackAge).toBe(a.age); expect(v.fighter(s, 0, 0).attackAge).toBe(a.age);
    // Replace the move with a different instance: still no blend from the stale age.
    tick(s, v); tick(s, v); v.capture(s); const stale = s.fighters[0].attack!.age;
    s.fighters[0].attack = { ...s.fighters[0].attack!, uid: 99999, age: 0 };
    const r = v.fighter(s, 0, 0.5).attackAge!; expect(r).toBe(0); expect(stale).toBeGreaterThan(0);
  });

  it('is null when no move is playing and holds still through hitstop', () => {
    const s = make(), v = new VisualInterpolator(); faceOff(s, 4, -3);
    tick(s, v); expect(v.fighter(s, 0, 0.5).attackAge).toBeNull();
    tick(s, v, { attack: true }); tick(s, v); s.freeze = 4; tick(s, v);
    const a = s.fighters[0].attack!; v.capture(s);                                  // age unchanged by the frozen tick
    expect(v.fighter(s, 0, 0.5).attackAge).toBe(a.age); expect(v.fighter(s, 0, 0).attackAge).toBe(a.age);
  });
});

describe('projectiles', () => {
  it('sweeps along the shot path, draws a new shot at its spawn point, and forgets expired shots', () => {
    const s = make(), v = new VisualInterpolator(); faceOff(s, 6, -3);
    tick(s, v, { special: true }); for (let i = 0; i < 30 && !s.shots.length; i++) tick(s, v);
    expect(s.shots.length).toBeGreaterThan(0);
    const shot = s.shots[0], id = shot.id, x0 = shot.x; expect(v.shot(shot, 0.5).fresh).toBe(true);           // spawned during the last tick
    tick(s, v);
    const moved = s.shots[0]; expect(moved.id).toBe(id); expect(moved.x).not.toBe(x0);
    const r = v.shot(moved, 0.5); expect(r.fresh).toBe(false);
    expect(r.x).toBeCloseTo((x0 + moved.x) / 2, 8); expect(v.shot(moved, 1).x).toBeCloseTo(moved.x, 10);
    s.shots.length = 0; tick(s, v); expect(v.shot(moved, 0.5).fresh).toBe(true);   // pruned: a recycled id would not smear
  });
});

describe('reset', () => {
  it('draws the next frame exactly at the simulation state', () => {
    const s = make(), v = new VisualInterpolator(); faceOff(s, 4, -3);
    tick(s, v, { attack: true }); tick(s, v); tick(s, v);
    v.reset(); const a = s.fighters[0].attack!;
    expect(v.fighter(s, 0, 0.3).attackAge).toBe(a.age);
    expect(newRenderedFighter().snapped).toBe(true);
  });
});
