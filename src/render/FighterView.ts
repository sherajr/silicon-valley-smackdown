import Phaser from 'phaser';
import { buildFighterVisuals, parseFrameKey, type FighterVisualSet } from './SpriteFactory';
import { poseIndexForMove } from './moveTimeline';
import { GROUND_Y, SIM_FPS } from '../sim/constants';
import type { FighterRuntime } from '../sim/FighterRuntime';
import type { CharacterDef, FighterStateName } from '../sim/types';

/** How long a blocked hit's guard-impact frame holds before falling back to the held guard stance. */
const BLOCK_IMPACT_HOLD_MS = 160;
/** How long the sharp initial hitstun snap-back holds before settling into the daze-hold pose. */
const HITSTUN_SNAP_MS = 120;
/** How long the knockdown fall pose holds before settling flat. */
const KNOCKDOWN_FALL_MS = 180;
/** How long the wakeup stir pose holds before rising into the crouch stance. */
const WAKEUP_STIR_MS = 140;
/**
 * |vy| below which a jump reads as "at the apex" rather than rising/falling. At the original 0.4,
 * Hunter's arc (-10.5 initial vy, +0.62 gravity per tick) spent only about one 60Hz tick inside
 * that band -- easy to miss entirely. 1.0 widens it to roughly three ticks (~50ms) without
 * changing the arc, airtime, or jump height at all: this gates only which pose is *shown*, never
 * anything CombatSim computes.
 */
const JUMP_APEX_VY = 1.0;
/**
 * White damage-flash duration, in real (wall-clock) ms -- deliberately NOT tied to the sim-tick
 * pose clock below, so a long hit-stop doesn't leave the fighter flashing white for its whole
 * duration; the flash reads as a brief snap regardless of how long the freeze lasts.
 */
const FLASH_DURATION_MS = 50;
const MS_PER_SIM_TICK = 1000 / SIM_FPS;

/**
 * Per-fighter signal for "something happened to this fighter since the last render frame", built
 * by FightScene by accumulating the sim's events across however many fixed steps ran. `hit` and
 * `blocked` are edges: true for exactly one render frame, and FighterView turns them into held
 * state. Accumulating (rather than reading only the newest step) is what stops a hit or block
 * from being dropped when several sim steps land inside one display frame.
 */
export interface FighterImpact {
  /** A real (unblocked) hit landed on this fighter. */
  hit: boolean;
  /** An attack was just blocked by this fighter (not a guard break). */
  blocked: boolean;
  /** Stance captured by the sim at the moment of that block; only meaningful when `blocked`. */
  blockedCrouching: boolean;
}

export function neutralImpact(): FighterImpact {
  return { hit: false, blocked: false, blockedCrouching: false };
}

/**
 * Presentation-only wrapper: reads simulation state each render tick and drives a Phaser sprite.
 * Never mutates combat state. Origin, cell size and scale all come from the resolved visual
 * source, so painted art and the procedural rig each anchor with their own measured geometry.
 */
export class FighterView {
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly visuals: FighterVisualSet;
  private currentKey = '';
  private flashMs = 0;
  private paletteTint: number | null = null;
  private shadow: Phaser.GameObjects.Ellipse;

  // Presentation-only "time in state" tracking, driven by the sim's own frame counter (which does
  // not advance during hit-stop) rather than wall-clock render delta -- so a reaction pose can't
  // finish progressing while combat is still frozen, and a repeat hit during an unchanged state
  // name (e.g. a second hit while already in 'hitstun') still restarts the snap.
  private lastState: FighterStateName | null = null;
  private lastSimFrame = -1;
  private stateElapsedTicks = 0;
  /** -1 = no guard impact currently showing. */
  private blockImpactTicks = -1;
  private blockImpactCrouching = false;

