/**
 * The six Arena fighters as data: body, movement and a complete typed move set each.
 * Shared helpers keep the tables short, but every fighter has its own timing, reach, damage, launch,
 * projectile, recovery, throws and CPU profile. Numbers are tuned by the tests in `characters.test.ts`
 * and `combos.test.ts`; change them together with those tests.
 */
import { box, defineMove, launch, melee, window } from './moveDefinitions';
import type { ComboInfo, Cancel, MoveDef, MoveId, ProjectileDef } from './moveDefinitions';

export interface AiProfile {
  /** Distance at which the CPU likes to stand to poke. */
  spacing: number;
  /** Minimum distance before the CPU prefers its projectile. */
  zone: number;
  /** Throw direction the CPU picks by default. */
  throwDir: 'f' | 'b' | 'u' | 'd';
  poke: MoveId;
  finisher: MoveId;
}

export interface FighterDef {
  id: string;
  /** One-line identity shown in the move list. */
  style: string;
  /** Ground top speed per tick. */
  walk: number;
  /** Air top speed as a fraction of ground speed, and air acceleration toward it. */
  air: number;
  airAccel: number;
  weight: number;
  /** Terminal fall speed per tick. */
  fall: number;
  /** Ground jump and air jump launch speeds. */
  jump: [number, number];
  /** Hurtbox half-width and height (feet-up). */
  hurt: { hw: number; h: number };
  /** Half-width of the grounded pushbox. */
  push: number;
  /** Distance in front of the captor at which a caught opponent is held. */
  hold: number;
  moves: Record<MoveId, MoveDef>;
  combos: ComboInfo[];
  ai: AiProfile;
}

/** Follow-up a jab can chain into. Whiffs may chain too, so the three-hit string always animates. */
const chain = (into: MoveId, from: number, on: Cancel['on'] = 'always'): Cancel => ({ into, from, on });
const lunge = (from: number, to: number, vx: number) => [{ from, to, vx }];

interface ThrowSpec { release?: number; dur: number; dmg: number; kb: [number, number, number]; stun?: number; stop?: number }
const throwing = (id: 'fthrow' | 'bthrow' | 'uthrow' | 'dthrow', name: string, t: ThrowSpec) =>
  defineMove(id, name, { duration: t.dur, throwing: { release: t.release ?? 10, damage: t.dmg, launch: launch(...t.kb), stun: t.stun, stop: t.stop ?? 7 }, air: 0 });

const pummel = (name: string, dmg: number) => defineMove('pummel', name, { duration: 12, pummel: dmg, air: 0 });

interface GrabSpec { from: number; to: number; dur: number; reach: number }
const grab = (name: string, g: GrabSpec) => defineMove('grab', name, { duration: g.dur, grab: { from: g.from, to: g.to, box: box(0.15, g.reach, 0.2, 1.9) }, slide: 0.75 });

const shot = (p: Omit<ProjectileDef, 'solid' | 'gravity'> & { gravity?: number; solid?: ProjectileDef['solid'] }): ProjectileDef => ({ gravity: 0, solid: 'break', ...p });

/** Explosion burst around a recovery: short hit volume in front of and above the fighter. */
const burst = (from: number, to: number, reach: number, dmg: number, kb: [number, number, number], extra: Partial<Parameters<typeof window>[5]> = {}) =>
  window(from, to, box(-0.9, reach, 0.2, 2.6), dmg, kb, { dir: 'away', ...extra });

