import type { Facing, HitEffect, LocalBox, ProjectileDef } from './types';

export interface ProjectileInstance {
  id: number;
  ownerSlot: 'p1' | 'p2';
  moveId: string;
  def: ProjectileDef;
  x: number;
  y: number;
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
  return {
    id: nextProjectileId++,
    ownerSlot,
    moveId,
    def,
    x: originX + def.spawnOffset.x * facing,
    y: originY + def.spawnOffset.y,
    vy: def.vy0 ?? 0,
    facing,
    age: 0,
    hasHit: false,
  };
}

export function stepProjectile(p: ProjectileInstance): void {
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

export function projectileWorldBox(p: ProjectileInstance): { left: number; right: number; top: number; bottom: number } {
  const box: LocalBox = p.def.box;
  const x0 = p.facing === 1 ? p.x + box.x : p.x - box.x - box.w;
  const y0 = p.y + box.y;
  return { left: x0, right: x0 + box.w, top: y0, bottom: y0 + box.h };
}

export function isProjectileArmed(p: ProjectileInstance): boolean {
  return p.age >= (p.def.telegraphFrames ?? 0);
}

export function effectiveEffect(p: ProjectileInstance): HitEffect {
  return p.def.effect;
}
