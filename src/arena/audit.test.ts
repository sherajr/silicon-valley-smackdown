/**
 * Regression tests for the gameplay audit (findings F01-F15). Each one replays the audit's reproduction through
 * real controls and asserts the required result, not the old behaviour.
 */
import { describe, it, expect } from 'vitest';
import { buildStage } from './collision';
import { STAGE_PLATFORMS } from './data';
import { attackId, events, faceOff, make, replay, run, runUntil } from './testHelpers';

describe('F01: presses are never lost to hitstop or recovery', () => {
  it('a grab pressed for one tick during hitstop starts once when hitstop ends', () => {
    const s = make(), [a, b] = s.fighters; faceOff(s);
    s.freeze = 3;
    run(s, 1, { grab: true });
    expect(a.attack).toBeNull();                      // still frozen
    run(s, 3);
    expect(attackId(a)).toBe('grab'); expect(a.attack!.age).toBe(0);
    runUntil(s, () => b.heldBy === 0, 40);
    expect(b.damage).toBe(0);
  });
  it('a grab pressed two ticks before a jab ends executes right after the jab', () => {
    const s = make(), [a] = s.fighters; faceOff(s);
    s.startAttack(a, 'jab'); a.attack!.age = a.attack!.duration - 3;
    run(s, 1, { grab: true });
    expect(attackId(a)).toBe('jab1');                 // not legal yet: the jab is still in recovery
    run(s, 2);
    expect(attackId(a)).toBe('grab');
  });
  it('a request that is never legal in time expires instead of firing later', () => {
    const s = make(), [a] = s.fighters; faceOff(s); s.fighters[1].x = 30;
    s.startAttack(a, 'heavy');
    run(s, 1, { grab: true });
    run(s, 34);                                       // heavy lasts 35 ticks
    expect(a.attack).toBeNull();
    run(s, 10);
    expect(a.attack).toBeNull();
  });
  it('holding a button does not repeat: one press makes one move', () => {
    const s = make(), [a] = s.fighters; faceOff(s); s.fighters[1].x = 30;
    const started = new Set<number>();
    for (let i = 0; i < 60; i++) { run(s, 1, { attack: true }); if (a.attack) started.add(a.attack.uid); }   // held for the whole minute
    expect(started.size).toBe(1);
  });
  it('a release and a fresh press is a new request', () => {
    const s = make(), [a] = s.fighters; faceOff(s); s.fighters[1].x = 30;
    const started = new Set<number>();
    for (let i = 0; i < 60; i++) { run(s, 1, { attack: i % 12 < 2 }); if (a.attack) started.add(a.attack.uid); }
    expect(started.size).toBeGreaterThan(2);
  });
});

describe('F02: moves out of shield', () => {
  it('shield + grab in the same command starts a grab and drops the shield', () => {
    const s = make(), [a] = s.fighters; faceOff(s);
    run(s, 1, { shield: true }); expect(a.guarding).toBe(true);
    run(s, 1, { shield: true, grab: true });
    expect(attackId(a)).toBe('grab'); expect(a.guarding).toBe(false);
  });
  it('jump out of shield works', () => {
    const s = make(), [a] = s.fighters; faceOff(s);
    run(s, 2, { shield: true }); run(s, 1, { shield: true, jump: true });
    expect(a.grounded).toBe(false); expect(a.jumps).toBe(1); expect(a.vy).toBeGreaterThan(0.2);
  });
  it('direction + shield still rolls', () => {
    const s = make(), [a] = s.fighters; faceOff(s);
    run(s, 1, { shield: true, x: 1 }); expect(a.roll).toBeGreaterThan(0); expect(events(s, 'roll')).toHaveLength(1);
  });
});

describe('F03/F12: a grab catches, then throws', () => {
  it('M against a shielding opponent catches first and deals no damage on the catch', () => {
    const s = make(), [a, b] = s.fighters; faceOff(s);
    run(s, 1, { grab: true }, { shield: true });
    runUntil(s, () => b.heldBy === 0, 40, {}, { shield: true });
    expect(b.damage).toBe(0); expect(a.hold).not.toBeNull(); expect(events(s, 'hit')).toHaveLength(0);
    expect(b.guarding).toBe(false);
  });
  it('a fighter behind the grabber is not caught', () => {
    const s = make(), [a, b] = s.fighters; faceOff(s); b.x = -0.3;
    run(s, 1, { grab: true }); run(s, 40);
    expect(b.heldBy).toBeNull(); expect(a.hold).toBeNull();
  });
  it('an airborne target is not caught', () => {
    const s = make(), [a, b] = s.fighters; faceOff(s); b.y = 1.2; b.grounded = false; b.support = null; b.vy = 0.02;
    run(s, 1, { grab: true }); run(s, 14, {}, {});
    expect(b.heldBy).toBeNull();
  });
  it('a grab cannot be started in the air', () => {
    const s = make(), [a] = s.fighters; faceOff(s); a.y = 2; a.grounded = false; a.support = null;
    run(s, 1, { grab: true });
    expect(a.attack?.kind).not.toBe('grab');
  });
});