// ---------------------------------------------------------------------------------------------------
// Hunter: the balanced rushdown fighter. Quick jabs that string into a launcher, an advancing heavy.
// ---------------------------------------------------------------------------------------------------
const hunter: FighterDef = {
  id: 'hunter', style: 'Balanced rushdown. Quick jab string, advancing heavy, reliable recovery.',
  walk: 0.145, air: 1, airAccel: 0.062, weight: 1, fall: 0.52, jump: [0.315, 0.295], hurt: { hw: 0.38, h: 2.3 }, push: 0.3, hold: 0.85,
  moves: {
    jab1: melee('jab1', 'Pitch Deck I', { t: [4, 3, 16], box: [0.3, 1.25, 0.85, 1.75], dmg: 5, kb: [0, 0.04, 0.0004], stun: 15, stop: 4 }, { lunge: lunge(0, 6, 0.03), cancels: [chain('jab2', 7)] }),
    jab2: melee('jab2', 'Pitch Deck II', { t: [4, 3, 17], box: [0.3, 1.3, 0.8, 1.8], dmg: 7, kb: [0, 0.045, 0.0004], stun: 16, stop: 4 }, { lunge: lunge(0, 6, 0.03), cancels: [chain('jab3', 7), chain('upper', 8, 'hit')] }),
    jab3: melee('jab3', 'iPad Swing', { t: [6, 4, 27], box: [0.3, 1.5, 0.6, 2], dmg: 9, kb: [32, 0.26, 0.0034], stun: 14, stop: 6 }, { lunge: lunge(3, 8, 0.05) }),
    heavy: melee('heavy', 'Disrupt!', { t: [12, 5, 35], box: [0.3, 1.7, 0.55, 2], dmg: 15, kb: [38, 0.28, 0.0034], stop: 7 }, { lunge: lunge(8, 16, 0.06) }),
    upper: melee('upper', 'Growth Hack', { t: [8, 5, 29], box: [-0.35, 0.95, 1.2, 3.1], dmg: 12, kb: [88, 0.22, 0.0026], stun: 26 }, { cancels: [{ into: 'jump', from: 12, on: 'hit' }] }),
    sweep: melee('sweep', 'Low Burn', { t: [7, 5, 27], box: [0.3, 1.6, 0, 0.75], dmg: 9, kb: [28, 0.165, 0.0034] }),
    nair: melee('nair', 'Synergy Spin', { t: [5, 8, 26], box: [-0.8, 1, 0.35, 2.25], dmg: 8, kb: [45, 0.15, 0.003], stun: 13 }, { air: 0.8, landing: 8 }),
    fair: melee('fair', 'Hard Shove', { t: [7, 4, 28], box: [0.35, 1.55, 0.6, 2], dmg: 11, kb: [35, 0.22, 0.0033], stun: 14 }, { air: 0.7, landing: 12 }),
    bair: melee('bair', 'Exit Strategy', { t: [6, 4, 27], box: [-1.6, -0.3, 0.6, 2], dmg: 12, kb: [35, 0.24, 0.0035] }, { air: 0.7, landing: 12 }),
    uair: melee('uair', 'Moonshot', { t: [5, 5, 25], box: [-0.65, 0.9, 1.9, 3.5], dmg: 9, kb: [85, 0.2, 0.003], stun: 22 }, { air: 0.8, landing: 10 }),
    dair: melee('dair', 'Bounce Rate', { t: [9, 6, 34], box: [-0.55, 0.55, -0.95, 0.45], dmg: 10, kb: [-65, 0.18, 0.003] }, { air: 0.6, landing: 16 }),
    special: defineMove('special', 'iPad Yeet', { duration: 40, air: 0.6, projectile: shot({ fire: 14, vx: 0.25, vy: 0, life: 100, rx: 0.35, ry: 0.3, damage: 11, launch: launch(25, 0.15, 0.003), spawn: { x: 0.8, y: 1.25 } }) }),
    recovery: defineMove('recovery', 'Elevator Pitch', { duration: 43, hits: [burst(1, 17, 1.0, 9, [75, 0.16, 0.0034])], recovery: { vy: 0.43, vx: 0.12, drift: 0.006 }, air: 1 }),
    down: defineMove('down', 'Pivot Slam', { duration: 39, hits: [window(10, 15, box(-1.9, 1.9, -0.1, 1.6), 16, [60, 0.27, 0.0038], { dir: 'away', stop: 7 })], dive: { speed: 0.42 }, air: 0 }),
    grab: grab('Mandatory Networking', { from: 8, to: 11, dur: 34, reach: 1.25 }),
    pummel: pummel('Hard Sell', 2),
    fthrow: throwing('fthrow', 'Handshake Toss', { dur: 28, dmg: 9, kb: [35, 0.24, 0.0034], stun: 18 }),
    bthrow: throwing('bthrow', 'Reverse Pitch', { dur: 30, dmg: 10, kb: [150, 0.26, 0.0034], stun: 18 }),
    uthrow: throwing('uthrow', 'Raise the Round', { dur: 26, dmg: 7, kb: [85, 0.17, 0.0025], stun: 30 }),
    dthrow: throwing('dthrow', 'Cold Email', { dur: 26, dmg: 6, kb: [80, 0.1, 0.002], stun: 22 }),
  },
  combos: [
    { name: 'Pitch Deck string', inputs: 'V, V, V', kind: 'true', script: { 0: { attack: true }, 7: { attack: true }, 14: { attack: true } }, kinds: ['jab', 'jab', 'jab'], limits: { none: 150, away: 150 }, note: 'Three quick jabs keep the defender in hitstun; the iPad Swing finisher launches.' },
    { name: 'Growth Hack route', inputs: 'V, V, W+V, W, →+V', kind: 'true', script: { 0: { attack: true }, 7: { attack: true }, 15: { attack: true, up: true }, 30: { jump: true }, 32: { attack: true, x: 1 } }, kinds: ['jab', 'jab', 'upper', 'aerial'], limits: { none: 40, away: 10 }, note: 'Jab, jab, cancel into the up attack, jump-cancel it on hit, finish with Hard Shove. Heavier defenders stay in it longer; light ones and anyone holding away escape sooner.' },
    { name: 'Jab into grab', inputs: 'V, then M', kind: 'pressure', note: 'If they shield the jab, the grab goes through. If they do not, the string continues. A guess, not a guarantee.' },
  ],
  ai: { spacing: 1.3, zone: 4, throwDir: 'f', poke: 'jab1', finisher: 'heavy' },
};

