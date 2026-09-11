import { ActionQueue } from './ActionQueue';
import type { CharacterDef, Facing, FighterStateName, HitEffect, LocalBox, MoveDef, TargetedStrikeDef } from './types';

export interface PendingThrow {
  effect: HitEffect;
  attackerFacing: Facing;
  attackerSlot: 'p1' | 'p2';
}

export interface ActiveMove {
  def: MoveDef;
  frame: number;
  /** hit-window index -> last frame it successfully connected (for reHitInterval gating). */
  lastHitFrame: Map<number, number>;
  isSuper: boolean;
  /** True once this move's projectile (if any) has launched, so it can only fire once per activation. */
  projectileSpawned?: boolean;
}

export interface Modifiers {
  damageMult: number;
  speedMult: number;
  gpuFrames: number;
  coffeeFrames: number;
}

export interface FighterRuntime {
  def: CharacterDef;
  x: number;
  y: number; // 0 = grounded; negative = height above ground
  vx: number;
  vy: number;
  facing: Facing;
  state: FighterStateName;
  /** True while actively holding block (in either the 'block' or 'crouch' state). */
  blocking: boolean;
  stateTimer: number;
  health: number;
  guard: number;
  guardRegenDelay: number;
  hype: number;
  comboCount: number;
  comboDamage: number;
  comboResetTimer: number;
  activeMove: ActiveMove | null;
  chainIndex: 0 | 1 | 2 | 3;
  chainWindow: number;
  cooldowns: { special: number; downSpecial: number; grab: number; super: number };
  dashCooldown: number;
  lastDirTap: Facing | 0;
  lastDirTapTimer: number;
  /** Raw held state one frame ago, for genuine press/release edge detection (dash double-tap). */
  prevLeftHeld: boolean;
  prevRightHeld: boolean;
  /** Direction whose release is currently awaiting a second press to complete a double-tap. */
  tapPendingDir: Facing | 0;
  tapPendingTimer: number;
  grabEscapeWindow: number;
  pendingThrow: PendingThrow | null;
  wakeupInvuln: number;
  modifiers: Modifiers;
  pendingTargetedStrike: { framesLeft: number; activeFramesLeft: number; worldX: number; def: TargetedStrikeDef; hasHit: boolean } | null;
  isCrunchMode: boolean;
  koFlag: boolean;
  queue: ActionQueue;
  dashFramesLeft: number;
  introDone: boolean;
}

export function createFighterRuntime(def: CharacterDef, x: number, facing: Facing): FighterRuntime {
  return {
    def,
    x,
    y: 0,
    vx: 0,
    vy: 0,
    facing,
    state: 'intro',
    blocking: false,
    stateTimer: 30,
    health: def.maxHealth,
    guard: 100,
    guardRegenDelay: 0,
    hype: 0,
    comboCount: 0,
    comboDamage: 0,
    comboResetTimer: 0,
    activeMove: null,
    chainIndex: 0,
    chainWindow: 0,
    cooldowns: { special: 0, downSpecial: 0, grab: 0, super: 0 },
    dashCooldown: 0,
    lastDirTap: 0,
    lastDirTapTimer: 0,
    prevLeftHeld: false,
    prevRightHeld: false,
    tapPendingDir: 0,
    tapPendingTimer: 0,
    grabEscapeWindow: 0,
    pendingThrow: null,
    wakeupInvuln: 0,
    modifiers: { damageMult: 1, speedMult: 1, gpuFrames: 0, coffeeFrames: 0 },
    pendingTargetedStrike: null,
    isCrunchMode: false,
    koFlag: false,
    queue: new ActionQueue(),
    dashFramesLeft: 0,
    introDone: false,
  };
}

export function resetFighterForRound(f: FighterRuntime, x: number, facing: Facing): void {
  f.x = x;
  f.y = 0;
  f.vx = 0;
  f.vy = 0;
  f.facing = facing;
  f.state = 'intro';
  f.blocking = false;
  f.stateTimer = 30;
  f.health = f.def.maxHealth;
  f.guard = 100;
  f.guardRegenDelay = 0;
  f.hype = 0;
  f.comboCount = 0;
  f.comboDamage = 0;
  f.comboResetTimer = 0;
  f.activeMove = null;
  f.chainIndex = 0;
  f.chainWindow = 0;
  f.cooldowns = { special: 0, downSpecial: 0, grab: 0, super: 0 };
  f.dashCooldown = 0;
  f.lastDirTap = 0;
  f.lastDirTapTimer = 0;
  f.prevLeftHeld = false;
  f.prevRightHeld = false;
  f.tapPendingDir = 0;
  f.tapPendingTimer = 0;
  f.grabEscapeWindow = 0;
  f.pendingThrow = null;
  f.wakeupInvuln = 0;
  f.modifiers = { damageMult: 1, speedMult: 1, gpuFrames: 0, coffeeFrames: 0 };
  f.pendingTargetedStrike = null;
  f.koFlag = false;
  f.queue.clear();
  f.dashFramesLeft = 0;
  f.introDone = false;
  // isCrunchMode persists only within a match's boss fight handling; caller resets explicitly if needed.
}

export const FREE_STATES: FighterStateName[] = ['idle', 'walk', 'dash', 'jump', 'crouch'];
export const GRABABLE_STATES: FighterStateName[] = ['idle', 'walk', 'dash', 'crouch', 'block'];
export const STUNNED_STATES: FighterStateName[] = ['hitstun', 'blockstun', 'guardbreak', 'knockdown', 'wakeup', 'grabbed'];

export function isGrounded(f: FighterRuntime): boolean {
  return f.y >= 0;
}

export function isCrouching(f: FighterRuntime): boolean {
  return f.state === 'crouch';
}

/** True only while the fighter is actually in a blocking stance right now (guards against a stale flag surviving a state transition into attack/stun). */
export function isActivelyBlocking(f: FighterRuntime): boolean {
  return f.blocking && (f.state === 'block' || f.state === 'crouch');
}

export function isAirborne(f: FighterRuntime): boolean {
  return f.y < 0;
}

/** Hurtbox in local space; shorter while crouching, shifted up while airborne is handled via world Y offset elsewhere. */
export function hurtboxFor(f: FighterRuntime): LocalBox {
  const w = f.def.width;
  const fullH = f.def.height;
  if (f.state === 'crouch') {
    const h = fullH * 0.62;
    return { x: -w / 2, y: -h, w, h };
  }
  if (f.state === 'knockdown') {
    return { x: -w / 2, y: -8, w, h: 8 };
  }
  return { x: -w / 2, y: -fullH, w, h: fullH };
}
