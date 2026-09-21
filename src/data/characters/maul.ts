import { box, effect, move, projectile, superHitstop, window } from '../moveHelpers';
import type { CharacterDef } from '../../sim/types';

/**
 * The roster's only weapon fighter: a saberstaff duellist built around reach.
 *
 * He is the first fighter with REACH 5 -- every normal outranges its equivalent on the rest of
 * the cast by roughly a staff length -- and pays for it with the lowest health in the game
 * (185, under Priya's 180 only because she trades reach for speed instead). The intended shape
 * is a zoner who wins at staff range and loses badly once someone is inside it.
 */
export const MAUL: CharacterDef = {
  id: 'maul',
  name: 'Darth Maul',
  profession: 'The Hostile Takeover',
  tagline: 'At last we will have market share.',
  introLine: 'At last we will have market share.',
  winLine: 'Your runway has ended.',
  maxHealth: 185,
  walkSpeed: 1.9,
  dashSpeed: 5.0,
  jumpVelocity: -11.0,
  power: 4,
  speed: 4,
  reach: 5,
  width: 34,
  height: 64,
  visual: {
    skin: '#8e2225', // Zabrak red, the tattooed face
    hair: '#1a1418', // the crown of horns reads as the hair silhouette
    primary: '#26232b', // black robes
    secondary: '#141217', // darker tabard/hood
    pants: '#1d1a21', // black trousers
    accent: '#ff3b2f', // saber red
    outline: '#0b090d',
  },
  moves: {
    // The basic string uses deliberately small knockback on the first two links: the damage-scaled
    // default would push the target out of basic3's range, which is the same trap Hunter's string
    // fell into (see hunter.combo.test.ts) and bites harder here because basic3 is a whirl, not a
    // reaching poke. Covered by maul.combo.test.ts.
    basic1: move('maul_basic1', 'Saber Jab I', 'Basic', 'basic1', 'mid', 4, 5, {
      hits: [window(4, 3, box(26, -44, 32, 14), effect(6, 'mid', { knockback: { x: 1.5, y: 0 } }))],
    }),
    basic2: move('maul_basic2', 'Saber Jab II', 'Basic x2', 'basic2', 'mid', 5, 7, {
      hits: [window(5, 3, box(28, -42, 34, 14), effect(8, 'mid', { knockback: { x: 1.8, y: 0 } }))],
    }),
    basic3: move('maul_basic3', 'Double-Blade Whirl', 'Basic x3', 'basic3', 'mid', 7, 11, {
      hits: [window(7, 5, box(24, -46, 40, 26), effect(13, 'mid', { knockback: { x: 6.5, y: 0 } }))],
    }),
    crouchBasic: move('maul_crouch_basic', 'Low Sweep', 'Down + Basic', 'crouchBasic', 'low', 6, 9, {
      hits: [window(6, 4, box(24, -12, 34, 12), effect(8, 'low'))],
    }),
    jumpBasic: move('maul_jump_basic', 'Descending Arc', 'Jump + Basic', 'jumpBasic', 'overhead', 5, 6, {
      hits: [window(5, 6, box(22, -58, 32, 24), effect(10, 'overhead'))],
    }),
    forwardBasic: move('maul_dash_thrust', 'Dash Thrust', 'Forward + Basic', 'forwardBasic', 'mid', 11, 19, {
      hits: [window(11, 4, box(32, -44, 38, 18), effect(16, 'mid', { knockback: { x: 7.5, y: 0 } }))],
      lunge: { speed: 3.6, frames: 13 },
    }),
    special: move('maul_force_shove', 'Force Shove', 'Special', 'special', 'mid', 13, 18, {
      cooldown: 60,
      projectile: projectile({
        motion: 'linear',
        speed: 4.0,
        life: 80,
        spawnOffset: { x: 20, y: -42 },
        box: box(0, -8, 18, 18),
        effect: effect(11, 'mid', { knockback: { x: 6.5, y: 0 } }),
      }),
    }),
    // A duellist's parry rather than another poke: it rewards reading an approach, which is the
    // only tool he has once an opponent is inside staff range.
    downSpecial: move('maul_parry', 'Saber Parry', 'Down + Special', 'downSpecial', 'mid', 7, 25, {
      cooldown: 75,
      isCounter: true,
      counterWindow: { start: 7, end: 21 },
      counterEffect: effect(18, 'mid', { forceKnockdown: true, knockback: { x: 8.5, y: 0 }, hitstopFrames: 7 }),
    }),
    grab: move('maul_choke', 'Force Choke', 'Grab', 'grab', 'mid', 7, 22, {
      cooldown: 15,
      isGrab: true,
      hits: [window(7, 4, box(16, -42, 18, 22), effect(18, 'mid', { guardDamage: 0, knockback: { x: 7.5, y: 0 }, forceKnockdown: true }))],
    }),
    super: move('maul_spin', 'Both Ends of the Blade', 'Super (Basic+Special)', 'super', 'mid', 24, 26, {
      meterCost: 100,
      cooldown: 30,
      hits: [
        window(24, 6, box(22, -50, 42, 30), effect(7, 'mid', { hitstopFrames: superHitstop() })),
        window(32, 6, box(22, -50, 44, 30), effect(7, 'mid', { hitstopFrames: superHitstop() }), { reHitInterval: 8 }),
        window(40, 6, box(22, -50, 44, 30), effect(7, 'mid', { hitstopFrames: superHitstop() }), { reHitInterval: 8 }),
        window(48, 6, box(22, -50, 44, 30), effect(7, 'mid', { hitstopFrames: superHitstop() }), { reHitInterval: 8 }),
        window(56, 8, box(20, -54, 48, 36), effect(24, 'mid', { forceKnockdown: true, knockback: { x: 9.5, y: -2 }, hitstopFrames: superHitstop() })),
      ],
    }),
  },
};