// ---------------------------------------------------------------------------------------------------
// Kevin: patient precision fighter. Long pokes, a punishable counter, a recovery with a legal attack.
// ---------------------------------------------------------------------------------------------------
const kevin: FighterDef = {
  id: 'kevin', style: 'Precision and counters. Long pokes, slow pursuit, Rebuttal counter, narrow recovery.',
  walk: 0.127, air: 1, airAccel: 0.058, weight: 1.1, fall: 0.54, jump: [0.315, 0.295], hurt: { hw: 0.38, h: 2.4 }, push: 0.3, hold: 0.9,
  moves: {
    jab1: melee('jab1', 'Cross I', { t: [6, 3, 18], box: [0.3, 1.6, 0.9, 1.9], dmg: 4, kb: [0, 0.035, 0.0004], stun: 17, stop: 4 }, { lunge: lunge(2, 8, 0.025), cancels: [chain('jab2', 8)] }),
    jab2: melee('jab2', 'Cross II', { t: [6, 3, 19], box: [0.3, 1.65, 0.85, 1.95], dmg: 5, kb: [0, 0.04, 0.0004], stun: 18, stop: 4 }, { lunge: lunge(2, 8, 0.025), cancels: [chain('jab3', 8), chain('upper', 9, 'hit')] }),
    jab3: melee('jab3', 'Briefcase Hook', { t: [8, 4, 30], box: [0.3, 1.85, 0.6, 2.05], dmg: 8, kb: [30, 0.26, 0.0034], stun: 14, stop: 6 }, { lunge: lunge(4, 10, 0.04) }),
    heavy: melee('heavy', 'Brief Bash', { t: [13, 5, 38], box: [0.3, 1.95, 0.6, 2.05], dmg: 14, kb: [36, 0.27, 0.0034], stop: 7 }),
    upper: melee('upper', 'Objection!', { t: [7, 5, 28], box: [-0.3, 1, 1.2, 3.3], dmg: 11, kb: [86, 0.24, 0.0036], stun: 30 }, { cancels: [{ into: 'jump', from: 11, on: 'hit' }] }),
    sweep: melee('sweep', 'Subpoena', { t: [8, 5, 29], box: [0.3, 1.9, 0, 0.8], dmg: 8, kb: [28, 0.16, 0.0033] }),
    nair: melee('nair', 'Recess', { t: [6, 8, 27], box: [-0.8, 1.05, 0.35, 2.3], dmg: 7, kb: [45, 0.14, 0.003], stun: 13 }, { air: 0.7, landing: 9 }),
    fair: melee('fair', 'Sidebar', { t: [8, 4, 30], box: [0.35, 1.8, 0.6, 2.1], dmg: 10, kb: [33, 0.22, 0.0033], stun: 14 }, { air: 0.6, landing: 13 }),
    bair: melee('bair', 'Overruled', { t: [7, 4, 28], box: [-1.75, -0.3, 0.6, 2.1], dmg: 11, kb: [35, 0.24, 0.0035] }, { air: 0.6, landing: 13 }),
    uair: melee('uair', 'Appeal Denied', { t: [5, 6, 27], box: [-0.8, 1.37, 1.3, 3.7], dmg: 8, kb: [85, 0.19, 0.003], stun: 26 }, { air: 0.75, landing: 11 }),
    dair: melee('dair', 'Gavel Drop', { t: [11, 5, 36], box: [-0.5, 0.5, -1, 0.45], dmg: 11, kb: [-70, 0.2, 0.003] }, { air: 0.5, landing: 18 }),
    special: defineMove('special', 'Briefcase Briefing', { duration: 42, air: 0.6, projectile: shot({ fire: 15, vx: 0.23, vy: 0.12, gravity: 0.004, life: 100, rx: 0.4, ry: 0.3, damage: 10, launch: launch(35, 0.16, 0.003), spawn: { x: 0.8, y: 1.3 }, solid: 'bounce' }) }),
    recovery: defineMove('recovery', 'Appeal to the Court', { duration: 46, hits: [burst(3, 12, 1.1, 7, [70, 0.15, 0.0032])], recovery: { vy: 0.4, vx: 0.08, drift: 0.004 }, air: 0.7 }),
    down: defineMove('down', 'Rebuttal', { duration: 44, kind: 'counter', counter: { from: 4, to: 20, damage: 12, launch: launch(40, 0.3, 0.0036), stun: 18, stop: 8, after: 14 }, air: 0, slide: 0.6 }),
    grab: grab('Cross-Examination', { from: 9, to: 12, dur: 37, reach: 1.45 }),
    pummel: pummel('Leading Question', 2),
    fthrow: throwing('fthrow', 'Sustained', { dur: 29, dmg: 9, kb: [33, 0.24, 0.0034], stun: 18 }),
    bthrow: throwing('bthrow', 'Overturned', { dur: 31, dmg: 10, kb: [150, 0.26, 0.0034], stun: 18 }),
    uthrow: throwing('uthrow', 'Stay of Execution', { dur: 27, dmg: 7, kb: [87, 0.3, 0.0012], stun: 40 }),
    dthrow: throwing('dthrow', 'Gag Order', { dur: 27, dmg: 6, kb: [80, 0.1, 0.002], stun: 22 }),
  },
  combos: [
    { name: 'Cross string', inputs: 'V, V, V', kind: 'true', script: { 0: { attack: true }, 7: { attack: true }, 14: { attack: true } }, kinds: ['jab', 'jab', 'jab'], limits: { none: 150, away: 150 }, note: 'Long-reach pokes: the string still connects from spacing other fighters cannot poke from.' },
    { name: 'Stay of Execution route', inputs: 'M, W+M, W, →+W+V', kind: 'true', script: { 0: { grab: true }, 5: { grab: true, up: true }, 43: { jump: true, x: 1 }, 50: { attack: true, up: true, x: 1 } }, hold: [44, 68], kinds: ['throw', 'aerial'], limits: { none: 100, away: 35 }, note: 'Catch, up throw, jump, up air. Needs the grab to land first. Holding away beats it on light and average defenders at higher percents; heavy ones cannot escape.' },
    { name: 'Rebuttal read', inputs: 'S+B as they swing', kind: 'read', note: 'The counter only works in its window and is punishable if they hold back. It does not work on grabs.' },
  ],
  ai: { spacing: 1.75, zone: 4.5, throwDir: 'u', poke: 'jab1', finisher: 'heavy' },
};

