import Phaser from 'phaser';
import { buildFighterVisuals, RIG_ORIGIN_X, RIG_ORIGIN_Y, type FighterVisualSet } from './SpriteFactory';
import { poseIndexForMove } from './moveTimeline';
import { GROUND_Y, SIM_FPS } from '../sim/constants';
import type { FighterRuntime } from '../sim/FighterRuntime';
import type { CharacterDef, FighterStateName } from '../sim/types';

/** How long a blocked hit's impact flinch pose holds before falling back to the idle guard stance. */
const BLOCK_IMPACT_HOLD_MS = 160;
/** How long the sharp initial hitstun snap-back holds before settling into the daze-hold pose. */
const HITSTUN_SNAP_MS = 120;
/** How long the knockdown fall pose holds before settling flat. */
const KNOCKDOWN_FALL_MS = 180;
/** How long the wakeup stir pose holds before rising into the crouch stance. */
const WAKEUP_STIR_MS = 140;
/** vy magnitude below which a jump reads as "at the apex" rather than rising/falling. At 0.4
 * (the original value), Hunter's arc (-10.5 initial vy, +0.62 gravity/tick) only spent about one
 * 60Hz tick inside that band -- easy to miss entirely, per Codex's evidence review. 1.0 widens it
 * to roughly three ticks (~50ms) without changing the actual arc, airtime, or jump height at all
 * (this only gates which pose is *shown*, never anything CombatSim computes). */
const JUMP_APEX_VY = 1.0;
/** White damage-flash duration, in real (wall-clock) ms -- deliberately NOT tied to the sim-tick
 * pose clock below, so a long hit-stop doesn't leave the fighter flashing white for its entire
 * duration; the flash reads as a brief snap regardless of how long the freeze lasts. */
const FLASH_DURATION_MS = 50;
const MS_PER_SIM_TICK = 1000 / SIM_FPS;

/** Per-fighter signal for "something happened to this fighter this render frame", built fresh
 * by FightScene from the sim's events each frame. `hit`/`blocked` are true for exactly one
 * render frame each; FighterView is responsible for turning that edge into held state. */
export interface FighterImpact {
  /** A real (unblocked) hit landed on this fighter this frame. */
  hit: boolean;
  /** An attack was just blocked by this fighter this frame (not a guard break). */
  blocked: boolean;
  /** Stance captured by the sim at the moment of that block; only meaningful when `blocked`. */
  blockedCrouching: boolean;
}

/**
 * Presentation-only wrapper: reads simulation state each render tick and
 * drives a Phaser sprite. Never mutates combat state.
 */
export class FighterView {
  readonly sprite: Phaser.GameObjects.Sprite;
  private visuals: FighterVisualSet;
  private currentKey = '';
  private flashMs = 0;
  private paletteTint: number | null = null;
  private shadow: Phaser.GameObjects.Ellipse;

  // Presentation-only "time in state" tracking, driven by the sim's own frame counter (which
  // does not advance during hit-stop) rather than wall-clock render delta -- so a reaction pose
  // can't finish progressing while combat is still frozen, and a repeat hit during an unchanged
  // state name (e.g. a second hit while already in 'hitstun') still restarts the snap. Never fed
  // back into the sim.
  private lastState: FighterStateName | null = null;
  private lastSimFrame = -1;
  private stateElapsedTicks = 0;
  /** -1 = no block impact currently showing. */
  private blockImpactTicks = -1;
  private blockImpactCrouching = false;

  constructor(scene: Phaser.Scene, def: CharacterDef, x: number, y: number, palette?: { tintOverride?: number }) {
    this.shadow = scene.add.ellipse(x, y, def.width * 0.9, 7, 0x000000, 0.32);
    this.shadow.setDepth(-1); // anchors the fighter to the floor, above the stage but below the sprite

    this.visuals = buildFighterVisuals(scene, def);
    this.sprite = scene.add.sprite(x, y, this.visuals.portraitFrame);
    this.sprite.setOrigin(RIG_ORIGIN_X, RIG_ORIGIN_Y);
    this.sprite.setScale(1);
    if (palette?.tintOverride) {
      this.paletteTint = palette.tintOverride;
      this.sprite.setTint(this.paletteTint);
    }
  }

