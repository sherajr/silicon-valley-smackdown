import { drawArcadeBackdrop } from '../render/arcadeTheme';
import Phaser from 'phaser';
import { SceneKeys } from './sceneKeys';
import { GameContext } from '../GameContext';
import { TransitionGuard } from '../ui/TransitionGuard';
import { BASE_WIDTH, BASE_HEIGHT } from '../sim/constants';
import { CHARACTERS } from '../data/characters';
import { STAGES } from '../data/stages';
import { FighterView } from '../render/FighterView';

export class VersusIntroScene extends Phaser.Scene {
  private guard = new TransitionGuard();
  private advanced = false;

  constructor() {
    super(SceneKeys.VersusIntro);
  }

  create(): void {
    this.guard.arm(GameContext.input);
    this.advanced = false;
    const { p1Fighter, p2Fighter, stage } = GameContext.session;
    const stageDef = STAGES[stage];
    const p1Def = CHARACTERS[p1Fighter];
    const p2Def = CHARACTERS[p2Fighter];

    drawArcadeBackdrop(this);
    this.add.text(BASE_WIDTH / 2, 20, stageDef.name.toUpperCase(), { fontFamily: 'monospace', fontSize: '10px', color: stageDef.palette.neon }).setOrigin(0.5, 0.5);
    this.add.text(BASE_WIDTH / 2, 40, 'VS', { fontFamily: 'monospace', fontSize: '20px', color: '#fff23d' }).setOrigin(0.5, 0.5);

    const p1View = new FighterView(this, p1Def, 130, 190);
    p1View.sprite.setScale(2.2);
    const mirror = p1Fighter === p2Fighter;
    const p2View = new FighterView(this, p2Def, BASE_WIDTH - 130, 190, mirror ? { tintOverride: 0x99c2ff } : undefined);
    p2View.sprite.setScale(2.2);
    p2View.sprite.setFlipX(true);

    this.add.text(130, 240, `P1: ${p1Def.name.toUpperCase()}`, { fontFamily: 'monospace', fontSize: '9px', color: '#fff23d' }).setOrigin(0.5, 0.5);
    this.add.text(BASE_WIDTH - 130, 240, `P2: ${p2Def.name.toUpperCase()}`, { fontFamily: 'monospace', fontSize: '9px', color: '#4fd0ff' }).setOrigin(0.5, 0.5);

    this.add.text(BASE_WIDTH / 2, 90, `"${p1Def.introLine}"`, { fontFamily: 'monospace', fontSize: '8px', color: '#f5f1ff' }).setOrigin(0.5, 0.5);

    this.time.delayedCall(1800, () => this.advance());
  }

  update(): void {
    this.guard.poll(GameContext.input);
    if (!this.guard.ready()) return;
    const frame = GameContext.input.captureFrame();
    if (frame.p1.basicPressed || frame.p2.basicPressed || frame.pausePressed) this.advance();
  }

  private advance(): void {
    if (this.advanced) return;
    this.advanced = true;
    this.scene.start(SceneKeys.Fight);
  }
}
