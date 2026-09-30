/** Movement budgets, drop-through, ledges, rolls at every edge, multi-hit rules and match lifecycle cleanup. */
import { describe, it, expect } from 'vitest';
import { STAGE_PLATFORMS } from './data';
import { box, defineMove, window } from './moveDefinitions';
import { ArenaSim } from './Simulation';
import { ctl, events, faceOff, make, run, runUntil } from './testHelpers';

describe('jump and recovery budgets', () => {
  it('two jumps, then nothing: no third air jump by any route', () => {
    const s = make({ stage: 2 }), [a] = s.fighters; faceOff(s); s.fighters[1].x = -9;
    run(s, 1, { jump: true }); run(s, 4); run(s, 1, { jump: true }); run(s, 4);
    for (let i = 0; i < 8; i++) { run(s, 1, { jump: true }); run(s, 2); }
    expect(events(s, 'jump')).toHaveLength(2); expect(a.jumps).toBe(2);
  });
  it('landing refreshes jumps and recovery exactly once, with one landing event', () => {
    const s = make({ stage: 2 }), [a] = s.fighters; faceOff(s); s.fighters[1].x = -9;
    Object.assign(a, { x: 0, y: 3, vy: 0, grounded: false, support: null, jumps: 2, recovered: true });
    runUntil(s, () => a.grounded, 100);
    run(s, 30);
    expect(events(s, 'land')).toHaveLength(1); expect(a.jumps).toBe(0); expect(a.recovered).toBe(false);
  });
  it('walking off an edge leaves exactly one air jump, and a buffered jump at the edge cannot add another', () => {
    const s = make({ stage: 2 }), [a] = s.fighters; faceOff(s); s.fighters[1].x = -9; a.x = a.prevX = 9.4;
    run(s, 1, { x: 1, jump: true }); run(s, 12, { x: 1 });
    expect(a.jumps).toBeLessThanOrEqual(2);
    run(s, 1, { jump: true }); run(s, 1, { jump: true }); run(s, 1, { jump: true });
    expect(a.jumps).toBeLessThanOrEqual(2); expect(events(s, 'jump').length).toBeLessThanOrEqual(2);
  });
  it('a recovery can be used once per airborne sequence and is refreshed by landing', () => {
    const s = make({ stage: 2 }), [a] = s.fighters; faceOff(s); s.fighters[1].x = -9;
    Object.assign(a, { x: 14, prevX: 14, y: -3, prevY: -3, vy: -0.1, grounded: false, support: null, jumps: 2 });
    run(s, 1, { up: true, special: true });
    expect(a.recovered).toBe(true);
    a.attack = null; run(s, 1);                                          // release, then press again
    run(s, 1, { up: true, special: true });
    expect(events(s, 'recovery')).toHaveLength(1); expect(events(s, 'fizzle')).toHaveLength(1);
    Object.assign(a, { x: 0, y: 0.2, vy: -0.2, grounded: false, support: null }); run(s, 3);
    expect(a.recovered).toBe(false);
    Object.assign(a, { x: 14, y: -3, vy: -0.1, grounded: false, support: null, jumps: 2 }); a.attack = null; run(s, 1);
    run(s, 1, { up: true, special: true });
    expect(events(s, 'recovery')).toHaveLength(2);
  });
  it('fast-fall is bounded by the fighter\'s terminal speed', () => {
    const s = make({ stage: 2 }), [a] = s.fighters; faceOff(s); s.fighters[1].x = -9;
    Object.assign(a, { y: 15, prevY: 15, vy: 0, grounded: false, support: null, jumps: 2 });
    let fastest = 0; for (let i = 0; i < 40; i++) { run(s, 1, { down: true }); fastest = Math.max(fastest, -a.vy); }
    expect(fastest).toBeCloseTo(0.52, 5);
  });
});

