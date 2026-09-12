import { drawArcadeBackdrop } from '../render/arcadeTheme';
import Phaser from 'phaser';
import { SceneKeys } from './sceneKeys';
import { GameContext } from '../GameContext';
import { TransitionGuard } from '../ui/TransitionGuard';
import { MenuNavRepeater } from '../ui/menuInput';
import { MenuList } from '../ui/MenuList';
import { BASE_WIDTH, BASE_HEIGHT } from '../sim/constants';
import { CHARACTERS } from '../data/characters';
import { ARCADE_ENDINGS } from '../data/arcadeEndings';
import { FighterView } from '../render/FighterView';

export class EndingScene extends Phaser.Scene {
  private guard = new TransitionGuard();
  private nav = new MenuNavRepeater();
  private menu!: MenuList;

  constructor() {
    super(SceneKeys.Ending);
  }

  create(): void {
    this.guard.arm(GameContext.input);
    GameContext.audio.playMusic('victory');
    drawArcadeBackdrop(this);

    const fighterId = GameContext.session.arcadeFighter;
    const def = CHARACTERS[fighterId];
    const lines = ARCADE_ENDINGS[fighterId];

    this.add.text(BASE_WIDTH / 2, 20, 'THE LAST FUNDING ROUND -- SECURED', { fontFamily: 'monospace', fontSize: '10px', color: '#fff23d' }).setOrigin(0.5, 0.5);

    const view = new FighterView(this, def, BASE_WIDTH / 2, 130);
    view.sprite.setScale(2.2);

    this.add
      .text(BASE_WIDTH / 2, 175, lines.join('\n\n'), {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: '#f5f1ff',
        align: 'center',
        wordWrap: { width: BASE_WIDTH - 60 },
      })
      .setOrigin(0.5, 0);

    this.add
      .text(BASE_WIDTH / 2, BASE_HEIGHT - 40, 'ELON UNLOCKED FOR VERSUS AND TRAINING', { fontFamily: 'monospace', fontSize: '8px', color: '#4fd0ff' })
      .setOrigin(0.5, 0.5);

    this.menu = new MenuList(this, BASE_WIDTH / 2, BASE_HEIGHT - 16, 16, [
      { label: 'Credits', onSelect: () => this.scene.start(SceneKeys.Credits) },
      { label: 'Main Menu', onSelect: () => this.scene.start(SceneKeys.MainMenu) },
    ]);
  }

  update(): void {
    this.guard.poll(GameContext.input);
    if (!this.guard.ready()) return;
    const frame = GameContext.input.captureFrame();
    const nav = this.nav.update(frame.p1, frame.p2);
    if (nav.left || nav.up) this.menu.moveUp();
    if (nav.right || nav.down) this.menu.moveDown();
    if (nav.confirm) this.menu.confirm();
  }
}
