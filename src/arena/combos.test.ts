/**
 * Combos, verified through real controls. Every route comes from the same data the help and training screens show,
 * so what is documented is exactly what is tested: connects at 0% on everyone, stays true up to the stated limits on
 * an average-weight defender (with and without DI), and stops working just past them.
 */
import { describe, it, expect } from 'vitest';
import { FIGHTERS } from './fighterDefinitions';
import { ctl, events, faceOff, isTrueCombo, make, replay, run, runCombo } from './testHelpers';
import { ArenaSim, noInput } from './Simulation';

const FIGHTER_NAMES = FIGHTERS.map(f => f.id);
const AVERAGE = 0;                                     // Hunter, weight 1.0
const SIDES = [[1, 0], [-1, 0], [1, 1], [-1, 1]] as const;
const verified = FIGHTERS.flatMap((f, i) => f.combos.filter(c => c.script && c.kinds).map(c => [f.id, i, c] as const));

describe('combo data', () => {
  it('every fighter documents a jab string, one verified unique route, and one pressure or read', () => {
    for (const f of FIGHTERS) {
      expect(f.combos.filter(c => c.kind === 'true' && c.script)).toHaveLength(2);
      expect(f.combos.some(c => c.kind !== 'true')).toBe(true);
      expect(f.combos[0].inputs).toBe('V, V, V');
    }
  });
  it('unique routes differ from fighter to fighter', () => {
    const routes = FIGHTERS.map(f => JSON.stringify(f.combos[1].script));
    expect(new Set(routes).size).toBe(6);
  });
});

describe.each(verified)('%s: %#', (_id, attacker, combo) => {
  const need = combo.kinds!;
  it('connects at 0% on every defender, both slots and both facings, with no DI', () => {
    for (let defender = 0; defender < 6; defender++) for (const [facing, slot] of SIDES) {
      const r = runCombo(attacker, defender, 0, combo, { facing, slot: slot as 0 | 1 });
      expect(isTrueCombo(r, need), `${FIGHTER_NAMES[attacker]} ${combo.name} vs ${FIGHTER_NAMES[defender]} facing ${facing} slot ${slot}: ${r.kinds}`).toBe(true);
    }
  });
  it(`stays a true combo up to its stated no-DI limit on an average-weight defender`, () => {
    for (let pct = 0; pct <= combo.limits!.none; pct += 5) for (const [facing, slot] of SIDES)
      expect(isTrueCombo(runCombo(attacker, AVERAGE, pct, combo, { facing, slot: slot as 0 | 1 }), need), `${pct}%`).toBe(true);
  });
  it(`with the defender holding away, stays true up to its stated DI limit`, () => {
    if (combo.limits!.away < 0) { expect(isTrueCombo(runCombo(attacker, AVERAGE, 0, combo, { di: 'away' }), need)).toBe(false); return; }
    for (let pct = 0; pct <= combo.limits!.away; pct += 5) for (const [facing, slot] of SIDES)
      expect(isTrueCombo(runCombo(attacker, AVERAGE, pct, combo, { facing, slot: slot as 0 | 1, di: 'away' }), need), `${pct}%`).toBe(true);
  });
  it('is honest: the stated limits are tight, not conservative', () => {
    const tight = (limit: number, di: 'none' | 'away') => {
      if (limit >= 100) return true;
      for (let pct = limit + 5; pct <= limit + 15; pct += 5) for (const [facing, slot] of SIDES) if (!isTrueCombo(runCombo(attacker, AVERAGE, pct, combo, { facing, slot: slot as 0 | 1, di }), need)) return true;
      return false;
    };
    expect(tight(combo.limits!.none, 'none')).toBe(true);
    if (combo.limits!.away >= 0) expect(tight(combo.limits!.away, 'away')).toBe(true);
  });
});

describe('what the documented limits mean', () => {
  const hunter = FIGHTERS[0].combos[1];
  it('DI matters: Hunter\'s route connects on a dummy but can be escaped by holding away', () => {
    expect(isTrueCombo(runCombo(0, AVERAGE, 35, hunter, { di: 'none' }), hunter.kinds!)).toBe(true);
    expect(isTrueCombo(runCombo(0, AVERAGE, 35, hunter, { di: 'away' }), hunter.kinds!)).toBe(false);
  });
  it('weight matters: heavy defenders stay in the route longer, light ones drop out sooner', () => {
    expect(isTrueCombo(runCombo(0, 2, 60, hunter), hunter.kinds!)).toBe(true);             // Al
    expect(isTrueCombo(runCombo(0, 3, 60, hunter), hunter.kinds!)).toBe(false);            // Priya
  });
  it('Kevin\'s route holds against defenders who cannot DI out of range, but average weights can escape it', () => {
    const kevin = FIGHTERS[1].combos[1];
    expect(isTrueCombo(runCombo(1, 2, 80, kevin, { di: 'away' }), kevin.kinds!)).toBe(true);
    expect(isTrueCombo(runCombo(1, AVERAGE, 80, kevin, { di: 'away' }), kevin.kinds!)).toBe(false);
  });
});

