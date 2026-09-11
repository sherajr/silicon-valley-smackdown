import Phaser from 'phaser';
import { buildFighterVisuals, RIG_ORIGIN_X, RIG_ORIGIN_Y, type FighterVisualSet } from './SpriteFactory';
import { poseIndexForMove } from './moveTimeline';
import { GROUND_Y } from '../sim/constants';
import type { FighterRuntime } from '../sim/FighterRuntime';
import type { CharacterDef } from '../sim/types';

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

  update(f: FighterRuntime, arenaOffsetX: number, hitFlash: boolean): void {
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
      case 'dash':
        this.playAnim(this.visuals.idleAnim);
        break;
      case 'walk':
        this.playAnim(this.visuals.walkAnim);
        break;
      case 'jump':
        this.setFrame(this.visuals.jumpFrames[0]);
        break;
      case 'crouch':
        this.setFrame(this.visuals.crouchFrames[0]);
        break;
      case 'block':
      case 'guardbreak':
        this.setFrame(this.visuals.blockFrames[0]);
        break;
      case 'hitstun':
      case 'blockstun':
      case 'grabbed':
        this.setFrame(this.visuals.hitstunFrames[0]);
        break;
      case 'knockdown':
        this.setFrame(this.visuals.knockdownFrames[0]);
        break;
      case 'wakeup':
        this.setFrame(this.visuals.wakeupFrames[0]);
        break;
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
