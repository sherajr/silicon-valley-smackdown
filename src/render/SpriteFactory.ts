import Phaser from 'phaser';
import { renderPose, RIG_CANVAS_W, RIG_CANVAS_H, RIG_ANCHOR_X, RIG_ANCHOR_Y, type Pose } from './FighterRig';
import { framesForCharacter } from './characterRigs';
import { detailPainterFor } from './characterDetails';
import type { CharacterDef, MoveKind } from '../sim/types';

export const RIG_ORIGIN_X = RIG_ANCHOR_X / RIG_CANVAS_W;
export const RIG_ORIGIN_Y = RIG_ANCHOR_Y / RIG_CANVAS_H;

export interface FighterVisualSet {
  idleAnim: string;
  walkAnim: string;
  victoryAnim: string;
  jumpFrames: string[];
  crouchFrames: string[];
  blockFrames: string[];
  hitstunFrames: string[];
  knockdownFrames: string[];
  wakeupFrames: string[];
  koFrames: string[];
  moveFrames: Record<MoveKind, string[]>;
  portraitFrame: string;
}

const registeredTextures = new Set<string>();
const builtCharacters = new Set<string>();
const cache = new Map<string, FighterVisualSet>();

function registerTexture(scene: Phaser.Scene, key: string, pose: Pose, def: CharacterDef): string {
  if (!registeredTextures.has(key)) {
    const canvas = renderPose(pose, def.visual, detailPainterFor(def.id));
    scene.textures.addCanvas(key, canvas);
    registeredTextures.add(key);
  }
  return key;
}

function registerAnim(scene: Phaser.Scene, key: string, textureKeys: string[], frameRate: number, repeat: number): string {
  if (!scene.anims.exists(key)) {
    scene.anims.create({ key, frames: textureKeys.map((k) => ({ key: k })), frameRate, repeat });
  }
  return key;
}

/** Generates every texture/animation for a character exactly once per Game instance, cached across scenes. */
export function buildFighterVisuals(scene: Phaser.Scene, def: CharacterDef): FighterVisualSet {
  const cacheKey = def.id;
  if (builtCharacters.has(cacheKey)) return cache.get(cacheKey)!;

  const set = framesForCharacter(def);
  const prefix = def.id;
  const reg = (name: string, poses: Pose[]): string[] => poses.map((p, i) => registerTexture(scene, `${prefix}_${name}_${i}`, p, def));

  const idleKeys = reg('idle', set.idle);
  const walkKeys = reg('walk', set.walk);
  const victoryKeys = reg('victory', set.victory);
  const portraitKeys = reg('portrait', set.portrait);

  const visuals: FighterVisualSet = {
    idleAnim: registerAnim(scene, `${prefix}_idle`, idleKeys, 5, -1),
    walkAnim: registerAnim(scene, `${prefix}_walk`, walkKeys, 11, -1),
    victoryAnim: registerAnim(scene, `${prefix}_victory`, victoryKeys, 3, -1),
    jumpFrames: reg('jump', set.jump),
    crouchFrames: reg('crouch', set.crouch),
    blockFrames: reg('block', set.block),
    hitstunFrames: reg('hitstun', set.hitstun),
    knockdownFrames: reg('knockdown', set.knockdown),
    wakeupFrames: reg('wakeup', set.wakeup),
    koFrames: reg('ko', set.ko),
    moveFrames: {} as Record<MoveKind, string[]>,
    portraitFrame: portraitKeys[0],
  };

  for (const kind of Object.keys(set.moves) as MoveKind[]) {
    visuals.moveFrames[kind] = reg(`move_${kind}`, set.moves[kind]);
  }

  builtCharacters.add(cacheKey);
  cache.set(cacheKey, visuals);
  return visuals;
}

/** Test/dev helper to reset the module-level texture cache (Phaser texture manager is per-Game, not per-test). */
export function resetVisualCache(): void {
  registeredTextures.clear();
  builtCharacters.clear();
  cache.clear();
}