  constructor(scene: Phaser.Scene, def: CharacterDef, x: number, y: number, palette?: { tintOverride?: number }) {
    this.shadow = scene.add.ellipse(x, y, def.width * 0.9, 7, 0x000000, 0.32);
    this.shadow.setDepth(-1); // anchors the fighter to the floor, above the stage but below the sprite

    this.visuals = buildFighterVisuals(scene, def);
    const portrait = parseFrameKey(this.visuals.portraitFrame);
    this.sprite = scene.add.sprite(x, y, portrait.texture, portrait.frame);
    this.sprite.setOrigin(this.visuals.originX, this.visuals.originY);
    this.sprite.setScale(this.visuals.gameplayScale);
    if (palette?.tintOverride) {
      this.paletteTint = palette.tintOverride;
      this.sprite.setTint(this.paletteTint);
    }
  }

  destroy(): void {
    this.sprite.destroy();
    this.shadow.destroy();
  }

  /**
   * Sizes the sprite to a target on-screen height in logical pixels. Scenes state the height they
   * want rather than a raw scale, because painted cells (120px) and rig cells (92px) would
   * otherwise render at noticeably different sizes from the same scale number.
   */
  setDisplayHeight(px: number): void {
    this.sprite.setScale(px / this.visuals.cellH);
  }

  /** Clears transient reaction state -- call on a round/match reset so a stale pose can't carry over. */
  resetReactionState(): void {
    this.lastState = null;
    this.lastSimFrame = -1;
    this.stateElapsedTicks = 0;
    this.blockImpactTicks = -1;
    this.blockImpactCrouching = false;
    this.flashMs = 0;
  }

  private setFrame(key: string): void {
    if (this.currentKey === key) return;
    this.currentKey = key;
    this.sprite.anims.stop();
    const { texture, frame } = parseFrameKey(key);
    this.sprite.setTexture(texture, frame);
  }

  private playAnim(key: string): void {
    if (this.currentKey === key) return;
    this.currentKey = key;
    this.sprite.play({ key, repeat: -1 });
  }

  /** Picks frame `idx` from a state's authored frames, clamped to however many that source actually provides. */
  private setSequenced(frames: string[], idx: number): void {
    if (!frames.length) return;
    this.setFrame(frames[Math.min(idx, frames.length - 1)]);
  }

  /** Starts the looping idle breathing animation for a standing preview with no live sim driving it. */
  playIdlePreview(): void {
    this.playAnim(this.visuals.idleAnim);
  }

