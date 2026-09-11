import Phaser from 'phaser';
import { SceneKeys } from './sceneKeys';
import { GameContext } from '../GameContext';
import { TransitionGuard } from '../ui/TransitionGuard';
import { BASE_WIDTH, BASE_HEIGHT } from '../sim/constants';
import { CREDITS_PARODY_NOTE } from '../data/arcadeEndings';

export class CreditsScene extends Phaser.Scene {
  private guard = new TransitionGuard();

  constructor() {
    super(SceneKeys.Credits);
  }

  create(): void {
    this.guard.arm(GameContext.input);
    this.cameras.main.setBackgroundColor('#0a0a12');

    this.add.text(BASE_WIDTH / 2, 16, 'CREDITS', { fontFamily: 'monospace', fontSize: '13px', color: '#ffd23f' }).setOrigin(0.5, 0.5);

    const lines = [
      'Silicon Valley Smackdown',
      '',
      'Design, code, pixel art, music, and sound: built for this project,',
      'entirely original and generated in-engine -- no external assets.',
      '',
      'Fighters: Hunter, Kevin, Al, Priya, Chad, and Elon.',
      'Stages: Castro Street Coffee Clash, Sand Hill Road Showdown,',
      'and Palo Alto Launch Night.',
      '',
      'Engine: TypeScript + Vite + Phaser.',
    ];
    this.add
      .text(30, 40, lines.join('\n'), { fontFamily: 'monospace', fontSize: '8px', color: '#d8d8ee', lineSpacing: 4 })
      .setOrigin(0, 0);

    this.add
      .text(30, 190, CREDITS_PARODY_NOTE, {
        fontFamily: 'monospace',
        fontSize: '7px',
        color: '#8a8a99',
        wordWrap: { width: BASE_WIDTH - 60 },
        lineSpacing: 4,
      })
      .setOrigin(0, 0);

    this.add
      .text(BASE_WIDTH / 2, BASE_HEIGHT - 14, 'Press Basic or Block to return', { fontFamily: 'monospace', fontSize: '7px', color: '#7a7f96' })
      .setOrigin(0.5, 0.5);
  }

  update(): void {
    this.guard.poll(GameContext.input);
    if (!this.guard.ready()) return;
    const frame = GameContext.input.captureFrame();
    if (frame.p1.basicPressed || frame.p2.basicPressed || frame.p1.blockPressed || frame.p2.blockPressed || frame.pausePressed) {
      this.scene.start(SceneKeys.MainMenu);
    }
  }
}
