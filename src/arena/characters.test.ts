/** The six fighters are genuinely different, and each signature mechanic works through real controls. */
import { describe, it, expect } from 'vitest';
import { FIGHTERS } from './fighterDefinitions';
import type { FighterDef } from './fighterDefinitions';
import { MOVE_IDS, moveReach } from './moveDefinitions';
import type { MoveId } from './moveDefinitions';
import { ROSTER, MOVE_SPEED, WEIGHT, SPECIAL_NAMES, RECOVERY_NAMES } from './data';
import { attackId, duel, events, faceOff, make, run, runUntil } from './testHelpers';

const names = FIGHTERS.map(f => f.id);
const pairs = FIGHTERS.flatMap((a, i) => FIGHTERS.slice(i + 1).map((b, j) => [a, b, i, i + 1 + j] as const));

describe('roster data', () => {
  it('has a typed definition for every original fighter, in roster order', () => {
    expect(FIGHTERS).toHaveLength(6);
    expect(names).toEqual(ROSTER.map(r => r.id));
  });
  it('every fighter defines every move slot with sane timing', () => {
    for (const f of FIGHTERS) for (const id of MOVE_IDS) {
      const m = f.moves[id];
      expect(m, `${f.id}.${id}`).toBeDefined();
      expect(m.id).toBe(id);
      expect(m.duration).toBeGreaterThan(m.start);
      expect(m.start).toBeGreaterThanOrEqual(0);
      for (const h of m.hits) { expect(h.to).toBeGreaterThanOrEqual(h.from); expect(h.damage).toBeGreaterThan(0); expect(h.box.x1).toBeGreaterThan(h.box.x0); }
    }
  });
  it('the legacy exports are derived from the definitions', () => {
    expect(MOVE_SPEED).toEqual(FIGHTERS.map(f => f.walk)); expect(WEIGHT).toEqual(FIGHTERS.map(f => f.weight));
    expect(SPECIAL_NAMES).toEqual(FIGHTERS.map(f => f.moves.special.name)); expect(RECOVERY_NAMES).toEqual(FIGHTERS.map(f => f.moves.recovery.name));
  });
  it('keeps the original recovery and projectile names', () => {
    expect(RECOVERY_NAMES).toEqual(['Elevator Pitch', 'Appeal to the Court', 'Last Call Lift', 'Career Ladder', 'Bridge Funding', 'To the Moon']);
    expect(SPECIAL_NAMES).toEqual(['iPad Yeet', 'Briefcase Briefing', 'Bottle Service', 'Résumé Blast', 'Cash Burn', 'Rocket Reply']);
  });
});

describe.each(pairs)('fighters %#: %s vs %s are not reskins', (a: FighterDef, b: FighterDef) => {
  const same = (pick: (f: FighterDef) => unknown) => JSON.stringify(pick(a)) === JSON.stringify(pick(b));
  it.each([
    ['heavy attack', (f: FighterDef) => { const m = f.moves.heavy; return [m.start, m.duration, m.hits]; }],
    ['jab string', (f: FighterDef) => [f.moves.jab1.hits, f.moves.jab2.hits, f.moves.jab3.hits]],
    ['up attack', (f: FighterDef) => f.moves.upper.hits],
    ['down attack', (f: FighterDef) => f.moves.sweep.hits],
    ['aerials', (f: FighterDef) => ['nair', 'fair', 'bair', 'uair', 'dair'].map(id => f.moves[id as MoveId].hits)],
    ['projectile', (f: FighterDef) => f.moves.special.projectile],
    ['recovery', (f: FighterDef) => [f.moves.recovery.recovery, f.moves.recovery.hits, f.moves.recovery.duration]],
    ['down special', (f: FighterDef) => { const m = f.moves.down; return [m.kind, m.hits, m.counter, m.dive, m.lunge, m.cancels]; }],
    ['grab', (f: FighterDef) => f.moves.grab.grab],
    ['throws', (f: FighterDef) => ['fthrow', 'bthrow', 'uthrow', 'dthrow'].map(id => f.moves[id as MoveId].throwing)],
  ])('has a different %s', (_name, pick) => { expect(same(pick)).toBe(false); });
  it('differs in body and movement', () => {
    expect([a.walk, a.weight, a.hurt.hw, a.hurt.h]).not.toEqual([b.walk, b.weight, b.hurt.hw, b.hurt.h]);
  });
});

