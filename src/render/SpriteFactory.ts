import Phaser from 'phaser';
import { ALL_FIGHTER_IDS, ALL_STAGE_IDS, type CharacterDef, type FighterId, type MoveKind } from '../sim/types';

export const SPRITE_CELL_W = 96;
export const SPRITE_CELL_H = 120;
/** Feet sit near the bottom of each cell so GROUND_Y placement matches the sim. */
export const RIG_ORIGIN_X = 0.5;
export const RIG_ORIGIN_Y = 0.96;

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
  for (const id of ALL_FIGHTER_IDS) {
    for (const action of ['idle', 'walk', 'attack', 'poses'] as const) {
      scene.load.spritesheet(sheetKey(id, action), `${base}sprites/fighters/${id}/${action}.png`, {
        frameWidth: SPRITE_CELL_W,
        frameHeight: SPRITE_CELL_H,
      });
    }
  }
  for (const stage of ALL_STAGE_IDS) {
    scene.load.image(`stage_${stage}`, `${base}sprites/stages/${stage}.png`);
  }
  scene.load.spritesheet('fx_projectiles', `${base}sprites/fx/projectiles.png`, { frameWidth: 48, frameHeight: 48 });
  scene.load.spritesheet('fx_impact', `${base}sprites/fx/impact.png`, { frameWidth: 48, frameHeight: 48 });
}

function ensureAnim(scene: Phaser.Scene, key: string, sheet: string, frameRate: number, repeat: number): string {
  if (!scene.anims.exists(key)) {
    scene.anims.create({
      key,
      frames: scene.anims.generateFrameNumbers(sheet, { start: 0, end: 3 }),
      frameRate,
      repeat,
    });
  }
  return key;
}

/** Registers pixel-art textures/animations for a character once per Game instance. */
export function buildFighterVisuals(scene: Phaser.Scene, def: CharacterDef): FighterVisualSet {
  const cacheKey = def.id;
  if (builtCharacters.has(cacheKey)) return cache.get(cacheKey)!;

  const idleSheet = sheetKey(def.id, 'idle');
  const walkSheet = sheetKey(def.id, 'walk');
  const attackSheet = sheetKey(def.id, 'attack');
  const poseSheet = sheetKey(def.id, 'poses');

  const jump = frameKey(poseSheet, 0);
  const crouch = frameKey(poseSheet, 1);
  const block = frameKey(poseSheet, 2);
  const hurt = frameKey(poseSheet, 3);
  const attackFrames = [0, 1, 2, 3].map((i) => frameKey(attackSheet, i));

  const moveFrames = {} as Record<MoveKind, string[]>;
  for (const kind of MOVE_KINDS) {
    if (kind === 'crouchBasic') moveFrames[kind] = [crouch, attackFrames[1], crouch];
    else if (kind === 'jumpBasic') moveFrames[kind] = [jump, attackFrames[1], jump];
    else if (kind === 'grab') moveFrames[kind] = [attackFrames[0], attackFrames[2], attackFrames[3]];
    else if (kind === 'super') moveFrames[kind] = [attackFrames[0], attackFrames[1], attackFrames[2], attackFrames[3]];
    else moveFrames[kind] = attackFrames;
  }

  const visuals: FighterVisualSet = {
    idleAnim: ensureAnim(scene, `${def.id}_idle`, idleSheet, 5, -1),
    walkAnim: ensureAnim(scene, `${def.id}_walk`, walkSheet, 11, -1),
    victoryAnim: ensureAnim(scene, `${def.id}_victory`, idleSheet, 3, -1),
    idleSheet,
    walkSheet,
    attackSheet,
    poseSheet,
    jumpFrames: [jump],
    crouchFrames: [crouch],
    blockFrames: [block],
    hitstunFrames: [hurt],
    knockdownFrames: [hurt],
    wakeupFrames: [crouch],
    koFrames: [hurt],
    moveFrames,
    portraitFrame: frameKey(idleSheet, 0),
  };

  builtCharacters.add(cacheKey);
  cache.set(cacheKey, visuals);
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
