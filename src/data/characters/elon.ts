import { box, effect, move, projectile, targetedStrike, window } from '../moveHelpers';
import type { CharacterDef } from '../../sim/types';

function buildMoves(isBoss: boolean): CharacterDef['moves'] {
  return {
    basic1: move('elon_basic1', 'Founder Mode I', 'Basic', 'basic1', 'mid', 5, 6, {
      hits: [window(5, 3, box(18, -46, 24, 16), effect(6, 'mid'))],
    }),
    basic2: move('elon_basic2', 'Founder Mode II', 'Basic x2', 'basic2', 'mid', 6, 7, {
      hits: [window(6, 3, box(20, -44, 26, 16), effect(8, 'mid'))],
    }),
    basic3: move('elon_basic3', 'Founder Mode III', 'Basic x3', 'basic3', 'high', 6, 10, {
      hits: [window(6, 4, box(20, -50, 28, 18), effect(12, 'high', { knockback: { x: 6.5, y: 0 } }))],
    }),
    crouchBasic: move('elon_crouch_basic', 'Low Founder Mode', 'Down + Basic', 'crouchBasic', 'low', 5, 7, {
      hits: [window(5, 3, box(16, -14, 22, 12), effect(7, 'low'))],
    }),
    jumpBasic: move('elon_jump_basic', 'Air Rocket Kick', 'Jump + Basic', 'jumpBasic', 'overhead', 4, 6, {
      hits: [window(4, 6, box(16, -58, 26, 20), effect(9, 'overhead'))],
    }),
    forwardBasic: move('elon_move_fast', 'Move Fast', 'Forward + Basic', 'forwardBasic', 'mid', 11, 18, {
      hits: [window(11, 4, box(22, -48, 30, 24), effect(16, 'mid', { knockback: { x: 8, y: 0 } }))],
      lunge: { speed: 4.6, frames: 13 },
    }),
    special: move('elon_rocket_reply', 'Rocket Reply', 'Special', 'special', 'mid', 12, 16, {
      cooldown: isBoss ? 45 : 58,
      projectile: projectile({
        motion: 'linear',
        speed: 4.2,
        life: 80,
        spawnOffset: { x: 20, y: -46 },
        box: box(0, -8, 16, 10),
        effect: effect(12, 'mid', { guardDamage: 12 }),
      }),
    }),
    downSpecial: move('elon_cybertruck_shuffle', 'Cybertruck Shuffle', 'Down + Special', 'downSpecial', 'low', 14, 20, {
      cooldown: isBoss ? 70 : 90,
      projectile: projectile({
        motion: 'ground',
        speed: 1.8,
        life: 55,
        spawnOffset: { x: 18, y: 0 },
        box: box(0, -14, 22, 14),
        effect: effect(13, 'low', { guardDamage: 12 }),
        maxActiveInstances: 1,
      }),
    }),
    grab: move('elon_acquisition', 'Acquisition', 'Grab', 'grab', 'mid', 7, 20, {
      cooldown: 15,
      isGrab: true,
      hits: [window(7, 4, box(14, -42, 18, 20), effect(20, 'mid', { guardDamage: 0, knockback: { x: 9, y: -1 }, forceKnockdown: true }))],
    }),
    super: move('elon_to_the_moon', 'To the Moon', 'Super (Basic+Special)', 'super', 'mid', 20, 24, {
      meterCost: 100,
      cooldown: 30,
      targetedStrike: targetedStrike({
        delayFrames: 50,
        activeFrames: 12,
        offset: { x: 40, y: 0 },
        box: box(-30, -70, 60, 70),
        effect: effect(50, 'mid', { guardDamage: 28, forceKnockdown: true, knockback: { x: 9, y: -3 }, hitstopFrames: 10 }),
        markerRadius: 32,
      }),
    }),
  };
}

const VISUAL = {
  skin: '#e2ac82',
  hair: '#2a2520',
  primary: '#14151c', // dark futuristic jacket
  secondary: '#3a3f52',
  accent: '#d0d6de', // rocket boot / rocket accessory
  outline: '#0a0a0e',
};

export const ELON_BOSS: CharacterDef = {
  id: 'elon',
  name: 'Elon',
  profession: 'Final Boss',
  tagline: "The roadmap says I've already won.",
  introLine: "The roadmap says I've already won.",
  winLine: 'Victory ships next quarter.',
  maxHealth: 280,
  walkSpeed: 1.7,
  dashSpeed: 4.6,
  jumpVelocity: -10.4,
  power: 5,
  speed: 3,
  reach: 3,
  width: 40,
  height: 68,
  visual: VISUAL,
  moves: buildMoves(true),
  bossPhaseThreshold: 0.45,
};

export const ELON: CharacterDef = {
  id: 'elon',
  name: 'Elon',
  profession: 'The Founder',
  tagline: "The roadmap says I've already won.",
  introLine: "The roadmap says I've already won.",
  winLine: 'Victory ships next quarter.',
  maxHealth: 210,
  walkSpeed: 1.6,
  dashSpeed: 4.4,
  jumpVelocity: -10.4,
  power: 3,
  speed: 3,
  reach: 3,
  width: 40,
  height: 68,
  visual: VISUAL,
  moves: buildMoves(false),
  locked: true,
};
