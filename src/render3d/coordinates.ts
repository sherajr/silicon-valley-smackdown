// Converts simulation coordinates (sim units == pixels on the 480x270 base canvas, origin
// top-left, y growing down, ground at GROUND_Y) into Three.js world space (right-handed, Y-up,
// ground at world Y=0). This is the ONLY place that mapping is defined; every 3D consumer
// (fighters, effects, projectiles, pickups, debug boxes) must go through it so nothing drifts.
//
// From the sim (src/sim/FighterRuntime.ts): x is absolute across the whole arena, y is a
// ground-relative offset that goes NEGATIVE while airborne (see FighterRuntime.y's own comment).
// The existing 2D renderer (FighterView.ts) does `sprite.y = GROUND_Y + f.y` -- GROUND_Y only
// belongs to that screen-space compositing, never to world space, so it must not appear here.
import { BASE_WIDTH } from '../sim/constants';

/** World units per sim pixel. Chosen so BASE_WIDTH spans a manageable orthographic frustum. */
export const WORLD_UNITS_PER_PX = 0.05;

export function simToWorldX(simX: number): number {
  return (simX - BASE_WIDTH / 2) * WORLD_UNITS_PER_PX;
}

/** simY is negative while airborne (see FighterRuntime.y) -- negate it so "up" maps to +worldY. */
export function simToWorldY(simY: number): number {
  return -simY * WORLD_UNITS_PER_PX;
}

export function simLengthToWorld(px: number): number {
  return px * WORLD_UNITS_PER_PX;
}
