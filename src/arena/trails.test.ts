import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { TRAIL_POINTS, TrailSet } from './trails';

const white = [1, 1, 1] as const;
const verts = (t: TrailSet) => ((t.mesh.geometry as T.BufferGeometry).getAttribute('position').array as Float32Array);
const alpha = (t: TrailSet) => ((t.mesh.geometry as T.BufferGeometry).getAttribute('color').array as Float32Array);
const maxAlpha = (t: TrailSet, slot = 0) => { const a = alpha(t); let m = 0; for (let i = slot * TRAIL_POINTS * 2; i < (slot + 1) * TRAIL_POINTS * 2; i++) m = Math.max(m, a[i * 4 + 3]); return m; };

describe('trail ribbons', () => {
  it('share one preallocated geometry and never change its size', () => {
    const t = new TrailSet(4), g = t.mesh.geometry as T.BufferGeometry, size = verts(t).length, index = g.index!.count;
    for (let f = 0; f < 200; f++) { t.follow('a', f * 0.1, 0, 0, white, 0.3, 0.3); t.follow('b', 0, f * 0.1, 0, white, 0.3, 0.3); t.update(1 / 60); }
    expect(verts(t).length).toBe(size); expect(g.index!.count).toBe(index); expect(size).toBe(4 * TRAIL_POINTS * 2 * 3);
    for (const v of verts(t)) expect(Number.isFinite(v)).toBe(true);
    t.dispose();
  });

  it('grows only when the subject actually moves', () => {
    const t = new TrailSet(2);
    for (let f = 0; f < 30; f++) { t.follow('a', 5, 2, 0, white, 0.3, 5); t.update(1 / 60); }       // standing still (hitstop): one sample, no ribbon body
    const still = [...verts(t).slice(0, TRAIL_POINTS * 6)];
    const xs = new Set(still.filter((_, i) => i % 3 === 0).map(v => Math.round(v * 100)));
    expect(xs.size).toBeLessThanOrEqual(3);                                                           // all points near x = 5 (plus the ribbon's own width)
    const t2 = new TrailSet(2); for (let f = 0; f < 10; f++) { t2.follow('a', f * 0.5, 0, 0, white, 0.3, 5); t2.update(1 / 60); }
    expect(new Set(Array.from({ length: TRAIL_POINTS }, (_, k) => Math.round(verts(t2)[k * 6] * 10))).size).toBeGreaterThan(5);
    t.dispose(); t2.dispose();
  });

  it('holds still, ageing nothing, when the clock is held (hitstop)', () => {
    const t = new TrailSet(2);
    for (let f = 0; f < 8; f++) { t.follow('a', f * 0.4, 0, 0, white, 0.3, 0.3); t.update(1 / 60); }
    const before = maxAlpha(t), samples = [...verts(t).slice(0, TRAIL_POINTS * 6)];
    // The subject is frozen in hitstop: it keeps reporting the same position while the trail clock is held at 0.
    for (let f = 0; f < 120; f++) { t.follow('a', 7 * 0.4, 0, 0, white, 0.3, 0.3); t.update(0); }
    expect(t.active).toBe(1); expect(maxAlpha(t)).toBeCloseTo(before, 6);
    expect([...verts(t).slice(0, TRAIL_POINTS * 6)]).toEqual(samples);                       // not one vertex moved or grew
    t.dispose();
  });

  it('fades out once the subject stops feeding it, then frees the slot', () => {
    const t = new TrailSet(1);
    for (let f = 0; f < 10; f++) { t.follow('a', f * 0.4, 0, 0, white, 0.3, 0.3); t.update(1 / 60); }
    expect(t.active).toBe(1); const feeding = maxAlpha(t);
    for (let f = 0; f < 12; f++) t.update(1 / 60);
    expect(maxAlpha(t)).toBeLessThan(feeding);
    for (let f = 0; f < 60; f++) t.update(1 / 60);
    expect(t.active).toBe(0); expect(maxAlpha(t)).toBe(0);
    t.follow('b', 0, 0, 0, white, 0.3, 0.3); expect(t.active).toBe(1);        // the freed slot is reusable
    t.dispose();
  });

  it('ignores a request when every slot is busy rather than allocating', () => {
    const t = new TrailSet(2); t.follow('a', 0, 0, 0, white, 0.3, 1); t.follow('b', 0, 1, 0, white, 0.3, 1); t.follow('c', 0, 2, 0, white, 0.3, 1);
    expect(t.active).toBe(2); t.update(1 / 60); expect(t.active).toBe(2);
    t.clear(); expect(t.active).toBe(0); t.dispose();
  });

  it('tapers: the newest point is the widest and the oldest the thinnest', () => {
    const t = new TrailSet(1);
    for (let f = 0; f < 12; f++) { t.follow('a', f * 0.5, 0, 0, white, 0.6, 0.5); t.update(1 / 60); }
    const v = verts(t), width = (k: number) => Math.hypot(v[k * 6 + 3] - v[k * 6], v[k * 6 + 4] - v[k * 6 + 1]);
    const used = 12; expect(width(used - 1)).toBeGreaterThan(width(0));
    t.dispose();
  });
});