describe('authored move data stays inside sensible limits', () => {
  it.each(FIGHTERS.map(f => [f.id, f] as const))('%s: every window, cancel and phase is valid and bounded', (_name, f) => {
    for (const id of MOVE_IDS) {
      const m = f.moves[id], where = `${f.id}.${id}`;
      for (const h of m.hits) {
        expect(h.damage, where).toBeGreaterThan(0); expect(h.damage, where).toBeLessThanOrEqual(25);
        expect(h.launch.base, where).toBeGreaterThanOrEqual(0); expect(h.launch.base, where).toBeLessThanOrEqual(0.5);
        expect(h.launch.growth, where).toBeGreaterThanOrEqual(0); expect(h.launch.growth, where).toBeLessThanOrEqual(0.006);
        expect(h.launch.angle, where).toBeGreaterThanOrEqual(-90); expect(h.launch.angle, where).toBeLessThanOrEqual(180);
        expect(h.from, where).toBeGreaterThanOrEqual(0); expect(h.to, where).toBeLessThan(m.duration);
        if (h.stun !== undefined) expect(h.stun, where).toBeLessThanOrEqual(60);
        if (h.stop !== undefined) expect(h.stop, where).toBeLessThanOrEqual(12);
        if (h.rehit !== undefined) expect(h.rehit, where).toBeGreaterThan(0);
      }
      for (const c of m.cancels ?? []) {
        expect(c.into === 'jump' || MOVE_IDS.includes(c.into), `${where} cancels into ${c.into}`).toBe(true);
        expect(c.from, where).toBeGreaterThanOrEqual(m.start); expect(c.from, where).toBeLessThan(m.duration);
        if (c.into !== 'jump') expect(f.moves[c.into], where).toBeDefined();
      }
      if (m.counter) { expect(m.counter.to, where).toBeLessThan(m.duration); expect(m.counter.after, where).toBeLessThan(m.duration); expect(m.counter.damage, where).toBeGreaterThan(0); }
      if (m.armor) { expect(m.armor.to, where).toBeLessThan(m.duration); expect(m.armor.limit, where).toBeGreaterThan(0); }
      if (m.projectile) { expect(m.projectile.fire, where).toBeLessThan(m.duration); expect(m.projectile.life, where).toBeGreaterThan(0); expect(m.projectile.rx, where).toBeGreaterThan(0); expect(Math.hypot(m.projectile.vx, m.projectile.vy), where).toBeLessThan(0.6); }
      if (m.throwing) { expect(m.throwing.release, where).toBeLessThan(m.duration); expect(m.throwing.release, where).toBeGreaterThan(8); expect(m.throwing.damage, where).toBeLessThanOrEqual(15); }
      if (m.grab) { expect(m.grab.to, where).toBeLessThan(m.duration); expect(m.duration - m.grab.to, where).toBeGreaterThanOrEqual(20); }   // a whiff is always punishable
      if (m.dive) expect(m.dive.speed, where).toBeLessThanOrEqual(0.52);
      if (m.recovery) expect(m.recovery.vy, where).toBeLessThan(0.7);
    }
    expect(f.hold).toBeGreaterThan(0.5); expect(f.hurt.hw).toBeGreaterThan(0.2); expect(f.weight).toBeGreaterThan(0.5);
  });
  it('the launch math used by every window is monotonic in damage and antitonic in weight', () => {
    const speed = (l: { base: number; growth: number }, damage: number, weight: number) => (l.base + damage * l.growth) / weight;
    for (const f of FIGHTERS) for (const id of MOVE_IDS) for (const h of f.moves[id].hits) {
      expect(speed(h.launch, 100, 1)).toBeGreaterThanOrEqual(speed(h.launch, 0, 1));
      expect(speed(h.launch, 50, 0.88)).toBeGreaterThanOrEqual(speed(h.launch, 50, 1.23));
    }
  });
});