describe('jab strings', () => {
  it.each(FIGHTERS.map((f, i) => [f.id, i] as const))('%s: rapid mashing chains three distinct jabs in order', (_n, c) => {
    const s = make({ fighters: [c, 0] }), [a] = s.fighters; faceOff(s); s.fighters[1].x = -9;
    const seen: string[] = [];
    for (let i = 0; i < 70; i++) { run(s, 1, { attack: i % 4 === 0 }); const id = a.attack?.id; if (id && seen[seen.length - 1] !== id) seen.push(id); }
    expect(seen.slice(0, 3)).toEqual(['jab1', 'jab2', 'jab3']);
  });
  it('pressing again after the finisher starts over at the first jab', () => {
    const s = make(), [a] = s.fighters; faceOff(s); s.fighters[1].x = -9;
    replay(s, { 0: { attack: true }, 8: { attack: true }, 16: { attack: true } }, 60);
    expect(a.jabSequenceIndex).toBe(0);
    run(s, 1, { attack: true });
    expect(a.attack?.id).toBe('jab1');
  });
  it('the string resets to the first jab if the player waits too long between jabs', () => {
    const s = make(), [a] = s.fighters; faceOff(s); s.fighters[1].x = -9;
    replay(s, { 0: { attack: true } }, 70);
    expect(a.jabSequenceIndex).toBe(0);
    run(s, 1, { attack: true }); expect(a.attack?.id).toBe('jab1');
  });
  it.each(FIGHTERS.map((f, i) => [f.id, i] as const))('%s: against a shield the string is blocked: no combo, shield damage, and it still chains', (_n, c) => {
    const t = make({ fighters: [c, 0] }), [x, y] = t.fighters; faceOff(t);
    for (let i = 0; i < 70; i++) t.step([ctl([0, 7, 14].includes(i) ? { attack: true } : {}), ctl({ shield: true })]);
    expect(y.damage).toBe(0); expect(y.shield).toBeLessThan(100); expect(events(t, 'block').length).toBeGreaterThanOrEqual(2);
    expect(events(t, 'combo')).toHaveLength(0); expect(x.combo).toBe(0);
  });
  it('whiffed jabs do not count: no hits, no combo events', () => {
    const s = make(), [a] = s.fighters; faceOff(s); s.fighters[1].x = -9;
    replay(s, { 0: { attack: true }, 7: { attack: true }, 14: { attack: true } }, 60);
    expect(events(s, 'hit')).toHaveLength(0); expect(events(s, 'combo')).toHaveLength(0); expect(a.combo).toBe(0);
  });
});

describe('confirmed combo counting', () => {
  it('counts a chain of hits while the defender is in hitstun', () => {
    const r = runCombo(0, AVERAGE, 0, FIGHTERS[0].combos[0]);
    expect(r.comboMax).toBe(3);
  });
  it('two hits farther apart than the hitstun are two separate hits, not a combo', () => {
    const s = make(), [a, b] = s.fighters; faceOff(s);
    replay(s, { 0: { attack: true }, 40: { attack: true } }, 100);
    expect(b.damage).toBe(10); expect(events(s, 'combo')).toHaveLength(0); expect(a.combo).toBe(0);
  });
  it('the counter carries the running damage and resets at the end', () => {
    const s = make(), [a, b] = s.fighters; faceOff(s);
    replay(s, { 0: { attack: true }, 7: { attack: true }, 14: { attack: true } }, 34);
    expect(a.combo).toBe(3); expect(a.comboDamage).toBe(21);
    run(s, 80);
    expect(a.combo).toBe(0); expect(a.comboDamage).toBe(0); expect(b.stun).toBe(0);
    expect(events(s, 'comboEnd').map(e => e.value)).toEqual([3]);
  });
  it('a knocked-out defender ends the combo', () => {
    const s = make(), [a, b] = s.fighters; faceOff(s);
    replay(s, { 0: { attack: true }, 7: { attack: true } }, 24);
    expect(a.combo).toBe(2); b.y = -30;
    run(s, 4);
    expect(a.combo).toBe(0); expect(events(s, 'comboEnd')).toHaveLength(1);
  });
});

