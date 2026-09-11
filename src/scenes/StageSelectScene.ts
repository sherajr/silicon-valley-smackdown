import Phaser from 'phaser';
import { SceneKeys } from './sceneKeys';
import { GameContext } from '../GameContext';
import { TransitionGuard } from '../ui/TransitionGuard';
import { MenuNavRepeater } from '../ui/menuInput';
import { BASE_WIDTH, BASE_HEIGHT } from '../sim/constants';
import { ALL_STAGE_IDS } from '../sim/types';
import { STAGES } from '../data/stages';

export class StageSelectScene extends Phaser.Scene {
  private guard = new TransitionGuard();
  private nav = new MenuNavRepeater();
  private index = 0;
  private powerups = true;
  private tiles: Phaser.GameObjects.Rectangle[] = [];
  private cursor!: Phaser.GameObjects.Rectangle;
  private powerupText!: Phaser.GameObjects.Text;
  private mode: 'versus' | 'training' = 'versus';
  private choosingPowerup = false;

  constructor() {
    super(SceneKeys.StageSelect);
  }

  create(): void {
    this.guard.arm(GameContext.input);
    this.mode = GameContext.session.mode === 'training' ? 'training' : 'versus';
    this.powerups = this.mode === 'training' ? false : GameContext.session.powerupsEnabled;
    this.index = 0;
    this.choosingPowerup = false;
    this.cameras.main.setBackgroundColor('#101018');

    this.add.text(BASE_WIDTH / 2, 12, 'CHOOSE YOUR STAGE', { fontFamily: 'monospace', fontSize: '11px', color: '#ffd23f' }).setOrigin(0.5, 0.5);

    const spacing = 150;
    const startX = BASE_WIDTH / 2 - spacing;
    ALL_STAGE_IDS.forEach((id, i) => {
      const stage = STAGES[id];
      const x = startX + i * spacing;
      const y = 100;
      const bg = Phaser.Display.Color.HexStringToColor(stage.palette.mid).color;
      const rect = this.add.rectangle(x, y, 128, 72, bg).setStrokeStyle(1, 0x33334a);
      this.tiles.push(rect);
      this.add.text(x, y + 46, stage.name, { fontFamily: 'monospace', fontSize: '7px', color: '#d8d8ee', align: 'center', wordWrap: { width: 130 } }).setOrigin(0.5, 0);
      this.add.text(x, y - 46, stage.location, { fontFamily: 'monospace', fontSize: '6px', color: '#8a8a99' }).setOrigin(0.5, 1);
    });

    this.cursor = this.add.rectangle(0, 0, 134, 78).setStrokeStyle(2, 0xffd23f);
    this.refreshCursor();

    if (this.mode === 'versus') {
      this.powerupText = this.add
        .text(BASE_WIDTH / 2, 190, '', { fontFamily: 'monospace', fontSize: '9px', color: '#c8c8d8' })
        .setOrigin(0.5, 0.5);
      this.refreshPowerupText();
    } else {
      this.powerupText = this.add.text(BASE_WIDTH / 2, 190, '', { fontFamily: 'monospace', fontSize: '9px' }).setOrigin(0.5, 0.5);
    }

    this.add
      .text(BASE_WIDTH / 2, BASE_HEIGHT - 14, 'Left/Right to choose, Basic to confirm, Block to go back', { fontFamily: 'monospace', fontSize: '7px', color: '#7a7f96' })
      .setOrigin(0.5, 0.5);
  }

  private refreshCursor(): void {
    const spacing = 150;
    const startX = BASE_WIDTH / 2 - spacing;
    this.cursor.setPosition(startX + this.index * spacing, 100);
  }

  private refreshPowerupText(): void {
    this.powerupText.setText(`Power-ups: ${this.powerups ? 'ON' : 'OFF'}  (Up/Down to toggle)`);
  }

  update(): void {
    this.guard.poll(GameContext.input);
    if (!this.guard.ready()) return;
    const frame = GameContext.input.captureFrame();
    const nav = this.nav.update(frame.p1, frame.p2);

    if (nav.left) {
      this.index = Phaser.Math.Wrap(this.index - 1, 0, ALL_STAGE_IDS.length);
      GameContext.audio.playSfx('select');
      this.refreshCursor();
    }
    if (nav.right) {
      this.index = Phaser.Math.Wrap(this.index + 1, 0, ALL_STAGE_IDS.length);
      GameContext.audio.playSfx('select');
      this.refreshCursor();
    }
    if (this.mode === 'versus' && (nav.up || nav.down)) {
      this.powerups = !this.powerups;
      GameContext.audio.playSfx('select');
      this.refreshPowerupText();
    }
    if (nav.confirm) this.confirm();
    if (nav.cancel) {
      this.scene.start(SceneKeys.CharacterSelect);
    }
  }

  private confirm(): void {
    GameContext.audio.playSfx('confirm');
    GameContext.session.stage = ALL_STAGE_IDS[this.index];
    GameContext.session.powerupsEnabled = this.powerups;
    if (this.mode === 'versus') {
      GameContext.session.versusWinsP1 = 0;
      GameContext.session.versusWinsP2 = 0;
      this.scene.start(SceneKeys.VersusIntro);
    } else {
      this.scene.start(SceneKeys.Fight);
    }
  }
}
