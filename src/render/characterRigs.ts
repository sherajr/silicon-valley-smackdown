import type { Pose, RectStyle } from './FighterRig';
import {
  airStrikeArchetype,
  blockFrames,
  buildFor,
  counterStanceArchetype,
  crouchFrames,
  crouchStrikeArchetype,
  dashFrames,
  grabArchetype,
  heavyLungeArchetype,
  hitstunFrames,
  hookArchetype,
  idleFrames,
  jabArchetype,
  jumpFrames,
  kickArchetype,
  knockdownFrames,
  koPose,
  lowSweepArchetype,
  portraitPose,
  superFinisherPose,
  superWindupPose,
  targetPointArchetype,
  throwArchetype,
  victoryPose,
  wakeupFrames,
  walkFrames,
  withHairStyle,
  withProp,
  type Build,
  type HairStyle,
} from './poses';
import type { CharacterDef, MoveKind } from '../sim/types';

export interface CharacterFrameSet {
  idle: Pose[];
  walk: Pose[];
  dash: Pose[];
  jump: Pose[];
  crouch: Pose[];
  block: Pose[];
  hitstun: Pose[];
  knockdown: Pose[];
  wakeup: Pose[];
  victory: Pose[];
  ko: Pose[];
  portrait: Pose[];
  moves: Record<MoveKind, Pose[]>;
}

function propAt(b: Build, w: number, h: number, color: string, yOffset = 0): RectStyle {
  return { x: b.torsoW / 2 - 2, y: b.shoulderY + b.armLen * 0.45 + yOffset, w, h, color };
}

function withStandingProp(base: Pose, prop: RectStyle | null): Pose {
  return withProp(base, prop);
}

interface RigRecipe {
  /** The item this fighter's attacks throw/swing -- attached only to the specific moves that use it, never to idle/walk, so it doesn't float beside the same hand through every unrelated action. */
  signatureProp: (b: Build) => RectStyle | null;
  hairStyle: HairStyle;
  moves: (b: Build, sigProp: RectStyle | null) => Record<MoveKind, Pose[]>;
  /** Optional distinct prop presented on the selection portrait (e.g. Hunter's laptop, separate from his thrown iPad). */
  portraitProp?: (b: Build) => RectStyle | null;
  /** Optional distinct prop shown on the victory pose. */
  victoryProp?: (b: Build) => RectStyle | null;
}

function buildFrameSet(def: CharacterDef, recipe: RigRecipe): CharacterFrameSet {
  const b = buildFor(def.width, def.height);
  const sigProp = recipe.signatureProp(b);
  const hair = (poses: Pose[]) => poses.map((p) => withHairStyle(p, recipe.hairStyle));
  const moves = recipe.moves(b, sigProp);
  for (const kind of Object.keys(moves) as MoveKind[]) moves[kind] = hair(moves[kind]);
  return {
    // Idle/walk/crouch never carry the attack prop -- it appears, is held, and is released only
    // by the specific moves that throw or swing it (see `moves` below).
    idle: hair(idleFrames(b)),
    walk: hair(walkFrames(b)),
    dash: hair(dashFrames(b)),
    jump: hair(jumpFrames(b)),
    crouch: hair(crouchFrames(b)),
    block: hair(blockFrames(b)),
    hitstun: hair(hitstunFrames(b)),
    knockdown: hair(knockdownFrames(b)),
    wakeup: hair(wakeupFrames(b)),
    victory: hair([withStandingProp(victoryPose(b), recipe.victoryProp ? recipe.victoryProp(b) : null)]),
    ko: hair([koPose(b)]),
    portrait: hair([withStandingProp(portraitPose(b), recipe.portraitProp ? recipe.portraitProp(b) : null)]),
    moves,
  };
}

const IPAD: (b: Build) => RectStyle = (b) => propAt(b, 12, 16, '#dbe9f0');
const BRIEFCASE: (b: Build) => RectStyle = (b) => propAt(b, 14, 11, '#8a5a1f');
const BOTTLE: (b: Build) => RectStyle = (b) => propAt(b, 6, 14, '#4c7a3f');
const CLIPBOARD: (b: Build) => RectStyle = (b) => propAt(b, 10, 13, '#f2e6c8');
const TERM_SHEET: (b: Build) => RectStyle = (b) => propAt(b, 5, 15, '#e8e4d8');
const ROCKET: (b: Build) => RectStyle = (b) => propAt(b, 7, 16, '#c7ccd3');
/** Hunter's signature presentation prop: a silver laptop with a bright cyan screen glow, distinct from his thrown iPad. */
const LAPTOP: (b: Build) => RectStyle = (b) => ({ ...propAt(b, 16, 11, '#c7d0d8'), glowColor: '#8fe9ff' });

