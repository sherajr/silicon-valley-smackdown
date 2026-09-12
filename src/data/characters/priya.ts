import { box, effect, move, projectile, superHitstop, window } from '../moveHelpers';
import type { CharacterDef } from '../../sim/types';

export const PRIYA: CharacterDef = {
  id: 'priya',
  name: 'Priya',
  profession: 'The Recruiter',
  tagline: 'Do you have five minutes for an opportunity?',
  introLine: 'Do you have five minutes for an opportunity?',
  winLine: "We'll keep your resume on file.",
  maxHealth: 180,
  walkSpeed: 2.0,
  dashSpeed: 5.2,
  jumpVelocity: -10.8,
  power: 2,
  speed: 5,
  reach: 2,
  width: 32,
  height: 58,
  visual: {
    skin: '#caa27a',
    hair: '#241a12',
    primary: '#ff36c8',
    secondary: '#00e5ff',
    pants: '#46248e',
    accent: '#fff23d',
    outline: '#100a30',
  },
  moves: {
    basic1: move('priya_basic1', 'Quick Follow-Up I', 'Basic', 'basic1', 'mid', 3, 4, {
      hits: [window(3, 3, box(16, -40, 20, 14), effect(5, 'mid'))],
    }),
    basic2: move('priya_basic2', 'Quick Follow-Up II', 'Basic x2', 'basic2', 'mid', 4, 6, {
      hits: [window(4, 3, box(16, -38, 22, 14), effect(7, 'mid'))],
    }),
    basic3: move('priya_basic3', 'Quick Follow-Up III', 'Basic x3', 'basic3', 'high', 5, 8, {
      hits: [window(5, 4, box(18, -46, 22, 16), effect(10, 'high', { knockback: { x: 5.5, y: 0 } }))],
    }),
    crouchBasic: move('priya_crouch_basic', 'Ankle Tap', 'Down + Basic', 'crouchBasic', 'low', 4, 6, {
      hits: [window(4, 3, box(14, -12, 18, 10), effect(6, 'low'))],
    }),
    jumpBasic: move('priya_jump_basic', 'Air Heel Kick', 'Jump + Basic', 'jumpBasic', 'overhead', 3, 5, {
      hits: [window(3, 6, box(14, -54, 22, 18), effect(8, 'overhead'))],
    }),
    forwardBasic: move('priya_culture_fit', 'Culture Fit', 'Forward + Basic', 'forwardBasic', 'mid', 8, 15, {
      hits: [window(8, 4, box(20, -42, 26, 20), effect(15, 'mid', { knockback: { x: 7, y: 0 } }))],
      lunge: { speed: 4.4, frames: 10 },
    }),
    special: move('priya_resume_blast', 'Resume Blast', 'Special', 'special', 'mid', 8, 14, {
      cooldown: 42,
      projectile: projectile({
        motion: 'linear',
        speed: 4.6,
        life: 70,
        spawnOffset: { x: 16, y: -38 },
        box: box(0, -4, 12, 8),
        effect: effect(8, 'mid', { guardDamage: 9 }),
      }),
    }),
    downSpecial: move("priya_lets_connect", "Let's Connect", 'Down + Special', 'downSpecial', 'mid', 6, 18, {
      cooldown: 55,
      lunge: { speed: -3.2, frames: 8 },
      projectile: projectile({
        motion: 'linear',
        speed: 3.8,
        life: 55,
        spawnOffset: { x: 14, y: -34 },
        box: box(0, -4, 10, 8),
        effect: effect(6, 'mid', { guardDamage: 6 }),
      }),
    }),
    grab: move('priya_talent_acquisition', 'Talent Acquisition', 'Grab', 'grab', 'mid', 5, 18, {
      cooldown: 15,
      isGrab: true,
      hits: [window(5, 4, box(13, -38, 16, 18), effect(18, 'mid', { guardDamage: 0, knockback: { x: 8, y: 0 }, forceKnockdown: true }))],
    }),
    super: move('priya_seven_round_interview', 'Seven-Round Interview', 'Super (Basic+Special)', 'super', 'mid', 18, 22, {
      meterCost: 100,
      cooldown: 30,
      lunge: { speed: 3.6, frames: 30 },
      hits: [
        window(18, 5, box(16, -46, 26, 24), effect(10, 'mid', { hitstopFrames: superHitstop() })),
        window(26, 5, box(16, -46, 26, 24), effect(10, 'mid', { hitstopFrames: superHitstop() }), { reHitInterval: 6 }),
        window(34, 7, box(14, -50, 30, 28), effect(20, 'mid', { forceKnockdown: true, knockback: { x: 8, y: -2 }, hitstopFrames: superHitstop() })),
      ],
    }),
  },
};