// ---------------------------------------------------------------------------------------------------
// Al: heavy close-range brawler. Slow, strong, longest grab, poor air drift.
// ---------------------------------------------------------------------------------------------------
const al: FighterDef = {
  id: 'al', style: 'Heavy grappler. Slow, punishable whiffs, longest grab and strong throws, poor air drift.',
  walk: 0.117, air: 0.85, airAccel: 0.05, weight: 1.23, fall: 0.58, jump: [0.315, 0.295], hurt: { hw: 0.5, h: 2.25 }, push: 0.38, hold: 1.0,
  moves: {
    jab1: melee('jab1', 'Sloppy Jab I', { t: [6, 3, 19], box: [0.3, 1.5, 0.8, 1.8], dmg: 4, kb: [0, 0.035, 0.0004], stun: 18, stop: 4 }, { lunge: lunge(2, 8, 0.035), cancels: [chain('jab2', 8)] }),
    jab2: melee('jab2', 'Sloppy Jab II', { t: [6, 3, 20], box: [0.3, 1.55, 0.8, 1.8], dmg: 5, kb: [0, 0.04, 0.0004], stun: 19, stop: 4 }, { lunge: lunge(2, 8, 0.035), cancels: [chain('jab3', 8)] }),
    jab3: melee('jab3', 'Haymaker', { t: [9, 4, 32], box: [0.3, 1.6, 0.6, 2.05], dmg: 10, kb: [33, 0.3, 0.0037], stun: 15, stop: 7 }, { lunge: lunge(5, 11, 0.045) }),
    heavy: melee('heavy', 'Bottle Swing', { t: [16, 6, 44], box: [0.3, 1.95, 0.55, 2.1], dmg: 18, kb: [40, 0.32, 0.0038], stop: 8 }, { lunge: lunge(12, 20, 0.04) }),
    upper: melee('upper', 'Hiccup Uppercut', { t: [9, 5, 31], box: [-0.35, 1.05, 1.2, 3.1], dmg: 13, kb: [74, 0.24, 0.0036], stun: 26 }),
    sweep: melee('sweep', 'Barstool Sweep', { t: [9, 5, 31], box: [0.3, 1.7, 0, 0.8], dmg: 10, kb: [28, 0.18, 0.0035] }),
    nair: melee('nair', 'Stumble Spin', { t: [7, 9, 30], box: [-0.9, 1.1, 0.3, 2.2], dmg: 9, kb: [45, 0.17, 0.0032], stun: 14 }, { air: 0.5, landing: 11 }),
    fair: melee('fair', 'Barstool Hook', { t: [10, 4, 33], box: [0.4, 1.6, 0.5, 2.05], dmg: 13, kb: [33, 0.25, 0.0036] }, { air: 0.45, landing: 16 }),
    bair: melee('bair', 'Elbow Drop-Back', { t: [9, 4, 31], box: [-1.6, -0.3, 0.55, 2.05], dmg: 14, kb: [35, 0.27, 0.0037] }, { air: 0.45, landing: 15 }),
    uair: melee('uair', 'Toast', { t: [7, 6, 30], box: [-0.75, 0.95, 1.85, 3.4], dmg: 10, kb: [85, 0.21, 0.0031], stun: 22 }, { air: 0.5, landing: 14 }),
    dair: melee('dair', 'Dive Bar', { t: [13, 6, 40], box: [-0.65, 0.65, -1, 0.5], dmg: 13, kb: [-70, 0.22, 0.0033] }, { air: 0.4, landing: 22 }),
    special: defineMove('special', 'Bottle Service', { duration: 44, air: 0.5, projectile: shot({ fire: 17, vx: 0.2, vy: 0.12, gravity: 0.004, life: 105, rx: 0.4, ry: 0.35, damage: 13, launch: launch(35, 0.17, 0.0032), spawn: { x: 0.9, y: 1.2 }, solid: 'bounce' }) }),
    recovery: defineMove('recovery', 'Last Call Lift', { duration: 50, hits: [burst(2, 19, 1.0, 10, [78, 0.18, 0.0036])], recovery: { vy: 0.5, vx: 0.02, drift: 0.001 }, air: 0.4 }),
    down: defineMove('down', 'Closing Time', { duration: 50, hits: [window(14, 21, box(-2.7, 2.7, -0.1, 1.7), 17, [55, 0.3, 0.004], { dir: 'away', stop: 8 })], dive: { speed: 0.45 }, air: 0 }),
    grab: grab('Bar Hug', { from: 9, to: 13, dur: 39, reach: 1.9 }),
    pummel: pummel('Noogie', 3),
    fthrow: throwing('fthrow', 'Bouncer Toss', { dur: 30, dmg: 12, kb: [36, 0.3, 0.004], stun: 18, stop: 8 }),
    bthrow: throwing('bthrow', 'Last Orders', { dur: 32, dmg: 13, kb: [150, 0.31, 0.004], stun: 18, stop: 8 }),
    uthrow: throwing('uthrow', 'Toss It Up', { dur: 28, dmg: 8, kb: [85, 0.19, 0.0028], stun: 30 }),
    dthrow: throwing('dthrow', 'Barstool Slam', { dur: 28, dmg: 7, kb: [80, 0.1, 0.002], stun: 36 }),
  },
  combos: [
    { name: 'Sloppy string', inputs: 'V, V, V', kind: 'true', script: { 0: { attack: true }, 7: { attack: true }, 14: { attack: true } }, kinds: ['jab', 'jab', 'jab'], limits: { none: 150, away: 150 }, note: 'Slow and low-damage, but the Haymaker finisher hits hard.' },
    { name: 'Barstool Slam route', inputs: 'M, S+M, V, V', kind: 'true', script: { 0: { grab: true }, 5: { grab: true, down: true }, 44: { attack: true }, 52: { attack: true } }, kinds: ['throw', 'jab', 'jab'], limits: { none: 50, away: 5 }, note: 'Down throw pins the target; two jabs follow. Holding away escapes the second jab almost immediately, and regrab protection stops the grab repeating.' },
    { name: 'Bar Hug mix-up', inputs: 'M, then a throw or a pummel', kind: 'read', note: 'Longest grab in the game. After a down throw, a heavy or a second grab is a read on whether they act.' },
  ],
  ai: { spacing: 1.2, zone: 5, throwDir: 'f', poke: 'jab1', finisher: 'heavy' },
};

