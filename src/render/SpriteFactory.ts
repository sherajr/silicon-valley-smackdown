import Phaser from 'phaser';
import { framesForCharacter } from './characterRigs';
import { detailPainterFor } from './characterDetails';
import { renderPose, RIG_CANVAS_W, RIG_CANVAS_H, RIG_ANCHOR_X, RIG_ANCHOR_Y, type Pose } from './FighterRig';
import { ALL_FIGHTER_IDS, ALL_STAGE_IDS, type CharacterDef, type FighterId, type MoveKind } from '../sim/types';

/**
 * Painted sheet geometry, measured from the shipped assets rather than assumed: every
 * `public/sprites/fighters/<id>/{idle,walk,attack,poses}.png` is 192x240 -- a 2x2 grid of four
 * 96x120 cells -- and in all 24 sheets the drawn character's lowest opaque row is y=115 within
 * its cell. ART_ORIGIN_Y is that measured foot contact expressed as a fraction of cell height,
 * so `sprite.y = GROUND_Y` plants the feet on the floor line.
 */
export const SPRITE_CELL_W = 96;
export const SPRITE_CELL_H = 120;
export const ART_ORIGIN_X = 0.5;
export const ART_ORIGIN_Y = 0.96;
const ART_CELLS_PER_SHEET = 4;
/** Painted cells are 120px tall for a 62px-tall collision box; this renders them at the intended on-screen size. */
const ART_GAMEPLAY_SCALE = 0.72;

/** Procedural-rig geometry. A different canvas and a different foot anchor from the painted art -- never interchange the two. */
export const RIG_ORIGIN_X = RIG_ANCHOR_X / RIG_CANVAS_W;
export const RIG_ORIGIN_Y = RIG_ANCHOR_Y / RIG_CANVAS_H;
const RIG_GAMEPLAY_SCALE = 1;

/** Which art pipeline produced a fighter's frames. Shipped content must always be 'art'. */
export type VisualSourceKind = 'art' | 'rig';

