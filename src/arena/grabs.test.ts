/** Catch, hold, tech, pummel and throw rules, exercised through real controls for both slots and both facings. */
import { describe, it, expect } from 'vitest';
import type { Controls } from './controls';
import { FIGHTERS } from './fighterDefinitions';
import { GRAB_PROTECT, HOLD_MAX, PUMMEL_MAX, TECH_FRAMES, canBeCaught, catchConnects, throwDirection } from './grabs';
import { duel, events } from './testHelpers';
import { box } from './moveDefinitions';

const SIDES = [[0, 1], [0, -1], [1, 1], [1, -1]] as const;
const HUNTER = FIGHTERS[0];

/** Mirror match so both slots have identical numbers. `actor` grabs; returns once the catch has connected. */
function caught(slot: 0 | 1, facing: 1 | -1, target: Partial<Controls> = {}, gap = 1.1) {
  const d = duel(slot, facing, gap, { fighters: [0, 0] });
  d.step(1, { grab: true }, target);
  d.until(() => d.other.heldBy === slot, 60, {}, target);
  return d;
}

describe.each(SIDES)('grab (actor slot %s, facing %s)', (slot, facing) => {
  it('catches through a shield, links both fighters, holds the target at the hands and deals no damage yet', () => {
    const d = caught(slot, facing, { shield: true });
    expect(d.actor.hold).toMatchObject({ target: 1 - slot, pummels: 0 });
    expect(d.other.heldBy).toBe(slot);
    expect(d.other.damage).toBe(0); expect(events(d.s, 'hit')).toHaveLength(0); expect(events(d.s, 'catch')).toHaveLength(1);
    expect(d.other.guarding).toBe(false);
    d.step(8);
    expect(d.other.x - d.actor.x).toBeCloseTo(facing * HUNTER.hold, 2);
    expect(d.other.facing).toBe(-facing);
    expect(d.other.vx).toBe(0);
  });

  it('neither fighter can walk, jump or act independently while linked', () => {
    const d = caught(slot, facing);
    const ax = d.actor.x, ox = d.other.x;
    d.step(6, { x: facing, jump: true }, { x: -facing, jump: true, attack: true });
    expect(Math.abs(d.actor.x - ax)).toBeLessThan(0.01); expect(d.other.jumps).toBe(0); expect(d.actor.jumps).toBe(0);
    expect(d.other.attack).toBeNull();
    expect(d.other.heldBy).toBe(slot); expect(Math.abs(d.other.x - ox)).toBeLessThan(0.5);
  });

  describe.each([
    ['forward', (f: 1 | -1): Partial<Controls> => ({ x: f })],
    ['neutral (defaults to forward)', (): Partial<Controls> => ({})],
  ])('throw %s', (_name, dir) => {
    it('damages and launches exactly once, on the authored release frame, toward the captor\'s facing', () => {
      const d = caught(slot, facing);
      d.step(1, { grab: true, ...dir(facing) });
      const release = HUNTER.moves.fthrow.throwing!.release;
      for (let i = 0; i < 40 && d.other.damage === 0; i++) { expect(d.other.damage).toBe(0); d.step(1); }
      expect(d.other.damage).toBe(HUNTER.moves.fthrow.throwing!.damage);
      expect(d.actor.attack!.age).toBe(release);
      expect(Math.sign(d.other.vx)).toBe(facing); expect(d.other.vy).toBeGreaterThan(0.05);
      expect(d.other.heldBy).toBeNull(); expect(d.actor.hold).toBeNull();
      const dealt = d.other.damage; d.step(60);
      expect(d.other.damage).toBe(dealt);                 // never damaged again by the same throw
      expect(events(d.s, 'hit')).toHaveLength(1);
    });
  });

  it('back throw sends the target behind the captor', () => {
    const d = caught(slot, facing);
    d.step(1, { grab: true, x: -facing });
    d.until(() => d.other.damage > 0, 40);
    expect(Math.sign(d.other.vx)).toBe(-facing); expect(d.other.vy).toBeGreaterThan(0.05);
    expect(d.other.damage).toBe(HUNTER.moves.bthrow.throwing!.damage);
  });

  it('up throw sends the target upward, and up is a throw direction, not a jump', () => {
    const d = caught(slot, facing);
    d.step(1, { grab: true, up: true, jump: true });      // W is both "up" and "jump" on the keyboard
    d.until(() => d.other.damage > 0, 40);
    expect(d.other.vy).toBeGreaterThan(0.12); expect(Math.abs(d.other.vx)).toBeLessThan(0.05);
    expect(d.other.damage).toBe(HUNTER.moves.uthrow.throwing!.damage);
    expect(d.actor.jumps).toBe(0); expect(events(d.s, 'jump')).toHaveLength(0);
  });

  it('down throw pins the target low with long hitstun', () => {
    const d = caught(slot, facing);
    d.step(1, { grab: true, down: true });
    d.until(() => d.other.damage > 0, 40);
    expect(d.other.vy).toBeLessThan(0.14); expect(d.other.stun).toBeGreaterThanOrEqual(HUNTER.moves.dthrow.throwing!.stun!);
    expect(d.other.damage).toBe(HUNTER.moves.dthrow.throwing!.damage);
  });

  describe('tech', () => {
    it('a fresh grab press during the catch hitstop breaks the hold with no damage and a symmetric separation', () => {
      const d = caught(slot, facing);
      const gap = Math.abs(d.other.x - d.actor.x);
      d.step(1, {}, { grab: true });                      // the first frozen tick after the catch
      expect(d.s.freeze).toBeGreaterThan(0);
      d.until(() => d.actor.hold === null, 20);
      expect(d.other.damage).toBe(0); expect(d.actor.damage).toBe(0); expect(events(d.s, 'tech')).toHaveLength(1);
      expect(d.other.heldBy).toBeNull(); expect(d.actor.busy).toBeGreaterThan(0); expect(d.other.busy).toBeGreaterThan(0);
      expect(Math.abs(d.other.x - d.actor.x)).toBeGreaterThan(Math.max(gap, HUNTER.hold) + 0.6);
      expect(Math.abs((d.actor.x + d.other.x) / 2 - (facing * HUNTER.hold) / 2)).toBeLessThan(0.45);
      expect(d.other.grabProtect).toBeGreaterThan(0);
    });
    it.each([5, 11])('a fresh press %s ticks after the catch still breaks the hold (inside the 8-frame window)', later => {
      const d = caught(slot, facing);
      d.step(later); d.step(1, {}, { grab: true });
      expect(d.actor.hold).toBeNull(); expect(events(d.s, 'tech')).toHaveLength(1); expect(d.other.damage).toBe(0);
    });
    it('a press after the window has closed does not tech', () => {
      const d = caught(slot, facing);
      d.step(1, { grab: true });                          // start the throw
      d.step(4 + TECH_FRAMES);                            // hitstop (4) + the whole window
      d.step(1, {}, { grab: true });
      expect(events(d.s, 'tech')).toHaveLength(0);
      d.until(() => d.other.damage > 0, 40);
      expect(d.other.damage).toBeGreaterThan(0);
    });
    it('a grab button that was already held is not a tech', () => {
      const d = caught(slot, facing);
      d.other.input.prev.grab = true;                      // the button was down before the catch
      d.step(20, {}, { grab: true });
      expect(events(d.s, 'tech')).toHaveLength(0); expect(d.other.heldBy).toBe(slot);
    });
    it('a press made before the catch connects is not a tech', () => {
      const d = duel(slot, facing, 1.1, { fighters: [0, 0] });
      d.step(1, { grab: true }); d.step(4); d.step(1, {}, { grab: true });   // target starts its own grab, then is caught
      d.until(() => d.other.heldBy === slot, 30);
      d.step(14);
      expect(events(d.s, 'tech')).toHaveLength(0); expect(d.other.heldBy).toBe(slot);
    });
  });

  it('pummels are capped, damage a little each, and do not count as combo hits', () => {
    const d = caught(slot, facing);
    const before = d.other.damage;
    for (let i = 0; i < 4; i++) { d.step(1, { attack: true }); d.step(15); }
    expect(d.actor.hold!.pummels).toBe(PUMMEL_MAX);
    expect(d.other.damage - before).toBeCloseTo(PUMMEL_MAX * HUNTER.moves.pummel.pummel!, 5);
    expect(events(d.s, 'pummel')).toHaveLength(PUMMEL_MAX);
    expect(d.actor.combo).toBe(0);
  });

  it('a hold never lasts longer than the cap: it throws forward by itself', () => {
    const d = caught(slot, facing);
    let held = 0;
    while (d.other.heldBy === slot && held < 300) { d.step(1); if (d.s.freeze === 0) held++; }
    expect(held).toBeGreaterThanOrEqual(HOLD_MAX - 1); expect(held).toBeLessThanOrEqual(HOLD_MAX + HUNTER.moves.fthrow.throwing!.release + 2);
    expect(d.other.damage).toBe(HUNTER.moves.fthrow.throwing!.damage); expect(Math.sign(d.other.vx)).toBe(facing);
  });

  describe('who can be caught', () => {
    it.each([
      ['a fighter out of reach', (d: ReturnType<typeof duel>) => { d.other.x = d.facing * 2.8; }],
      ['a fighter behind the captor', (d: ReturnType<typeof duel>) => { d.other.x = -d.facing * 0.3; }],
      ['a fighter standing on a higher platform', (d: ReturnType<typeof duel>) => {
        // Horizontally in reach, but on the upper platform: 3.4 above the grabber.
        const x = d.facing * 3.2; d.actor.x = d.actor.prevX = x - d.facing * 1.1; d.other.x = d.other.prevX = x; d.other.y = d.other.prevY = 3.4; d.other.support = d.facing > 0 ? 'right' : 'left';
      }],
      ['an airborne fighter', (d: ReturnType<typeof duel>) => { d.other.y = 1.2; d.other.grounded = false; d.other.support = null; d.other.vy = 0.03; }],
      ['an invincible fighter', (d: ReturnType<typeof duel>) => { d.other.invincible = 60; }],
      ['a rolling fighter', (d: ReturnType<typeof duel>) => { d.other.roll = 20; d.other.invincible = 20; }],
      ['a fighter in hitstun', (d: ReturnType<typeof duel>) => { d.other.stun = 30; }],
      ['a fighter still under regrab protection', (d: ReturnType<typeof duel>) => { d.other.grabProtect = 30; }],
    ])('does not catch %s', (_name, arrange) => {
      const d = duel(slot, facing, 1.1, { fighters: [0, 0] });
      arrange(d);
      d.step(1, { grab: true }); d.step(40);
      expect(d.other.heldBy).toBeNull(); expect(d.actor.hold).toBeNull();
    });
    it('misses leave the grabber in endlag that a punish can exploit', () => {
      const d = duel(slot, facing, 3, { fighters: [0, 0] });
      d.step(1, { grab: true });
      d.step(HUNTER.moves.grab.duration - 4);
      expect(d.actor.attack?.id).toBe('grab');            // still recovering from the whiff
      d.step(6);
      expect(d.actor.attack).toBeNull();
    });
  });

  describe('fairness and cleanup', () => {
    it('two grabs that connect on each other break: no hold, no damage, both recover and are pushed apart', () => {
      const d = duel(slot, facing, 1.1, { fighters: [0, 0] });
      d.step(1, { grab: true }, { grab: true });
      d.until(() => events(d.s, 'throwBreak').length > 0, 40);
      expect(d.actor.hold).toBeNull(); expect(d.other.hold).toBeNull(); expect(d.actor.damage + d.other.damage).toBe(0);
      expect(d.actor.busy).toBeGreaterThan(0); expect(d.other.busy).toBeGreaterThan(0);
      expect(Math.abs(d.other.x - d.actor.x)).toBeGreaterThan(1.8);
    });
    it('an active strike that connects beats a grab on the same frame', () => {
      const d = duel(slot, facing, 1.1, { fighters: [0, 0] });
      d.step(1, { grab: true }); d.step(3); d.step(1, {}, { attack: true });   // the jab is active on the catch frame
      d.until(() => d.actor.damage > 0, 30);
      expect(d.other.heldBy).toBeNull(); expect(d.actor.hold).toBeNull(); expect(d.actor.damage).toBe(5);
    });
    it('the captor being hit frees the held fighter cleanly', () => {
      const d = caught(slot, facing);
      d.s.hit(d.other, d.actor, 6, 0.15, 'jab');
      expect(d.actor.hold).toBeNull(); expect(d.other.heldBy).toBeNull(); expect(d.other.grabProtect).toBeGreaterThan(0);
      d.step(5);
      expect(d.other.x).toBeLessThan(10);
    });
    it('a projectile from the held fighter that reaches the captor also ends the hold', () => {
      const d = caught(slot, facing);
      const def = FIGHTERS[0].moves.special.projectile!;
      d.s.shots.push({ id: 99, owner: d.other.slot, kind: 0, x: d.actor.x - facing * 0.3, y: 1.3, vx: facing * 0.01, vy: 0, life: 30, dir: facing, bounces: 0, def });
      d.step(6);
      expect(d.actor.hold).toBeNull(); expect(d.other.heldBy).toBeNull(); expect(d.actor.damage).toBeGreaterThan(0);
    });
    it('a captor knocked out mid-hold leaves no stale link behind', () => {
      const d = caught(slot, facing);
      d.actor.y = -30;
      d.step(8);                                            // past the catch hitstop, where blast zones are checked
      expect(d.actor.respawn).toBeGreaterThan(0); expect(d.actor.hold).toBeNull(); expect(d.other.heldBy).toBeNull();
    });
    it('resetting positions clears holds', () => {
      const d = caught(slot, facing);
      d.s.resetPositions();
      expect(d.actor.hold).toBeNull(); expect(d.other.heldBy).toBeNull();
    });
    it('a thrown fighter cannot be caught again until protection ends, so grabs cannot chain forever', () => {
      const d = caught(slot, facing);
      d.step(1, { grab: true, down: true });
      d.until(() => d.other.damage > 0, 40);
      expect(d.other.grabProtect).toBeGreaterThan(20);
      let catches = 0;
      for (let i = 0; i < 180; i++) { d.step(1, { grab: i % 6 === 0 }); if (d.actor.hold && d.actor.hold.age === 1) catches++; d.other.stun = Math.max(0, d.other.stun - 1); }
      expect(catches).toBeLessThanOrEqual(3);
    });
  });
});

