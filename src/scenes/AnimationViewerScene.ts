import Phaser from 'phaser';
import { SceneKeys } from './sceneKeys';
import { BASE_WIDTH, BASE_HEIGHT } from '../sim/constants';
import { ALL_FIGHTER_IDS, type FighterId, type FighterStateName, type MoveKind } from '../sim/types';
import { CHARACTERS } from '../data/characters';
import { buildFighterVisuals, RIG_ORIGIN_X, RIG_ORIGIN_Y, type FighterVisualSet } from '../render/SpriteFactory';
import { queueRealSpriteLoad, realFramesForClip, CHARACTERS_WITH_REAL_ART } from '../render/realSprites';
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
const RIG_SPRITE_SCALE = 2.2;
/** Real frames are trimmed at native source resolution (hundreds of px tall), not the procedural
 * rig's tiny 128x92 canvas -- this scale is a rough eyeball match so the real "ready" pose reads
 * at about the same on-screen height as the rig's idle pose in THIS viewer, for side-by-side
 * comparison. It is not a gameplay decision: FightScene doesn't use real art at all yet, so the
 * actual in-match pixel scale for this character is still open (see CODEX_NEXT.md). */
const REAL_SPRITE_SCALE = 0.5;
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
  /** Prefer real delivered art over the procedural rig wherever it's available for the current
   * fighter/clip; falls back to the rig automatically otherwise. Toggle with 'R' to compare. */
  private preferRealArt = true;
  /** Whether the frame actually on screen right now is real art (vs. rig) -- drives the display
   * scale/origin and the info-text label; recomputed every refresh(). */
  private showingRealArt = false;
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
      case 'KeyR':
        this.preferRealArt = !this.preferRealArt;
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

  preload(): void {
    for (const id of ALL_FIGHTER_IDS) {
      if (CHARACTERS_WITH_REAL_ART.has(id)) queueRealSpriteLoad(this, id);
    }
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#20222c');
    this.add.rectangle(SPRITE_X, SPRITE_Y, BASE_WIDTH, 2, 0x4a4a5a); // ground reference line at RIG anchor height

    this.sprite = this.add.sprite(SPRITE_X, SPRITE_Y, '');
    this.sprite.setOrigin(RIG_ORIGIN_X, RIG_ORIGIN_Y);
    this.sprite.setScale(RIG_SPRITE_SCALE);

    this.overlayGfx = this.add.graphics();
    this.overlayGfx.setDepth(10);

    this.infoText = this.add.text(8, 8, '', { fontFamily: 'monospace', fontSize: '9px', color: '#ffffff', lineSpacing: 3 });
    this.helpText = this.add
      .text(8, BASE_HEIGHT - 8, '', { fontFamily: 'monospace', fontSize: '8px', color: '#9aa0b0' })
      .setOrigin(0, 1);
    this.helpText.setText(
      'Left/Right: frame   Up/Down: clip   Q/E: character   F: flip facing   H: toggle overlay   R: real/rig art   Esc: exit',
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

  /** Resolves the clip to what should actually be drawn: real delivered frames when preferred and
   * available for this fighter/clip, else the procedural rig frames (the "fallback for anything
   * not yet converted" -- there is no partial/broken state here, just an automatic choice). */
  private resolveFrames(clip: ClipId, visuals: FighterVisualSet): { keys: string[]; origins: { x: number; y: number }[]; scale: number; isReal: boolean } {
    if (this.preferRealArt) {
      const real = realFramesForClip(this.currentDef().id, clip);
      if (real && real.length > 0) {
        return {
          keys: real.map((r) => r.key),
          origins: real.map((r) => ({ x: r.meta.originX, y: r.meta.originY })),
          scale: REAL_SPRITE_SCALE,
          isReal: true,
        };
      }
    }
    const keys = this.framesFor(clip, visuals);
    return {
      keys,
      origins: keys.map(() => ({ x: RIG_ORIGIN_X, y: RIG_ORIGIN_Y })),
      scale: RIG_SPRITE_SCALE,
      isReal: false,
    };
  }

  private step(dir: number): void {
    const { keys } = this.resolveFrames(CLIPS[this.clipIndex], this.currentVisuals());
    if (keys.length === 0) return;
    this.frameIndex = Phaser.Math.Wrap(this.frameIndex + dir, 0, keys.length);
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
    const resolved = this.resolveFrames(clip, visuals);
    const { keys, origins, scale, isReal } = resolved;
    this.showingRealArt = isReal;
    if (keys.length === 0) {
      this.frameIndex = 0;
    } else {
      this.frameIndex = Phaser.Math.Clamp(this.frameIndex, 0, keys.length - 1);
      this.sprite.setTexture(keys[this.frameIndex]);
      const origin = origins[this.frameIndex];
      this.sprite.setOrigin(origin.x, origin.y);
      this.sprite.setScale(scale);
    }
    this.sprite.setFlipX(this.flipped);

    const hasRealForClip = realFramesForClip(def.id, clip) !== null;
    const artLabel =
      keys.length === 0
        ? 'n/a'
        : isReal
          ? 'real'
          : !this.preferRealArt && hasRealForClip
            ? 'rig (real art available, toggled off)'
            : CHARACTERS_WITH_REAL_ART.has(def.id)
              ? 'rig (no real frame for this clip)'
              : 'rig';
    this.infoText.setText(
      [
        `Fighter: ${def.name} (${this.charIndex + 1}/${ALL_FIGHTER_IDS.length})`,
        `Clip: ${clip} -- frame ${keys.length ? this.frameIndex + 1 : 0}/${keys.length}`,
        `Art: ${artLabel} (prefer real: ${this.preferRealArt ? 'on' : 'off'})`,
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
    // Gameplay hit/hurtboxes are authored in raw sim units (1 unit = 1px at the rig's default
    // scale of 1, since the procedural canvas is drawn at sim-unit resolution). This viewer
    // enlarges the sprite for visibility, so boxes are scaled the same way around the shared
    // origin (sprite.x, sprite.y) -- accurate for the rig. For real art (`scale` = REAL_SPRITE_SCALE)
    // this keeps the boxes moving/scaling with the sprite instead of using the wrong constant, but
    // is NOT a calibrated match: REAL_SPRITE_SCALE was picked for on-screen size parity with the
    // rig, not against Hunter's actual hurtbox dimensions, so treat overlay alignment as unverified
    // whenever `showingRealArt` is true -- see CODEX_NEXT.md.
    const scaleBox = (box: ReturnType<typeof localBoxToWorld>): ReturnType<typeof localBoxToWorld> => ({
      left: this.sprite.x + (box.left - this.sprite.x) * scale,
      right: this.sprite.x + (box.right - this.sprite.x) * scale,
      top: this.sprite.y + (box.top - this.sprite.y) * scale,
      bottom: this.sprite.y + (box.bottom - this.sprite.y) * scale,
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
        const spawnX = this.sprite.x + move.projectile.spawnOffset.x * facing * scale;
        const spawnY = this.sprite.y + move.projectile.spawnOffset.y * scale;
        strokeBox(localBoxToWorld(move.projectile.box, spawnX, spawnY, facing), 0x8fe9ff, 0.95);
      }
    }
  }
}
