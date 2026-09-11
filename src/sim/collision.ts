import type { Facing, LocalBox } from './types';

export interface WorldBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Converts a fighter-local box (x grows toward facing, y measured from ground
 * anchor with negative = up) into world-space AABB coordinates.
 */
export function localBoxToWorld(box: LocalBox, originX: number, originY: number, facing: Facing): WorldBox {
  const x0 = facing === 1 ? originX + box.x : originX - box.x - box.w;
  const y0 = originY + box.y;
  return { left: x0, right: x0 + box.w, top: y0, bottom: y0 + box.h };
}

export function boxesOverlap(a: WorldBox, b: WorldBox): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export function pushboxOverlap(
  ax: number, aw: number,
  bx: number, bw: number,
): number {
  // returns overlap amount (0 if none) along X only, used for grounded separation
  const aLeft = ax - aw / 2;
  const aRight = ax + aw / 2;
  const bLeft = bx - bw / 2;
  const bRight = bx + bw / 2;
  const overlap = Math.min(aRight, bRight) - Math.max(aLeft, bLeft);
  return overlap > 0 ? overlap : 0;
}
