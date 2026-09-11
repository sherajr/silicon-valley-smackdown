import Phaser from 'phaser';
import { SceneKeys } from './sceneKeys';
import { GameContext } from '../GameContext';
import { TransitionGuard } from '../ui/TransitionGuard';
import { MenuNavRepeater } from '../ui/menuInput';
import { BASE_WIDTH, BASE_HEIGHT } from '../sim/constants';
import { labelForBinding } from '../input/bindings';

export class HowToPlayScene extends Phaser.Scene {
  private guard = new TransitionGuard();
  private nav = new MenuNavRepeater();
  private page = 0;
  private pageText!: Phaser.GameObjects.Text;
  private pageIndicator!: Phaser.GameObjects.Text;
  private pages: string[] = [];

  constructor() {
    super(SceneKeys.HowToPlay);
  }

  create(): void {
    this.guard.arm(GameContext.input);
    this.page = 0;
    this.cameras.main.setBackgroundColor('#0e0e18');

    const p1 = GameContext.save.bindings.p1;
    const p2 = GameContext.save.bindings.p2;

    this.pages = [
      [
        'CONTROLS',
        '',
        `Move: P1 ${labelForBinding(p1.moveLeft)}/${labelForBinding(p1.moveRight)}   P2 ${labelForBinding(p2.moveLeft)}/${labelForBinding(p2.moveRight)}`,
        `Jump: P1 ${labelForBinding(p1.up)}   P2 ${labelForBinding(p2.up)}`,
        `Crouch: P1 ${labelForBinding(p1.down)}   P2 ${labelForBinding(p2.down)}`,
        `Basic: P1 ${labelForBinding(p1.basic)}   P2 ${labelForBinding(p2.basic)}`,
        `Special: P1 ${labelForBinding(p1.special)}   P2 ${labelForBinding(p2.special)}`,
        `Block (hold): P1 ${labelForBinding(p1.block)}   P2 ${labelForBinding(p2.block)}`,
        `Grab: P1 ${labelForBinding(p1.grab)}   P2 ${labelForBinding(p2.grab)}`,
        'Super: Basic + Special together, with a full Hype meter',
        'Pause: Escape',
        '',
        'P2 default is a numeric keypad: 4/5/6/+. A laptop preset (arrows + J/K/L/;) is in Settings.',
      ].join('\n'),
      [
        'THE BASICS',
        '',
        'Each match is best of 3 rounds, 90 seconds each.',
        'A three-hit Basic chain, a crouching low, a jumping overhead, and a',
        'Forward+Basic heavy all lead into each other with practice.',
        '',
        'Standing Block stops mid/high/overhead strikes.',
        'Crouch-Block (hold Down + Block) stops mid/low strikes, but loses to overheads.',
        'Crouching alone ducks under high strikes entirely.',
        '',
        'Grabs beat blocking but need close range, and can be escaped by',
        'pressing Grab again within a short window after being caught.',
      ].join('\n'),
      [
        'HYPE, GUARD & PICKUPS',
        '',
        'Landing and taking real hits fills your Hype meter. At full Hype,',
        'Basic + Special together unleashes your Super.',
        '',
        'Blocking drains a guard gauge and chips a little health.',
        'An empty guard gauge causes a brief Guard Break.',
        '',
        'GPU boosts outgoing damage, Coffee boosts movement speed, and a',
        'Signing Bonus restores health. Pickups can be disabled before a match.',
        '',
        'Long combos are capped -- big strings end in a forced knockdown',
        'with a moment of wake-up protection.',
      ].join('\n'),
    ];

    this.pageText = this.add
      .text(30, 20, '', { fontFamily: 'monospace', fontSize: '9px', color: '#d8d8ee', lineSpacing: 5 })
      .setOrigin(0, 0);
    this.pageIndicator = this.add
      .text(BASE_WIDTH / 2, BASE_HEIGHT - 24, '', { fontFamily: 'monospace', fontSize: '8px', color: '#8a8a99' })
      .setOrigin(0.5, 0.5);
    this.add
      .text(BASE_WIDTH / 2, BASE_HEIGHT - 10, 'Left/Right to page, Block to return', { fontFamily: 'monospace', fontSize: '7px', color: '#7a7f96' })
      .setOrigin(0.5, 0.5);

    this.refresh();
  }

  private refresh(): void {
    this.pageText.setText(this.pages[this.page]);
    this.pageIndicator.setText(`Page ${this.page + 1} / ${this.pages.length}`);
  }

  update(): void {
    this.guard.poll(GameContext.input);
    if (!this.guard.ready()) return;
    const frame = GameContext.input.captureFrame();
    const nav = this.nav.update(frame.p1, frame.p2);
    if (nav.left) {
      this.page = Phaser.Math.Wrap(this.page - 1, 0, this.pages.length);
      this.refresh();
    }
    if (nav.right) {
      this.page = Phaser.Math.Wrap(this.page + 1, 0, this.pages.length);
      this.refresh();
    }
    if (nav.cancel || frame.pausePressed) this.scene.start(SceneKeys.MainMenu);
  }
}