describe('stated identities hold in the numbers', () => {
  const by = (id: string) => FIGHTERS[names.indexOf(id)];
  it('Al has the longest grab and is the heaviest and slowest', () => {
    const reach = FIGHTERS.map(f => f.moves.grab.grab!.box.x1);
    expect(Math.max(...reach)).toBe(by('al').moves.grab.grab!.box.x1);
    expect(by('al').weight).toBe(Math.max(...FIGHTERS.map(f => f.weight))); expect(by('al').walk).toBe(Math.min(...FIGHTERS.map(f => f.walk)));
  });
  it('Priya is the lightest and fastest with the best air control and the shortest grab', () => {
    expect(by('priya').weight).toBe(Math.min(...FIGHTERS.map(f => f.weight))); expect(by('priya').walk).toBe(Math.max(...FIGHTERS.map(f => f.walk)));
    expect(by('priya').airAccel).toBe(Math.max(...FIGHTERS.map(f => f.airAccel)));
    expect(by('priya').moves.grab.grab!.box.x1).toBe(Math.min(...FIGHTERS.map(f => f.moves.grab.grab!.box.x1)));
  });
  it('Kevin has the longest pokes; Priya has the fastest jab and the smallest per-hit damage', () => {
    const jab = FIGHTERS.map(f => moveReach(f.moves.jab1));
    expect(Math.max(...jab)).toBe(moveReach(by('kevin').moves.jab1));
    expect(by('priya').moves.jab1.start).toBe(Math.min(...FIGHTERS.map(f => f.moves.jab1.start)));
    expect(by('priya').moves.jab1.hits[0].damage).toBe(Math.min(...FIGHTERS.map(f => f.moves.jab1.hits[0].damage)));
  });
  it('Elon has the biggest hurtbox, the slowest projectile start and the strongest vertical recovery', () => {
    const area = (f: FighterDef) => f.hurt.hw * f.hurt.h;
    expect(area(by('elon'))).toBe(Math.max(...FIGHTERS.map(area)));
    expect(by('elon').moves.recovery.recovery!.vy).toBe(Math.max(...FIGHTERS.map(f => f.moves.recovery.recovery!.vy)));
    expect(by('elon').moves.special.projectile!.fire).toBe(Math.max(...FIGHTERS.map(f => f.moves.special.projectile!.fire)));
    expect(by('elon').moves.recovery.landing).toBeGreaterThan(Math.max(...FIGHTERS.filter(f => f.id !== 'elon').map(f => f.moves.recovery.landing ?? 0)));
  });
  it('Chad travels farthest sideways in recovery and has the widest projectile; Al drifts least', () => {
    const drift = (f: FighterDef) => f.moves.recovery.recovery!.vx + f.moves.recovery.recovery!.drift * 17;
    expect(drift(by('chad'))).toBe(Math.max(...FIGHTERS.map(drift))); expect(drift(by('al'))).toBe(Math.min(...FIGHTERS.map(drift)));
    expect(by('chad').moves.special.projectile!.ry).toBe(Math.max(...FIGHTERS.map(f => f.moves.special.projectile!.ry)));
  });
  it('the down special differs in kind: slams, a counter, a dash', () => {
    expect(FIGHTERS.map(f => f.moves.down.kind)).toEqual(['slam', 'counter', 'slam', 'dash', 'slam', 'slam']);
  });
  it('every fighter answers all nine original input categories with a legal move', () => {
    const cats = ['jab', 'heavy', 'aerial', 'upper', 'sweep', 'special', 'recovery', 'slam', 'grab'] as const;
    for (let c = 0; c < 6; c++) for (const cat of cats) {
      const s = make({ fighters: [c, 1] }), [a] = s.fighters; faceOff(s); s.fighters[1].x = -9;
      s.startAttack(a, cat);
      expect(a.attack, `${names[c]} ${cat}`).not.toBeNull(); expect(a.attack!.duration).toBeGreaterThan(0);
    }
  });
});