// ---------------------------------------------------------------------------------------------------
// Priya: fast aerial rushdown. Short-range, light, excellent air control.
// ---------------------------------------------------------------------------------------------------
const priya: FighterDef = {
  id: 'priya', style: 'Aerial rushdown. Fastest mover, quick short-range strings, light, weak per-hit damage.',
  walk: 0.171, air: 1.25, airAccel: 0.085, weight: 0.88, fall: 0.47, jump: [0.325, 0.3], hurt: { hw: 0.32, h: 2.15 }, push: 0.26, hold: 0.75,
  moves: {
    jab1: melee('jab1', 'Quick Screen I', { t: [3, 2, 13], box: [0.25, 1.05, 0.9, 1.7], dmg: 3, kb: [0, 0.035, 0.0004], stun: 13, stop: 3 }, { lunge: lunge(0, 4, 0.03), cancels: [chain('jab2', 5)] }),
    jab2: melee('jab2', 'Quick Screen II', { t: [3, 2, 13], box: [0.25, 1.1, 0.85, 1.75], dmg: 3, kb: [0, 0.035, 0.0004], stun: 13, stop: 3 }, { lunge: lunge(0, 4, 0.03), cancels: [chain('jab3', 5)] }),
    jab3: melee('jab3', 'Follow-Up Call', { t: [5, 3, 22], box: [0.25, 1.3, 0.6, 1.95], dmg: 6, kb: [30, 0.22, 0.0036], stun: 12, stop: 5 }, { lunge: lunge(2, 6, 0.05) }),
    heavy: melee('heavy', 'Interview Kick', { t: [9, 4, 30], box: [0.3, 1.45, 0.5, 1.9], dmg: 11, kb: [38, 0.25, 0.0034], stop: 6 }, { lunge: lunge(5, 12, 0.07) }),
    upper: melee('upper', 'Résumé Fan', { t: [6, 5, 25], box: [-0.5, 0.9, 1.1, 3], dmg: 8, kb: [78, 0.2, 0.0035], stun: 26 }, { cancels: [{ into: 'jump', from: 10, on: 'hit' }] }),
    sweep: melee('sweep', 'Low Offer', { t: [5, 4, 22], box: [0.25, 1.4, 0, 0.7], dmg: 5, kb: [82, 0.26, 0.0018], stun: 28, stop: 4 }, { cancels: [{ into: 'jump', from: 8, on: 'hit' }] }),
    nair: melee('nair', 'Cold Call', { t: [3, 6, 20], box: [-0.7, 0.9, 0.35, 2.05], dmg: 6, kb: [45, 0.13, 0.003], stun: 13 }, { air: 1, landing: 5 }),
    fair: melee('fair', 'Follow-Up Kick', { t: [4, 4, 20], box: [0.3, 1.35, 0.6, 1.95], dmg: 7, kb: [35, 0.18, 0.0033], stun: 14 }, { air: 1, landing: 7 }),
    bair: melee('bair', 'Ghosting', { t: [4, 4, 21], box: [-1.4, -0.25, 0.6, 1.95], dmg: 8, kb: [35, 0.2, 0.0034] }, { air: 1, landing: 8 }),
    uair: melee('uair', 'Headhunt Up', { t: [4, 4, 20], box: [-0.6, 1.1, 1.75, 3.3], dmg: 6, kb: [68, 0.17, 0.003], stun: 28 }, { air: 1, landing: 6, cancels: [{ into: 'fair', from: 7, on: 'hit' }, { into: 'nair', from: 7, on: 'hit' }] }),
    dair: melee('dair', 'Hard Pass', { t: [6, 5, 24], box: [-0.45, 0.45, -0.9, 0.4], dmg: 7, kb: [-60, 0.15, 0.003] }, { air: 0.9, landing: 10 }),
    special: defineMove('special', 'Résumé Blast', { duration: 34, air: 1, projectile: shot({ fire: 11, vx: 0.32, vy: 0, life: 90, rx: 0.3, ry: 0.28, damage: 8, launch: launch(25, 0.12, 0.003), spawn: { x: 0.7, y: 1.2 } }) }),
    recovery: defineMove('recovery', 'Career Ladder', { duration: 40, hits: [burst(2, 12, 0.9, 5, [70, 0.13, 0.003])], recovery: { vy: 0.39, vx: 0.17, drift: 0.012 }, air: 1 }),
    down: defineMove('down', 'Headhunt Dash', { duration: 26, kind: 'dash', lunge: lunge(3, 11, 0.44), cancels: [chain('jab1', 8), chain('heavy', 8), chain('grab', 9)], air: 0.3, slide: 0.9 }),
    grab: grab('Talent Net', { from: 6, to: 9, dur: 31, reach: 1.05 }),
    pummel: pummel('Follow-Up Email', 1.5),
    fthrow: throwing('fthrow', 'Offer Letter', { dur: 25, dmg: 6, kb: [36, 0.2, 0.0034], stun: 16, stop: 6 }),
    bthrow: throwing('bthrow', 'Exit Interview', { dur: 27, dmg: 7, kb: [150, 0.22, 0.0034], stun: 16, stop: 6 }),
    uthrow: throwing('uthrow', 'Talent Acquisition', { dur: 23, dmg: 5, kb: [85, 0.16, 0.0025], stun: 34, stop: 6 }),
    dthrow: throwing('dthrow', 'Pipeline Drop', { dur: 23, dmg: 4, kb: [80, 0.09, 0.002], stun: 22, stop: 6 }),
  },
  combos: [
    { name: 'Quick Screen string', inputs: 'V, V, V', kind: 'true', script: { 0: { attack: true }, 7: { attack: true }, 14: { attack: true } }, kinds: ['jab', 'jab', 'jab'], limits: { none: 150, away: 150 }, note: 'The fastest jabs: the string still works when mashed.' },
    { name: 'Low Offer route', inputs: 'S+V, W→, W+V, →+V', kind: 'true', script: { 0: { attack: true, down: true }, 3: { jump: true, x: 1 }, 5: { attack: true, up: true, x: 1 }, 15: { attack: true, x: 1 } }, hold: [4, 24], kinds: ['sweep', 'aerial', 'aerial'], limits: { none: 70, away: 60 }, note: 'Down attack pops the target, jump-cancel, up air, then Follow-Up Kick on hit. Works through DI; light defenders drop out earlier.' },
    { name: 'Dash pressure', inputs: 'S+B, then V or M', kind: 'pressure', note: 'Headhunt Dash cancels into a jab, heavy or grab. Mix which one to beat a shield.' },
  ],
  ai: { spacing: 1.0, zone: 3.5, throwDir: 'u', poke: 'jab1', finisher: 'fair' },
};

