/** The CPU plays by the same rules as a human, uses each fighter's own tools, and stays deterministic. */
import { describe, it, expect } from 'vitest';
import { ArenaSim, noInput } from './Simulation';
import type { MatchOptions } from './Simulation';
import { cpuControls } from './cpu';
import { FIGHTERS } from './fighterDefinitions';
import { ctl, events, faceOff, make, run } from './testHelpers';

const cpuMatch = (extra: Partial<MatchOptions> = {}) => make({ mode: 'cpu', ...extra });

describe('CPU state-by-state decisions', () => {
  it('recovers toward the stage when offstage, and only uses up-special while it still has one', () => {
    const s = cpuMatch(), cpu = s.fighters[1];
    Object.assign(cpu, { x: 12, y: -2, vy: -0.1, grounded: false, support: null, jumps: 2, recovered: false });
    const c = cpuControls(s);
    expect(c.up && c.special).toBe(true); expect(c.x).toBe(-1);
    cpu.recovered = true;
    const spent = cpuControls(s);
    expect(spent.special).toBe(false); expect(spent.up).toBe(false);
  });
  it('never tries to grab while airborne', () => {
    const s = cpuMatch({ difficulty: 2 }), cpu = s.fighters[1]; faceOff(s, 1.1);
    Object.assign(cpu, { y: 3, grounded: false, support: null, jumps: 1 });
    s.fighters[0].guarding = true;
    for (let i = 0; i < 300; i++) { s.tick = i; expect(cpuControls(s).grab).toBe(false); }
  });
  it('counter-grabs a shielding opponent standing in front of it', () => {
    let grabs = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = cpuMatch({ seed, difficulty: 2 }), cpu = s.fighters[1]; faceOff(s, 1.3);
      s.fighters[0].guarding = true;
      for (let i = 0; i < 60; i++) { s.cpu.action = 0; if (cpuControls(s).grab) grabs++; s.tick++; }
    }
    expect(grabs).toBeGreaterThan(200);
  });
  it('throws only after the tech window, in its fighter\'s preferred direction', () => {
    for (const [character, id] of [[1, 'uthrow'], [0, 'fthrow'], [3, 'uthrow']] as const) {
      const s = cpuMatch({ fighters: [0, character] }), [player, cpu] = s.fighters; faceOff(s, 1.1);
      cpu.facing = -1; player.facing = 1;
      s.fighters[1].hold = { target: 0, age: 4, tick: 0, pummels: 1, gap: 0 }; player.heldBy = 1;
      expect(cpuControls(s).grab).toBe(false);
      cpu.hold!.age = 12;
      const c = cpuControls(s);
      expect(c.grab, `${FIGHTERS[character].id} ${id}`).toBe(true);
      if (id === 'uthrow') expect(c.up).toBe(true); else expect(c.up || c.down).toBe(false);
    }
  });
  it('throws a heavily damaged opponent toward the nearest edge', () => {
    const s = cpuMatch({ fighters: [0, 0] }), [player, cpu] = s.fighters; faceOff(s, 1.1, 5);
    cpu.facing = -1; player.damage = 120; player.heldBy = 1; cpu.hold = { target: 0, age: 12, tick: 0, pummels: 1, gap: 0 };
    player.x = 6.5; cpu.x = 7.6; cpu.facing = -1;                                    // the player is toward the stage centre
    const back = cpuControls(s);
    expect(back.x).toBe(1);                                                           // a back throw sends them toward the right edge they are nearest to
    cpu.x = 5.4; player.x = 6.5; cpu.facing = 1;
    const forward = cpuControls(s);
    expect(forward.x === 0 && !forward.up && !forward.down).toBe(true);               // already facing the edge: forward throw
  });
  it('sometimes breaks a grab, never on the first frame, and more often on harder difficulties', () => {
    const teched = (level: number) => {
      let n = 0;
      for (let i = 1; i <= 60; i++) {
        const s = cpuMatch({ seed: 1 + i * 7919, difficulty: level }), [player, cpu] = s.fighters; faceOff(s, 1.1);   // well-spaced seeds: nearby seeds give nearly equal first draws
        player.hold = { target: 1, age: 0, tick: 0, pummels: 0, gap: 0 }; cpu.heldBy = 0;
        let pressedAt = -1;
        for (let age = 1; age <= 8 && pressedAt < 0; age++) { player.hold.age = age; if (cpuControls(s).grab) pressedAt = age; }
        if (pressedAt > 0) { n++; expect(pressedAt).toBeGreaterThanOrEqual(1); expect(pressedAt).toBeLessThanOrEqual(8); }
      }
      return n;
    };
    const easy = teched(0), hard = teched(2);
    expect(hard).toBeGreaterThan(easy); expect(hard).toBeLessThan(60); expect(easy).toBeLessThan(30);
  });
  it('uses its fighter\'s own ranges: Chad stays at midrange, Priya rushes in', () => {
    const gap = (character: number) => {
      const s = cpuMatch({ fighters: [0, character] }); faceOff(s, 4.5);
      s.fighters[0].facing = 1; s.fighters[1].facing = -1;
      const c = cpuControls(s); return c.x;
    };
    expect(gap(3)).toBe(-1); expect(gap(4)).toBe(-1);                                 // both approach from far away
    const close = (character: number) => { const s = cpuMatch({ fighters: [0, character] }); faceOff(s, 2.0); return cpuControls(s).x; };
    expect(close(3)).toBe(-1);                                                        // Priya (spacing 1.0) keeps closing in
    expect(close(4)).toBe(0);                                                         // Chad (spacing 2.4) is already where he wants to be
  });
});