describe('recoveries differ in behaviour', () => {
  const recover = (character: number, hold: number) => {
    const s = make({ fighters: [character, 1], stage: 2 }), [a] = s.fighters; faceOff(s); s.fighters[1].x = -9;
    Object.assign(a, { x: 14, prevX: 14, y: -3, prevY: -3, vx: 0, vy: -0.1, grounded: false, support: null, jumps: 2, facing: -1 });
    run(s, 1, { up: true, special: true, x: hold ? -1 : 0 });
    let top = a.y; const start = a.x;
    for (let i = 0; i < 30; i++) { run(s, 1, { x: hold ? -1 : 0 }); top = Math.max(top, a.y); }
    return { rise: top + 3, sideways: start - a.x, attack: a.attack?.id };
  };
  it('each fighter rises and travels a different amount', () => {
    const results = FIGHTERS.map((_, i) => recover(i, 1));
    const rises = results.map(r => r.rise.toFixed(1)), sides = results.map(r => r.sideways.toFixed(1));
    expect(new Set(rises).size).toBeGreaterThanOrEqual(5);
    expect(new Set(sides).size).toBeGreaterThanOrEqual(5);
    expect(results[5].rise).toBe(Math.max(...results.map(r => r.rise)));           // Elon: highest
    expect(results[4].sideways).toBeGreaterThan(results[2].sideways + 1.5);        // Chad far beyond Al
  });
  it('a recovery with a hit volume really hits a nearby opponent', () => {
    for (const c of [0, 1, 2, 3, 4, 5]) {
      const s = make({ fighters: [c, 0], stage: 2 }), [a, b] = s.fighters; faceOff(s);
      Object.assign(a, { x: 0, prevX: 0, y: 3, prevY: 3, vy: -0.05, grounded: false, support: null, jumps: 2 }); b.x = 0.8; b.y = 3.4; b.grounded = false; b.support = null; b.vy = 0;
      run(s, 1, { up: true, special: true });
      run(s, 24);
      expect(b.damage, names[c]).toBeGreaterThan(0);
    }
  });
  it('Elon takes long landing lag if he touches down during To the Moon; others recover quickly', () => {
    const lag = (c: number) => {
      const s = make({ fighters: [c, 1], stage: 2 }), [a] = s.fighters; faceOff(s); s.fighters[1].x = -9;
      Object.assign(a, { x: 0, prevX: 0, y: 1.5, prevY: 1.5, vy: -0.1, grounded: false, support: null, jumps: 2 });
      run(s, 1, { up: true, special: true });
      runUntil(s, () => a.busyKind === 'landing' && a.busy > 0, 220);
      return a.busy;
    };
    expect(lag(5)).toBeGreaterThan(30);
    expect(() => lag(0)).toThrow();                     // Hunter touches down freely after his recovery
  });
});

