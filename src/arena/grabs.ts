/**
 * Grab and throw rules as pure helpers: which fighters can be caught, where the catch reaches, where a held
 * opponent stands, and which throw a direction selects. The simulation owns the state; this module owns the rules
 * and the tuning numbers, so they can be tested and documented in one place.
 */
import type { Box, MoveId } from './moveDefinitions';

/** Gameplay frames after a catch in which the held fighter can break free with a fresh grab press. */
export const TECH_FRAMES = 8;
/** Longest a hold can last before the captor automatically throws forward. */
export const HOLD_MAX = 54;
export const PUMMEL_MAX = 2;
/** Frames between pummels. */
export const PUMMEL_GAP = 14;
/** Frame of the pummel animation on which its damage lands. */
export const PUMMEL_HIT = 3;
/** Frames after a hold ends (throw, tech, timeout, interruption) before the same fighter can be caught again. */
export const GRAB_PROTECT = 45;
/** Hitstop on a successful catch, and non-actionable frames for both fighters after a tech. */
export const CATCH_STOP = 4;
export const TECH_LAG = 16;
/** How far each fighter is pushed apart by a tech or a simultaneous-grab break. */
export const SEPARATE = 0.45;
/** Speed at which a caught fighter is drawn to the hold position. */
export const HOLD_PULL = 0.25;
/** Closest (in front) centre distance at which a catch can connect. A fighter behind the captor is never caught. */
export const CATCH_MIN_FRONT = 0.1;

export interface CatchCandidate {
  x: number; y: number; facing: number; grounded: boolean; stocks: number; respawn: number; invincible: number;
  stun: number; roll: number; ledge: number; heldBy: number | null; hold: object | null; grabProtect: number;
}

/** Legal target states for a normal catch: standing or shielding on the ground, not protected, not already held. */
export function canBeCaught(t: CatchCandidate): boolean {
  return t.stocks > 0 && t.respawn === 0 && t.invincible === 0 && t.grounded && t.stun === 0 && t.roll === 0 && t.ledge === 0 && t.heldBy === null && t.hold === null && t.grabProtect === 0;
}

export type ThrowDir = 'f' | 'b' | 'u' | 'd';
const THROW_IDS: Record<ThrowDir, MoveId> = { f: 'fthrow', b: 'bthrow', u: 'uthrow', d: 'dthrow' };
export const throwMoveId = (d: ThrowDir): MoveId => THROW_IDS[d];

/** Vertical input wins over horizontal; forward/back are relative to the captor's facing; neutral throws forward. */
export function throwDirection(facing: number, input: { x: number; up: boolean; down: boolean }): ThrowDir {
  if (input.up) return 'u';
  if (input.down) return 'd';
  if (input.x !== 0 && Math.sign(input.x) !== facing) return 'b';
  return 'f';
}

/** World rectangle of a facing-relative box for a fighter at (x, y) facing `facing`. */
export function worldBox(b: Box, x: number, y: number, facing: number): { x0: number; x1: number; y0: number; y1: number } {
  const a = x + b.x0 * facing, c = x + b.x1 * facing;
  return { x0: Math.min(a, c), x1: Math.max(a, c), y0: y + b.y0, y1: y + b.y1 };
}

export const rectsOverlap = (a: { x0: number; x1: number; y0: number; y1: number }, b: { x0: number; x1: number; y0: number; y1: number }) =>
  a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

/**
 * Does the catch reach the target? They must stand on the same surface (same height), in front of the captor, inside
 * the catch volume. `hurt` is the target's hurtbox half-width and height.
 */
export function catchConnects(captor: { x: number; y: number; facing: number }, catchBox: Box, target: { x: number; y: number }, hurt: { hw: number; h: number }): boolean {
  if (Math.abs(target.y - captor.y) > 0.3) return false;
  if ((target.x - captor.x) * captor.facing < CATCH_MIN_FRONT) return false;
  const reach = worldBox(catchBox, captor.x, captor.y, captor.facing);
  return rectsOverlap(reach, { x0: target.x - hurt.hw, x1: target.x + hurt.hw, y0: target.y, y1: target.y + hurt.h });
}

/** Where a held fighter stands, clamped to stay on the captor's platform. */
export function holdPosition(captorX: number, facing: number, offset: number, span: { x0: number; x1: number } | null): number {
  const x = captorX + facing * offset;
  return span ? Math.max(span.x0 + 0.12, Math.min(span.x1 - 0.12, x)) : x;
}
