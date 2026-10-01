import type { Platform } from './data';

/**
 * Pure platform geometry shared by the stage builder, the renderer's contact shadows and the tests. Collision reads
 * `STAGE_PLATFORMS`; this module only decides how that same record becomes visible geometry, so the picture and the
 * physics cannot drift apart. Nothing here knows about WebGL.
 */
/** Scenery depth (z) of each kind of platform. Collision is 2D, so this is purely visual. */
export const MAIN_DEPTH = 6.8;
export const UPPER_DEPTH = 2.4;

export interface SlabSpec {
  /** Centre of the slab's box. */
  cx: number; cy: number; cz: number;
  /** Box size. */
  w: number; h: number; d: number;
  /** World height of the single exposed walkable face, and of the underside. */
  top: number; bottom: number;
}

/** The one slab that is a platform's visible body: top at `p.y`, bottom at `p.y - thickness`, width `p.w`. */
export function slabSpec(p: Platform): SlabSpec {
  const d = p.solid ? MAIN_DEPTH : UPPER_DEPTH;
  return { cx: p.x, cy: p.y - p.thickness / 2, cz: 0, w: p.w, h: p.thickness, d, top: p.y, bottom: p.y - p.thickness };
}

/**
 * The highest platform top at or below a point, among platforms whose span overlaps a footprint of half-width
 * `radius` around `x`. Used to place a fighter's contact shadow on the surface they are actually above.
 */
export function floorBelow(platforms: readonly Platform[], x: number, y: number, radius = 0.5): Platform | null {
  let best: Platform | null = null;
  for (const p of platforms) {
    if (p.y > y + 0.05) continue;
    const l = Math.max(x - radius, p.x - p.w / 2), r = Math.min(x + radius, p.x + p.w / 2);
    if (r - l < 0.12) continue;
    if (!best || p.y > best.y) best = p;
  }
  return best;
}

/**
 * Where a round contact shadow of half-width `radius` at `x` is allowed to sit on a platform: the part of its
 * footprint that overlaps the platform's span. A fighter at the edge gets a shadow cropped to the surface, never a
 * dark disc hanging in the air.
 */
export function shadowSpan(x: number, radius: number, p: Pick<Platform, 'x' | 'w'>): { cx: number; half: number } | null {
  const l = Math.max(x - radius, p.x - p.w / 2), r = Math.min(x + radius, p.x + p.w / 2);
  return r - l < 0.12 ? null : { cx: (l + r) / 2, half: (r - l) / 2 };
}
