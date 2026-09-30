import { describe, it, expect } from 'vitest';
import { HULL_HW, buildStage, depenetrate, moveBody, segmentHitsRect, segmentHitsSolid, supportOf } from './collision';
import type { Body } from './collision';
import { STAGE_PLATFORMS } from './data';

const H = 2.3;
const body = (x: number, y: number, vx = 0, vy = 0): Body => ({ x, y, vx, vy, height: H });

describe.each([0, 1, 2])('collision on stage %s', index => {
  const stage = buildStage(STAGE_PLATFORMS[index]);
  const oneway = stage.oneway;

  it('lands a falling fighter exactly on top of the solid stage', () => {
    const r = moveBody(stage, body(0, 0.4, 0, -0.5));
    expect(r.y).toBe(0); expect(r.grounded).toBe(true); expect(r.support).toBe('main'); expect(r.landed).toBe(true); expect(r.vy).toBe(0);
  });

  it.each([0, 1, 2, 3].slice(0, STAGE_PLATFORMS[index].length - 1))('lands on upper platform %s from above, and passes up through it from below', n => {
    const p = oneway[n];
    const down = moveBody(stage, body(p.x, p.y + 0.3, 0, -0.52));
    expect(down.y).toBe(p.y); expect(down.grounded).toBe(true); expect(down.support).toBe(p.id);
    const up = moveBody(stage, body(p.x, p.y - 0.4, 0, 0.6));
    expect(up.y).toBeGreaterThan(p.y); expect(up.grounded).toBe(false);
  });

  it('an intentional drop-through ignores only the chosen platform', () => {
    const p = oneway[0];
    const through = moveBody(stage, body(p.x, p.y, 0, -0.02), { dropThrough: p.id });
    expect(through.y).toBeLessThan(p.y); expect(through.grounded).toBe(false);
    // The solid stage is never ignorable.
    const main = moveBody(stage, body(0, 0, 0, -0.02), { dropThrough: 'main' });
    expect(main.y).toBe(0); expect(main.grounded).toBe(true);
  });

  it('a very fast downward sweep still lands on a thin upper platform', () => {
    const p = oneway[0];
    const r = moveBody(stage, body(p.x, p.y + 2.5, 0, -1.4));
    expect(r.y).toBeGreaterThanOrEqual(p.y); expect(r.y).toBeLessThan(p.y + 1.2);
    const pass = moveBody(stage, body(p.x, p.y + 1.2, 0, -1.4));
    expect(pass.y).toBe(p.y); expect(pass.grounded).toBe(true);
  });

  it('a very fast upward sweep cannot cross the solid roof from underneath', () => {
    const r = moveBody(stage, body(3, -4, 0, 1.4));
    expect(r.y).toBeLessThanOrEqual(-1.06 - H + 1e-6); expect(r.bonk).toBe(true); expect(r.vy).toBe(0);
  });

  it('the sides of the roof block a fast horizontal sweep, for both edges', () => {
    const right = moveBody(stage, body(10.5, -0.5, -1.4, 0));
    expect(right.x).toBeCloseTo(9.5 + HULL_HW, 6); expect(right.wall).toBe(-1); expect(right.vx).toBe(0);
    const left = moveBody(stage, body(-10.5, -0.5, 1.4, 0));
    expect(left.x).toBeCloseTo(-9.5 - HULL_HW, 6); expect(left.wall).toBe(1);
  });

  it('a diagonal approach to the roof corner slides without sticking or teleporting', () => {
    const r = moveBody(stage, body(9.9, -0.4, -0.3, 0.3));
    expect(r.x).toBeCloseTo(9.5 + HULL_HW, 6);          // stopped by the wall, not pulled inside
    expect(r.y).toBeCloseTo(-0.1, 6);                   // the upward half of the motion carried on along the wall
    const over = moveBody(stage, body(9.9, -0.05, -0.3, 0.3));
    expect(over.y).toBeGreaterThan(0); expect(Number.isFinite(over.x + over.y)).toBe(true);
  });

  it('a fighter moving along the top of the roof is not snagged by the seam or the ends', () => {
    let b = body(-9.4, 0, 0.14, -0.0135);
    for (let i = 0; i < 40; i++) { const r = moveBody(stage, b); b = { ...b, x: r.x, y: r.y, vx: 0.14, vy: -0.0135 }; expect(r.y).toBe(0); }
    expect(b.x).toBeGreaterThan(-4);
  });
});

