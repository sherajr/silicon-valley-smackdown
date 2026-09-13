import { drawArcadeBackdrop } from '../render/arcadeTheme';
import Phaser from 'phaser';
import { SceneKeys } from './sceneKeys';
import { GameContext } from '../GameContext';
import { TransitionGuard } from '../ui/TransitionGuard';
import { BASE_WIDTH, BASE_HEIGHT } from '../sim/constants';
import { ALL_FIGHTER_IDS } from '../sim/types';
import { CHARACTERS } from '../data/characters';
import { buildFighterVisuals } from '../render/SpriteFactory';

/** On-screen height of each fighter in the title screen's roster line. */
const TITLE_ROSTER_H = 70;

export class TitleScene extends Phaser.Scene {
  private guard = new TransitionGuard();
  private prompt!: Phaser.GameObjects.Text;
  private started = false;

  constructor() {
    super(SceneKeys.Title);
  }

  init(): void {
    this.started = false;
  }

  create(): void {
    this.guard.arm(GameContext.input);
    drawArcadeBackdrop(this);

    const title = this.add
      .text(BASE_WIDTH / 2, 58, 'SILICON VALLEY\nSMACKDOWN', {
        fontFamily: 'monospace',
        fontSize: '22px',
        color: '#fff23d',
        align: 'center',
        lineSpacing: 6,
      })
      .setOrigin(0.5, 0.5);
    this.tweens.add({ targets: title, scale: { from: 0.94, to: 1.0 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut' });

    this.add
      .text(BASE_WIDTH / 2, 102, 'a fictional arcade fighting parody', {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#a8eaff',
      })
      .setOrigin(0.5, 0.5);

    this.prompt = this.add
      .text(BASE_WIDTH / 2, 128, 'PRESS START', { fontFamily: 'monospace', fontSize: '13px', color: '#ffffff' })
      .setOrigin(0.5, 0.5);
    this.tweens.add({ targets: this.prompt, alpha: { from: 1, to: 0.15 }, duration: 650, yoyo: true, repeat: -1 });

    this.add.rectangle(BASE_WIDTH / 2, BASE_HEIGHT - 12, BASE_WIDTH, 2, 0xfff23d, 0.35);

    const n = ALL_FIGHTER_IDS.length;
    ALL_FIGHTER_IDS.forEach((id, i) => {
      const visuals = buildFighterVisuals(this, CHARACTERS[id]);
      const x = BASE_WIDTH / 2 + (i - (n - 1) / 2) * 64;
      const spr = this.add.sprite(x, BASE_HEIGHT - 12, visuals.idleSheet, 0);
      spr.setOrigin(visuals.originX, visuals.originY);
      // Height, not a raw scale: painted cells and rig cells differ, and a fixed scale would
      // render the roster line at two different sizes depending on which source resolved.
      spr.setScale(TITLE_ROSTER_H / visuals.cellH);
      spr.play(visuals.idleAnim);
    });

    this.input.once('pointerdown', () => this.tryStart());
  }

  update(): void {
    this.guard.poll(GameContext.input);
    const frame = GameContext.input.captureFrame();
    if (this.guard.ready() && (frame.p1.basicPressed || frame.p2.basicPressed || frame.pausePressed)) {
      this.tryStart();
    }
  }

  private tryStart(): void {
    if (this.started) return;
    this.started = true;
    GameContext.audio.resume();
    GameContext.audio.playMusic('menu');
    this.scene.start(SceneKeys.MainMenu);
  }
}
