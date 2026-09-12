import Phaser from 'phaser';
import { framesForCharacter } from './characterRigs';
import { detailPainterFor } from './characterDetails';
import { renderPose, RIG_CANVAS_W, RIG_CANVAS_H, RIG_ANCHOR_X, RIG_ANCHOR_Y, type Pose } from './FighterRig';
import { type CharacterDef, type FighterId, type MoveKind } from '../sim/types';

export const SPRITE_CELL_W = RIG_CANVAS_W;
export const SPRITE_CELL_H = RIG_CANVAS_H;
/** Feet sit near the bottom of each cell so GROUND_Y placement matches the sim. */
export const RIG_ORIGIN_X = RIG_ANCHOR_X / RIG_CANVAS_W;
export const RIG_ORIGIN_Y = RIG_ANCHOR_Y / RIG_CANVAS_H;

export interface FighterVisualSet {
  idleAnim: string;
  walkAnim: string;
  victoryAnim: string;
  idleSheet: string;
  walkSheet: string;
  attackSheet: string;
  poseSheet: string;
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

const MOVE_KINDS: MoveKind[] = [
  'basic1',
  'basic2',
  'basic3',
  'crouchBasic',
  'jumpBasic',
  'forwardBasic',
  'special',
  'downSpecial',
  'grab',
  'super',
];

const builtCharacters = new Set<string>();
const cache = new Map<string, FighterVisualSet>();

function sheetKey(id: FighterId, action: string): string {
  return `${id}_${action}_sheet`;
}

function frameKey(sheet: string, frame: number): string {
  return `${sheet}#${frame}`;
}

export function preloadGameArt(scene: Phaser.Scene): void {
  const base = import.meta.env.BASE_URL;
  scene.load.spritesheet('fx_projectiles', `${base}sprites/fx/projectiles.png`, { frameWidth: 48, frameHeight: 48 });
  scene.load.spritesheet('fx_impact', `${base}sprites/fx/impact.png`, { frameWidth: 48, frameHeight: 48 });
}

/** Build authored pixel rigs using each fighter's arcade outfit. */
export function buildFighterVisuals(scene: Phaser.Scene, def: CharacterDef): FighterVisualSet {
  if (builtCharacters.has(def.id) && scene.textures.exists(cache.get(def.id)!.idleSheet)) return cache.get(def.id)!;
  const poses = framesForCharacter(def);
  function sheet(action: string, frames: Pose[]): string[] {
    const key = sheetKey(def.id, action);
    if (!scene.textures.exists(key)) {
      const atlas = document.createElement('canvas');
      atlas.width = RIG_CANVAS_W * frames.length;
      atlas.height = RIG_CANVAS_H;
      const ctx = atlas.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      frames.forEach((pose, i) => ctx.drawImage(renderPose(pose, def.visual, detailPainterFor(def.id)), i * RIG_CANVAS_W, 0));
      const texture = scene.textures.addCanvas(key, atlas)!;
      frames.forEach((_pose, i) => texture.add(i, 0, i * RIG_CANVAS_W, 0, RIG_CANVAS_W, RIG_CANVAS_H));
    }
    return frames.map((_pose, i) => frameKey(key, i));
  }
  function anim(action: string, frames: string[], frameRate: number): string {
    const key = def.id + '_' + action;
    if (!scene.anims.exists(key)) scene.anims.create({
      key, frames: frames.map(token => { const f = parseFrameKey(token); return { key: f.texture, frame: f.frame }; }),
      frameRate, repeat: -1,
    });
    return key;
  }
  const idle = sheet('idle', poses.idle);
  const walk = sheet('walk', poses.walk);
  const victory = sheet('victory', poses.victory);
  const moveFrames = {} as Record<MoveKind, string[]>;
  for (const kind of MOVE_KINDS) moveFrames[kind] = sheet(kind, poses.moves[kind]);
  const visuals: FighterVisualSet = {
    idleAnim: anim('idle', idle, 5), walkAnim: anim('walk', walk, 11),
    victoryAnim: anim('victory', victory, 4),
    idleSheet: sheetKey(def.id, 'idle'), walkSheet: sheetKey(def.id, 'walk'),
    attackSheet: sheetKey(def.id, 'basic1'), poseSheet: sheetKey(def.id, 'jump'),
    jumpFrames: sheet('jump', poses.jump), crouchFrames: sheet('crouch', poses.crouch),
    blockFrames: sheet('block', poses.block), hitstunFrames: sheet('hitstun', poses.hitstun),
    knockdownFrames: sheet('knockdown', poses.knockdown), wakeupFrames: sheet('wakeup', poses.wakeup),
    koFrames: sheet('ko', poses.ko), portraitFrame: sheet('portrait', poses.portrait)[0], moveFrames,
  };
  builtCharacters.add(def.id);
  cache.set(def.id, visuals);
  return visuals;
}

export function parseFrameKey(token: string): { texture: string; frame: number } {
  const hash = token.lastIndexOf('#');
  if (hash === -1) return { texture: token, frame: 0 };
  return { texture: token.slice(0, hash), frame: Number(token.slice(hash + 1)) || 0 };
}

export function resetVisualCache(): void {
  builtCharacters.clear();
  cache.clear();
}