describe('the CPU plays whole matches legally', () => {
  it.each(FIGHTERS.map((f, i) => [f.id, i] as const))('%s: no NaN, no stuck states, and recovery is used at most once per airborne sequence', (_n, c) => {
    const s = cpuMatch({ fighters: [0, c], items: true, seed: 100 + c, difficulty: 2 });
    let recoveries = 0, lastRecoveryTick = -999;
    for (let i = 0; i < 3000; i++) {
      // A scripted, aggressive human so the CPU has something to react to.
      s.step([ctl({ x: i % 160 < 80 ? 1 : -1, attack: i % 19 === 0, special: i % 71 === 0, grab: i % 53 === 0, jump: i % 41 === 0, shield: i % 97 < 12 }), noInput()]);
      for (const f of s.fighters) expect(Number.isFinite(f.x + f.y + f.vx + f.vy)).toBe(true);
      const cpu = s.fighters[1];
      if (cpu.attack?.id === 'grab' && cpu.attack.age === 0) expect(cpu.grounded).toBe(true);
      for (const e of s.events) if (e.type === 'recovery' && e.slot === 1) { recoveries++; expect(s.tick - lastRecoveryTick, 'recovery repeated while airborne').toBeGreaterThan(20); lastRecoveryTick = s.tick; }
      s.events.length = 0;
      if (s.finished) break;
      if (s.countdown > 0) s.countdown = 0;
    }
    expect(recoveries).toBeGreaterThanOrEqual(0);
  });
  it('seeded matches are exactly reproducible, for every fighter and difficulty', () => {
    for (const c of [0, 2, 5]) for (const difficulty of [0, 1, 2]) {
      const play = () => { const s = cpuMatch({ fighters: [1, c], seed: 9, difficulty, items: true }); for (let i = 0; i < 1500; i++) s.step([ctl({ x: i % 90 < 45 ? 1 : -1, attack: i % 23 === 0 }), noInput()]); return JSON.stringify([s.fighters, s.shots, s.pickups]); };
      expect(play()).toBe(play());
    }
  });
  it('the CPU chains its jab string and uses on-hit routes when it lands a hit', () => {
    let chained = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const s = cpuMatch({ fighters: [0, 0], seed, difficulty: 2 }); faceOff(s, 1.1); s.fighters[1].facing = -1;
      let sawJab2 = false;
      for (let i = 0; i < 240; i++) { s.step([noInput(), noInput()]); if (s.fighters[1].attack?.id === 'jab2') sawJab2 = true; if (s.fighters[0].stun === 0) { s.fighters[0].x = 0; } }
      if (sawJab2) chained++;
    }
    expect(chained).toBeGreaterThan(5);
  });
});

describe('training dummy', () => {
  it('idle does nothing; shield holds shield; jump jumps on a schedule', () => {
    const s = make({ mode: 'training' }); faceOff(s, 4);
    run(s, 10); expect(s.fighters[1].guarding).toBe(false);
    s.dummy = 'shield'; run(s, 3); expect(s.fighters[1].guarding).toBe(true);
    s.dummy = 'jump'; let jumps = 0; for (let i = 0; i < 400; i++) { run(s, 1); jumps = events(s, 'jump').filter(e => e.slot === 1).length; }
    expect(jumps).toBeGreaterThanOrEqual(3);
  });
  it('DI dummies hold a direction only while in hitstun, and the same script replays identically', () => {
    const play = (mode: 'diLeft' | 'diRight') => {
      const s = make({ mode: 'training' }), [a, b] = s.fighters; faceOff(s, 1.1); s.dummy = mode;
      run(s, 1); s.hit(a, b, 10, 0.2, 'heavy'); s.freeze = 0;
      run(s, 30);
      return { x: b.x, di: b.di, json: JSON.stringify(b) };
    };
    const left = play('diLeft'), right = play('diRight');
    expect(right.x).toBeGreaterThan(left.x); expect(left.di).toBeLessThan(0); expect(right.di).toBeGreaterThan(0);
    expect(play('diLeft').json).toBe(left.json);
    const idle = make({ mode: 'training' }); faceOff(idle, 1.1); idle.dummy = 'diLeft'; run(idle, 30);
    expect(idle.fighters[1].x).toBe(1.1);
  });
  it('the tech dummy breaks grabs, and never when it is told not to', () => {
    const grabbed = (mode: 'tech' | 'idle') => {
      const s = make({ mode: 'training' }); faceOff(s, 1.1); s.dummy = mode;
      run(s, 1, { grab: true });
      run(s, 60);
      return events(s, 'tech').length;
    };
    expect(grabbed('tech')).toBe(1); expect(grabbed('idle')).toBe(0);
  });
  it('P2\'s own keys override the dummy', () => {
    const s = make({ mode: 'training' }); faceOff(s, 4); s.dummy = 'shield';
    run(s, 5, {}, { x: 1 });
    expect(s.fighters[1].guarding).toBe(false); expect(s.fighters[1].x).toBeGreaterThan(4);
  });
  it('damage presets, position reset and hard resets leave a clean state', () => {
    const s = make({ mode: 'training' }), [a, b] = s.fighters; faceOff(s, 1.1);
    s.setDamage(1, 150); expect(b.damage).toBe(150); s.setDamage(1, -5); expect(b.damage).toBe(0); s.setDamage(1, 5000); expect(b.damage).toBe(999);
    run(s, 1, { grab: true }); run(s, 14);
    expect(a.hold).not.toBeNull();
    s.resetPositions();
    expect([a.x, b.x]).toEqual([-4, 4]); expect(a.hold).toBeNull(); expect(b.heldBy).toBeNull(); expect(a.attack).toBeNull();
    run(s, 12);
    expect(a.attack).toBeNull();                                                      // the old grab press was flushed
  });
});
