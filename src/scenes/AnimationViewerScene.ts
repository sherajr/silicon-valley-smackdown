import Phaser from 'phaser';
import { SceneKeys } from './sceneKeys';
import { BASE_WIDTH, BASE_HEIGHT } from '../sim/constants';
import { ALL_FIGHTER_IDS, type FighterId, type FighterStateName, type MoveKind } from '../sim/types';
import { CHARACTERS } from '../data/characters';
import { buildFighterVisuals, RIG_ORIGIN_X, RIG_ORIGIN_Y, type FighterVisualSet } from '../render/SpriteFactory';
import { hurtboxFor } from '../sim/FighterRuntime';
import { localBoxToWorld } from '../sim/collision';

type ClipId = 'idle' | 'walk' | 'dash' | 'jump' | 'crouch' | 'block' | 'hitstun' | 'knockdown' | 'wakeup' | 'victory' | 'ko' | 'portrait' | MoveKind;

const NON_MOVE_CLIPS: ClipId[] = ['idle', 'walk', 'dash', 'jump', 'crouch', 'block', 'hitstun', 'knockdown', 'wakeup', 'victory', 'ko', 'portrait'];
const MOVE_CLIPS: MoveKind[] = ['basic1', 'basic2', 'basic3', 'crouchBasic', 'jumpBasic', 'forwardBasic', 'special', 'downSpecial', 'grab', 'super'];
const CLIPS: ClipId[] = [...NON_MOVE_CLIPS, ...MOVE_CLIPS];

/** Maps a clip id to the "hurtbox state" gameplay would report during it, for the hurtbox overlay. */
const HURTBOX_STATE_FOR_CLIP: Partial<Record<ClipId, FighterStateName>> = {
  crouch: 'crouch',
  knockdown: 'knockdown',
  jumpBasic: 'jump',
  crouchBasic: 'crouch',
};

// RIG_CANVAS_H (92) is taller than the character silhouette (padding for limb extension/props),
// and the sprite's origin sits near the feet (RIG_ORIGIN_Y), so the visible top of the sprite
// extends upward from spriteY by roughly RIG_ORIGIN_Y-fraction * RIG_CANVAS_H * scale. This
// scale/y pair keeps that within the 480x270 logical viewport instead of clipping off-screen.
const SPRITE_SCALE = 2.2;
const SPRITE_X = BASE_WIDTH / 2;
const SPRITE_Y = 230;

/**
 * Dev-only tool (see docs/handoffs/CODEX_NEXT.md for the asset contract this exists to verify
 * against): steps through every clip for every fighter using the exact same textures, anim
 * frame lists, and hit/hurtbox data gameplay uses -- no separate rendering path -- so an art
 * pass can be inspected frame-by-frame, in both facings, with pivot/hitbox overlays, without
 * needing a live match. Reachable at ?animviewer=1 (see BootScene.ts), inert otherwise.
 */
export class AnimationViewerScene extends Phaser.Scene {
  private charIndex = 0;
  private clipIndex = 0;
  private frameIndex = 0;
  private flipped = false;
  private showOverlay = true;
  private sprite!: Phaser.GameObjects.Sprite;
  private overlayGfx!: Phaser.GameObjects.Graphics;
  private infoText!: Phaser.GameObjects.Text;
  private helpText!: Phaser.GameObjects.Text;

