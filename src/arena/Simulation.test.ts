import { describe, it, expect } from 'vitest';
import { ArenaSim, noInput } from './Simulation';
import type { Controls, MatchOptions } from './Simulation';

const setup = (extra: Partial<MatchOptions> = {}) => {
  const s = new ArenaSim({ fighters: [0, 1], stage: 0, mode: 'versus', difficulty: 1, items: false, seed: 7, ...extra });
  s.countdown = 0; return s;
};
const advance = (s: ArenaSim, n: number, p1: Partial<Controls> = {}, p2: Partial<Controls> = {}) => {
  for (let i = 0; i < n; i++) s.step([{ ...noInput(), ...p1 }, { ...noInput(), ...p2 }]);
};

describe('Arena platform fighter', () => {
  it.each([1, -1])('melee connects in facing %s and increases damage', facing => {
    const s = setup(), [a, b] = s.fighters; a.x = 0; b.x = facing * 1.1; a.facing = facing;
    advance(s, 1, { attack: true }); advance(s, 10);
    expect(b.damage).toBeGreaterThan(0); expect(Math.sign(b.vx)).toBe(facing);
  });
  it('one active melee window cannot hit repeatedly', () => {
    const s = setup(), [a, b] = s.fighters; a.x = 0; b.x = 1.1;
    advance(s, 1, { attack: true }); advance(s, 23);
    expect(b.damage).toBe(5);
  });
  it('high damage produces a farther launch than low damage', () => {
    const low = setup(), high = setup(); high.fighters[1].damage = 120;
    low.hit(low.fighters[0], low.fighters[1], 15, 0.24, 'heavy'); high.hit(high.fighters[0], high.fighters[1], 15, 0.24, 'heavy');
    expect(high.fighters[1].vx).toBeGreaterThan(low.fighters[1].vx * 2); expect(high.fighters[1].stun).toBeGreaterThan(low.fighters[1].stun);
  });
  it('heavy fighters resist knockback', () => {
    const light = setup({ fighters: [0, 3] }), heavy = setup({ fighters: [0, 2] });
    light.hit(light.fighters[0], light.fighters[1], 20, 0.2, 'heavy'); heavy.hit(heavy.fighters[0], heavy.fighters[1], 20, 0.2, 'heavy');
    expect(heavy.fighters[1].vx).toBeLessThan(light.fighters[1].vx);
  });
  it('shield blocks damage while grabs defeat it', () => {
    const s = setup(), [a, b] = s.fighters; b.guarding = true;
    s.hit(a, b, 10, 0.2, 'heavy'); expect(b.damage).toBe(0); expect(b.shield).toBe(76);
    s.hit(a, b, 12, 0.2, 'grab'); expect(b.damage).toBe(12); expect(b.guarding).toBe(false);
  });
  it('overusing a shield breaks it and causes punishable stun', () => {
    const s = setup(); s.fighters[0].shield = 0.1; advance(s, 1, { shield: true });
    expect(s.fighters[0].stun).toBe(90); expect(s.fighters[0].guarding).toBe(false);
  });
  it('two jumps are allowed, but a third air jump is not', () => {
    const s = setup(); advance(s, 1, { jump: true }); advance(s, 8); advance(s, 1, { jump: true });
    expect(s.fighters[0].jumps).toBe(2); advance(s, 5); const before = s.fighters[0].vy;
    advance(s, 1, { jump: true }); expect(s.fighters[0].vy).toBeLessThan(before);
  });
  it('walking off consumes the ground jump and leaves one air jump', () => {
    const s = setup(), a = s.fighters[0]; a.x = 9.59; advance(s, 2, { x: 1 });
    expect(a.grounded).toBe(false); expect(a.jumps).toBe(1);
  });
  it('recovery works once airborne and refreshes on landing', () => {
    const s = setup(), a = s.fighters[0]; a.x = 12; a.y = -2; a.grounded = false; a.jumps = 2;
    advance(s, 1, { up: true, special: true }); expect(a.recovered).toBe(true); expect(a.vy).toBeGreaterThan(0.35);
    a.attack = null; const vy = a.vy; advance(s, 1, { up: true, special: true });
    expect(s.fighters[0].attack?.kind).not.toBe('recovery'); expect(a.vy).toBeLessThan(vy);
    a.attack = null; a.x = 0; a.y = 0.1; a.vy = -0.2; advance(s, 1); expect(a.recovered).toBe(false); expect(a.grounded).toBe(true);
  });
  it.each([0, 1, 2])('lands on stage %s platforms and drops through them', stage => {
    const s = setup({ stage }), a = s.fighters[0], p = s.platforms[1]; a.x = p.x; a.y = p.y + 0.1; a.vy = -0.2;
    advance(s, 1); expect(a.y).toBe(p.y); expect(a.grounded).toBe(true);
    advance(s, 3, { down: true }); expect(a.y).toBeLessThan(p.y); expect(a.grounded).toBe(false);
  });
  it('platforms are one way, allowing upward passage', () => {
    const s = setup(), a = s.fighters[0], p = s.platforms[1]; a.x = p.x; a.y = p.y - 0.1; a.vy = 0.3; a.grounded = false;
    advance(s, 1); expect(a.y).toBeGreaterThan(p.y); expect(a.grounded).toBe(false);
  });
  it('stock loss respawns with protection and clean combat state', () => {
    const s = setup(), a = s.fighters[0]; a.x = 22; a.damage = 90; advance(s, 1);
    expect(a.stocks).toBe(2); expect(a.damage).toBe(0); expect(a.respawn).toBe(70);
    advance(s, 70); expect(a.respawn).toBe(0); expect(a.invincible).toBe(120); expect(a.y).toBe(7);
    s.hit(s.fighters[1], a, 30, 0.3, 'heavy'); expect(a.damage).toBe(0);
  });
  it('final stock loss finishes the match', () => {
    const s = setup(); s.fighters[1].stocks = 1; s.fighters[1].y = -12; advance(s, 1);
    expect(s.finished).toBe(true); expect(s.winner).toBe(0);
  });
  it('simultaneous final-stock KOs start sudden death instead of favoring P1', () => {
    const s = setup(); for (const f of s.fighters) { f.stocks = 1; f.y = -12; } advance(s, 1);
    expect(s.finished).toBe(false); expect(s.suddenDeath).toBe(true); expect(s.fighters.map(f => f.damage)).toEqual([150, 150]);
  });
  it('timeout ranks stocks first, then damage, and ties go to sudden death', () => {
    const s = setup(); s.remaining = 1; s.fighters[0].damage = 100; advance(s, 1); expect(s.winner).toBe(1);
    const tied = setup(); tied.remaining = 1; advance(tied, 1); expect(tied.suddenDeath).toBe(true);
  });
  it('training has no timer or stock loss', () => {
    const s = setup({ mode: 'training' }); s.remaining = 1; s.fighters[0].y = -12; advance(s, 1);
    expect(s.remaining).toBe(1); expect(s.fighters[0].stocks).toBe(3); expect(s.finished).toBe(false);
  });
  it('hitstop freezes movement and attack timelines while the clock runs', () => {
    const s = setup(); s.startAttack(s.fighters[0], 'heavy'); s.freeze = 5; const remaining = s.remaining;
    advance(s, 5, { x: 1 }); expect(s.fighters[0].x).toBe(-4); expect(s.fighters[0].attack!.age).toBe(0); expect(s.remaining).toBe(remaining - 5);
  });
  it('simultaneous active attacks trade instead of favoring the first player', () => {
    const s = setup(), [a, b] = s.fighters; a.x = 0; b.x = 1.1;
    advance(s, 1, { attack: true }, { attack: true }); advance(s, 5);
    expect(a.damage).toBe(5); expect(b.damage).toBe(5);
  });
  it.each([0, 1, 2, 3, 4, 5])('character %s fires one signature projectile per move', character => {
    const s = setup({ fighters: [character, 1] }); s.fighters[1].x = 15; advance(s, 1, { special: true }); advance(s, 20);
    expect(s.shots).toHaveLength(1); expect(s.shots[0].kind).toBe(character);
  });
  it('CPU prioritizes recovering toward the stage while offscreen', () => {
    const s = setup({ mode: 'cpu' }), cpu = s.fighters[1]; cpu.x = 12; cpu.y = -2; cpu.vy = -0.1; cpu.grounded = false; cpu.jumps = 2;
    advance(s, 1); expect(cpu.attack?.kind).toBe('recovery'); expect(cpu.vy).toBeGreaterThan(0); expect(cpu.facing).toBe(-1);
  });
  it('seeded CPU matches are deterministic', () => {
    const a = setup({ mode: 'cpu', items: true }), b = setup({ mode: 'cpu', items: true }); advance(a, 1500); advance(b, 1500);
    expect(JSON.stringify(a.fighters)).toBe(JSON.stringify(b.fighters)); expect(a.shots).toEqual(b.shots); expect(a.pickups).toEqual(b.pickups);
  });
  it('coffee heals and a GPU temporarily improves attacks', () => {
    const s = setup(), a = s.fighters[0]; a.damage = 80;
    s.pickups.push({ id: 1, type: 'coffee', x: a.x, y: 0.55, life: 20 }); advance(s, 1); expect(a.damage).toBe(58);
    s.pickups.push({ id: 2, type: 'gpu', x: a.x, y: 0.55, life: 20 }); advance(s, 1); expect(a.buff).toBe(480);
    s.hit(a, s.fighters[1], 12, 0.2, 'heavy'); expect(s.fighters[1].damage).toBe(15);
  });
});
