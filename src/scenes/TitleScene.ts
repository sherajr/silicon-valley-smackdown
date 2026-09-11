import Phaser from 'phaser';
import { SceneKeys } from './sceneKeys';
import { GameContext } from '../GameContext';
import { TransitionGuard } from '../ui/TransitionGuard';
import { BASE_WIDTH, BASE_HEIGHT } from '../sim/constants';

export class TitleScene extends Phaser.Scene {
  private guard = new TransitionGuard();
  private prompt!: Phaser.GameObjects.Text;

  constructor() {
    super(SceneKeys.Title);
  }

  create(): void {
    this.guard.arm(GameContext.input);
    this.cameras.main.setBackgroundColor('#0a0a14');

    const title = this.add
      .text(BASE_WIDTH / 2, BASE_HEIGHT / 2 - 40, 'SILICON VALLEY\nSMACKDOWN', {
        fontFamily: 'monospace',
        fontSize: '26px',
        color: '#ffd23f',
        align: 'center',
      })
      .setOrigin(0.5, 0.5);
    this.tweens.add({ targets: title, scale: { from: 0.92, to: 1.0 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut' });

    this.add
      .text(BASE_WIDTH / 2, BASE_HEIGHT / 2 + 10, 'a fictional arcade fighting parody', {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#8892b0',
      })
      .setOrigin(0.5, 0.5);

    this.prompt = this.add
      .text(BASE_WIDTH / 2, BASE_HEIGHT - 40, 'PRESS START', { fontFamily: 'monospace', fontSize: '13px', color: '#ffffff' })
      .setOrigin(0.5, 0.5);
    this.tweens.add({ targets: this.prompt, alpha: { from: 1, to: 0.15 }, duration: 650, yoyo: true, repeat: -1 });

    this.input.once('pointerdown', () => this.tryStart());
  }

  update(): void {
    this.guard.poll(GameContext.input);
    const frame = GameContext.input.captureFrame();
    if (this.guard.ready() && (frame.p1.basicPressed || frame.p2.basicPressed || frame.pausePressed)) {
      this.tryStart();
    }
  }

  private started = false;
  private tryStart(): void {
    if (this.started) return;
    this.started = true;
    GameContext.audio.resume();
    GameContext.audio.playMusic('menu');
    this.scene.start(SceneKeys.MainMenu);
  }
}
