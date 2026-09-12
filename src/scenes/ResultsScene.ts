import { drawArcadeBackdrop } from '../render/arcadeTheme';
import Phaser from 'phaser';
import { SceneKeys } from './sceneKeys';
import { GameContext } from '../GameContext';
import { TransitionGuard } from '../ui/TransitionGuard';
import { MenuNavRepeater } from '../ui/menuInput';
import { MenuList } from '../ui/MenuList';
import { BASE_WIDTH, BASE_HEIGHT } from '../sim/constants';
import { CHARACTERS } from '../data/characters';
import type { FightSceneResult } from './FightScene';

export class ResultsScene extends Phaser.Scene {
  private guard = new TransitionGuard();
  private nav = new MenuNavRepeater();
  private menu!: MenuList;

  constructor() {
    super(SceneKeys.Results);
  }

  create(data: FightSceneResult): void {
    this.guard.arm(GameContext.input);
    drawArcadeBackdrop(this);

    if (data.mode === 'arcade') {
      this.createArcadeResults(data);
    } else {
      this.createVersusResults(data);
    }
  }

  private createArcadeResults(data: FightSceneResult): void {
    const playerWon = data.matchWinner === 'p1';
    const opponentDef = CHARACTERS[GameContext.session.p2Fighter] ?? CHARACTERS[GameContext.session.arcadeFighter];

    this.add
      .text(BASE_WIDTH / 2, 60, playerWon ? 'VICTORY!' : 'DEFEATED', { fontFamily: 'monospace', fontSize: '22px', color: playerWon ? '#fff23d' : '#ff6b6b' })
      .setOrigin(0.5, 0.5);
    this.add
      .text(BASE_WIDTH / 2, 90, `${data.scoreP1} - ${data.scoreP2}  vs  ${opponentDef.name}`, { fontFamily: 'monospace', fontSize: '10px', color: '#f5f1ff' })
      .setOrigin(0.5, 0.5);

    if (playerWon) {
      this.add.text(BASE_WIDTH / 2, 115, `"${opponentDef.winLine}" -- well, not this time.`, { fontFamily: 'monospace', fontSize: '8px', color: '#b9b3da' }).setOrigin(0.5, 0.5);
      const isLastMatch = GameContext.session.arcadeIndex >= GameContext.session.arcadeLadder.length - 1;
      this.menu = new MenuList(this, BASE_WIDTH / 2, 170, 22, [
        {
          label: isLastMatch ? 'Continue to Ending' : 'Continue',
          onSelect: () => {
            if (isLastMatch) {
              if (!GameContext.save.elonUnlocked) {
                GameContext.save.elonUnlocked = true;
                GameContext.persist();
              }
              this.scene.start(SceneKeys.Ending);
            } else {
              GameContext.session.arcadeIndex++;
              const stop = GameContext.session.arcadeLadder[GameContext.session.arcadeIndex];
              GameContext.session.p2Fighter = stop.opponent;
              GameContext.session.stage = stop.stage;
              this.scene.start(SceneKeys.ArcadeIntermission);
            }
          },
        },
        { label: 'Main Menu', onSelect: () => this.scene.start(SceneKeys.MainMenu) },
      ]);
    } else {
      this.menu = new MenuList(this, BASE_WIDTH / 2, 150, 22, [
        { label: 'Retry Opponent', onSelect: () => this.scene.start(SceneKeys.Fight) },
        { label: 'Main Menu', onSelect: () => this.scene.start(SceneKeys.MainMenu) },
      ]);
    }
  }

  private createVersusResults(data: FightSceneResult): void {
    if (data.matchWinner === 'p1') GameContext.session.versusWinsP1++;
    else GameContext.session.versusWinsP2++;

    this.add.text(BASE_WIDTH / 2, 50, `${data.matchWinner.toUpperCase()} WINS THE MATCH`, { fontFamily: 'monospace', fontSize: '16px', color: '#fff23d' }).setOrigin(0.5, 0.5);
    this.add
      .text(BASE_WIDTH / 2, 76, `${data.scoreP1} - ${data.scoreP2}   |   Session: P1 ${GameContext.session.versusWinsP1} - P2 ${GameContext.session.versusWinsP2}`, {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#f5f1ff',
      })
      .setOrigin(0.5, 0.5);

    this.menu = new MenuList(this, BASE_WIDTH / 2, 130, 22, [
      { label: 'Rematch', onSelect: () => this.scene.start(SceneKeys.Fight) },
      { label: 'Character Select', onSelect: () => this.scene.start(SceneKeys.CharacterSelect) },
      { label: 'Main Menu', onSelect: () => this.scene.start(SceneKeys.MainMenu) },
    ]);
  }

  update(): void {
    this.guard.poll(GameContext.input);
    if (!this.guard.ready()) return;
    const frame = GameContext.input.captureFrame();
    const nav = this.nav.update(frame.p1, frame.p2);
    if (nav.up) this.menu.moveUp();
    if (nav.down) this.menu.moveDown();
    if (nav.confirm) this.menu.confirm();
  }
}
