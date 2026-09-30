/**
 * Stage collision for the 2D gameplay plane. Pure functions over plain numbers: no browser or Three.js imports.
 *
 * A fighter is an axis-aligned hull: centred on x, `HULL_HW` either side, from the feet (y) up `height`.
 * Solid platforms are blocks that stop the hull on top, sides and underside. One-way platforms only catch
 * a hull that is falling onto them from above. Movement is swept (earliest contact wins), so fast launches
 * cannot tunnel through thin geometry, and a contact on one axis never cancels motion on the other.
 */
import type { Platform } from './data';

/** Half-width of the environmental hull. Matches the landing tolerance: a fighter is supported while their
 * centre is within this distance past a platform edge. */
export const HULL_HW = 0.1;
/** A fighter this far below a one-way top, and falling, still lands on it (absorbs float noise). */
const ONEWAY_LEEWAY = 0.04;
const EPS = 1e-6;
/** Sub-step cap: no sweep segment longer than this, however hard the launch. */
export const MAX_SPEED = 1.4;

export interface Rect { id: string; x0: number; x1: number; y0: number; y1: number }
export interface Ledge { platform: string; side: -1 | 1; x: number; y: number }
export interface Stage { platforms: Platform[]; solids: Rect[]; oneway: Platform[]; ledges: Ledge[] }

/** Derives collision geometry from platform data. Call again after the data changes: nothing is cached elsewhere. */
export function buildStage(platforms: Platform[]): Stage {
  const solids: Rect[] = [], ledges: Ledge[] = [];
  for (const p of platforms) {
    if (!p.solid) continue;
    solids.push({ id: p.id, x0: p.x - p.w / 2, x1: p.x + p.w / 2, y0: p.y - p.thickness, y1: p.y });
    if (p.ledges) { ledges.push({ platform: p.id, side: -1, x: p.x - p.w / 2, y: p.y }, { platform: p.id, side: 1, x: p.x + p.w / 2, y: p.y }); }
  }
  return { platforms, solids, oneway: platforms.filter(p => !p.solid), ledges };
}

export interface Body { x: number; y: number; vx: number; vy: number; height: number }
export interface MoveResult {
  x: number; y: number; vx: number; vy: number;
  /** Feet rest on a surface this tick. */
  grounded: boolean;
  /** Id of the platform underfoot, if grounded. */
  support: string | null;
  /** Became supported this tick after being airborne at the start of it. */
  landed: boolean;
  /** Head struck a solid underside. */
  bonk: boolean;
  /** Stopped by the side of a solid: -1 left wall contact, 1 right wall contact, 0 none. */
  wall: -1 | 0 | 1;
}

const overlaps = (x: number, y: number, h: number, r: Rect) =>
  x + HULL_HW > r.x0 + EPS && x - HULL_HW < r.x1 - EPS && y + h > r.y0 + EPS && y < r.y1 - EPS;

/**
 * Pushes a hull out of any solid it overlaps. Normally overlaps are microscopic; a large one means an impossible
 * state (spawned inside the stage). The exit is chosen against the fighter's motion so nobody is lifted through a
 * roof they were moving into from below: "came from below" resolves downward.
 */
export function depenetrate(stage: Stage, x: number, y: number, vx: number, vy: number, h: number): { x: number; y: number } {
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const r of stage.solids) {
      if (!overlaps(x, y, h, r)) continue;
      const exits = [
        { dx: 0, dy: r.y1 - y, cost: r.y1 - y, along: vy > 0 },                                  // up
        { dx: 0, dy: -(y + h - r.y0), cost: y + h - r.y0, along: vy < 0 },                        // down
        { dx: r.x1 - (x - HULL_HW), dy: 0, cost: r.x1 - (x - HULL_HW), along: vx > 0 },           // right
        { dx: -(x + HULL_HW - r.x0), dy: 0, cost: x + HULL_HW - r.x0, along: vx < 0 },            // left
      ];
      // Leaving in the direction of travel would carry the fighter through the solid: penalise it heavily.
      let best = exits[0], bestScore = Infinity;
      for (const e of exits) { const score = e.cost + (e.along ? 1000 : 0); if (score < bestScore) { best = e; bestScore = score; } }
      x += best.dx; y += best.dy; moved = true;
    }
    if (!moved) break;
  }
  return { x, y };
}

export interface MoveOptions {
  /** Id of a one-way platform to ignore (an intentional drop-through). */
  dropThrough?: string | null;
  /** Hold position instead of falling: used by fighters pinned to a surface (rolls, holds). */
  groundLock?: boolean;
}

