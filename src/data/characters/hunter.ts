import { box, effect, move, projectile, superHitstop, window } from '../moveHelpers';
import type { CharacterDef } from '../../sim/types';

export const HUNTER: CharacterDef = {
  id: 'hunter',
  name: 'Hunter',
  profession: 'The Tech Bro',
  tagline: "I'm not fighting. I'm disrupting.",
  introLine: "I'm not fighting. I'm disrupting.",
  winLine: "Let's circle back when you've raised more.",
  maxHealth: 200,
  walkSpeed: 1.7,
  dashSpeed: 4.6,
  jumpVelocity: -10.5,
  power: 3,
  speed: 3,
  reach: 3,
  width: 36,
  height: 62,
  visual: {
    skin: '#e8b48a',
    hair: '#4a3324', // chestnut brown
    primary: '#9098a3', // gray hoodie
    secondary: '#262a33', // dark quilted puffer vest
    pants: '#3b5a86', // blue jeans
    accent: '#59c1d6', // cyan rim light / sneaker accent / smartwatch
    outline: '#151018',
  },
  moves: {
    basic1: move('hunter_basic1', 'Disruptive Innovation I', 'Basic', 'basic1', 'mid', 4, 5, {
      hits: [window(4, 3, box(18, -44, 24, 16), effect(6, 'mid'))],
    }),
    basic2: move('hunter_basic2', 'Disruptive Innovation II', 'Basic x2', 'basic2', 'mid', 5, 7, {
      hits: [window(5, 3, box(18, -42, 26, 16), effect(8, 'mid'))],
    }),
    basic3: move('hunter_basic3', 'Disruptive Innovation III', 'Basic x3', 'basic3', 'high', 6, 10, {
      hits: [window(6, 4, box(20, -50, 26, 18), effect(12, 'high', { knockback: { x: 6, y: 0 } }))],
    }),
    crouchBasic: move('hunter_crouch_basic', 'Low Jab', 'Down + Basic', 'crouchBasic', 'low', 5, 7, {
      hits: [window(5, 3, box(16, -14, 22, 12), effect(7, 'low'))],
    }),
    jumpBasic: move('hunter_jump_basic', 'Air Jab', 'Jump + Basic', 'jumpBasic', 'overhead', 4, 6, {
      hits: [window(4, 6, box(16, -58, 26, 20), effect(9, 'overhead'))],
    }),
    forwardBasic: move('hunter_elevator_pitch', 'Elevator Pitch', 'Forward + Basic', 'forwardBasic', 'mid', 10, 18, {
      hits: [window(10, 4, box(22, -46, 28, 22), effect(16, 'mid', { knockback: { x: 7.5, y: 0 } }))],
      lunge: { speed: 3.2, frames: 12 },
    }),
    special: move('hunter_ipad_yeet', 'iPad Yeet', 'Special', 'special', 'mid', 12, 16, {
      cooldown: 55,
      projectile: projectile({
        motion: 'linear',
        speed: 3.6,
        life: 90,
        spawnOffset: { x: 20, y: -40 },
        box: box(0, -6, 14, 10),
        effect: effect(11, 'mid', { guardDamage: 12 }),
      }),
    }),
    downSpecial: move('hunter_pivot', 'Pivot', 'Down + Special', 'downSpecial', 'mid', 9, 16, {
      cooldown: 65,
      hits: [window(9, 4, box(20, -44, 26, 20), effect(15, 'mid', { knockback: { x: 8, y: 0 } }))],
      lunge: { speed: 4.2, frames: 11 },
    }),
    grab: move('hunter_networking', 'Mandatory Networking', 'Grab', 'grab', 'mid', 6, 20, {
      cooldown: 15,
      isGrab: true,
      hits: [window(6, 4, box(14, -40, 18, 20), effect(20, 'mid', { guardDamage: 0, knockback: { x: 9, y: 0 }, forceKnockdown: true }))],
    }),
    super: move('hunter_series_a', 'Series A', 'Super (Basic+Special)', 'super', 'mid', 22, 24, {
      meterCost: 100,
      cooldown: 30,
      hits: [
        window(22, 6, box(18, -50, 30, 26), effect(9, 'mid', { hitstopFrames: superHitstop() })),
        window(30, 6, box(18, -50, 34, 26), effect(9, 'mid', { hitstopFrames: superHitstop() }), { reHitInterval: 8 }),
        window(38, 6, box(18, -50, 34, 26), effect(9, 'mid', { hitstopFrames: superHitstop() }), { reHitInterval: 8 }),
        window(46, 8, box(16, -56, 36, 34), effect(24, 'mid', { forceKnockdown: true, knockback: { x: 10, y: -3 }, hitstopFrames: superHitstop() })),
      ],
    }),
  },
};
