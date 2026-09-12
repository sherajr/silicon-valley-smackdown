import { box, effect, move, projectile, superHitstop, window } from '../moveHelpers';
import type { CharacterDef } from '../../sim/types';

export const KEVIN: CharacterDef = {
  id: 'kevin',
  name: 'Kevin',
  profession: 'The Lawyer',
  tagline: 'This consultation is billable.',
  introLine: 'This consultation is billable.',
  winLine: 'You should have read the fine print.',
  maxHealth: 210,
  walkSpeed: 1.4,
  dashSpeed: 4.0,
  jumpVelocity: -10.2,
  power: 4,
  speed: 2,
  reach: 4,
  width: 38,
  height: 66,
  visual: {
    skin: '#e0ac7c',
    hair: '#1c1c1c',
    primary: '#ff36c8',
    secondary: '#fff23d',
    pants: '#163f86',
    accent: '#fff23d',
    outline: '#100a30',
  },
  moves: {
    basic1: move('kevin_basic1', 'Billable Hours I', 'Basic', 'basic1', 'mid', 5, 6, {
      hits: [window(5, 3, box(20, -46, 24, 16), effect(6, 'mid'))],
    }),
    basic2: move('kevin_basic2', 'Billable Hours II', 'Basic x2', 'basic2', 'mid', 6, 8, {
      hits: [window(6, 3, box(22, -44, 26, 16), effect(8, 'mid'))],
    }),
    basic3: move('kevin_basic3', 'Billable Hours III', 'Basic x3', 'basic3', 'mid', 7, 11, {
      hits: [window(7, 4, box(24, -42, 28, 20), effect(12, 'mid', { knockback: { x: 7, y: 0 } }))],
    }),
    crouchBasic: move('kevin_crouch_basic', 'Low Retainer', 'Down + Basic', 'crouchBasic', 'low', 6, 8, {
      hits: [window(6, 3, box(18, -14, 22, 12), effect(7, 'low'))],
    }),
    jumpBasic: move('kevin_jump_basic', 'Air Briefcase Chop', 'Jump + Basic', 'jumpBasic', 'overhead', 5, 6, {
      hits: [window(5, 6, box(18, -60, 26, 20), effect(9, 'overhead'))],
    }),
    forwardBasic: move('kevin_fine_print', 'Fine Print', 'Forward + Basic', 'forwardBasic', 'mid', 13, 22, {
      hits: [window(13, 5, box(24, -48, 32, 22), effect(16, 'mid', { knockback: { x: 8, y: 0 } }))],
      lunge: { speed: 2.6, frames: 14 },
    }),
    special: move('kevin_briefcase_briefing', 'Briefcase Briefing', 'Special', 'special', 'mid', 14, 20, {
      cooldown: 60,
      projectile: projectile({
        motion: 'arc',
        speed: 3.1,
        gravity: 0.22,
        vy0: -3.4,
        life: 75,
        spawnOffset: { x: 18, y: -50 },
        box: box(0, -6, 14, 12),
        effect: effect(13, 'mid', { guardDamage: 13 }),
      }),
    }),
    downSpecial: move('kevin_objection', 'Objection!', 'Down + Special', 'downSpecial', 'mid', 8, 26, {
      cooldown: 80,
      isCounter: true,
      counterWindow: { start: 8, end: 22 },
      counterEffect: effect(17, 'mid', { forceKnockdown: true, knockback: { x: 8, y: 0 }, hitstopFrames: 7 }),
    }),
    grab: move('kevin_served', "You've Been Served", 'Grab', 'grab', 'mid', 7, 22, {
      cooldown: 15,
      isGrab: true,
      hits: [window(7, 4, box(15, -42, 18, 20), effect(19, 'mid', { guardDamage: 0, knockback: { x: 8, y: 0 }, forceKnockdown: true }))],
    }),
    super: move('kevin_class_action', 'Class Action', 'Super (Basic+Special)', 'super', 'mid', 26, 26, {
      meterCost: 100,
      cooldown: 30,
      hits: [
        window(26, 6, box(16, -52, 34, 30), effect(8, 'mid', { hitstopFrames: superHitstop() })),
        window(34, 6, box(16, -52, 36, 30), effect(8, 'mid', { hitstopFrames: superHitstop() }), { reHitInterval: 8 }),
        window(42, 6, box(16, -52, 36, 30), effect(8, 'mid', { hitstopFrames: superHitstop() }), { reHitInterval: 8 }),
        window(50, 8, box(14, -56, 40, 36), effect(26, 'mid', { forceKnockdown: true, knockback: { x: 9, y: -2 }, hitstopFrames: superHitstop() })),
      ],
    }),
  },
};