describe('grab rules as pure functions', () => {
  it('only standing or shielding ground fighters who are not protected or held can be caught', () => {
    const base = { x: 0, y: 0, facing: 1, grounded: true, stocks: 3, respawn: 0, invincible: 0, stun: 0, roll: 0, ledge: 0, heldBy: null, hold: null, grabProtect: 0 };
    expect(canBeCaught(base)).toBe(true);
    for (const change of [{ grounded: false }, { stocks: 0 }, { respawn: 1 }, { invincible: 1 }, { stun: 1 }, { roll: 1 }, { ledge: 1 }, { heldBy: 0 }, { hold: {} }, { grabProtect: 1 }])
      expect(canBeCaught({ ...base, ...change })).toBe(false);
  });
  it('throw direction: vertical input wins, back is relative to facing, neutral is forward', () => {
    expect(throwDirection(1, { x: 0, up: false, down: false })).toBe('f');
    expect(throwDirection(1, { x: 1, up: false, down: false })).toBe('f');
    expect(throwDirection(1, { x: -1, up: false, down: false })).toBe('b');
    expect(throwDirection(-1, { x: 1, up: false, down: false })).toBe('b');
    expect(throwDirection(-1, { x: -1, up: false, down: false })).toBe('f');
    expect(throwDirection(1, { x: -1, up: true, down: false })).toBe('u');
    expect(throwDirection(1, { x: 1, up: false, down: true })).toBe('d');
  });
  it('a catch needs the target in front, at the same height, inside the volume', () => {
    const c = { x: 0, y: 0, facing: 1 }, b = box(0.15, 1.25, 0.2, 1.9), hurt = { hw: 0.38, h: 2.3 };
    expect(catchConnects(c, b, { x: 1.1, y: 0 }, hurt)).toBe(true);
    expect(catchConnects(c, b, { x: -0.3, y: 0 }, hurt)).toBe(false);
    expect(catchConnects(c, b, { x: 2.6, y: 0 }, hurt)).toBe(false);
    expect(catchConnects(c, b, { x: 1.1, y: 1.2 }, hurt)).toBe(false);
    expect(catchConnects({ ...c, facing: -1 }, b, { x: -1.1, y: 0 }, hurt)).toBe(true);
    expect(catchConnects({ ...c, facing: -1 }, b, { x: 1.1, y: 0 }, hurt)).toBe(false);
  });
});