  destroy(): void {
    this.sprite.destroy();
    this.shadow.destroy();
  }

  private setFrame(key: string): void {
    if (this.currentKey === key) return;
    this.currentKey = key;
    this.sprite.anims.stop();
    this.sprite.setTexture(key);
  }

  private playAnim(key: string): void {
    if (this.currentKey === key) return;
    this.currentKey = key;
    this.sprite.play({ key, repeat: -1 });
  }

  /** Starts the looping idle breathing animation with no live FighterRuntime driving it -- for a standing preview (e.g. character select) that isn't part of a running match. */
  playIdlePreview(): void {
    this.playAnim(this.visuals.idleAnim);
  }

  update(f: FighterRuntime, arenaOffsetX: number, impact: FighterImpact, deltaMs: number, simFrameCount: number): void {
    // Ticks actually advanced in the sim since the last call -- 0 while hit-stop or pause holds
    // CombatSim.frameCount flat, however many real render frames pass in the meantime.
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
      this.sprite.setTintMode(Phaser.TintModes.MULTIPLY);
      this.sprite.setTint(this.paletteTint);
    } else {
      this.sprite.clearTint();
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
        const frames = this.visuals.jumpFrames;
        const idx = f.vy < -JUMP_APEX_VY ? 0 : f.vy > JUMP_APEX_VY ? 2 : 1;
        this.setFrame(frames[Math.min(idx, frames.length - 1)]);
        break;
      }
      case 'crouch': {
        // Held stance only -- the actual impact frame is rendered by the real 'blockstun'
        // state below, which is what the sim enters the instant a block connects.
        this.setFrame(this.visuals.crouchFrames[0]);
        break;
      }
      case 'block': {
        this.setFrame(this.visuals.blockFrames[0]);
        break;
      }
      case 'blockstun': {
        // The state the sim is actually in while a blocked hit is landing -- this is the one
        // real signal for "show the guard-impact pose", not the pre-impact 'block'/'crouch'
        // stance (see the bug this fixes: those never receive a block event at all).
        const frames = this.blockImpactCrouching ? this.visuals.crouchFrames : this.visuals.blockFrames;
        const idx = this.blockImpactTicks >= 0 ? 1 : 0;
        this.setFrame(frames[Math.min(idx, frames.length - 1)]);
        break;
      }
      case 'hitstun':
      case 'guardbreak': // a broken guard is a stagger/recoil, not another guard pose
      case 'grabbed': {
        const frames = this.visuals.hitstunFrames;
        const idx = this.stateElapsedTicks * MS_PER_SIM_TICK < HITSTUN_SNAP_MS ? 0 : 1;
        this.setFrame(frames[Math.min(idx, frames.length - 1)]);
        break;
      }
      case 'knockdown': {
        const frames = this.visuals.knockdownFrames;
        const idx = this.stateElapsedTicks * MS_PER_SIM_TICK < KNOCKDOWN_FALL_MS ? 0 : 1;
        this.setFrame(frames[Math.min(idx, frames.length - 1)]);
        break;
      }
      case 'wakeup': {
        const frames = this.visuals.wakeupFrames;
        const idx = this.stateElapsedTicks * MS_PER_SIM_TICK < WAKEUP_STIR_MS ? 0 : 1;
        this.setFrame(frames[Math.min(idx, frames.length - 1)]);
        break;
      }
      case 'victory':
        this.playAnim(this.visuals.victoryAnim);
        break;
      case 'ko':
        this.setFrame(this.visuals.koFrames[0]);
        break;
      case 'intro':
        this.setFrame(this.visuals.portraitFrame);
        break;
      case 'attack': {
        const move = f.activeMove;
        if (move) {
          const frames = this.visuals.moveFrames[move.def.kind];
          const idx = poseIndexForMove(move, frames.length);
          this.setFrame(frames[idx]);
        }
        break;
      }
      default:
        break;
    }
  }
}