/** Moves a hull by its velocity with swept collision. Returns the new position, velocity and contact flags. */
export function moveBody(stage: Stage, b: Body, opts: MoveOptions = {}): MoveResult {
  const wasGrounded = supportOf(stage, b.x, b.y, opts.dropThrough) !== null && b.vy <= 0;
  const h = b.height;
  const fixed = depenetrate(stage, b.x, b.y, b.vx, b.vy, h);
  let x = fixed.x, y = fixed.y, vx = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, b.vx)), vy = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, b.vy));
  let dx = vx, dy = vy, bonk = false, wall: -1 | 0 | 1 = 0, landedOn: string | null = null;

  for (let iteration = 0; iteration < 4 && (Math.abs(dx) > EPS || Math.abs(dy) > EPS); iteration++) {
    let t = 1, nx = 0, ny = 0, hitId: string | null = null, oneWay = false;
    for (const r of stage.solids) {
      const hit = sweepRect(x, y, h, dx, dy, r);
      if (hit && hit.t < t) { t = hit.t; nx = hit.nx; ny = hit.ny; hitId = r.id; oneWay = false; }
    }
    if (dy < 0) for (const p of stage.oneway) {
      if (p.id === opts.dropThrough) continue;
      const top = p.y, bottom = y;
      if (bottom < top - ONEWAY_LEEWAY || bottom + dy > top + EPS) continue;     // started below, or never reaches the top
      const tt = Math.max(0, (top - bottom) / dy);
      if (tt >= t) continue;
      const cx = x + dx * tt;
      if (cx + HULL_HW > p.x - p.w / 2 + EPS && cx - HULL_HW < p.x + p.w / 2 - EPS) { t = tt; nx = 0; ny = 1; hitId = p.id; oneWay = true; }
    }
    x += dx * t; y += dy * t;
    if (hitId === null) break;
    if (oneWay) y = stage.oneway.find(p => p.id === hitId)!.y;          // land exactly on the surface
    else if (ny > 0) y = stage.solids.find(r => r.id === hitId)!.y1;
    if (ny > 0) { landedOn = hitId; vy = 0; } else if (ny < 0) { bonk = true; vy = 0; }
    if (nx !== 0) { wall = nx > 0 ? -1 : 1; vx = 0; }
    const rest = 1 - t;
    dx = nx !== 0 ? 0 : dx * rest; dy = ny !== 0 ? 0 : dy * rest;
    if (t >= 1) break;
  }

  // A resting fighter with no downward motion this tick is still supported: look directly under the feet.
  const support = landedOn ?? (vy <= 0 ? supportOf(stage, x, y, opts.dropThrough) : null);
  const grounded = support !== null;
  return { x, y, vx, vy, grounded, support, landed: grounded && !wasGrounded, bonk, wall };
}

/** Earliest contact of a moving hull with one rect. Returns the time fraction and surface normal of the hull. */
function sweepRect(x: number, y: number, h: number, dx: number, dy: number, r: Rect): { t: number; nx: number; ny: number } | null {
  const bx0 = x - HULL_HW, bx1 = x + HULL_HW, by0 = y, by1 = y + h;
  // Distance to close before overlapping, and before fully passing, on each axis.
  let xEnter: number, xExit: number, yEnter: number, yExit: number;
  if (dx > 0) { xEnter = (r.x0 - bx1) / dx; xExit = (r.x1 - bx0) / dx; }
  else if (dx < 0) { xEnter = (r.x1 - bx0) / dx; xExit = (r.x0 - bx1) / dx; }
  else if (bx1 > r.x0 + EPS && bx0 < r.x1 - EPS) { xEnter = -Infinity; xExit = Infinity; } else return null;
  if (dy > 0) { yEnter = (r.y0 - by1) / dy; yExit = (r.y1 - by0) / dy; }
  else if (dy < 0) { yEnter = (r.y1 - by0) / dy; yExit = (r.y0 - by1) / dy; }
  else if (by1 > r.y0 + EPS && by0 < r.y1 - EPS) { yEnter = -Infinity; yExit = Infinity; } else return null;
  const enter = Math.max(xEnter, yEnter), exit = Math.min(xExit, yExit);
  if (enter >= exit || enter >= 1 || exit <= 0) return null;
  // Already overlapping along the path (depenetration should have prevented this): treat as no hit.
  if (enter < -EPS && xEnter > -Infinity && yEnter > -Infinity) return null;
  const t = Math.max(0, enter);
  if (xEnter > yEnter) return { t, nx: dx > 0 ? -1 : 1, ny: 0 };
  return { t, nx: 0, ny: dy > 0 ? -1 : 1 };
}