describe('solid depenetration', () => {
  const stage = buildStage(STAGE_PLATFORMS[0]);
  it('a fighter found inside the roof while moving up is pushed back down, never up through it', () => {
    const out = depenetrate(stage, 0, -2, 0, 0.43, H);
    expect(out.y).toBeLessThan(-1.06 - H + 1e-9); expect(out.x).toBe(0);
  });
  it('a fighter sunk into the top while falling is lifted onto it', () => {
    const out = depenetrate(stage, 0, -0.05, 0, -0.3, H);
    expect(out.y).toBe(0);
  });
  it('microscopic overlaps are corrected by the smallest distance', () => {
    const out = depenetrate(stage, 9.5 + HULL_HW - 0.001, -0.5, 0, 0, H);
    expect(out.x - (9.5 + HULL_HW - 0.001)).toBeCloseTo(0.001, 6); expect(out.y).toBe(-0.5);
  });
});

describe('support tolerance', () => {
  const stage = buildStage(STAGE_PLATFORMS[0]);
  it('a fighter is supported until their centre is one hull-width past the edge', () => {
    expect(supportOf(stage, 9.5 + HULL_HW - 0.01, 0)).toBe('main');
    expect(supportOf(stage, 9.5 + HULL_HW + 0.01, 0)).toBeNull();
    expect(supportOf(stage, -9.5 - HULL_HW + 0.01, 0)).toBe('main');
  });
  it('rests stably: a standing fighter stays on the exact surface for many ticks', () => {
    let b = body(2, 0, 0, 0);
    for (let i = 0; i < 100; i++) { const r = moveBody(stage, { ...b, vy: -0.0135 }); expect(r.y).toBe(0); expect(r.grounded).toBe(true); b = { ...b, y: r.y }; }
  });
});

describe('ledges and geometry', () => {
  it('ledges exist only on solid platforms that opt in, at their top corners', () => {
    const stage = buildStage(STAGE_PLATFORMS[1]);
    expect(stage.ledges).toHaveLength(2);
    expect(stage.ledges.every(l => l.y === 0 && Math.abs(l.x) === 9.5)).toBe(true);
    expect(stage.solids.map(r => r.id)).toEqual(['main']);
  });
  it('collision follows the same platform data the renderer reads', () => {
    const wider = STAGE_PLATFORMS[2].map(p => p.id === 'main' ? { ...p, w: 24 } : p);
    const stage = buildStage(wider);
    expect(supportOf(stage, 11.9, 0)).toBe('main');
    expect(stage.ledges.map(l => l.x).sort((a, b) => a - b)).toEqual([-12, 12]);
  });
});

describe('projectile contact', () => {
  const stage = buildStage(STAGE_PLATFORMS[0]);
  it('a shot falling onto the roof is stopped at its surface; upper platforms never stop shots', () => {
    const hit = segmentHitsSolid(stage, 2, 0.6, 2, -0.4, 0.15, 0.15);
    expect(hit).not.toBeNull(); expect(hit!.ny).toBe(1); expect(hit!.y).toBeCloseTo(0.15, 6);
    const p = stage.oneway[0];
    expect(segmentHitsSolid(stage, p.x, p.y + 0.6, p.x, p.y - 0.4, 0.15, 0.15)).toBeNull();
  });
  it('a fast shot does not skip over a hurtbox', () => {
    const rect = { x0: 4, x1: 4.8, y0: 0, y1: 2.3 };
    expect(segmentHitsRect(rect, 0, 1, 9, 1, 0.3, 0.3)).not.toBeNull();
    expect(segmentHitsRect(rect, 0, 4, 9, 4, 0.3, 0.3)).toBeNull();
    const inside = segmentHitsRect(rect, 4.4, 1, 4.6, 1, 0.3, 0.3);
    expect(inside?.t).toBe(0);
  });
});