export function hunterFrames(def: CharacterDef): CharacterFrameSet {
  return buildFrameSet(def, {
    signatureProp: IPAD,
    hairStyle: 'short',
    portraitProp: LAPTOP,
    victoryProp: LAPTOP,
    moves: (b, prop) => ({
      basic1: jabArchetype(b, null),
      basic2: hookArchetype(b, null),
      basic3: kickArchetype(b, 'high'),
      crouchBasic: crouchStrikeArchetype(b, null),
      jumpBasic: airStrikeArchetype(b, null),
      forwardBasic: heavyLungeArchetype(b, null),
      special: throwArchetype(b, prop),
      downSpecial: heavyLungeArchetype(b, null),
      grab: grabArchetype(b),
      super: [superWindupPose(b), ...throwArchetype(b, prop), superFinisherPose(b, prop)],
    }),
  });
}

export function kevinFrames(def: CharacterDef): CharacterFrameSet {
  return buildFrameSet(def, {
    signatureProp: BRIEFCASE,
    hairStyle: 'slick',
    moves: (b, prop) => ({
      basic1: jabArchetype(b, null),
      basic2: hookArchetype(b, null),
      basic3: heavyLungeArchetype(b, prop),
      crouchBasic: crouchStrikeArchetype(b, null),
      jumpBasic: airStrikeArchetype(b, prop),
      forwardBasic: heavyLungeArchetype(b, prop),
      special: throwArchetype(b, prop),
      downSpecial: counterStanceArchetype(b, prop),
      grab: grabArchetype(b),
      super: [superWindupPose(b), ...jabArchetype(b, prop), superFinisherPose(b, prop)],
    }),
  });
}

export function alFrames(def: CharacterDef): CharacterFrameSet {
  return buildFrameSet(def, {
    signatureProp: BOTTLE,
    hairStyle: 'messy',
    moves: (b, prop) => ({
      basic1: jabArchetype(b, null),
      basic2: hookArchetype(b, null),
      basic3: hookArchetype(b, null),
      crouchBasic: crouchStrikeArchetype(b, null),
      jumpBasic: airStrikeArchetype(b, null),
      forwardBasic: heavyLungeArchetype(b, null),
      special: throwArchetype(b, prop),
      downSpecial: lowSweepArchetype(b),
      grab: grabArchetype(b),
      super: [superWindupPose(b), ...hookArchetype(b, null), superFinisherPose(b, null)],
    }),
  });
}

export function priyaFrames(def: CharacterDef): CharacterFrameSet {
  return buildFrameSet(def, {
    signatureProp: CLIPBOARD,
    hairStyle: 'ponytail',
    moves: (b, prop) => ({
      basic1: jabArchetype(b, null),
      basic2: jabArchetype(b, prop),
      basic3: kickArchetype(b, 'mid'),
      crouchBasic: crouchStrikeArchetype(b, null),
      jumpBasic: airStrikeArchetype(b, null),
      forwardBasic: heavyLungeArchetype(b, prop),
      special: throwArchetype(b, prop),
      downSpecial: throwArchetype(b, prop),
      grab: grabArchetype(b),
      super: [superWindupPose(b), ...jabArchetype(b, null), superFinisherPose(b, prop)],
    }),
  });
}

export function chadFrames(def: CharacterDef): CharacterFrameSet {
  return buildFrameSet(def, {
    signatureProp: TERM_SHEET,
    hairStyle: 'swept',
    moves: (b, prop) => ({
      basic1: jabArchetype(b, null),
      basic2: hookArchetype(b, prop),
      basic3: kickArchetype(b, 'mid'),
      crouchBasic: crouchStrikeArchetype(b, null),
      jumpBasic: airStrikeArchetype(b, prop),
      forwardBasic: heavyLungeArchetype(b, prop),
      special: throwArchetype(b, prop),
      downSpecial: targetPointArchetype(b, prop),
      grab: grabArchetype(b),
      super: [superWindupPose(b), ...targetPointArchetype(b, prop), superFinisherPose(b, prop)],
    }),
  });
}

export function elonFrames(def: CharacterDef): CharacterFrameSet {
  return buildFrameSet(def, {
    signatureProp: () => null,
    hairStyle: 'founder',
    moves: (b) => ({
      basic1: jabArchetype(b, null),
      basic2: hookArchetype(b, null),
      basic3: kickArchetype(b, 'high'),
      crouchBasic: crouchStrikeArchetype(b, null),
      jumpBasic: airStrikeArchetype(b, null),
      forwardBasic: heavyLungeArchetype(b, null),
      special: throwArchetype(b, ROCKET(b)),
      downSpecial: targetPointArchetype(b, null),
      grab: grabArchetype(b),
      super: [superWindupPose(b), ...targetPointArchetype(b, ROCKET(b)), superFinisherPose(b, null)],
    }),
  });
}

export function framesForCharacter(def: CharacterDef): CharacterFrameSet {
  switch (def.id) {
    case 'hunter':
      return hunterFrames(def);
    case 'kevin':
      return kevinFrames(def);
    case 'al':
      return alFrames(def);
    case 'priya':
      return priyaFrames(def);
    case 'chad':
      return chadFrames(def);
    case 'elon':
      return elonFrames(def);
  }
}