/** Platform whose top the feet rest on (within tolerance), or null. */
export function supportOf(stage: Stage, x: number, y: number, dropThrough?: string | null): string | null {
  let best: string | null = null, bestY = -Infinity;
  for (const r of stage.solids) if (Math.abs(y - r.y1) < 1e-4 && x + HULL_HW > r.x0 + EPS && x - HULL_HW < r.x1 - EPS && r.y1 > bestY) { best = r.id; bestY = r.y1; }
  for (const p of stage.oneway) {
    if (p.id === dropThrough) continue;
    if (Math.abs(y - p.y) < 1e-4 && x + HULL_HW > p.x - p.w / 2 + EPS && x - HULL_HW < p.x + p.w / 2 - EPS && p.y > bestY) { best = p.id; bestY = p.y; }
  }
  return best;
}

/** Horizontal extent a fighter may stand on for the given platform id, or null. */
export function supportSpan(stage: Stage, id: string | null): { x0: number; x1: number } | null {
  const p = stage.platforms.find(q => q.id === id);
  return p ? { x0: p.x - p.w / 2, x1: p.x + p.w / 2 } : null;
}

/** Highest surface directly below a point (for shadows and spawn checks). */
export function floorBelow(stage: Stage, x: number, y: number): number | null {
  let floor: number | null = null;
  for (const p of stage.platforms) if (Math.abs(x - p.x) < p.w / 2 && p.y <= y + 0.05 && (floor === null || p.y > floor)) floor = p.y;
  return floor;
}

export interface SegmentHit { t: number; nx: number; ny: number; x: number; y: number }

/**
 * Sweeps a box of half-extents (rx, ry) centred on a point moving from (x0, y0) to (x1, y1) against a rectangle.
 * Returns the first contact (time fraction, surface normal, contact point) or null. A start that already overlaps
 * reports t = 0, so a shot spawned inside a hurtbox still connects.
 */
export function segmentHitsRect(r: { x0: number; x1: number; y0: number; y1: number }, x0: number, y0: number, x1: number, y1: number, rx: number, ry: number): SegmentHit | null {
  const ex0 = r.x0 - rx, ex1 = r.x1 + rx, ey0 = r.y0 - ry, ey1 = r.y1 + ry;
  const dx = x1 - x0, dy = y1 - y0;
  let xEnter: number, xExit: number, yEnter: number, yExit: number;
  if (dx > 0) { xEnter = (ex0 - x0) / dx; xExit = (ex1 - x0) / dx; } else if (dx < 0) { xEnter = (ex1 - x0) / dx; xExit = (ex0 - x0) / dx; }
  else if (x0 > ex0 && x0 < ex1) { xEnter = -Infinity; xExit = Infinity; } else return null;
  if (dy > 0) { yEnter = (ey0 - y0) / dy; yExit = (ey1 - y0) / dy; } else if (dy < 0) { yEnter = (ey1 - y0) / dy; yExit = (ey0 - y0) / dy; }
  else if (y0 > ey0 && y0 < ey1) { yEnter = -Infinity; yExit = Infinity; } else return null;
  const enter = Math.max(xEnter, yEnter), exit = Math.min(xExit, yExit);
  // A segment that only touches the boundary on its way out (like a shot that just bounced) is not a hit.
  if (enter >= exit || enter > 1 || exit <= 1e-9) return null;
  const t = Math.max(0, enter);
  const horizontal = xEnter > yEnter;
  return { t, nx: horizontal ? (dx > 0 ? -1 : 1) : 0, ny: horizontal ? 0 : (dy > 0 ? -1 : 1), x: x0 + dx * t, y: y0 + dy * t };
}

/** First solid a projectile segment crosses, or null. Upper (one-way) platforms never stop a projectile. */
export function segmentHitsSolid(stage: Stage, x0: number, y0: number, x1: number, y1: number, rx: number, ry: number): SegmentHit | null {
  let best: SegmentHit | null = null;
  for (const r of stage.solids) { const hit = segmentHitsRect(r, x0, y0, x1, y1, rx, ry); if (hit && (!best || hit.t < best.t)) best = hit; }
  return best;
}