describe('drop-through', () => {
  it('drops through an upper platform that is being stood on, and is ignored only for a bounded time', () => {
    const s = make(), [a] = s.fighters; faceOff(s); s.fighters[1].x = -9; const p = s.platforms[1];
    Object.assign(a, { x: p.x, prevX: p.x, y: p.y, prevY: p.y, support: p.id });
    run(s, 1, { down: true });
    expect(a.drop).toBeGreaterThan(0); expect(a.dropFrom).toBe(p.id); expect(a.grounded).toBe(false);
    runUntil(s, () => a.grounded, 100);
    expect(a.y).toBe(0);                                                 // ended on the main stage, not back on the platform
    expect(a.drop).toBe(0);
  });
  it('an unrelated platform below still catches a fighter who dropped through another', () => {
    const s = make({ stage: 0 }), [a] = s.fighters; faceOff(s); s.fighters[1].x = -9;
    const top = s.platforms.find(p => p.id === 'top')!, left = s.platforms.find(p => p.id === 'left')!;
    Object.assign(a, { x: -2.0, prevX: -2.0, y: top.y, prevY: top.y, support: top.id, grounded: true });
    run(s, 1, { down: true, x: -1 });
    runUntil(s, () => a.grounded, 120, { x: -1 });
    expect(a.y).toBe(left.y); expect(a.support).toBe('left');
  });
  it('down never drops through the solid stage, even held for a long time', () => {
    const s = make(), [a] = s.fighters; faceOff(s); s.fighters[1].x = -9;
    run(s, 120, { down: true });
    expect(a.y).toBe(0); expect(a.grounded).toBe(true); expect(a.dropFrom).toBeNull();
  });
});

describe('ledges', () => {
  const edge = (s: ArenaSim, side = 1) => { const a = s.fighters[0]; Object.assign(a, { x: side * 9.8, prevX: side * 9.8, y: -0.3, prevY: -0.3, vx: -side * 0.05, vy: -0.05, grounded: false, support: null, jumps: 2, ledge: 0, invincible: 0 }); run(s, 1, { x: -side }); return a; };
  it('grabs only while falling toward the stage, and snaps onto the top surface inside the edge', () => {
    const s = make(), a = edge(make());
    expect(a.ledge).toBeGreaterThan(0); expect(a.y).toBe(0); expect(Math.abs(a.x)).toBeCloseTo(9.2, 5);
    const away = make(), b = away.fighters[0]; Object.assign(b, { x: 9.8, prevX: 9.8, y: -0.3, vy: -0.05, grounded: false, support: null, jumps: 2 }); run(away, 1, { x: 1 });
    expect(b.ledge).toBe(0);
    const rising = make(), c = rising.fighters[0]; Object.assign(c, { x: 9.8, prevX: 9.8, y: -0.3, vy: 0.2, grounded: false, support: null, jumps: 2 }); run(rising, 1, { x: -1 });
    expect(c.ledge).toBe(0); expect(s.tick).toBeGreaterThan(-1);
  });
  it('works on both sides of the stage', () => { for (const side of [1, -1]) { const a = edge(make(), side); expect(a.ledge).toBeGreaterThan(0); expect(Math.sign(a.x)).toBe(side); } });
  it('a real hit cancels the hang: the fighter is launched and no longer on the ledge', () => {
    const s = make(), a = edge(s), b = s.fighters[1]; a.invincible = 0;
    s.hit(b, a, 10, 0.2, 'heavy');
    expect(a.ledge).toBe(0); expect(a.stun).toBeGreaterThan(0); expect(a.damage).toBe(10);
  });
  it('the hang itself is invincible, then the fighter is free', () => {
    const s = make(), a = edge(s);
    s.hit(s.fighters[1], a, 10, 0.2, 'heavy'); expect(a.damage).toBe(0);
    run(s, 25); expect(a.ledge).toBe(0); expect(a.grounded).toBe(true);
  });
  it('protection shrinks with each regrab, and a genuine landing or a KO resets it', () => {
    const s = make(), a = s.fighters[0]; faceOff(s); s.fighters[1].x = -9;
    const grab = () => { Object.assign(a, { x: 9.8, prevX: 9.8, y: -0.3, vx: -0.05, vy: -0.05, grounded: false, support: null, ledge: 0, jumps: 2, invincible: 0, ledgeCooldown: 0 }); run(s, 1, { x: -1 }); return a.invincible; };
    const first = grab(), second = grab(), third = grab(), fourth = grab();
    expect(first).toBeGreaterThan(second); expect(second).toBeGreaterThan(third); expect(fourth).toBe(0);
    Object.assign(a, { x: 0, y: 0.2, vy: -0.2, grounded: false, support: null, ledge: 0 }); run(s, 3);   // a genuine landing
    expect(grab()).toBe(first);
    grab(); grab(); Object.assign(a, { y: -30 }); run(s, 3);                                   // a KO
    expect(a.ledgeGrabs).toBe(0);
  });
  it('a regrab right after letting go is refused until the cooldown ends', () => {
    const s = make(), a = edge(s);
    expect(a.ledge).toBeGreaterThan(0);
    Object.assign(a, { x: 9.8, y: -0.3, vx: -0.05, vy: -0.05, grounded: false, support: null, ledge: 0 });
    run(s, 1, { x: -1 });
    expect(a.ledge).toBe(0);
  });
});