describe('projectiles differ and are launched by their own definitions', () => {
  it('each fighter fires a differently-behaving projectile', () => {
    const shots = FIGHTERS.map((_, c) => {
      const s = make({ fighters: [c, 1], stage: 2 }); faceOff(s); s.fighters[1].x = -9;
      run(s, 1, { special: true });
      runUntil(s, () => s.shots.length > 0, 60);
      const shot = s.shots[0]; const x0 = shot.x, y0 = shot.y;
      run(s, 30);
      const later = s.shots[0];
      return { kind: shot.kind, dx: later.x - x0, dy: later.y - y0, damage: shot.def.damage, rx: shot.def.rx, ry: shot.def.ry };
    });
    expect(new Set(shots.map(s => s.dx.toFixed(2))).size).toBe(6);
    expect(new Set(shots.map(s => s.damage)).size).toBeGreaterThanOrEqual(4);
    expect(shots.map(s => s.kind)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(shots[1].dy).toBeGreaterThan(shots[0].dy); expect(shots[2].dy).toBeGreaterThan(shots[0].dy);      // the lobs arc up
  });
  it('Elon\'s rocket accelerates after a telegraphed start', () => {
    const s = make({ fighters: [5, 1] }); faceOff(s); s.fighters[1].x = -9;
    run(s, 1, { special: true }); runUntil(s, () => s.shots.length > 0, 60);
    const v0 = Math.abs(s.shots[0].vx); run(s, 20);
    expect(Math.abs(s.shots[0].vx)).toBeGreaterThan(v0 * 2);
  });
  it('a lobbed projectile bounces once off the roof and then breaks; a straight one just breaks', () => {
    const s = make({ fighters: [1, 0] }); faceOff(s); s.fighters[1].x = -9;
    s.shots.push({ id: 1, owner: 0, kind: 1, x: 3, y: 0.4, vx: 0.05, vy: -0.1, life: 100, dir: 1, bounces: 0, def: FIGHTERS[1].moves.special.projectile! });
    run(s, 4);
    expect(s.shots[0].vy).toBeGreaterThan(0); expect(events(s, 'bounce')).toHaveLength(1);
    const straight = make({ fighters: [0, 1] }); faceOff(straight); straight.fighters[1].x = -9;
    straight.shots.push({ id: 1, owner: 0, kind: 0, x: 3, y: 0.4, vx: 0.05, vy: -0.1, life: 100, dir: 1, bounces: 0, def: FIGHTERS[0].moves.special.projectile! });
    run(straight, 4);
    expect(straight.shots).toHaveLength(0); expect(events(straight, 'shotBreak')).toHaveLength(1);
  });
  it('projectiles pass through upper platforms', () => {
    const s = make({ fighters: [0, 1] }); faceOff(s); s.fighters[1].x = -9; const p = s.platforms[1];
    s.shots.push({ id: 1, owner: 0, kind: 0, x: p.x, y: p.y + 0.5, vx: 0, vy: -0.1, life: 100, dir: 1, bounces: 0, def: FIGHTERS[0].moves.special.projectile! });
    run(s, 10);
    expect(s.shots).toHaveLength(1); expect(s.shots[0].y).toBeLessThan(p.y);
  });
  it('a wide Cash Burn hits a target a narrow shot would miss', () => {
    const miss = (c: number) => {
      const s = make({ fighters: [c, 0] }), [a, b] = s.fighters; faceOff(s, 4);
      s.shots.push({ id: 1, owner: 0, kind: c, x: a.x + 1, y: b.y + 2.8, vx: 0.2, vy: 0, life: 60, dir: 1, bounces: 0, def: FIGHTERS[c].moves.special.projectile! });
      run(s, 25);
      return b.damage === 0;
    };
    expect(miss(0)).toBe(true); expect(miss(4)).toBe(false);
  });
});

describe('Kevin: Rebuttal counter', () => {
  const setup = () => duel(0, 1, 1.1, { fighters: [1, 0] });
  it('turns a melee hit into a riposte: the counterer is unharmed and the attacker is launched', () => {
    const d = setup();
    d.step(1, { special: true, down: true });
    d.step(5);                                          // inside the counter window (frames 4-20)
    d.step(1, {}, { attack: true });
    d.until(() => d.other.damage > 0, 30);
    expect(d.actor.damage).toBe(0); expect(d.other.damage).toBe(12); expect(events(d.s, 'counter')).toHaveLength(1);
    expect(d.other.vx).toBeGreaterThan(0.1);
  });
  it('fires only once per use', () => {
    const d = setup();
    d.step(1, { special: true, down: true }); d.step(5);
    d.step(1, {}, { attack: true }); d.until(() => d.other.damage > 0, 30);
    d.other.stun = 0; d.other.damage = 0; d.step(8, {}, { attack: true });
    expect(events(d.s, 'counter')).toHaveLength(1);
  });
  it('is punishable: a hit during startup or endlag lands', () => {
    const early = duel(0, 1, 1.1, { fighters: [1, 3] });                                    // Priya's jab lands on frame 3
    early.step(1, { special: true, down: true }, { attack: true });                        // before the window opens
    early.until(() => early.actor.damage > 0, 30);
    expect(events(early.s, 'counter')).toHaveLength(0); expect(early.actor.damage).toBe(3);
    const late = setup();
    late.step(1, { special: true, down: true }); late.step(30);                              // window (4-20) has closed
    late.step(1, {}, { attack: true }); late.until(() => late.actor.damage > 0, 30);
    expect(events(late.s, 'counter')).toHaveLength(0);
  });
  it('does not work against grabs', () => {
    const d = setup();
    d.step(1, { special: true, down: true }); d.step(2);
    d.step(1, {}, { grab: true });
    d.until(() => d.actor.heldBy !== null, 40);
    expect(d.actor.heldBy).toBe(1); expect(events(d.s, 'counter')).toHaveLength(0);
  });
});

describe('Chad: armored heavy', () => {
  const armored = (attacker: number, move: 'jab' | 'heavy') => {
    const d = duel(0, 1, 1.1, { fighters: [4, attacker] });
    d.step(1, { attack: true, x: 1 });
    d.step(7);                                                                  // armor frames 6-14
    d.other.attack = null;
    d.s.startAttack(d.other, move);
    d.other.attack!.age = d.other.attack!.def.start - 1;
    d.step(1);
    return d;
  };
  it('absorbs a light hit: damage lands but there is no flinch and the move continues', () => {
    const d = armored(0, 'jab');
    expect(d.actor.damage).toBe(5); expect(d.actor.stun).toBe(0); expect(d.actor.attack?.id).toBe('heavy'); expect(events(d.s, 'armor')).toHaveLength(1);
  });
  it('loses to a strong hit', () => {
    const d = armored(0, 'heavy');
    expect(d.actor.stun).toBeGreaterThan(0); expect(d.actor.attack).toBeNull();
  });
  it('loses to a grab', () => {
    const d = duel(0, 1, 1.1, { fighters: [4, 0] });
    d.step(1, { attack: true, x: 1 }, { grab: true });                          // the catch lands at frame 8, inside the armor
    d.until(() => d.actor.heldBy !== null, 40);
    expect(d.actor.heldBy).toBe(1);
  });
});

describe('Priya: Headhunt Dash', () => {
  it('moves quickly without hurting, then can cancel into an attack or grab', () => {
    const d = duel(0, 1, 6, { fighters: [3, 0] });
    const x0 = d.actor.x;
    d.step(1, { special: true, down: true });
    d.step(12);
    expect(d.actor.x - x0).toBeGreaterThan(2.2); expect(d.other.damage).toBe(0);
    d.actor.x = 0; d.other.x = 1.1; d.other.prevX = 1.1;
    d.step(14);                                                                 // let the rest of the dash finish
    const d2 = duel(0, 1, 4.4, { fighters: [3, 0] });
    d2.step(1, { special: true, down: true }); d2.step(9); d2.step(1, { attack: true }); d2.step(14);
    expect(d2.other.damage).toBeGreaterThan(0);
  });
  it('a dash cannot cancel into an unrelated move at any tick', () => {
    const d = duel(0, 1, 6, { fighters: [3, 0] });
    d.step(1, { special: true, down: true }); d.step(2, { attack: true, up: true });
    expect(attackId(d.actor)).toBe('down');
  });
});

describe('down specials: slams hit once on landing', () => {
  it.each([0, 2, 4, 5])('fighter %s: a high slam lands one impact and then recovers with endlag', c => {
    const d = duel(0, 1, 1.2, { fighters: [c, 2], stage: 2 });
    Object.assign(d.actor, { y: 10, prevY: 10, vy: 0, grounded: false, support: null });
    d.step(1, { special: true, down: true });
    d.until(() => d.other.damage > 0, 100);
    const dealt = d.other.damage;
    d.step(60);
    expect(d.other.damage).toBe(dealt); expect(events(d.s, 'impact')).toHaveLength(1);
    expect(dealt).toBe(FIGHTERS[c].moves.down.hits[0].damage);
  });
  it('an offstage slam has no surface to land on and keeps falling', () => {
    const d = duel(0, 1, 1.2, { stage: 2 });
    Object.assign(d.actor, { x: 14, prevX: 14, y: 4, prevY: 4, vy: 0, grounded: false, support: null }); d.other.x = 30;
    d.step(1, { special: true, down: true }); d.step(30);
    expect(d.actor.y).toBeLessThan(-1); expect(attackId(d.actor)).toBe('down');
  });
});

describe('directional aerials', () => {
  const aerial = (hold: { x?: number; up?: boolean; down?: boolean }, facing: 1 | -1 = 1) => {
    const d = duel(0, facing, 1.1, { fighters: [0, 0] });
    Object.assign(d.actor, { y: 4, prevY: 4, vy: 0.05, grounded: false, support: null, jumps: 1 });
    d.step(1, { attack: true, ...hold });
    return { id: attackId(d.actor), facing: d.actor.facing };
  };
  it.each([1, -1] as const)('picks the right aerial for the held direction (facing %s)', f => {
    expect(aerial({}, f).id).toBe('nair');
    expect(aerial({ x: f }, f).id).toBe('fair');
    expect(aerial({ x: -f }, f).id).toBe('bair');
    expect(aerial({ up: true }, f).id).toBe('uair');
    expect(aerial({ down: true }, f).id).toBe('dair');
  });
  it('a back aerial does not turn the fighter around', () => {
    expect(aerial({ x: -1 }, 1).facing).toBe(1);
  });
  it('drifting backward in the air does not flip facing, so back-air stays available', () => {
    const d = duel(0, 1, 1.1, { fighters: [0, 0], stage: 2 });
    Object.assign(d.actor, { y: 6, prevY: 6, vy: 0.1, grounded: false, support: null, jumps: 1 });
    d.step(10, { x: -1 });
    expect(d.actor.facing).toBe(1);
    d.step(1, { x: -1, attack: true });
    expect(attackId(d.actor)).toBe('bair');
  });
  it('each aerial has its own landing lag, and landing during one makes the fighter briefly helpless', () => {
    const d = duel(0, 1, 6, { fighters: [0, 0] });
    Object.assign(d.actor, { y: 0.4, prevY: 0.4, vy: -0.3, grounded: false, support: null, jumps: 1 });
    d.step(1, { attack: true, x: 1 });
    d.until(() => d.actor.busy > 0, 10);
    expect(d.actor.busy).toBe(FIGHTERS[0].moves.fair.landing); expect(d.actor.busyKind).toBe('landing');
    expect(new Set(FIGHTERS[0].moves.nair.landing === undefined ? [] : ['nair', 'fair', 'bair', 'uair', 'dair'].map(id => FIGHTERS[0].moves[id as MoveId].landing)).size).toBeGreaterThan(2);
  });
});
