import { drawArcadeBackdrop } from '../render/arcadeTheme';
import Phaser from 'phaser';
import { SceneKeys } from './sceneKeys';
import { GameContext } from '../GameContext';
import { TransitionGuard } from '../ui/TransitionGuard';
import { MenuNavRepeater } from '../ui/menuInput';
import { BASE_WIDTH, BASE_HEIGHT } from '../sim/constants';
import { ALL_FIGHTER_IDS, type FighterId } from '../sim/types';
import { CHARACTERS } from '../data/characters';
import { buildFighterVisuals, parseFrameKey } from '../render/SpriteFactory';
import { FighterView } from '../render/FighterView';
import { buildLadder } from '../progression/ArcadeLadder';
import { labelForBinding } from '../input/bindings';

const GRID_COLS = 3;
const TILE_W = 70;
const TILE_H = 58;
const GRID_ORIGIN_X = BASE_WIDTH / 2 - TILE_W * 1.5;
const GRID_ORIGIN_Y = 40;
const PREVIEW_Y = 246;
const PREVIEW_SCALE = 0.72;

const P2_TINT = 0x99c2ff;

export class CharacterSelectScene extends Phaser.Scene {
  private guard = new TransitionGuard();
  private nav1 = new MenuNavRepeater();
  private nav2 = new MenuNavRepeater();
  private roster: FighterId[] = [];
  private p1Index = 0;
  private p2Index = 1;
  private p1Confirmed = false;
  private p2Confirmed = false;
  private tileRects: Phaser.GameObjects.Rectangle[] = [];
  private tileSprites: Phaser.GameObjects.Sprite[] = [];
  private lockTexts: Phaser.GameObjects.Text[] = [];
  private p1Cursor!: Phaser.GameObjects.Rectangle;
  private p2Cursor!: Phaser.GameObjects.Rectangle;
  private previewP1: FighterView | null = null;
  private previewP2: FighterView | null = null;
  private p1InfoText!: Phaser.GameObjects.Text;
  private p2InfoText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private mode: 'arcade' | 'versus' | 'training' = 'arcade';

  constructor() {
    super(SceneKeys.CharacterSelect);
  }

  init(): void {
    this.proceeded = false;
    this.tileRects = [];
    this.tileSprites = [];
    this.lockTexts = [];
    this.previewP1 = null;
    this.previewP2 = null;
  }

  create(): void {
    this.guard.arm(GameContext.input);
    this.mode = GameContext.session.mode ?? 'arcade';
    this.roster = ALL_FIGHTER_IDS.filter((id) => id !== 'elon' || this.mode !== 'arcade');
    this.p1Confirmed = false;
    this.p2Confirmed = false;
    this.p1Index = 0;
    this.p2Index = Math.min(1, this.roster.length - 1);
    drawArcadeBackdrop(this);

    const title = this.mode === 'versus' ? 'TWO PLAYERS - CHOOSE YOUR FIGHTERS' : this.mode === 'training' ? 'TRAINING - CHOOSE YOUR FIGHTER' : 'SINGLE PLAYER - CHOOSE YOUR FIGHTER';
    this.add.text(BASE_WIDTH / 2, 10, title, { fontFamily: 'monospace', fontSize: '10px', color: '#fff23d' }).setOrigin(0.5, 0);

    this.roster.forEach((id, i) => {
      const col = i % GRID_COLS;
      const row = Math.floor(i / GRID_COLS);
      const x = GRID_ORIGIN_X + col * TILE_W + TILE_W / 2;
      const y = GRID_ORIGIN_Y + row * TILE_H + TILE_H / 2;
      const def = CHARACTERS[id];
      const locked = id === 'elon' && !GameContext.save.elonUnlocked;

      const rect = this.add.rectangle(x, y, TILE_W - 8, TILE_H - 8, 0x321964).setStrokeStyle(1, 0x854ac7);
      this.tileRects.push(rect);

      const visuals = buildFighterVisuals(this, def);
      const portrait = parseFrameKey(visuals.portraitFrame);
      const spr = this.add.sprite(x, y - 2, portrait.texture, portrait.frame);
      spr.setOrigin(0.5, 0.85);
      spr.setScale(0.62);
      if (locked) spr.setTint(0x2a2a33);
      this.tileSprites.push(spr);

      this.add.text(x, y + 19, def.name.toUpperCase(), { fontFamily: 'monospace', fontSize: '7px', color: locked ? '#4a4a55' : '#f5f1ff' }).setOrigin(0.5, 0.5);

      const lockText = this.add
        .text(x, y - 4, locked ? 'LOCKED' : '', { fontFamily: 'monospace', fontSize: '7px', color: '#ff6b6b' })
        .setOrigin(0.5, 0.5);
      this.lockTexts.push(lockText);
      if (locked) {
        this.add.text(x, y + 26, 'Beat Arcade', { fontFamily: 'monospace', fontSize: '6px', color: '#b9b3da' }).setOrigin(0.5, 0.5);
      }
    });

    this.p1Cursor = this.add.rectangle(0, 0, TILE_W - 4, TILE_H - 4).setStrokeStyle(2, 0xfff23d);
    this.p2Cursor = this.add.rectangle(0, 0, TILE_W - 10, TILE_H - 10).setStrokeStyle(2, 0x4fd0ff);
    this.p2Cursor.setVisible(this.mode === 'versus');

    const infoStyle = { fontFamily: 'monospace', fontSize: '8px', color: '#f5f1ff', lineSpacing: 3 } as const;
    if (this.mode === 'versus') {
      this.p1InfoText = this.add.text(6, 195, '', { ...infoStyle, color: '#ffe28a' });
      this.p2InfoText = this.add.text(BASE_WIDTH - 6, 195, '', { ...infoStyle, color: '#a8d8ff', align: 'right' }).setOrigin(1, 0);
    } else {
      this.p1InfoText = this.add.text(BASE_WIDTH / 2, 195, '', { ...infoStyle, align: 'center' }).setOrigin(0.5, 0);
      this.p2InfoText = this.add.text(0, 0, '').setVisible(false);
    }
    this.statusText = this.add
      .text(BASE_WIDTH / 2, BASE_HEIGHT - 10, '', { fontFamily: 'monospace', fontSize: '8px', color: '#b9b3da' })
      .setOrigin(0.5, 0.5);

    this.refreshCursors();
    this.updatePreview();
  }