describe('F04: rolls stop at the platform edge', () => {
  it.each([0, 1, 2])('stage %s: a roll toward the edge never leaves the platform', stage => {
    const s = make({ stage }), [a] = s.fighters; faceOff(s); a.x = a.prevX = 9.3;
    run(s, 1, { shield: true });
    run(s, 14, { shield: true, x: 1 });
    expect(a.x).toBeLessThanOrEqual(9.5); expect(a.y).toBe(0); expect(a.grounded).toBe(true); expect(a.roll).toBe(0);
  });
  it('the mirrored roll toward the left edge also stops', () => {
    const s = make(), [a] = s.fighters; faceOff(s); a.x = a.prevX = -9.3;
    run(s, 1, { shield: true }); run(s, 14, { shield: true, x: -1 });
    expect(a.x).toBeGreaterThanOrEqual(-9.5); expect(a.y).toBe(0);
  });
  it('jump and recovery inputs are not locked out after a roll', () => {
    const s = make(), [a] = s.fighters; faceOff(s); a.x = a.prevX = 0;
    run(s, 1, { shield: true }); run(s, 1, { shield: true, x: 1 });
    run(s, 40);                                        // roll and its lag are long over
    run(s, 1, { jump: true });
    expect(a.jumps).toBe(1); expect(a.vy).toBeGreaterThan(0.2);
  });
  it('rolling repeatedly leaves the fighter vulnerable for part of every cycle', () => {
    const s = make(), [a] = s.fighters; faceOff(s); a.x = a.prevX = -4;
    let vulnerable = 0, total = 0;
    run(s, 1, { shield: true });
    for (let i = 0; i < 240; i++) { run(s, 1, { shield: true, x: i < 120 ? 1 : -1 }); total++; if (a.invincible === 0) vulnerable++; }
    expect(vulnerable / total).toBeGreaterThan(0.3);
  });
});

describe('F05: the main stage is a solid roof', () => {
  it('a fighter rising from below cannot pass through the roof', () => {
    const s = make(), [a] = s.fighters; faceOff(s);
    Object.assign(a, { x: 0, prevX: 0, y: -2, prevY: -2, vy: 0.43, grounded: false, support: null });
    const top = Math.max(a.y, -2);
    for (let i = 0; i < 8; i++) { run(s, 1); expect(a.y).toBeLessThan(top + 0.01 + 0); }
    expect(a.y).toBeLessThan(0);
  });
  it('the underside stops a head-first approach instead of tunnelling', () => {
    const s = make(), [a] = s.fighters; faceOff(s);
    Object.assign(a, { x: 3, prevX: 3, y: -6, prevY: -6, vy: 0.9, grounded: false, support: null });
    run(s, 12);
    expect(a.y).toBeLessThan(-1.06);                   // never above the underside of the slab
  });
  it('the side of the roof blocks horizontal passage', () => {
    const s = make(), [a] = s.fighters; faceOff(s);
    Object.assign(a, { x: 12, prevX: 12, y: -0.5, prevY: -0.5, vx: -0.6, vy: 0, grounded: false, support: null });
    run(s, 12);
    expect(a.x).toBeGreaterThan(9.5);
  });
  it('down never drops through the main stage', () => {
    const s = make(), [a] = s.fighters; faceOff(s);
    run(s, 10, { down: true });
    expect(a.y).toBe(0); expect(a.grounded).toBe(true);
  });
});

describe('F06: the jab string connects', () => {
  it.each([[1, 0], [-1, 0]])('V, V, V connects all three hits on an idle opponent (facing %s)', facing => {
    const s = make(), [a, b] = s.fighters; faceOff(s);
    if (facing < 0) { a.x = a.prevX = 0; b.x = b.prevX = -1.1; a.facing = -1; b.facing = 1; }
    replay(s, { 0: { attack: true }, 25: { attack: true }, 50: { attack: true } }, 90);
    expect(b.damage).toBe(5 + 7 + 9);
    // Hits this far apart let the defender act in between, so they are three separate hits, not a true combo.
    expect(events(s, 'combo')).toHaveLength(0);
  });
  it('presses buffered inside the cancel window advance the string without perfect timing', () => {
    const s = make(), [a, b] = s.fighters; faceOff(s);
    replay(s, { 0: { attack: true }, 5: { attack: true }, 12: { attack: true } }, 70);
    expect(b.damage).toBe(5 + 7 + 9);
    // Quick presses keep the defender in hitstun, so this one is a confirmed three-hit combo.
    expect(events(s, 'combo').map(e => e.value)).toEqual([2, 3]);
    expect(events(s, 'comboEnd').map(e => e.value)).toEqual([3]);
  });
  it('the combo counter counts confirmed hits only: whiffed jabs do not count', () => {
    const s = make(), [a] = s.fighters; faceOff(s); s.fighters[1].x = 20;
    replay(s, { 0: { attack: true }, 10: { attack: true }, 20: { attack: true } }, 60);
    expect(a.jabSequenceIndex).toBe(0); expect(a.combo).toBe(0); expect(events(s, 'combo')).toHaveLength(0);
  });
});