export interface FighterVisualSet {
  /**
   * The pipeline these frames came from. 'art' is the shipped painted content; 'rig' is the
   * procedural fallback used only when a sheet is missing or invalid. Carried so callers can
   * report honestly which one is on screen instead of inferring it from texture names.
   */
  source: VisualSourceKind;
  /** Ground-contact pivot within this source's own cell, as a 0-1 fraction (differs per source). */
  originX: number;
  originY: number;
  /** This source's cell size in pixels, and the scale that renders it at the intended fighter size. */
  cellW: number;
  cellH: number;
  gameplayScale: number;
  idleAnim: string;
  walkAnim: string;
  dashAnim: string;
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

const cache = new Map<string, FighterVisualSet>();

/** Production painted-sheet texture key. The desktop/e2e asset checks assert exactly these. */
function artSheetKey(id: FighterId, action: string): string {
  return `${id}_${action}_sheet`;
}

/**
 * Procedural-rig texture key. Deliberately prefixed so a generated fallback can never occupy --
 * or be mistaken for -- a production art key: a texture named `hunter_idle_sheet` is always the
 * painted sheet, never a canvas rig. Asset tests rely on that separation.
 */
function rigSheetKey(id: FighterId, action: string): string {
  return `rig_${id}_${action}_sheet`;
}

function frameKey(sheet: string, frame: number): string {
  return `${sheet}#${frame}`;
}

export function preloadGameArt(scene: Phaser.Scene): void {
  const base = import.meta.env.BASE_URL;
  for (const id of ALL_FIGHTER_IDS) {
    for (const action of ['idle', 'walk', 'attack', 'poses'] as const) {
      scene.load.spritesheet(artSheetKey(id, action), `${base}sprites/fighters/${id}/${action}.png`, {
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

/**
 * True only when the key holds a real decoded sheet big enough for all four cells. A failed
 * download, a truncated/placeholder image, or a texture of the wrong size all fail here and send
 * the character to the procedural fallback instead of rendering blank or mis-sliced frames.
 */
export function artSheetUsable(scene: Phaser.Scene, key: string): boolean {
  if (!scene.textures.exists(key)) return false;
  const texture = scene.textures.get(key);
  const source = texture.source?.[0];
  if (!source || source.width < SPRITE_CELL_W * 2 || source.height < SPRITE_CELL_H * 2) return false;
  for (let i = 0; i < ART_CELLS_PER_SHEET; i++) if (!texture.has(String(i))) return false;
  return true;
}

/** All four painted sheets must be present and valid before a character renders from art. */
export function hasUsableArt(scene: Phaser.Scene, id: FighterId): boolean {
  return (['idle', 'walk', 'attack', 'poses'] as const).every((action) => artSheetUsable(scene, artSheetKey(id, action)));
}

function ensureAnim(scene: Phaser.Scene, key: string, frames: string[], frameRate: number): string {
  if (!scene.anims.exists(key)) {
    scene.anims.create({
      key,
      frames: frames.map((token) => {
        const f = parseFrameKey(token);
        return { key: f.texture, frame: f.frame };
      }),
      frameRate,
      repeat: -1,
    });
  }
  return key;
}

/**
 * Builds the painted-art visual set: the shipped pixel-art sheets, sliced into the states the
 * renderer asks for.
 *
 * Frame budget is honest here -- each character authors 16 cells (4 idle, 4 walk, 4 attack, and
 * 4 single-pose cells: jump, crouch, block, hurt). So every fighter has its own painted art, but
 * each authors exactly one frame for jump/crouch/block/hurt. FighterView clamps its two-phase
 * reaction sequencing to whatever a source actually provides, so those states hold their single
 * authored cell here while the procedural rig (which authors rise/apex/fall, snap/settle, etc.)
 * plays the full sequence. Move poses are drawn from the four attack cells in per-move
 * combinations, which distinguishes moves without pretending each has bespoke frames.
 */
function buildArtVisuals(scene: Phaser.Scene, def: CharacterDef): FighterVisualSet {
  const idleSheet = artSheetKey(def.id, 'idle');
  const walkSheet = artSheetKey(def.id, 'walk');
  const attackSheet = artSheetKey(def.id, 'attack');
  const poseSheet = artSheetKey(def.id, 'poses');

  const idle = [0, 1, 2, 3].map((i) => frameKey(idleSheet, i));
  const walk = [0, 1, 2, 3].map((i) => frameKey(walkSheet, i));
  // 0 = wind-up, 1 = strike, 2 = full extension, 3 = recovery (matches the painted cells).
  const atk = [0, 1, 2, 3].map((i) => frameKey(attackSheet, i));
  const jump = frameKey(poseSheet, 0);
  const crouch = frameKey(poseSheet, 1);
  const block = frameKey(poseSheet, 2);
  const hurt = frameKey(poseSheet, 3);

  const moveFrames = {} as Record<MoveKind, string[]>;
  for (const kind of MOVE_KINDS) {
    if (kind === 'crouchBasic') moveFrames[kind] = [crouch, atk[1], crouch];
    else if (kind === 'jumpBasic') moveFrames[kind] = [jump, atk[1], jump];
    else if (kind === 'basic1') moveFrames[kind] = [atk[0], atk[1], atk[3]];
    else if (kind === 'basic2') moveFrames[kind] = [atk[0], atk[2], atk[3]];
    else if (kind === 'forwardBasic') moveFrames[kind] = [atk[0], atk[2], atk[3]];
    else if (kind === 'grab') moveFrames[kind] = [atk[0], atk[2], atk[3]];
    else if (kind === 'downSpecial') moveFrames[kind] = [crouch, atk[2], atk[3]];
    else moveFrames[kind] = atk; // basic3, special, super use the full four-cell swing
  }

  return {
    source: 'art',
    originX: ART_ORIGIN_X,
    originY: ART_ORIGIN_Y,
    cellW: SPRITE_CELL_W,
    cellH: SPRITE_CELL_H,
    gameplayScale: ART_GAMEPLAY_SCALE,
    idleAnim: ensureAnim(scene, `${def.id}_idle`, idle, 5),
    walkAnim: ensureAnim(scene, `${def.id}_walk`, walk, 11),
    // No bespoke dash cell is painted, so dash replays the walk cells at a sprint cadence under
    // its own animation key -- visibly faster than walking, and never the idle loop.
    dashAnim: ensureAnim(scene, `${def.id}_dash`, walk, 20),
    victoryAnim: ensureAnim(scene, `${def.id}_victory`, idle, 3),
    idleSheet,
    walkSheet,
    attackSheet,
    poseSheet,
    jumpFrames: [jump],
    crouchFrames: [crouch],
    blockFrames: [block],
    // A broken guard is a recoil, not a guard pose -- so guardbreak routes here, to the hurt cell.
    hitstunFrames: [hurt],
    knockdownFrames: [hurt],
    wakeupFrames: [crouch],
    koFrames: [hurt],
    moveFrames,
    portraitFrame: frameKey(idleSheet, 0),
  };
}

/** Builds the procedural canvas rig -- the fallback for a character whose painted sheets are missing or invalid. */
function buildRigVisuals(scene: Phaser.Scene, def: CharacterDef): FighterVisualSet {
  const poses = framesForCharacter(def);
  function sheet(action: string, frames: Pose[]): string[] {
    const key = rigSheetKey(def.id, action);
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
  const idle = sheet('idle', poses.idle);
  const walk = sheet('walk', poses.walk);
  const dash = sheet('dash', poses.dash);
  const victory = sheet('victory', poses.victory);
  const moveFrames = {} as Record<MoveKind, string[]>;
  for (const kind of MOVE_KINDS) moveFrames[kind] = sheet(kind, poses.moves[kind]);
  return {
    source: 'rig',
    originX: RIG_ORIGIN_X,
    originY: RIG_ORIGIN_Y,
    cellW: RIG_CANVAS_W,
    cellH: RIG_CANVAS_H,
    gameplayScale: RIG_GAMEPLAY_SCALE,
    idleAnim: ensureAnim(scene, `rig_${def.id}_idle`, idle, 5),
    walkAnim: ensureAnim(scene, `rig_${def.id}_walk`, walk, 11),
    dashAnim: ensureAnim(scene, `rig_${def.id}_dash`, dash, 16),
    victoryAnim: ensureAnim(scene, `rig_${def.id}_victory`, victory, 4),
    idleSheet: rigSheetKey(def.id, 'idle'),
    walkSheet: rigSheetKey(def.id, 'walk'),
    attackSheet: rigSheetKey(def.id, 'basic1'),
    poseSheet: rigSheetKey(def.id, 'jump'),
    jumpFrames: sheet('jump', poses.jump),
    crouchFrames: sheet('crouch', poses.crouch),
    blockFrames: sheet('block', poses.block),
    hitstunFrames: sheet('hitstun', poses.hitstun),
    knockdownFrames: sheet('knockdown', poses.knockdown),
    wakeupFrames: sheet('wakeup', poses.wakeup),
    koFrames: sheet('ko', poses.ko),
    moveFrames,
    portraitFrame: sheet('portrait', poses.portrait)[0],
  };
}

/**
 * Resolves a character's frames, preferring the shipped painted sheets and falling back to the
 * procedural rig only when those sheets are genuinely unusable. The cache is re-validated against
 * the live texture manager so a set built for one Game instance is never reused after teardown.
 */
export function buildFighterVisuals(scene: Phaser.Scene, def: CharacterDef): FighterVisualSet {
  const cached = cache.get(def.id);
  if (cached && scene.textures.exists(parseFrameKey(cached.portraitFrame).texture)) return cached;
  const visuals = hasUsableArt(scene, def.id) ? buildArtVisuals(scene, def) : buildRigVisuals(scene, def);
  cache.set(def.id, visuals);
  return visuals;
}

export function parseFrameKey(token: string): { texture: string; frame: number } {
  const hash = token.lastIndexOf('#');
  if (hash === -1) return { texture: token, frame: 0 };
  return { texture: token.slice(0, hash), frame: Number(token.slice(hash + 1)) || 0 };
}

export function resetVisualCache(): void {
  cache.clear();
}