  private isSelectable(id: FighterId): boolean {
    return id !== 'elon' || GameContext.save.elonUnlocked;
  }

  private moveIndex(current: number, dir: number): number {
    let next = current;
    for (let i = 0; i < this.roster.length; i++) {
      next = Phaser.Math.Wrap(next + dir, 0, this.roster.length);
      if (this.isSelectable(this.roster[next])) break;
    }
    return next;
  }

  private refreshCursors(): void {
    const p1Pos = this.tilePosition(this.p1Index);
    this.p1Cursor.setPosition(p1Pos.x, p1Pos.y);
    if (this.mode === 'versus') {
      const p2Pos = this.tilePosition(this.p2Index);
      this.p2Cursor.setPosition(p2Pos.x, p2Pos.y);
    }
  }

  private tilePosition(index: number): { x: number; y: number } {
    const col = index % GRID_COLS;
    const row = Math.floor(index / GRID_COLS);
    return { x: GRID_ORIGIN_X + col * TILE_W + TILE_W / 2, y: GRID_ORIGIN_Y + row * TILE_H + TILE_H / 2 };
  }

  /** Builds one player's independent info panel: name, profession, move hint, and their own confirm/cancel keys. */
  private describeFighter(id: FighterId, label: string, binds: { basic: string[]; block: string[] }): string {
    const def = CHARACTERS[id];
    return [
      `${label}: ${def.name.toUpperCase()} - ${def.profession}`,
      `"${def.tagline}"`,
      `POWER ${'#'.repeat(def.power)}${'.'.repeat(5 - def.power)}  SPEED ${'#'.repeat(def.speed)}${'.'.repeat(5 - def.speed)}  REACH ${'#'.repeat(def.reach)}${'.'.repeat(5 - def.reach)}`,
      `Special: ${def.moves.special.name}`,
      `Confirm: ${labelForBinding(binds.basic)}   Cancel: ${labelForBinding(binds.block)}`,
    ].join('\n');
  }