describe('F08: air control during attacks', () => {
  it('an aerial can be steered while it is active', () => {
    const s = make(), [a] = s.fighters; faceOff(s); s.fighters[1].x = 20;
    Object.assign(a, { x: 0, y: 6, vx: 0, vy: 0.1, grounded: false, support: null });
    s.startAttack(a, 'aerial');
    run(s, 15, { x: -1 });
    expect(a.x).toBeLessThan(-0.15); expect(a.vx).toBeLessThan(0);
  });
});

describe('F09: the down special lands its impact from any height', () => {
  it.each([4, 14])('a slam started at height %s hits a nearby grounded opponent exactly once', height => {
    const s = make({ stage: 2 }), [a, b] = s.fighters; faceOff(s, 1.1, 0);
    Object.assign(a, { y: height, prevY: height, vy: 0, grounded: false, support: null });
    run(s, 1, { special: true, down: true });
    runUntil(s, () => b.damage > 0, 80);
    expect(b.damage).toBe(16);
    run(s, 50);
    expect(b.damage).toBe(16);
    expect(events(s, 'impact')).toHaveLength(1);
  });
});

describe('F10: projectiles launch along their own travel direction', () => {
  it('a left-travelling shot launches its target left even if the owner has since moved past it', () => {
    const s = make(), [a, b] = s.fighters; faceOff(s); a.facing = -1; a.x = a.prevX = 0; b.x = b.prevX = -7; b.facing = 1;
    run(s, 1, { special: true });
    runUntil(s, () => s.shots.length > 0, 40);
    // The owner runs past the target before the shot arrives: the old code would now launch the target rightward.
    a.x = -11;
    runUntil(s, () => b.damage > 0, 80);
    expect(b.vx).toBeLessThan(0);
  });
});

describe('F11: simultaneous unequal hits give the same hitstop whichever slot is which', () => {
  const trade = (heavySlot: 0 | 1) => {
    const s = make({ fighters: [0, 0] }), f = s.fighters; faceOff(s, 1.0);
    const heavy = f[heavySlot], light = f[1 - heavySlot];
    s.startAttack(heavy, 'heavy'); heavy.attack!.age = 11;
    s.startAttack(light, 'jab'); light.attack!.age = 3;
    run(s, 1);
    return { freeze: s.freeze, damage: [f[0].damage, f[1].damage], heavyDealt: light.damage, lightDealt: heavy.damage };
  };
  it('produces identical freeze and damage for each side', () => {
    const one = trade(0), two = trade(1);
    expect(one.freeze).toBe(two.freeze); expect(one.heavyDealt).toBe(15); expect(two.heavyDealt).toBe(15);
    expect(one.lightDealt).toBe(5); expect(two.lightDealt).toBe(5); expect(one.freeze).toBeGreaterThanOrEqual(7);
  });
});

describe('F13: fighters do not occupy the same space', () => {
  it('two idle grounded fighters at the same spot separate symmetrically', () => {
    const s = make(), [a, b] = s.fighters; faceOff(s, 0, 0);
    run(s, 30);
    expect(Math.abs(b.x - a.x)).toBeGreaterThanOrEqual(0.6 - 1e-6); expect(Math.abs(a.x + b.x)).toBeLessThan(1e-6);
  });
  it('airborne fighters may cross over', () => {
    const s = make(), [a, b] = s.fighters; faceOff(s, 0.2, 0);
    for (const f of [a, b]) Object.assign(f, { y: 4, vy: 0, grounded: false, support: null });
    run(s, 2);
    expect(Math.abs(b.x - a.x)).toBeLessThan(0.3);
  });
  it('walking into an idle fighter at the edge pushes them no further than the platform allows', () => {
    const s = make(), [a, b] = s.fighters; faceOff(s, 1.0, 7.5);
    run(s, 120, { x: 1 });
    expect(b.grounded).toBe(true); expect(b.x).toBeLessThan(9.5); expect(a.x).toBeLessThan(b.x);
  });
});

