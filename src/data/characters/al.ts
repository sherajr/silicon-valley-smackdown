import { box, effect, move, projectile, superHitstop, window } from '../moveHelpers';
import type { CharacterDef } from '../../sim/types';

export const AL: CharacterDef = {
  id: 'al',
  name: 'Al',
  profession: 'The Drunkard',
  tagline: 'Is this the karaoke signup?',
  introLine: 'Is this the karaoke signup?',
  winLine: 'Same time tomorrow?',
  maxHealth: 220,
  walkSpeed: 1.2,
  dashSpeed: 3.4,
  jumpVelocity: -9.6,
  power: 4,
  speed: 1,
  reach: 2,
  width: 44,
  height: 64,
  visual: {
    skin: '#e3ae82',
    hair: '#5a4632',
    primary: '#7a2e2e', // rumpled bowling shirt
    secondary: '#d9c48a', // loose, crooked tie
    pants: '#4a4238', // rumpled brown trousers
    accent: '#5a8f4f', // bottle
    outline: '#171013',
  },
  moves: {
    basic1: move('al_basic1', 'Last Call I', 'Basic', 'basic1', 'mid', 6, 7, {
      hits: [window(6, 3, box(16, -42, 22, 16), effect(6, 'mid'))],
    }),
    basic2: move('al_basic2', 'Last Call II', 'Basic x2', 'basic2', 'mid', 7, 9, {
      hits: [window(7, 3, box(16, -40, 24, 16), effect(8, 'mid'))],
    }),
    basic3: move('al_basic3', 'Last Call III', 'Basic x3', 'basic3', 'mid', 8, 13, {
      hits: [window(8, 5, box(18, -48, 26, 20), effect(13, 'mid', { knockback: { x: 7, y: 0 } }))],
    }),
    crouchBasic: move('al_crouch_basic', 'Bar Stool Jab', 'Down + Basic', 'crouchBasic', 'low', 7, 9, {
      hits: [window(7, 3, box(14, -12, 20, 12), effect(7, 'low'))],
    }),
    jumpBasic: move('al_jump_basic', 'Falling Elbow', 'Jump + Basic', 'jumpBasic', 'overhead', 5, 7, {
      hits: [window(5, 6, box(16, -56, 24, 20), effect(9, 'overhead'))],
    }),
    forwardBasic: move('al_closing_time', 'Closing Time', 'Forward + Basic', 'forwardBasic', 'mid', 15, 22, {
      hits: [window(15, 5, box(20, -44, 32, 26), effect(17, 'mid', { knockback: { x: 8.5, y: 0 } }))],
      lunge: { speed: 3.6, frames: 17 },
    }),
    special: move('al_bottle_service', 'Bottle Service', 'Special', 'special', 'mid', 15, 20, {
      cooldown: 65,
      projectile: projectile({
        motion: 'arc',
        speed: 2.9,
        gravity: 0.24,
        vy0: -3.2,
        life: 70,
        spawnOffset: { x: 16, y: -46 },
        box: box(0, -6, 12, 10),
        effect: effect(12, 'mid', { guardDamage: 12 }),
      }),
    }),
    downSpecial: move('al_happy_hour', 'Happy Hour', 'Down + Special', 'downSpecial', 'low', 12, 24, {
      cooldown: 70,
      hits: [window(12, 5, box(14, -10, 26, 12), effect(14, 'low', { knockback: { x: 6, y: 0 } }))],
      lunge: { speed: 2.2, frames: 13 },
    }),
    grab: move('al_best_friend', "You're My Best Friend", 'Grab', 'grab', 'mid', 8, 22, {
      cooldown: 15,
      isGrab: true,
      hits: [window(8, 4, box(13, -40, 18, 20), effect(21, 'mid', { guardDamage: 0, knockback: { x: 7, y: 0 }, forceKnockdown: true }))],
    }),
    super: move('al_open_bar', 'Open Bar', 'Super (Basic+Special)', 'super', 'mid', 24, 28, {
      meterCost: 100,
      cooldown: 30,
      lunge: { speed: 3.0, frames: 40 },
      hits: [
        window(24, 6, box(14, -48, 30, 26), effect(9, 'mid', { hitstopFrames: superHitstop() })),
        window(32, 6, box(14, -48, 30, 26), effect(9, 'mid', { hitstopFrames: superHitstop() }), { reHitInterval: 8 }),
        window(40, 6, box(14, -48, 30, 26), effect(9, 'mid', { hitstopFrames: superHitstop() }), { reHitInterval: 8 }),
        window(48, 8, box(12, -52, 34, 32), effect(22, 'mid', { forceKnockdown: true, knockback: { x: 8, y: -2 }, hitstopFrames: superHitstop() })),
      ],
    }),
  },
};