// ---------------------------------------------------------------------------------------------------
// Chad: deliberate midrange controller. Wide cash fan, armored heavy, long horizontal recovery.
// ---------------------------------------------------------------------------------------------------
const chad: FighterDef = {
  id: 'chad', style: 'Midrange control. Wide slow Cash Burn, armored heavy, long but shallow recovery.',
  walk: 0.124, air: 1, airAccel: 0.058, weight: 1.12, fall: 0.54, jump: [0.315, 0.295], hurt: { hw: 0.42, h: 2.3 }, push: 0.33, hold: 0.9,
  moves: {
    jab1: melee('jab1', 'Term Sheet I', { t: [5, 3, 17], box: [0.3, 1.3, 0.85, 1.8], dmg: 4, kb: [0, 0.035, 0.0004], stun: 16, stop: 4 }, { lunge: lunge(1, 7, 0.025), cancels: [chain('jab2', 7)] }),
    jab2: melee('jab2', 'Term Sheet II', { t: [5, 3, 18], box: [0.3, 1.35, 0.85, 1.8], dmg: 5, kb: [0, 0.04, 0.0004], stun: 26, stop: 4 }, { lunge: lunge(1, 7, 0.025), cancels: [chain('jab3', 7), chain('special', 8, 'hit')] }),
    jab3: melee('jab3', 'Cap Table Slam', { t: [8, 4, 30], box: [0.3, 1.6, 0.6, 2.05], dmg: 8, kb: [30, 0.27, 0.0035], stun: 14, stop: 6 }, { lunge: lunge(4, 10, 0.04) }),
    heavy: melee('heavy', 'Due Diligence', { t: [14, 5, 40], box: [0.3, 1.95, 0.55, 2.1], dmg: 16, kb: [37, 0.28, 0.0036], stop: 8 }, { armor: { from: 6, to: 14, limit: 12 } }),
    upper: melee('upper', 'Uplift Round', { t: [9, 5, 30], box: [-0.4, 1.05, 1.2, 3.1], dmg: 12, kb: [76, 0.23, 0.0035], stun: 26 }),
    sweep: melee('sweep', 'Liquidation', { t: [8, 5, 29], box: [0.3, 1.8, 0, 0.8], dmg: 9, kb: [28, 0.17, 0.0034] }),
    nair: melee('nair', 'Buyout Spin', { t: [6, 8, 28], box: [-0.85, 1.05, 0.35, 2.25], dmg: 8, kb: [45, 0.16, 0.003], stun: 13 }, { air: 0.65, landing: 9 }),
    fair: melee('fair', 'Hostile Bid', { t: [9, 4, 31], box: [0.4, 1.65, 0.55, 2.05], dmg: 12, kb: [34, 0.24, 0.0034] }, { air: 0.55, landing: 14 }),
    bair: melee('bair', 'Golden Parachute', { t: [8, 4, 29], box: [-1.6, -0.3, 0.55, 2.05], dmg: 12, kb: [35, 0.25, 0.0035] }, { air: 0.55, landing: 13 }),
    uair: melee('uair', 'Moon Round', { t: [6, 5, 27], box: [-0.7, 0.95, 1.85, 3.4], dmg: 9, kb: [85, 0.2, 0.003], stun: 24 }, { air: 0.65, landing: 12 }),
    dair: melee('dair', 'Bridge Loan', { t: [12, 6, 38], box: [-0.6, 0.6, -1, 0.5], dmg: 11, kb: [-68, 0.2, 0.003] }, { air: 0.45, landing: 20 }),
    special: defineMove('special', 'Cash Burn', { duration: 46, air: 0.6, projectile: shot({ fire: 16, vx: 0.21, vy: 0.03, gravity: 0.0015, life: 95, rx: 0.55, ry: 0.65, damage: 9, launch: launch(22, 0.18, 0.003), stun: 14, spawn: { x: 0.9, y: 1.2 } }) }),
    recovery: defineMove('recovery', 'Bridge Funding', { duration: 48, hits: [burst(3, 16, 1.2, 8, [60, 0.15, 0.0033])], recovery: { vy: 0.3, vx: 0.26, drift: 0.01 }, air: 1 }),
    down: defineMove('down', 'Down Round', { duration: 46, hits: [window(12, 18, box(-1.3, 2.5, -0.1, 1.6), 14, [52, 0.26, 0.0037], { dir: 'away', stop: 7 })], dive: { speed: 0.38 }, lunge: lunge(6, 11, 0.07), air: 0 }),
    grab: grab('Capital Call', { from: 9, to: 12, dur: 37, reach: 1.35 }),
    pummel: pummel('Hard Ask', 2),
    fthrow: throwing('fthrow', 'Follow-On Toss', { dur: 29, dmg: 9, kb: [24, 0.27, 0.0036], stun: 18 }),
    bthrow: throwing('bthrow', 'Clawback', { dur: 31, dmg: 10, kb: [150, 0.26, 0.0034], stun: 18 }),
    uthrow: throwing('uthrow', 'Valuation Bump', { dur: 27, dmg: 7, kb: [85, 0.17, 0.0025], stun: 30 }),
    dthrow: throwing('dthrow', 'Dilution', { dur: 27, dmg: 6, kb: [14, 0.2, 0.002], stun: 26 }),
  },
  combos: [
    { name: 'Term Sheet string', inputs: 'V, V, V', kind: 'true', script: { 0: { attack: true }, 7: { attack: true }, 14: { attack: true } }, kinds: ['jab', 'jab', 'jab'], limits: { none: 150, away: 150 }, note: 'Steady and reliable; the Cap Table Slam finisher launches.' },
    { name: 'Cash Burn route', inputs: 'V, V, B', kind: 'true', script: { 0: { attack: true }, 7: { attack: true }, 14: { special: true } }, kinds: ['jab', 'jab', 'projectile'], limits: { none: 100, away: 100 }, note: 'The second jab holds them long enough for the cash fan to arrive. Wide, so DI cannot dodge it.' },
    { name: 'Armored Due Diligence', inputs: '→+V into their jab', kind: 'pressure', note: 'Armor absorbs one light hit but loses to grabs and heavy hits. A trade, not a true combo.' },
  ],
  ai: { spacing: 2.4, zone: 3, throwDir: 'f', poke: 'jab1', finisher: 'heavy' },
};