  constructor() {
    super(SceneKeys.AnimationViewer);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    switch (e.code) {
      case 'ArrowLeft':
        this.step(-1);
        break;
      case 'ArrowRight':
        this.step(1);
        break;
      case 'ArrowUp':
        this.changeClip(-1);
        break;
      case 'ArrowDown':
        this.changeClip(1);
        break;
      case 'KeyQ':
        this.changeCharacter(-1);
        break;
      case 'KeyE':
        this.changeCharacter(1);
        break;
      case 'KeyF':
        this.flipped = !this.flipped;
        this.refresh();
        break;
      case 'KeyH':
        this.showOverlay = !this.showOverlay;
        this.refresh();
        break;
      case 'Escape':
        this.scene.start(SceneKeys.Title);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  create(): void {
    this.cameras.main.setBackgroundColor('#20222c');
    this.add.rectangle(SPRITE_X, SPRITE_Y, BASE_WIDTH, 2, 0x4a4a5a); // ground reference line at RIG anchor height

    this.sprite = this.add.sprite(SPRITE_X, SPRITE_Y, '');
    this.sprite.setOrigin(RIG_ORIGIN_X, RIG_ORIGIN_Y);
    this.sprite.setScale(SPRITE_SCALE);

    this.overlayGfx = this.add.graphics();
    this.overlayGfx.setDepth(10);

    this.infoText = this.add.text(8, 8, '', { fontFamily: 'monospace', fontSize: '9px', color: '#ffffff', lineSpacing: 3 });
    this.helpText = this.add
      .text(8, BASE_HEIGHT - 8, '', { fontFamily: 'monospace', fontSize: '8px', color: '#9aa0b0' })
      .setOrigin(0, 1);
    this.helpText.setText(
      'Left/Right: frame   Up/Down: clip   Q/E: character   F: flip facing   H: toggle overlay   Esc: exit',
    );

    // Raw window listener rather than Phaser's built-in keyboard plugin: this project's own
    // gameplay input (InputManager.ts) already relies on a plain window keydown/keyup listener
    // exclusively, and it's the proven-reliable path in this codebase/toolchain.
    window.addEventListener('keydown', this.onKeyDown);
    this.events.once('shutdown', () => window.removeEventListener('keydown', this.onKeyDown));

    this.refresh();
  }

  private currentDef() {
    return CHARACTERS[ALL_FIGHTER_IDS[this.charIndex]];
  }

  private currentVisuals(): FighterVisualSet {
    return buildFighterVisuals(this, this.currentDef());
  }

  /** Resolves a clip to its ordered list of texture keys, whether it's an anim (idle/walk/dash/victory) or a raw frame array. */
  private framesFor(clip: ClipId, visuals: FighterVisualSet): string[] {
    switch (clip) {
      case 'idle':
        return this.animFrameKeys(visuals.idleAnim);
      case 'walk':
        return this.animFrameKeys(visuals.walkAnim);
      case 'dash':
        return this.animFrameKeys(visuals.dashAnim);
      case 'victory':
        return this.animFrameKeys(visuals.victoryAnim);
      case 'jump':
        return visuals.jumpFrames;
      case 'crouch':
        return visuals.crouchFrames;
      case 'block':
        return visuals.blockFrames;
      case 'hitstun':
        return visuals.hitstunFrames;
      case 'knockdown':
        return visuals.knockdownFrames;
      case 'wakeup':
        return visuals.wakeupFrames;
      case 'ko':
        return visuals.koFrames;
      case 'portrait':
        return [visuals.portraitFrame];
      default:
        return visuals.moveFrames[clip as MoveKind] ?? [];
    }
  }

  private animFrameKeys(animKey: string): string[] {
    const anim = this.anims.get(animKey);
    if (!anim) return [];
    return anim.frames.map((f) => String(f.textureKey));
  }

  private step(dir: number): void {
    const frames = this.framesFor(CLIPS[this.clipIndex], this.currentVisuals());
    if (frames.length === 0) return;
    this.frameIndex = Phaser.Math.Wrap(this.frameIndex + dir, 0, frames.length);
    this.refresh();
  }

  private changeClip(dir: number): void {
    this.clipIndex = Phaser.Math.Wrap(this.clipIndex + dir, 0, CLIPS.length);
    this.frameIndex = 0;
    this.refresh();
  }

  private changeCharacter(dir: number): void {
    this.charIndex = Phaser.Math.Wrap(this.charIndex + dir, 0, ALL_FIGHTER_IDS.length);
    this.frameIndex = 0;
    this.refresh();
  }

  private refresh(): void {
    const def = this.currentDef();
    const visuals = this.currentVisuals();
    const clip = CLIPS[this.clipIndex];
    const frames = this.framesFor(clip, visuals);
    if (frames.length === 0) {
      this.frameIndex = 0;
    } else {
      this.frameIndex = Phaser.Math.Clamp(this.frameIndex, 0, frames.length - 1);
      this.sprite.setTexture(frames[this.frameIndex]);
    }
    this.sprite.setFlipX(this.flipped);

    this.infoText.setText(
      [
        `Fighter: ${def.name} (${this.charIndex + 1}/${ALL_FIGHTER_IDS.length})`,
        `Clip: ${clip} -- frame ${frames.length ? this.frameIndex + 1 : 0}/${frames.length}`,
        `Facing: ${this.flipped ? 'left (flipped)' : 'right (authored)'}   Overlay: ${this.showOverlay ? 'on' : 'off'}`,
      ].join('\n'),
    );

    this.overlayGfx.clear();
    if (!this.showOverlay) return;

    // Pivot/foot-anchor crosshair -- exactly the sprite's (x,y), since every gameplay sprite
    // shares this same origin (RIG_ORIGIN_X/Y from SpriteFactory), so this is a real check of
    // foot-plant alignment, not an approximation.
    this.overlayGfx.lineStyle(1, 0xffe36e, 1);
    this.overlayGfx.strokeLineShape(new Phaser.Geom.Line(this.sprite.x - 6, this.sprite.y, this.sprite.x + 6, this.sprite.y));
    this.overlayGfx.strokeLineShape(new Phaser.Geom.Line(this.sprite.x, this.sprite.y - 6, this.sprite.x, this.sprite.y + 6));

    const facing = this.flipped ? -1 : 1;
    // Gameplay hit/hurtboxes are authored in raw sim units (1 unit = 1px at the sprite's default
    // scale of 1). This viewer renders the sprite at SPRITE_SCALE for visibility, so every box
    // must be scaled the same way around the shared origin (sprite.x, sprite.y) or it drifts out
    // of alignment with the enlarged art -- exactly the kind of mismatch this overlay exists to catch.
    const scaleBox = (box: ReturnType<typeof localBoxToWorld>): ReturnType<typeof localBoxToWorld> => ({
      left: this.sprite.x + (box.left - this.sprite.x) * SPRITE_SCALE,
      right: this.sprite.x + (box.right - this.sprite.x) * SPRITE_SCALE,
      top: this.sprite.y + (box.top - this.sprite.y) * SPRITE_SCALE,
      bottom: this.sprite.y + (box.bottom - this.sprite.y) * SPRITE_SCALE,
    });
    const strokeBox = (box: ReturnType<typeof localBoxToWorld>, color: number, alpha: number) => {
      const b = scaleBox(box);
      this.overlayGfx.lineStyle(1, color, alpha);
      this.overlayGfx.strokeRect(b.left, b.top, b.right - b.left, b.bottom - b.top);
    };

    // Hurtbox for the state this clip corresponds to during real gameplay (standing by default).
    const hurtboxState = HURTBOX_STATE_FOR_CLIP[clip] ?? 'idle';
    const hb = hurtboxFor({ def, state: hurtboxState } as unknown as Parameters<typeof hurtboxFor>[0]);
    strokeBox(localBoxToWorld(hb, this.sprite.x, this.sprite.y, facing), 0x35c26b, 0.9);

    // All of this move's hit windows overlaid together (not synced to the current pose frame --
    // see the class doc comment) so reach/positioning can be checked against the character art.
    if ((MOVE_CLIPS as string[]).includes(clip)) {
      const move = def.moves[clip as MoveKind];
      for (const hit of move.hits) {
        strokeBox(localBoxToWorld(hit.box, this.sprite.x, this.sprite.y, facing), 0xff5555, 0.95);
      }
      if (move.projectile) {
        const spawnX = this.sprite.x + move.projectile.spawnOffset.x * facing * SPRITE_SCALE;
        const spawnY = this.sprite.y + move.projectile.spawnOffset.y * SPRITE_SCALE;
        strokeBox(localBoxToWorld(move.projectile.box, spawnX, spawnY, facing), 0x8fe9ff, 0.95);
      }
    }
  }
}