describe('F14: a jump pressed just before landing is not lost, and never becomes a third jump', () => {
  it('jump pressed on the landing tick executes as a ground jump afterwards', () => {
    const s = make(), [a] = s.fighters; faceOff(s);
    Object.assign(a, { y: 0.1, prevY: 0.1, vy: -0.2, grounded: false, support: null, jumps: 2 });
    run(s, 1, { jump: true });
    expect(a.grounded).toBe(true);
    run(s, 2);
    expect(a.jumps).toBe(1); expect(a.vy).toBeGreaterThan(0.2);
  });
  it('a jump pressed far too early in the air is refused and does not fire after landing', () => {
    const s = make({ stage: 2 }), [a] = s.fighters; faceOff(s);
    Object.assign(a, { y: 8, prevY: 8, vy: 0, grounded: false, support: null, jumps: 2 });
    run(s, 1, { jump: true });
    runUntil(s, () => a.grounded, 200);
    run(s, 10);
    expect(a.jumps).toBe(0); expect(a.y).toBe(0);
  });
  it('the total air-jump budget is still two', () => {
    const s = make(), [a] = s.fighters; faceOff(s);
    run(s, 1, { jump: true }); run(s, 6); run(s, 1, { jump: true }); run(s, 6);
    const vy = a.vy; run(s, 1, { jump: true });
    expect(a.jumps).toBe(2); expect(a.vy).toBeLessThan(vy);
  });
});

describe('F15: ledges come from the stage definition', () => {
  it('ledge positions follow platform data', () => {
    const narrow = STAGE_PLATFORMS[0].map(p => p.id === 'main' ? { ...p, w: 15 } : p);
    const stage = buildStage(narrow);
    expect(stage.ledges.map(l => l.x).sort((p, q) => p - q)).toEqual([-7.5, 7.5]);
    expect(stage.solids[0].x1).toBe(7.5);
  });
  it('a fighter grabs the ledge of a narrower stage, and collision moves with it', () => {
    const s = make(), [a] = s.fighters; faceOff(s);
    s.setPlatforms(STAGE_PLATFORMS[0].map(p => p.id === 'main' ? { ...p, w: 15 } : p));
    Object.assign(a, { x: 7.9, prevX: 7.9, y: -0.3, prevY: -0.3, vx: -0.05, vy: -0.05, grounded: false, support: null, jumps: 2 });
    run(s, 1, { x: -1 });
    expect(a.ledge).toBeGreaterThan(0); expect(a.x).toBeCloseTo(7.2, 5); expect(a.y).toBe(0);
  });
  it('repeated ledge grabs give less protection and respect a cooldown', () => {
    const s = make(), [a] = s.fighters; faceOff(s);
    const grab = () => { Object.assign(a, { x: 9.8, y: -0.3, vx: -0.05, vy: -0.05, grounded: false, support: null, ledge: 0, jumps: 2, invincible: 0 }); run(s, 1, { x: -1 }); return a.invincible; };
    const first = grab();
    expect(first).toBeGreaterThan(20);
    a.ledgeCooldown = 0;
    const second = grab();
    expect(second).toBeLessThan(first);
  });
});

describe('input hygiene', () => {
  it('a press during the countdown does not become an attack at GO', () => {
    const s = make(), [a] = s.fighters; faceOff(s); s.countdown = 20;
    run(s, 10, { attack: true });                       // held through the countdown
    run(s, 20);
    expect(a.attack).toBeNull();
  });
  it('up + special recovers without also spending a jump', () => {
    const s = make(), [a] = s.fighters; faceOff(s);
    Object.assign(a, { x: 12, prevX: 12, y: -2, prevY: -2, vy: -0.05, grounded: false, support: null, jumps: 1 });
    run(s, 1, { up: true, jump: true, special: true });
    expect(attackId(a)).toBe('recovery'); expect(a.vy).toBeGreaterThan(0.35);
    expect(events(s, 'jump')).toHaveLength(0);
  });
  it('a spent recovery is refused and never becomes a neutral projectile', () => {
    const s = make(), [a] = s.fighters; faceOff(s);
    Object.assign(a, { x: 12, prevX: 12, y: -4, prevY: -4, vy: -0.2, grounded: false, support: null, jumps: 2, recovered: true });
    run(s, 1, { up: true, special: true }); run(s, 30);
    expect(s.shots).toHaveLength(0); expect(events(s, 'fizzle')).toHaveLength(1);
  });
  it('clearInputs forgets buffered presses', () => {
    const s = make(), [a] = s.fighters; faceOff(s); s.fighters[1].x = 30;
    s.startAttack(a, 'heavy');
    run(s, 1, { grab: true });
    s.clearInputs();
    run(s, 40);
    expect(a.attack).toBeNull();
  });
});