// ---------------------------------------------------------------------------------------------------
// Elon: theatrical artillery. Big hurtbox, telegraphed rocket, huge ground-pound, vertical recovery.
// ---------------------------------------------------------------------------------------------------
const elon: FighterDef = {
  id: 'elon', style: 'Theatrical artillery. Big hurtbox, telegraphed Rocket Reply, heavy launcher, risky To the Moon.',
  walk: 0.147, air: 1, airAccel: 0.06, weight: 1.06, fall: 0.52, jump: [0.315, 0.295], hurt: { hw: 0.48, h: 2.45 }, push: 0.36, hold: 0.95,
  moves: {
    jab1: melee('jab1', 'Tweet I', { t: [5, 3, 17], box: [0.3, 1.3, 0.85, 1.85], dmg: 4, kb: [0, 0.035, 0.0004], stun: 16, stop: 4 }, { lunge: lunge(1, 7, 0.025), cancels: [chain('jab2', 7)] }),
    jab2: melee('jab2', 'Tweet II', { t: [5, 3, 18], box: [0.3, 1.35, 0.85, 1.85], dmg: 5, kb: [0, 0.04, 0.0004], stun: 17, stop: 4 }, { lunge: lunge(1, 7, 0.025), cancels: [chain('jab3', 7)] }),
    jab3: melee('jab3', 'Ban Hammer', { t: [8, 4, 32], box: [0.3, 1.65, 0.6, 2.1], dmg: 9, kb: [32, 0.28, 0.0036], stun: 14, stop: 6 }, { lunge: lunge(4, 10, 0.04) }),
    heavy: melee('heavy', 'Launch Window', { t: [15, 5, 42], box: [0.3, 1.95, 0.55, 2.15], dmg: 17, kb: [50, 0.3, 0.0038], stop: 8 }, { cancels: [{ into: 'jump', from: 21, on: 'hit' }] }),
    upper: melee('upper', 'Stage Separation', { t: [9, 5, 30], box: [-0.4, 1.1, 1.2, 3.3], dmg: 13, kb: [88, 0.27, 0.0028], stun: 34 }, { cancels: [{ into: 'jump', from: 13, on: 'hit' }] }),
    sweep: melee('sweep', 'Landing Burn', { t: [9, 5, 30], box: [0.3, 1.85, 0, 0.85], dmg: 10, kb: [28, 0.18, 0.0035] }),
    nair: melee('nair', 'Reentry', { t: [6, 9, 29], box: [-0.9, 1.1, 0.3, 2.35], dmg: 9, kb: [45, 0.17, 0.0032], stun: 14 }, { air: 0.6, landing: 10 }),
    fair: melee('fair', 'Payload', { t: [9, 4, 32], box: [0.4, 1.7, 0.5, 2.15], dmg: 13, kb: [33, 0.26, 0.0036] }, { air: 0.5, landing: 15 }),
    bair: melee('bair', 'Exhaust', { t: [8, 4, 30], box: [-1.7, -0.3, 0.5, 2.15], dmg: 13, kb: [35, 0.27, 0.0037] }, { air: 0.5, landing: 14 }),
    uair: melee('uair', 'Orbital', { t: [6, 6, 28], box: [-0.8, 1, 1.9, 3.6], dmg: 10, kb: [85, 0.22, 0.0032], stun: 26 }, { air: 0.6, landing: 12 }),
    dair: melee('dair', 'Deorbit', { t: [12, 6, 38], box: [-0.65, 0.65, -1, 0.55], dmg: 13, kb: [-70, 0.22, 0.0033] }, { air: 0.45, landing: 21 }),
    special: defineMove('special', 'Rocket Reply', { duration: 52, air: 0.5, projectile: shot({ fire: 20, vx: 0.1, vy: 0, accel: 0.012, life: 120, rx: 0.5, ry: 0.45, damage: 14, launch: launch(30, 0.3, 0.0038), stun: 16, stop: 8, spawn: { x: 0.9, y: 1.3 }, blast: 1.6 }) }),
    recovery: defineMove('recovery', 'To the Moon', { duration: 60, hits: [burst(3, 22, 1.1, 12, [80, 0.22, 0.0036])], recovery: { vy: 0.58, vx: 0.02, drift: 0.002 }, landing: 34, air: 0.3 }),
    down: defineMove('down', 'Ground Pound', { duration: 54, hits: [window(16, 23, box(-2.4, 2.4, -0.1, 1.8), 18, [58, 0.32, 0.004], { dir: 'away', stop: 9 })], dive: { speed: 0.4 }, air: 0 }),
    grab: grab('Acquisition', { from: 9, to: 12, dur: 37, reach: 1.5 }),
    pummel: pummel('Cost Cutting', 2),
    fthrow: throwing('fthrow', 'Hostile Takeover', { dur: 30, dmg: 11, kb: [35, 0.29, 0.0038], stun: 18, stop: 8 }),
    bthrow: throwing('bthrow', 'Reverse Merger', { dur: 32, dmg: 12, kb: [150, 0.3, 0.0038], stun: 18, stop: 8 }),
    uthrow: throwing('uthrow', 'Liftoff', { dur: 28, dmg: 8, kb: [87, 0.3, 0.0014], stun: 40 }),
    dthrow: throwing('dthrow', 'Layoffs', { dur: 28, dmg: 7, kb: [80, 0.1, 0.002], stun: 24 }),
  },
  combos: [
    { name: 'Tweet string', inputs: 'V, V, V', kind: 'true', script: { 0: { attack: true }, 7: { attack: true }, 14: { attack: true } }, kinds: ['jab', 'jab', 'jab'], limits: { none: 150, away: 150 }, note: 'Ban Hammer finisher hits late and hard.' },
    { name: 'Stage Separation route', inputs: 'W+V, W, W+V', kind: 'true', script: { 0: { attack: true, up: true }, 8: { jump: true }, 10: { attack: true, up: true } }, kinds: ['upper', 'aerial'], limits: { none: 100, away: 20 }, note: 'The launcher is telegraphed and short-ranged. A defender holding away escapes quickly unless they are heavy.' },
    { name: 'Rocket rush', inputs: 'B, then follow it in', kind: 'pressure', note: 'Rocket Reply starts slowly and accelerates. Advancing behind it forces a choice, but it is easy to read.' },
  ],
  ai: { spacing: 1.5, zone: 4.5, throwDir: 'u', poke: 'jab1', finisher: 'heavy' },
};

export const FIGHTERS: FighterDef[] = [hunter, kevin, al, priya, chad, elon];
