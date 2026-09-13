import { box, effect, move, projectile, targetedStrike, window } from '../moveHelpers';
import type { CharacterDef } from '../../sim/types';

export const CHAD: CharacterDef = {
  id: 'chad',
  name: 'Chad',
  profession: 'The Venture Capitalist',
  tagline: "I'm mostly investing in the team.",
  introLine: "I'm mostly investing in the team.",
  winLine: "Unfortunately, we're going to pass.",
  maxHealth: 205,
  walkSpeed: 1.3,
  dashSpeed: 3.8,
  jumpVelocity: -9.8,
  power: 5,
  speed: 1,
  reach: 4,
  width: 40,
  height: 68,
  visual: {
    skin: '#e4b48a',
    hair: '#3a2a18',
    primary: '#dedad0', // casual expensive quarter-zip
    secondary: '#1c1c22', // sunglasses / dark tee
    pants: '#c7bfa8', // chinos
    accent: '#c9a227', // term sheet / gold accents
    outline: '#141014',
  },
  moves: {
    basic1: move('chad_basic1', 'Due Diligence I', 'Basic', 'basic1', 'mid', 7, 8, {
      hits: [window(7, 3, box(20, -46, 24, 18), effect(6, 'mid'))],
    }),
    basic2: move('chad_basic2', 'Due Diligence II', 'Basic x2', 'basic2', 'mid', 8, 10, {
      hits: [window(8, 4, box(22, -44, 26, 18), effect(8, 'mid'))],
    }),
    basic3: move('chad_basic3', 'Due Diligence III', 'Basic x3', 'basic3', 'mid', 9, 14, {
      hits: [window(9, 5, box(24, -40, 30, 20), effect(13, 'mid', { knockback: { x: 7.5, y: 0 } }))],
    }),
    crouchBasic: move('chad_crouch_basic', 'Low Loafer', 'Down + Basic', 'crouchBasic', 'low', 8, 10, {
      hits: [window(8, 3, box(18, -14, 22, 12), effect(7, 'low'))],
    }),
    jumpBasic: move('chad_jump_basic', 'Air Baton Drop', 'Jump + Basic', 'jumpBasic', 'overhead', 6, 7, {
      hits: [window(6, 6, box(18, -62, 28, 22), effect(10, 'overhead'))],
    }),
    forwardBasic: move('chad_valuation_adjustment', 'Valuation Adjustment', 'Forward + Basic', 'forwardBasic', 'overhead', 16, 24, {
      hits: [window(16, 5, box(24, -56, 32, 30), effect(16, 'overhead', { knockback: { x: 8, y: 0 } }))],
      lunge: { speed: 2.4, frames: 16 },
    }),
    special: move('chad_cash_burn', 'Cash Burn', 'Special', 'special', 'mid', 16, 22, {
      cooldown: 70,
      projectile: projectile({
        motion: 'linear',
        speed: 3.0,
        life: 85,
        spawnOffset: { x: 20, y: -44 },
        box: box(0, -8, 16, 12),
        effect: effect(14, 'mid', { guardDamage: 14 }),
      }),
    }),
    downSpecial: move('chad_down_round', 'Down Round', 'Down + Special', 'downSpecial', 'mid', 10, 20, {
      cooldown: 90,
      targetedStrike: targetedStrike({
        delayFrames: 40,
        activeFrames: 10,
        offset: { x: 70, y: 0 },
        box: box(-18, -60, 36, 60),
        effect: effect(18, 'overhead', { guardDamage: 16, forceKnockdown: true, knockback: { x: 4, y: 0 }, hitstopFrames: 7 }),
        markerRadius: 18,
      }),
    }),
    grab: move('chad_hostile_takeover', 'Hostile Takeover', 'Grab', 'grab', 'mid', 8, 22, {
      cooldown: 15,
      isGrab: true,
      hits: [window(8, 4, box(15, -44, 18, 22), effect(21, 'mid', { guardDamage: 0, knockback: { x: 8, y: 0 }, forceKnockdown: true }))],
    }),
    super: move('chad_exit_strategy', 'Exit Strategy', 'Super (Basic+Special)', 'super', 'mid', 20, 26, {
      meterCost: 100,
      cooldown: 30,
      targetedStrike: targetedStrike({
        delayFrames: 46,
        activeFrames: 14,
        offset: { x: 46, y: 0 },
        box: box(-34, -70, 68, 70),
        effect: effect(52, 'mid', { guardDamage: 30, forceKnockdown: true, knockback: { x: 10, y: -2 }, hitstopFrames: 10 }),
        markerRadius: 34,
      }),
    }),
  },
};