  private updatePreview(): void {
    this.previewP1?.destroy();
    this.previewP1 = null;
    const id1 = this.roster[this.p1Index];
    this.previewP1 = new FighterView(this, CHARACTERS[id1], 130, PREVIEW_Y);
    this.previewP1.sprite.setScale(PREVIEW_SCALE);
    this.previewP1.playIdlePreview();
    this.p1InfoText.setText(this.describeFighter(id1, 'P1', GameContext.save.bindings.p1));

    if (this.mode === 'versus') {
      this.previewP2?.destroy();
      this.previewP2 = null;
      const id2 = this.roster[this.p2Index];
      const mirror = id1 === id2;
      this.previewP2 = new FighterView(this, CHARACTERS[id2], BASE_WIDTH - 130, PREVIEW_Y, mirror ? { tintOverride: P2_TINT } : undefined);
      this.previewP2.sprite.setScale(PREVIEW_SCALE);
      this.previewP2.playIdlePreview();
      this.previewP2.sprite.setFlipX(true);
      this.p2InfoText.setText(this.describeFighter(id2, 'P2', GameContext.save.bindings.p2));
    }

    this.statusText.setText(
      this.mode === 'versus'
        ? `P1 ${this.p1Confirmed ? 'READY' : 'choosing...'}   P2 ${this.p2Confirmed ? 'READY' : 'choosing...'}`
        : this.p1Confirmed
          ? 'READY'
          : 'Choose your fighter',
    );
  }

  update(): void {
    this.guard.poll(GameContext.input);
    if (!this.guard.ready()) return;
    const frame = GameContext.input.captureFrame();

    if (!this.p1Confirmed) {
      const n1 = this.nav1.update(frame.p1, frame.p1);
      let moved = false;
      if (n1.left) {
        this.p1Index = this.moveIndex(this.p1Index, -1);
        moved = true;
      }
      if (n1.right) {
        this.p1Index = this.moveIndex(this.p1Index, 1);
        moved = true;
      }
      if (n1.up) {
        this.p1Index = this.moveIndex(this.p1Index, -GRID_COLS);
        moved = true;
      }
      if (n1.down) {
        this.p1Index = this.moveIndex(this.p1Index, GRID_COLS);
        moved = true;
      }
      if (moved) {
        GameContext.audio.playSfx('select');
        this.refreshCursors();
        this.updatePreview();
      }
      if (frame.p1.basicPressed) this.confirmP1();
      if (frame.p1.blockPressed) {
        this.scene.start(SceneKeys.MainMenu);
        return;
      }
    } else if (frame.p1.blockPressed) {
      this.p1Confirmed = false;
      this.updatePreview();
    }

    if (this.mode === 'versus' && !this.p2Confirmed) {
      const n2 = this.nav2.update(frame.p2, frame.p2);
      let moved = false;
      if (n2.left) {
        this.p2Index = this.moveIndex(this.p2Index, -1);
        moved = true;
      }
      if (n2.right) {
        this.p2Index = this.moveIndex(this.p2Index, 1);
        moved = true;
      }
      if (n2.up) {
        this.p2Index = this.moveIndex(this.p2Index, -GRID_COLS);
        moved = true;
      }
      if (n2.down) {
        this.p2Index = this.moveIndex(this.p2Index, GRID_COLS);
        moved = true;
      }
      if (moved) {
        GameContext.audio.playSfx('select');
        this.refreshCursors();
        this.updatePreview();
      }
      if (frame.p2.basicPressed) this.confirmP2();
    } else if (this.mode === 'versus' && frame.p2.blockPressed) {
      this.p2Confirmed = false;
      this.updatePreview();
    }

    this.maybeProceed();
  }

  private confirmP1(): void {
    GameContext.audio.playSfx('confirm');
    this.p1Confirmed = true;
    this.updatePreview();
  }

  private confirmP2(): void {
    GameContext.audio.playSfx('confirm');
    this.p2Confirmed = true;
    this.updatePreview();
  }

  private proceeded = false;
  private maybeProceed(): void {
    if (this.proceeded) return;
    const ready = this.mode === 'versus' ? this.p1Confirmed && this.p2Confirmed : this.p1Confirmed;
    if (!ready) return;
    this.proceeded = true;
    const p1Id = this.roster[this.p1Index];
    GameContext.session.p1Fighter = p1Id;

    if (this.mode === 'arcade') {
      GameContext.session.arcadeFighter = p1Id;
      GameContext.session.arcadeLadder = buildLadder(p1Id);
      GameContext.session.arcadeIndex = 0;
      GameContext.session.p2Fighter = GameContext.session.arcadeLadder[0].opponent;
      GameContext.session.stage = GameContext.session.arcadeLadder[0].stage;
      this.time.delayedCall(150, () => this.scene.start(SceneKeys.ArcadeIntermission));
    } else if (this.mode === 'versus') {
      GameContext.session.p2Fighter = this.roster[this.p2Index];
      this.time.delayedCall(150, () => this.scene.start(SceneKeys.StageSelect));
    } else {
      GameContext.session.p2Fighter = p1Id === 'kevin' ? 'hunter' : 'kevin';
      this.time.delayedCall(150, () => this.scene.start(SceneKeys.StageSelect));
    }
  }
}