describe('anti-loop protection', () => {
  it('from the fourth hit of a combo, damage and hitstun shrink, so long juggles run dry', () => {
    const s = make(), [a, b] = s.fighters; faceOff(s);
    const dealt: number[] = [], stuns: number[] = [];
    for (let i = 0; i < 8; i++) { const before = b.damage; s.hit(a, b, 10, 0.1, 'jab'); dealt.push(b.damage - before); stuns.push(b.stun); s.freeze = 0; }
    expect(dealt.slice(0, 3)).toEqual([10, 10, 10]);
    expect(dealt[3]).toBeCloseTo(9, 5); expect(dealt[4]).toBeCloseTo(8, 5); expect(dealt[7]).toBeCloseTo(5, 5);
    expect(stuns[3]).toBeLessThan(stuns[2]); expect(stuns[7]).toBeLessThanOrEqual(stuns[4]);
  });
  it('three-hit strings are never scaled', () => {
    const r = runCombo(0, AVERAGE, 0, FIGHTERS[0].combos[0]);
    expect(r.damage).toBe(21);
  });
  it('a bot repeating grab and down throw as fast as it can never locks the defender out of acting', () => {
    const s = make({ fighters: [2, 0] }), [a, b] = s.fighters; faceOff(s);
    let actionable = 0, longestLock = 0, lock = 0;
    for (let i = 0; i < 900; i++) {
      s.step([ctl({ grab: i % 4 === 0, down: true }), ctl()]);
      if (b.respawn > 0) { faceOff(s); continue; }
      const free = b.stun === 0 && b.heldBy === null && b.busy === 0;
      if (free) { actionable++; lock = 0; } else longestLock = Math.max(longestLock, ++lock);
    }
    expect(actionable).toBeGreaterThan(100); expect(longestLock).toBeLessThan(120);
    expect(a.stocks).toBe(3);
  });
  it('a launcher route ends with the defender able to act again', () => {
    const r = runCombo(5, AVERAGE, 0, FIGHTERS[5].combos[1], { tail: 160 });
    expect(r.sim.fighters[1].stun).toBe(0);
  });
});

describe('damage and launch are bounded and monotonic', () => {
  const launchOf = (defender: number, percent: number) => {
    const s = make({ fighters: [0, defender] }), [a, b] = s.fighters; faceOff(s); b.damage = percent;
    s.hit(a, b, 12, 0.24, 'heavy');
    return { speed: Math.hypot(b.vx, b.vy), stun: b.stun };
  };
  it('launch speed never falls as damage rises, never rises with weight, and stays under the cap', () => {
    for (let d = 0; d < 6; d++) {
      let last = -1;
      for (let pct = 0; pct <= 999; pct += 25) { const { speed } = launchOf(d, pct); expect(speed).toBeGreaterThanOrEqual(last - 1e-9); expect(speed).toBeLessThanOrEqual(1.4 + 1e-9); expect(Number.isFinite(speed)).toBe(true); last = speed; }
    }
    expect(launchOf(2, 100).speed).toBeLessThan(launchOf(3, 100).speed);       // Al resists; Priya flies
  });
  it('hitstun is bounded', () => { expect(launchOf(3, 999).stun).toBeLessThanOrEqual(150); });
});

describe('determinism', () => {
  it('the same inputs always produce the same match, regardless of how many ticks are delivered per batch', () => {
    const script = (i: number) => ctl(i % 17 === 0 ? { attack: true, x: 1 } : i % 29 === 0 ? { special: true } : i % 41 === 0 ? { grab: true } : { x: i % 60 < 30 ? 1 : -1 });
    const play = (batch: number) => {
      const s = new ArenaSim({ fighters: [1, 4], stage: 1, mode: 'cpu', difficulty: 2, items: true, seed: 11 }); s.countdown = 0;
      for (let i = 0; i < 1200; i += batch) for (let k = 0; k < batch; k++) s.step([script(i + k), noInput()]);
      return JSON.stringify([s.fighters, s.shots, s.pickups, s.tick]);
    };
    expect(play(1)).toBe(play(4)); expect(play(1)).toBe(play(12));
  });
});
