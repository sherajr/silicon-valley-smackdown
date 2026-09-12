import Phaser from 'phaser';
import { buildFighterVisuals, RIG_ORIGIN_X, RIG_ORIGIN_Y, type FighterVisualSet } from './SpriteFactory';
import { poseIndexForMove } from './moveTimeline';
import { GROUND_Y } from '../sim/constants';
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
/** vy magnitude below which a jump reads as "at the apex" rather than rising/falling. */
const JUMP_APEX_VY = 0.4;

/**
 * Presentation-only wrapper: reads simulation state each render tick and
 * drives a Phaser sprite. Never mutates combat state.
 */
export class FighterView {
  readonly sprite: Phaser.GameObjects.Sprite;
  private visuals: FighterVisualSet;
  private currentKey = '';
  private flashTimer = 0;
  private paletteTint: number | null = null;
  private shadow: Phaser.GameObjects.Ellipse;

  // Presentation-only "time in state" tracking, derived purely by watching the sim's
  // state field change -- never fed back into the sim. Lets reaction/knockdown/wakeup
  // poses progress through more than one frame instead of freezing on frame zero.
  private lastState: FighterStateName | null = null;
  private stateElapsedMs = 0;
  private blockImpactMs = 0;

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

  update(f: FighterRuntime, arenaOffsetX: number, hitFlash: boolean, deltaMs = 16.67): void {
    if (f.state !== this.lastState) {
      this.stateElapsedMs = 0;
      this.lastState = f.state;
    } else {
      this.stateElapsedMs += deltaMs;
    }
    if (hitFlash && (f.state === 'block' || f.state === 'crouch' || f.state === 'guardbreak')) this.blockImpactMs = BLOCK_IMPACT_HOLD_MS;
    else if (this.blockImpactMs > 0) this.blockImpactMs -= deltaMs;

    this.sprite.setFlipX(f.facing === -1);
    this.sprite.x = Math.round(arenaOffsetX + f.x);
    this.sprite.y = Math.round(GROUND_Y + f.y);

    this.shadow.x = this.sprite.x;
    this.shadow.y = GROUND_Y;
    const airRatio = Math.min(1, Math.abs(f.y) / 90);
    this.shadow.setScale(1 - airRatio * 0.4);
    this.shadow.setAlpha(0.32 * (1 - airRatio * 0.6));

    if (hitFlash) this.flashTimer = 4;
    if (this.flashTimer > 0) {
      this.flashTimer--;
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
        const frames = this.visuals.crouchFrames;
        const idx = this.blockImpactMs > 0 && f.blocking ? 1 : 0;
        this.setFrame(frames[Math.min(idx, frames.length - 1)]);
        break;
      }
      case 'block':
      case 'guardbreak': {
        const frames = this.visuals.blockFrames;
        const idx = this.blockImpactMs > 0 ? 1 : 0;
        this.setFrame(frames[Math.min(idx, frames.length - 1)]);
        break;
      }
      case 'hitstun':
      case 'blockstun':
      case 'grabbed': {
        const frames = this.visuals.hitstunFrames;
        const idx = this.stateElapsedMs < HITSTUN_SNAP_MS ? 0 : 1;
        this.setFrame(frames[Math.min(idx, frames.length - 1)]);
        break;
      }
      case 'knockdown': {
        const frames = this.visuals.knockdownFrames;
        const idx = this.stateElapsedMs < KNOCKDOWN_FALL_MS ? 0 : 1;
        this.setFrame(frames[Math.min(idx, frames.length - 1)]);
        break;
      }
      case 'wakeup': {
        const frames = this.visuals.wakeupFrames;
        const idx = this.stateElapsedMs < WAKEUP_STIR_MS ? 0 : 1;
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
