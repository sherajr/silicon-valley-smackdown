import Phaser from 'phaser';
import { SceneKeys } from './sceneKeys';
import { GameContext } from '../GameContext';
import { TransitionGuard } from '../ui/TransitionGuard';
import { MenuNavRepeater } from '../ui/menuInput';
import { MenuList } from '../ui/MenuList';
import { BASE_WIDTH, BASE_HEIGHT } from '../sim/constants';

export class MainMenuScene extends Phaser.Scene {
  private guard = new TransitionGuard();
  private nav = new MenuNavRepeater();
  private menu!: MenuList;

  constructor() {
    super(SceneKeys.MainMenu);
  }

  create(): void {
    this.guard.arm(GameContext.input);
    GameContext.audio.playMusic('menu');
    this.cameras.main.setBackgroundColor('#0b2a4a');

    this.add
      .text(BASE_WIDTH / 2, 30, 'SILICON VALLEY SMACKDOWN', { fontFamily: 'monospace', fontSize: '13px', color: '#ffd23f' })
      .setOrigin(0.5, 0.5);

    this.menu = new MenuList(this, BASE_WIDTH / 2, 80, 22, [
      { label: 'Single Player', onSelect: () => this.goSingle() },
      { label: 'Two Players', onSelect: () => this.goVersus() },
      { label: 'Training', onSelect: () => this.goTraining() },
      { label: 'How to Play', onSelect: () => this.scene.start(SceneKeys.HowToPlay) },
      { label: 'Settings', onSelect: () => this.scene.start(SceneKeys.Settings) },
      { label: 'Credits', onSelect: () => this.scene.start(SceneKeys.Credits) },
    ]);

    this.add
      .text(BASE_WIDTH / 2, BASE_HEIGHT - 14, 'Up/Down to choose, Basic to confirm', { fontFamily: 'monospace', fontSize: '8px', color: '#7a7f96' })
      .setOrigin(0.5, 0.5);
  }

  private goSingle(): void {
    GameContext.audio.playSfx('confirm');
    GameContext.session.mode = 'arcade';
    this.scene.start(SceneKeys.CharacterSelect);
  }

  private goVersus(): void {
    GameContext.audio.playSfx('confirm');
    GameContext.session.mode = 'versus';
    this.scene.start(SceneKeys.CharacterSelect);
  }

  private goTraining(): void {
    GameContext.audio.playSfx('confirm');
    GameContext.session.mode = 'training';
    this.scene.start(SceneKeys.CharacterSelect);
  }

  update(): void {
    this.guard.poll(GameContext.input);
    if (!this.guard.ready()) return;
    const frame = GameContext.input.captureFrame();
    const nav = this.nav.update(frame.p1, frame.p2);
    if (nav.up) {
      this.menu.moveUp();
      GameContext.audio.playSfx('select');
    }
    if (nav.down) {
      this.menu.moveDown();
      GameContext.audio.playSfx('select');
    }
    if (nav.confirm) this.menu.confirm();
  }
}
