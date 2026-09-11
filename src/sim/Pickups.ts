import {
  GPU_DAMAGE_MULT,
  GPU_DURATION_FRAMES,
  COFFEE_SPEED_MULT,
  COFFEE_DURATION_FRAMES,
  PICKUP_FIRST_SPAWN_SECONDS,
  PICKUP_LIFETIME_SECONDS,
  PICKUP_MAX_INTERVAL_SECONDS,
  PICKUP_MIN_INTERVAL_SECONDS,
  PICKUP_TELEGRAPH_FRAMES,
  SIGNING_BONUS_HEAL,
  SIM_FPS,
  STAGE_LEFT_WALL,
  STAGE_RIGHT_WALL,
} from './constants';
import type { Rng } from './rng';

export type PickupKind = 'gpu' | 'coffee' | 'signing_bonus';

export const PICKUP_KINDS: PickupKind[] = ['gpu', 'coffee', 'signing_bonus'];

export interface PickupInstance {
  kind: PickupKind;
  x: number;
  age: number;
  armed: boolean;
}

export function rollNextSpawnFrame(rng: Rng, fromFrame: number, isFirst: boolean): number {
  if (isFirst) return fromFrame + PICKUP_FIRST_SPAWN_SECONDS * SIM_FPS;
  const seconds = rng.range(PICKUP_MIN_INTERVAL_SECONDS, PICKUP_MAX_INTERVAL_SECONDS);
  return fromFrame + Math.round(seconds * SIM_FPS);
}

export function rollPickupKind(rng: Rng): PickupKind {
  return rng.pick(PICKUP_KINDS);
}

export function rollPickupX(rng: Rng): number {
  const margin = 60;
  return rng.range(STAGE_LEFT_WALL + margin, STAGE_RIGHT_WALL - margin);
}

export const PICKUP_LIFETIME_FRAMES = PICKUP_LIFETIME_SECONDS * SIM_FPS;
export const PICKUP_TELEGRAPH = PICKUP_TELEGRAPH_FRAMES;

export function applyPickupEffect(kind: PickupKind, modifiers: { damageMult: number; speedMult: number; gpuFrames: number; coffeeFrames: number }, health: number, maxHealth: number): number {
  if (kind === 'gpu') {
    modifiers.gpuFrames = GPU_DURATION_FRAMES;
    modifiers.damageMult = GPU_DAMAGE_MULT;
    return health;
  }
  if (kind === 'coffee') {
    modifiers.coffeeFrames = COFFEE_DURATION_FRAMES;
    modifiers.speedMult = COFFEE_SPEED_MULT;
    return health;
  }
  return Math.min(maxHealth, health + SIGNING_BONUS_HEAL);
}
