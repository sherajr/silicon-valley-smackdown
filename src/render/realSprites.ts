import Phaser from 'phaser';
import type { FighterId } from '../sim/types';

/**
 * Real hand-drawn Hunter frames delivered by Codex (round 3 of the art handoff), trimmed to their
 * tight opaque bounding box (see art/sprites/hunter/raw for the untrimmed 500x500 source and
 * docs/handoffs/CODEX_NEXT.md for provenance). Every entry's (w, h) is the exact trimmed pixel
 * size on disk -- verified against the actual PNG dimensions, not guessed -- because origin below
 * is expressed as a fraction of that size, per Phaser's `setOrigin`.
 *
 * originX/originY: where the "ground contact" pivot sits within THIS SPECIFIC trimmed image, as a
 * 0-1 fraction of its own (w, h). Every pose here uses (0.5, 1.0) -- bottom-center of the trim --
 * which is the correct, mechanically-derivable pivot for any pose whose lowest opaque pixel is its
 * ground-contact point (true for every standing/crouching/kneeling pose in this set). It is a
 * looser convention for the two airborne poses (jump/jump_fall, where the lowest pixel is just
 * whichever limb happens to trail, not a ground contact at all) and for the lying poses
 * (knockdown_down/knockdown_fall/wakeup_stir, where "ground contact" means "nearest the floor in
 * the drawn perspective" rather than a literal foot-plant) -- those are documented as best-effort
 * per pose below. None of this has been tuned against a live render yet beyond the Animation
 * Viewer's pivot-crosshair overlay; see CODEX_NEXT.md for what's still open.
 */
export interface RealSpriteFrame {
  /** Trimmed PNG filename under public/sprites/hunter/ (and art/sprites/hunter/frames/ in-repo). */
  file: string;
  w: number;
  h: number;
  originX: number;
  originY: number;
}

function frame(file: string, w: number, h: number): RealSpriteFrame {
  return { file, w, h, originX: 0.5, originY: 1.0 };
}

/** Every trimmed Hunter pose Codex delivered, keyed by its own name -- not yet mapped to game clips (see HUNTER_CLIP_FRAMES). */
export const HUNTER_REAL_POSES = {
  ready: frame('ready.png', 290, 402),
  strike: frame('strike.png', 338, 392),
  ipad_toss: frame('ipad_toss.png', 456, 356),
  block: frame('block.png', 250, 346),
  block_2: frame('block_2.png', 270, 384),
  crouch: frame('crouch.png', 284, 314),
  crouch_block: frame('crouch_block.png', 248, 286),
  dash: frame('dash.png', 374, 318),
  jump: frame('jump.png', 210, 304),
  jump_fall: frame('jump_fall.png', 302, 362),
  hit_reaction: frame('hit_reaction.png', 296, 412),
  hit_stun_hold: frame('hit_stun_hold.png', 252, 392),
  knockdown_fall: frame('knockdown_fall.png', 430, 260),
  knockdown_down: frame('knockdown_down.png', 468, 90),
  wakeup_stir: frame('wakeup_stir.png', 404, 192),
  wakeup_rise: frame('wakeup_rise.png', 322, 324),
  victory: frame('victory.png', 252, 402),
} as const satisfies Record<string, RealSpriteFrame>;

export type HunterPoseName = keyof typeof HUNTER_REAL_POSES;

/**
 * Which characters have any real art at all right now. Everything else (and every clip not
 * listed in HUNTER_CLIP_FRAMES below) keeps using the procedural rig -- this is the "fallback for
 * anything not yet converted" the round-2 handoff promised, not a partial/broken state.
 */
export const CHARACTERS_WITH_REAL_ART: ReadonlySet<FighterId> = new Set(['hunter']);

/**
 * Maps each animation-viewer clip id to its ordered real-pose frames, mirroring the frame COUNT
 * each clip already expects from the procedural rig (FighterView.ts indexes into these arrays by
 * the same rules it uses for rig frames, e.g. jump picks [rise, apex, fall] by vy sign). Clips
 * absent here (walk, crouchBasic, jumpBasic, grab, ko, portrait, basic2/basic3/downSpecial/super
 * as distinct poses) have no delivered art yet and fall back to the rig entirely.
 *
 * Judgment calls made mapping 17 delivered poses onto the existing clip set, flagged here rather
 * than left implicit:
 *  - basic1 and forwardBasic both reuse the single delivered "strike" pose (one punch frame was
 *    delivered, not one per move) -- reach/hitbox differences between those moves are real in the
 *    sim and won't be visible in the art until distinct frames exist.
 *  - jump's middle (apex) slot reuses the rising frame (`jump`) a second time -- only rise/fall
 *    were delivered, not a separate apex hang frame.
 */
export const HUNTER_CLIP_FRAMES: Partial<Record<string, HunterPoseName[]>> = {
  idle: ['ready'],
  dash: ['dash'],
  jump: ['jump', 'jump', 'jump_fall'],
  crouch: ['crouch'],
  block: ['block', 'block_2'],
  hitstun: ['hit_reaction', 'hit_stun_hold'],
  knockdown: ['knockdown_fall', 'knockdown_down'],
  wakeup: ['wakeup_stir', 'wakeup_rise'],
  victory: ['victory'],
  basic1: ['strike'],
  forwardBasic: ['strike'],
  special: ['ipad_toss'],
};

function textureKey(id: FighterId, pose: HunterPoseName): string {
  return `real_${id}_${pose}`;
}

/**
 * Queues every real Hunter frame for loading. Call from a scene's `preload()`; textures are
 * available from `create()` onward via `textureKeyFor`. Idempotent across scenes/reloads (Phaser
 * skips a key already present in its texture manager).
 */
export function queueRealSpriteLoad(scene: Phaser.Scene, id: FighterId): void {
  if (!CHARACTERS_WITH_REAL_ART.has(id)) return;
  for (const pose of Object.keys(HUNTER_REAL_POSES) as HunterPoseName[]) {
    const key = textureKey(id, pose);
    if (scene.textures.exists(key)) continue;
    const url = `${import.meta.env.BASE_URL}sprites/${id}/${HUNTER_REAL_POSES[pose].file}`;
    scene.load.image(key, url);
  }
}

export function textureKeyFor(id: FighterId, pose: HunterPoseName): string {
  return textureKey(id, pose);
}

export function realFramesForClip(id: FighterId, clip: string): { key: string; meta: RealSpriteFrame }[] | null {
  if (!CHARACTERS_WITH_REAL_ART.has(id)) return null;
  const poses = HUNTER_CLIP_FRAMES[clip];
  if (!poses) return null;
  return poses.map((pose) => ({ key: textureKey(id, pose), meta: HUNTER_REAL_POSES[pose] }));
}
