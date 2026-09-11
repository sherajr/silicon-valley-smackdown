import type { Pose, RectStyle } from './FighterRig';
import {
  airStrikeArchetype,
  blockPose,
  buildFor,
  counterStanceArchetype,
  crouchPose,
  crouchStrikeArchetype,
  grabArchetype,
  heavyLungeArchetype,
  hitstunPose,
  hookArchetype,
  idleFrames,
  jabArchetype,
  jumpPose,
  kickArchetype,
  knockdownPose,
  koPose,
  lowSweepArchetype,
  superFinisherPose,
  superWindupPose,
  targetPointArchetype,
  throwArchetype,
  victoryPose,
  wakeupPose,
  walkFrames,
  withProp,
  type Build,
} from './poses';
import type { CharacterDef, MoveKind } from '../sim/types';

export interface CharacterFrameSet {
  idle: Pose[];
  walk: Pose[];
  jump: Pose[];
  crouch: Pose[];
  block: Pose[];
  hitstun: Pose[];
  knockdown: Pose[];
  wakeup: Pose[];
  victory: Pose[];
  ko: Pose[];
  moves: Record<MoveKind, Pose[]>;
}

function propAt(b: Build, w: number, h: number, color: string, yOffset = 0): RectStyle {
  return { x: b.torsoW / 2 - 2, y: b.shoulderY + b.armLen * 0.45 + yOffset, w, h, color };
}

function withSignatureProp(poses: Pose[], prop: RectStyle | null): Pose[] {
  return poses.map((p) => withProp(p, prop));
}

function withStandingProp(base: Pose, prop: RectStyle | null): Pose {
  return withProp(base, prop);
}

interface RigRecipe {
  signatureProp: (b: Build) => RectStyle | null;
  moves: (b: Build, sigProp: RectStyle | null) => Record<MoveKind, Pose[]>;
}

function buildFrameSet(def: CharacterDef, recipe: RigRecipe): CharacterFrameSet {
  const b = buildFor(def.width, def.height);
  const sigProp = recipe.signatureProp(b);
  return {
    idle: withSignatureProp(idleFrames(b), sigProp),
    walk: withSignatureProp(walkFrames(b), sigProp),
    jump: [jumpPose(b)],
    crouch: [withStandingProp(crouchPose(b), sigProp)],
    block: [blockPose(b)],
    hitstun: [hitstunPose(b)],
    knockdown: [knockdownPose(b)],
    wakeup: [wakeupPose(b)],
    victory: [victoryPose(b)],
    ko: [koPose(b)],
    moves: recipe.moves(b, sigProp),
  };
}

const IPAD: (b: Build) => RectStyle = (b) => propAt(b, 12, 16, '#dbe9f0');
const BRIEFCASE: (b: Build) => RectStyle = (b) => propAt(b, 14, 11, '#8a5a1f');
const BOTTLE: (b: Build) => RectStyle = (b) => propAt(b, 6, 14, '#4c7a3f');
const CLIPBOARD: (b: Build) => RectStyle = (b) => propAt(b, 10, 13, '#f2e6c8');
const TERM_SHEET: (b: Build) => RectStyle = (b) => propAt(b, 5, 15, '#e8e4d8');
const ROCKET: (b: Build) => RectStyle = (b) => propAt(b, 7, 16, '#c7ccd3');

export function hunterFrames(def: CharacterDef): CharacterFrameSet {
  return buildFrameSet(def, {
    signatureProp: IPAD,
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