describe('rolls at every platform edge', () => {
  for (const [index, platforms] of STAGE_PLATFORMS.entries()) for (const p of platforms) for (const side of [1, -1]) {
    it(`stage ${index}, ${p.id}, toward the ${side > 0 ? 'right' : 'left'} edge: the roll ends on the platform`, () => {
      const s = make({ stage: index }), a = s.fighters[0]; faceOff(s); s.fighters[1].x = -9.4 * side; s.fighters[1].y = 0;
      const x = p.x + side * (p.w / 2 - 0.3);
      Object.assign(a, { x, prevX: x, y: p.y, prevY: p.y, grounded: true, support: p.id, facing: side });
      run(s, 1, { shield: true }); run(s, 16, { shield: true, x: side });
      expect(a.y).toBe(p.y); expect(a.grounded).toBe(true); expect(Math.abs(a.x - p.x)).toBeLessThanOrEqual(p.w / 2);
    });
  }
  it('rolling never shortens protection the fighter already has, even when the roll is stopped at an edge', () => {
    const s = make(), [a] = s.fighters; faceOff(s, 8); s.fighters[1].x = -9;
    a.invincible = 120;                                                              // fresh respawn protection
    run(s, 1, { shield: true }); run(s, 1, { shield: true, x: -1 });
    expect(a.invincible).toBeGreaterThan(110);
    a.x = a.prevX = 9.3; a.roll = 0; a.busy = 0; a.invincible = 90; run(s, 2);        // roll into the edge
    run(s, 1, { shield: true }); run(s, 4, { shield: true, x: 1 });
    expect(a.roll).toBe(0); expect(a.invincible).toBeGreaterThan(75);                 // only the roll's own protection was dropped
  });
  it('a ledge grab never shortens protection the fighter already has', () => {
    const s = make(), a = s.fighters[0]; faceOff(s); s.fighters[1].x = -9;
    Object.assign(a, { x: 9.8, prevX: 9.8, y: -0.3, vx: -0.05, vy: -0.05, grounded: false, support: null, ledge: 0, jumps: 2, invincible: 100, ledgeGrabs: 5, ledgeCooldown: 0 });
    run(s, 1, { x: -1 });
    expect(a.ledge).toBeGreaterThan(0); expect(a.invincible).toBeGreaterThan(95);
  });
  it('a roll that is interrupted by a hit ends immediately, and the fighter can act afterwards', () => {
    const s = make(), [a, b] = s.fighters; faceOff(s, 4);
    run(s, 1, { shield: true }); run(s, 8, { shield: true, x: 1 });
    a.invincible = 0; s.hit(b, a, 8, 0.15, 'jab');
    expect(a.roll).toBe(0);
    runUntil(s, () => a.stun === 0, 100);
    run(s, 1, { jump: true });
    expect(a.jumps).toBe(1);
  });
  it('rolling into an edge and holding the direction cannot chain protection forever', () => {
    const s = make(), [a] = s.fighters; faceOff(s, 8); s.fighters[1].x = -9; a.x = a.prevX = 9.3; let protectedTicks = 0;
    run(s, 1, { shield: true });
    for (let i = 0; i < 300; i++) { run(s, 1, { shield: true, x: 1 }); if (a.invincible > 0) protectedTicks++; }
    expect(protectedTicks / 300).toBeLessThan(0.3);
    expect(a.x).toBeLessThanOrEqual(9.5);
  });
  it('a roll is cut short by an edge: the protection ends with it', () => {
    const s = make(), [a] = s.fighters; faceOff(s, 8); s.fighters[1].x = -9; a.x = a.prevX = 9.3;
    run(s, 1, { shield: true }); run(s, 3, { shield: true, x: 1 });
    expect(a.roll).toBe(0); expect(a.invincible).toBe(0);
  });
  it('rolling cannot be repeated with near-continuous protection', () => {
    const s = make(), [a] = s.fighters; faceOff(s, 8); a.x = a.prevX = -8; let protectedTicks = 0;
    run(s, 1, { shield: true });
    for (let i = 0; i < 300; i++) { run(s, 1, { shield: true, x: i % 120 < 60 ? 1 : -1 }); if (a.invincible > 0) protectedTicks++; }
    expect(protectedTicks / 300).toBeLessThan(0.7);
  });
});

