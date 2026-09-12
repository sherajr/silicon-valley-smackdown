import { drawArcadeBackdrop } from '../render/arcadeTheme';
import Phaser from 'phaser';
import { SceneKeys } from './sceneKeys';
import { GameContext } from '../GameContext';
import { TransitionGuard } from '../ui/TransitionGuard';
import { MenuNavRepeater } from '../ui/menuInput';
import { MenuList } from '../ui/MenuList';
import { BASE_WIDTH, BASE_HEIGHT } from '../sim/constants';
import { CHARACTERS, ELON_BOSS } from '../data/characters';
import { STAGES } from '../data/stages';
import { FighterView } from '../render/FighterView';
import type { Difficulty } from '../sim/types';

export class ArcadeIntermissionScene extends Phaser.Scene {
  private guard = new TransitionGuard();
  private nav = new MenuNavRepeater();
  private menu: MenuList | null = null;
  private choosingDifficulty = false;
  private advanced = false;

  constructor() {
    super(SceneKeys.ArcadeIntermission);
  }

  create(): void {
    this.guard.arm(GameContext.input);
    this.advanced = false;
    drawArcadeBackdrop(this);
    this.choosingDifficulty = GameContext.session.arcadeIndex === 0;

    if (this.choosingDifficulty) {
      this.showDifficultyPicker();
    } else {
      this.showOpponentCard();
    }
  }

  private showDifficultyPicker(): void {
    this.add.text(BASE_WIDTH / 2, 60, 'CHOOSE DIFFICULTY', { fontFamily: 'monospace', fontSize: '14px', color: '#fff23d' }).setOrigin(0.5, 0.5);
    const pick = (d: Difficulty) => {
      GameContext.session.difficulty = d;
      GameContext.save.lastDifficulty = d;
      GameContext.persist();
      this.choosingDifficulty = false;
      this.menu?.destroy();
      this.showOpponentCard();
    };
    this.menu = new MenuList(this, BASE_WIDTH / 2, 120, 24, [
      { label: 'Easy', onSelect: () => pick('easy') },
      { label: 'Normal', onSelect: () => pick('normal') },
      { label: 'Hard', onSelect: () => pick('hard') },
    ]);
    this.menu.setIndex(GameContext.save.lastDifficulty === 'easy' ? 0 : GameContext.save.lastDifficulty === 'hard' ? 2 : 1);
  }

  private showOpponentCard(): void {
    this.menu = null;
    const { arcadeLadder, arcadeIndex, arcadeFighter } = GameContext.session;
    const stop = arcadeLadder[arcadeIndex];
    const opponentDef = stop.opponent === 'elon' ? ELON_BOSS : CHARACTERS[stop.opponent];
    const playerDef = CHARACTERS[arcadeFighter];
    const stageDef = STAGES[stop.stage];

    const isBoss = stop.opponent === 'elon';
    this.add
      .text(BASE_WIDTH / 2, 20, isBoss ? 'FINAL OPPONENT' : `MATCH ${arcadeIndex + 1} OF ${arcadeLadder.length}`, { fontFamily: 'monospace', fontSize: '9px', color: '#b9b3da' })
      .setOrigin(0.5, 0.5);
    this.add.text(BASE_WIDTH / 2, 38, stageDef.name.toUpperCase(), { fontFamily: 'monospace', fontSize: '9px', color: stageDef.palette.neon }).setOrigin(0.5, 0.5);

    if (isBoss) {
      this.add.text(BASE_WIDTH / 2, 60, 'Rooftop lights dim. A rocket descends.', { fontFamily: 'monospace', fontSize: '8px', color: '#b9b3da' }).setOrigin(0.5, 0.5);
    }

    const view = new FighterView(this, opponentDef, BASE_WIDTH / 2, 160);
    view.sprite.setScale(2.4);

    this.add.text(BASE_WIDTH / 2, 205, opponentDef.name.toUpperCase(), { fontFamily: 'monospace', fontSize: '12px', color: '#ff6b6b' }).setOrigin(0.5, 0.5);
    this.add.text(BASE_WIDTH / 2, 220, `"${opponentDef.introLine}"`, { fontFamily: 'monospace', fontSize: '8px', color: '#f5f1ff' }).setOrigin(0.5, 0.5);
    this.add.text(BASE_WIDTH / 2, 235, `${playerDef.name}: "Let's get this over with."`, { fontFamily: 'monospace', fontSize: '7px', color: '#8fa0ff' }).setOrigin(0.5, 0.5);

    this.add
      .text(BASE_WIDTH / 2, BASE_HEIGHT - 12, 'Press Basic to continue', { fontFamily: 'monospace', fontSize: '7px', color: '#b9b3da' })
      .setOrigin(0.5, 0.5);

    this.time.delayedCall(2600, () => this.advance());
  }

  private advance(): void {
    if (this.advanced) return;
    this.advanced = true;
    this.scene.start(SceneKeys.Fight);
  }

  update(): void {
    this.guard.poll(GameContext.input);
    if (!this.guard.ready()) return;
    const frame = GameContext.input.captureFrame();
    const nav = this.nav.update(frame.p1, frame.p2);

    if (this.choosingDifficulty) {
      if (nav.up) this.menu?.moveUp();
      if (nav.down) this.menu?.moveDown();
      if (nav.confirm) this.menu?.confirm();
      return;
    }

    if (frame.p1.basicPressed || frame.p2.basicPressed) this.advance();
  }
}
