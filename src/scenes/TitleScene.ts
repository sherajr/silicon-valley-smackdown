import Phaser from 'phaser';
import { SceneKeys } from './sceneKeys';
import { GameContext } from '../GameContext';
import { TransitionGuard } from '../ui/TransitionGuard';
import { BASE_WIDTH, BASE_HEIGHT } from '../sim/constants';
import { ALL_FIGHTER_IDS } from '../sim/types';
import { CHARACTERS } from '../data/characters';
import { buildFighterVisuals } from '../render/SpriteFactory';

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
    this.cameras.main.setBackgroundColor('#0a0a14');

    const title = this.add
      .text(BASE_WIDTH / 2, 58, 'SILICON VALLEY\nSMACKDOWN', {
        fontFamily: 'monospace',
        fontSize: '22px',
        color: '#ffd23f',
        align: 'center',
        lineSpacing: 6,
      })
      .setOrigin(0.5, 0.5);
    this.tweens.add({ targets: title, scale: { from: 0.94, to: 1.0 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut' });

    this.add
      .text(BASE_WIDTH / 2, 102, 'a fictional arcade fighting parody', {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#8892b0',
      })
      .setOrigin(0.5, 0.5);

    this.prompt = this.add
      .text(BASE_WIDTH / 2, 128, 'PRESS START', { fontFamily: 'monospace', fontSize: '13px', color: '#ffffff' })
      .setOrigin(0.5, 0.5);
    this.tweens.add({ targets: this.prompt, alpha: { from: 1, to: 0.15 }, duration: 650, yoyo: true, repeat: -1 });

    this.add.rectangle(BASE_WIDTH / 2, BASE_HEIGHT - 12, BASE_WIDTH, 2, 0xffd23f, 0.35);

    const n = ALL_FIGHTER_IDS.length;
    ALL_FIGHTER_IDS.forEach((id, i) => {
      const visuals = buildFighterVisuals(this, CHARACTERS[id]);
      const x = BASE_WIDTH / 2 + (i - (n - 1) / 2) * 64;
      const spr = this.add.sprite(x, BASE_HEIGHT - 12, visuals.idleSheet, 0);
      spr.setOrigin(0.5, 1);
      spr.setScale(0.55);
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