  update(f: FighterRuntime, arenaOffsetX: number, impact: FighterImpact, deltaMs: number, simFrameCount: number): void {
    // Ticks actually advanced in the sim since the last call -- 0 while hit-stop or pause holds
    // CombatSim.frameCount flat, however many real render frames pass in the meantime. A round
    // reset sends frameCount back to 0; that restarts the pose clock rather than producing a
    // large negative delta.
    if (this.lastSimFrame >= 0 && simFrameCount < this.lastSimFrame) this.resetReactionState();
    const ticksAdvanced = this.lastSimFrame < 0 ? 0 : Math.max(0, simFrameCount - this.lastSimFrame);
    this.lastSimFrame = simFrameCount;

    if (f.state !== this.lastState) {
      this.stateElapsedTicks = 0;
      this.lastState = f.state;
    } else if (impact.hit) {
      // A fresh hit while the state name hasn't changed (e.g. a second hit during ongoing
      // hitstun) must still restart the reaction snap, not silently continue the old one.
      this.stateElapsedTicks = 0;
    } else {
      this.stateElapsedTicks += ticksAdvanced;
    }

    if (impact.blocked) {
      this.blockImpactTicks = 0;
      this.blockImpactCrouching = impact.blockedCrouching;
    } else if (this.blockImpactTicks >= 0) {
      this.blockImpactTicks += ticksAdvanced;
      if (this.blockImpactTicks * MS_PER_SIM_TICK > BLOCK_IMPACT_HOLD_MS) this.blockImpactTicks = -1;
    }

    this.sprite.setFlipX(f.facing === -1);
    this.sprite.x = Math.round(arenaOffsetX + f.x);
    this.sprite.y = Math.round(GROUND_Y + f.y);

    this.shadow.x = this.sprite.x;
    this.shadow.y = GROUND_Y;
    const airRatio = Math.min(1, Math.abs(f.y) / 90);
    this.shadow.setScale(1 - airRatio * 0.4);
    this.shadow.setAlpha(0.32 * (1 - airRatio * 0.6));

    // Deliberately wall-clock (deltaMs), not sim-tick based: this flash is a snap cosmetic that
    // must read the same length regardless of how long the accompanying hit-stop freeze lasts.
    if (impact.hit) this.flashMs = FLASH_DURATION_MS;
    else if (this.flashMs > 0) this.flashMs -= deltaMs;
    if (this.flashMs > 0) {
      this.sprite.setTint(0xffffff);
      this.sprite.setTintMode(Phaser.TintModes.FILL);
    } else if (this.paletteTint !== null) {
      this.sprite.clearTint();
      this.sprite.setTintMode(Phaser.TintModes.MULTIPLY);
      this.sprite.setTint(this.paletteTint);
    } else {
      this.sprite.clearTint();
      this.sprite.setTintMode(Phaser.TintModes.MULTIPLY);
    }

    switch (f.state) {
      case 'idle':
        this.playAnim(this.visuals.idleAnim);
        break;
      case 'dash':
        this.playAnim(this.visuals.dashAnim);
        break;
      case 'walk':
        this.playAnim(this.visuals.walkAnim);
        break;
      case 'jump': {
        // Selected from the sim's actual vertical velocity, not an internal timer:
        // rising while vy is (up-)negative, falling once vy turns positive, apex between.
        const idx = f.vy < -JUMP_APEX_VY ? 0 : f.vy > JUMP_APEX_VY ? 2 : 1;
        this.setSequenced(this.visuals.jumpFrames, idx);
        break;
      }
      case 'crouch':
        // Held stance only -- the actual guard-impact frame is rendered by the 'blockstun' branch
        // below, which is the state the sim enters the instant a blocked hit lands.
        this.setSequenced(this.visuals.crouchFrames, 0);
        break;
      case 'block':
        this.setSequenced(this.visuals.blockFrames, 0);
        break;
      case 'blockstun': {
        // The state the sim is actually in while a blocked hit is landing -- the one real signal
        // for "show the guard-impact pose". The pre-impact 'block'/'crouch' stance never receives
        // a block event at all, which is the bug this branch fixes.
        const frames = this.blockImpactCrouching ? this.visuals.crouchFrames : this.visuals.blockFrames;
        this.setSequenced(frames, this.blockImpactTicks >= 0 ? 1 : 0);
        break;
      }
      case 'hitstun':
      case 'guardbreak': // a broken guard is a stagger/recoil, not another guard pose
      case 'grabbed':
        this.setSequenced(this.visuals.hitstunFrames, this.stateElapsedTicks * MS_PER_SIM_TICK < HITSTUN_SNAP_MS ? 0 : 1);
        break;
      case 'knockdown':
        this.setSequenced(this.visuals.knockdownFrames, this.stateElapsedTicks * MS_PER_SIM_TICK < KNOCKDOWN_FALL_MS ? 0 : 1);
        break;
      case 'wakeup':
        this.setSequenced(this.visuals.wakeupFrames, this.stateElapsedTicks * MS_PER_SIM_TICK < WAKEUP_STIR_MS ? 0 : 1);
        break;
      case 'victory':
        this.playAnim(this.visuals.victoryAnim);
        break;
      case 'ko':
        this.setSequenced(this.visuals.koFrames, 0);
        break;
      case 'intro':
        this.setFrame(this.visuals.portraitFrame);
        break;
      case 'attack': {
        const move = f.activeMove;
        if (move) {
          const frames = this.visuals.moveFrames[move.def.kind];
          this.setFrame(frames[poseIndexForMove(move, frames.length)]);
        }
        break;
      }
      default:
        break;
    }
  }
}
