import { HITSTOP_HEAVY, HITSTOP_LIGHT, HITSTOP_SUPER } from '../sim/constants';
import type {
  AttackHeight,
  HitEffect,
  LocalBox,
  MoveDef,
  MoveHitWindow,
  MoveKind,
  ProjectileDef,
  TargetedStrikeDef,
  Vec2,
} from '../sim/types';

export interface EffectOpts {
  guardDamage?: number;
  stunFrames?: number;
  blockstunFrames?: number;
  knockback?: Vec2;
  launches?: boolean;
  forceKnockdown?: boolean;
  hitstopFrames?: number;
}

/** Builds a HitEffect with sensible defaults scaled off damage, per the tuning table. */
export function effect(damage: number, height: AttackHeight, opts: EffectOpts = {}): HitEffect {
  return {
    damage,
    height,
    guardDamage: opts.guardDamage ?? Math.round(damage * 1.3),
    stunFrames: opts.stunFrames ?? Math.round(9 + damage * 0.55),
    blockstunFrames: opts.blockstunFrames ?? Math.round(5 + damage * 0.3),
    knockback: opts.knockback ?? { x: 2.2 + damage * 0.18, y: 0 },
    launches: opts.launches,
    forceKnockdown: opts.forceKnockdown,
    hitstopFrames: opts.hitstopFrames ?? (damage >= 18 ? HITSTOP_HEAVY : damage >= 10 ? HITSTOP_LIGHT + 1 : HITSTOP_LIGHT),
  };
}

export function superHitstop(): number {
  return HITSTOP_SUPER;
}

export function box(x: number, y: number, w: number, h: number): LocalBox {
  return { x, y, w, h };
}

export interface HitWindowOpts {
  reHitInterval?: number;
}

export function window(startupFrame: number, activeFrames: number, hitbox: LocalBox, hitEffect: HitEffect, opts: HitWindowOpts = {}): MoveHitWindow {
  return { startupFrame, activeFrames, box: hitbox, effect: hitEffect, reHitInterval: opts.reHitInterval };
}

export interface MoveOpts {
  cooldown?: number;
  meterCost?: number;
  hits?: MoveHitWindow[];
  projectile?: ProjectileDef;
  isGrab?: boolean;
  isCounter?: boolean;
  counterWindow?: { start: number; end: number };
  counterEffect?: HitEffect;
  targetedStrike?: TargetedStrikeDef;
  chainsFrom?: MoveKind[];
  lunge?: { speed: number; frames: number };
}

/** Builds a MoveDef; totalFrames = startup + recovery, with hits placed inside that span by the caller. */
export function move(id: string, name: string, command: string, kind: MoveKind, height: AttackHeight, startup: number, recovery: number, opts: MoveOpts = {}): MoveDef {
  const hits = opts.hits ?? [];
  const lastActiveEnd = hits.reduce((max, h) => Math.max(max, h.startupFrame + h.activeFrames), startup);
  return {
    id,
    name,
    command,
    kind,
    height,
    startup,
    recovery,
    hits,
    cooldown: opts.cooldown ?? 0,
    meterCost: opts.meterCost ?? 0,
    projectile: opts.projectile,
    isGrab: opts.isGrab,
    isCounter: opts.isCounter,
    counterWindow: opts.counterWindow,
    counterEffect: opts.counterEffect,
    chainsFrom: opts.chainsFrom,
    targetedStrike: opts.targetedStrike,
    lunge: opts.lunge,
    totalFrames: Math.max(lastActiveEnd, startup) + recovery,
  };
}

export function projectile(opts: {
  motion: ProjectileDef['motion'];
  speed: number;
  gravity?: number;
  vy0?: number;
  life: number;
  spawnOffset: Vec2;
  box: LocalBox;
  effect: HitEffect;
  maxActiveInstances?: number;
  telegraphFrames?: number;
  releaseFrame?: number;
}): ProjectileDef {
  return {
    motion: opts.motion,
    speed: opts.speed,
    gravity: opts.gravity,
    vy0: opts.vy0,
    life: opts.life,
    spawnOffset: opts.spawnOffset,
    box: opts.box,
    effect: opts.effect,
    maxActiveInstances: opts.maxActiveInstances ?? 1,
    telegraphFrames: opts.telegraphFrames,
    releaseFrame: opts.releaseFrame,
  };
}

export function targetedStrike(opts: {
  delayFrames: number;
  activeFrames: number;
  offset: Vec2;
  box: LocalBox;
  effect: HitEffect;
  markerRadius: number;
}): TargetedStrikeDef {
  return opts;
}