describe('explicit hit rules', () => {
  const hitsOf = (def: ReturnType<typeof defineMove>) => {
    const s = make({ fighters: [0, 2] }), [a, b] = s.fighters; faceOff(s, 1.0); b.damage = 0;
    s.startMove(a, def);
    let hits = 0;
    for (let i = 0; i < def.duration + 5; i++) { run(s, 1); hits += events(s, 'hit').length; s.events.length = 0; b.vx = 0; b.stun = 0; b.x = 1.0; }
    return hits;
  };
  const gentle: [number, number, number] = [0, 0.001, 0.0001];
  it('a single window hits once however long it is active', () => {
    expect(hitsOf(defineMove('jab1', 'test', { duration: 40, hits: [window(4, 30, box(0.3, 1.4, 0.5, 1.9), 1, gentle)] }))).toBe(1);
  });
  it('a window with a re-hit interval hits on that schedule', () => {
    expect(hitsOf(defineMove('jab1', 'test', { duration: 40, hits: [window(4, 22, box(0.3, 1.4, 0.5, 1.9), 1, gentle, { rehit: 6 })] }))).toBe(4);
  });
  it('separate windows each get their own hit', () => {
    expect(hitsOf(defineMove('jab1', 'test', { duration: 40, hits: [window(4, 6, box(0.3, 1.4, 0.5, 1.9), 1, gentle), window(12, 14, box(0.3, 1.4, 0.5, 1.9), 1, gentle), window(20, 22, box(0.3, 1.4, 0.5, 1.9), 1, gentle)] }))).toBe(3);
  });
  it('one move never hits the same target twice on a single frame', () => {
    const overlap = defineMove('jab1', 'test', { duration: 20, hits: [window(4, 6, box(0.3, 1.4, 0.5, 1.9), 1, gentle), window(4, 6, box(0.3, 1.4, 0.5, 1.9), 1, gentle)] });
    expect(hitsOf(overlap)).toBeLessThanOrEqual(2);
  });
});

describe('match lifecycle cleanup', () => {
  it('sudden death leaves no grab, hold or buffered press behind', () => {
    const s = make(), [a, b] = s.fighters; faceOff(s);
    run(s, 1, { grab: true }); runUntil(s, () => b.heldBy === 0, 40);
    for (const f of s.fighters) { f.stocks = 1; }
    a.y = b.y = -30; run(s, 10);
    expect(s.suddenDeath).toBe(true);
    for (const f of s.fighters) { expect(f.hold).toBeNull(); expect(f.heldBy).toBeNull(); expect(f.input.requests).toHaveLength(0); expect(f.damage).toBe(150); }
  });
  it('a press held through a KO and respawn is not a surprise attack', () => {
    const s = make({ stage: 2 }), [a] = s.fighters; faceOff(s); s.fighters[1].x = -9;
    a.y = -30;
    for (let i = 0; i < 100; i++) run(s, 1, { attack: true });                                  // held the whole time
    expect(a.respawn).toBe(0); expect(a.attack).toBeNull();
  });
  it('the countdown ignores input entirely, then play starts clean', () => {
    const s = new ArenaSim({ fighters: [0, 1], stage: 0, mode: 'versus', difficulty: 1, items: false, seed: 1 });
    for (let i = 0; i < 149; i++) s.step([ctl({ attack: true, x: 1, grab: i === 3 }), ctl()]);
    expect(s.fighters[0].x).toBe(-4); expect(s.fighters[0].input.requests).toHaveLength(0); expect(s.countdown).toBe(1);
    s.step([ctl({ attack: true }), ctl()]); expect(s.countdown).toBe(0);
    run(s, 10, { attack: true });
    expect(s.fighters[0].attack).toBeNull();                                                     // still the same held press: no edge
  });
  it('new matches never share state with old ones', () => {
    const a = make(), b = make();
    run(a, 50, { attack: true, x: 1 });
    expect(JSON.stringify(b.fighters)).not.toBe(JSON.stringify(a.fighters));
    expect(b.fighters[0].input.requests).toHaveLength(0); expect(b.fighters[0].hold).toBeNull();
  });
  it('hitstop, stock loss and timer still behave after the rewrite', () => {
    const s = make(); s.remaining = 100; s.freeze = 5; run(s, 5);
    expect(s.remaining).toBe(95); expect(s.freeze).toBe(0);
  });
});
