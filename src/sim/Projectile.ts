import type { Facing, HitEffect, LocalBox, ProjectileDef } from './types';

export interface ProjectileInstance {
  id: number;
  ownerSlot: 'p1' | 'p2';
  moveId: string;
  def: ProjectileDef;
  x: number;
  y: number;
  /** Position one frame ago, used to build a swept collision box so a fast projectile can't tunnel through a hurtbox between frames. */
  prevX: number;
  prevY: number;
  vy: number;
  facing: Facing;
  age: number;
  hasHit: boolean;
}

let nextProjectileId = 1;

export function spawnProjectile(
  ownerSlot: 'p1' | 'p2',
  moveId: string,
  def: ProjectileDef,
  originX: number,
  originY: number,
  facing: Facing,
): ProjectileInstance {
  const x = originX + def.spawnOffset.x * facing;
  const y = originY + def.spawnOffset.y;
  return {
    id: nextProjectileId++,
    ownerSlot,
    moveId,
    def,
    x,
    y,
    prevX: x,
    prevY: y,
    vy: def.vy0 ?? 0,
    facing,
    age: 0,
    hasHit: false,
  };
}

export function stepProjectile(p: ProjectileInstance): void {
  p.prevX = p.x;
  p.prevY = p.y;
  p.age++;
  if (p.def.motion === 'ground' || p.def.motion === 'linear') {
    p.x += p.def.speed * p.facing;
  } else if (p.def.motion === 'arc') {
    p.x += p.def.speed * p.facing;
    p.vy += p.def.gravity ?? 0;
    p.y += p.vy;
    if (p.y > 0) {
      p.y = 0;
      p.vy = 0;
    }
  }
}

function worldBoxAt(p: ProjectileInstance, x: number, y: number): { left: number; right: number; top: number; bottom: number } {
  const box: LocalBox = p.def.box;
  const x0 = p.facing === 1 ? x + box.x : x - box.x - box.w;
  const y0 = y + box.y;
  return { left: x0, right: x0 + box.w, top: y0, bottom: y0 + box.h };
}

export function projectileWorldBox(p: ProjectileInstance): { left: number; right: number; top: number; bottom: number } {
  return worldBoxAt(p, p.x, p.y);
}

/**
 * Union of this frame's and the previous frame's world box, so a hurtbox that
 * only overlapped the projectile's flight path *between* two sampled positions
 * (because the projectile is fast relative to the hurtbox width) still registers
 * a hit instead of tunnelling through for one frame.
 */
export function projectileSweptWorldBox(p: ProjectileInstance): { left: number; right: number; top: number; bottom: number } {
  const cur = worldBoxAt(p, p.x, p.y);
  const prev = worldBoxAt(p, p.prevX, p.prevY);
  return {
    left: Math.min(cur.left, prev.left),
    right: Math.max(cur.right, prev.right),
    top: Math.min(cur.top, prev.top),
    bottom: Math.max(cur.bottom, prev.bottom),
  };
}

export function isProjectileArmed(p: ProjectileInstance): boolean {
  return p.age >= (p.def.telegraphFrames ?? 0);
}

export function effectiveEffect(p: ProjectileInstance): HitEffect {
  return p.def.effect;
}
