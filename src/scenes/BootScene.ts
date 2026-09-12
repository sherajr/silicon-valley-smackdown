import Phaser from 'phaser';
import { SceneKeys } from './sceneKeys';
import { GameContext } from '../GameContext';
import { buildFighterVisuals, preloadGameArt } from '../render/SpriteFactory';
import { ALL_FIGHTER_IDS, ALL_STAGE_IDS, type FighterId, type StageId } from '../sim/types';
import { CHARACTERS } from '../data/characters';

export class BootScene extends Phaser.Scene {
  constructor() {
    super(SceneKeys.Boot);
  }

  preload(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    const bar = this.add.rectangle(w / 2, h / 2, 160, 8, 0x1a1a22);
    bar.setStrokeStyle(1, 0x2a2a33);
    const fill = this.add.rectangle(w / 2 - 78, h / 2, 4, 6, 0xfff23d).setOrigin(0, 0.5);
    this.add
      .text(w / 2, h / 2 - 22, 'LOADING SMACKDOWN', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#fff23d',
      })
      .setOrigin(0.5, 0.5);
    this.load.on('progress', (value: number) => {
      fill.width = Math.max(4, 156 * value);
    });
    preloadGameArt(this);
  }

  create(): void {
    GameContext.audio.init();
    for (const id of ALL_FIGHTER_IDS) {
      buildFighterVisuals(this, CHARACTERS[id]);
    }

    const params = new URLSearchParams(location.search);
    if (params.get('skip') === 'fight') {
      const p1 = params.get('p1') as FighterId | null;
      const p2 = params.get('p2') as FighterId | null;
      const stage = params.get('stage') as StageId | null;
      GameContext.session.mode = 'training';
      GameContext.session.p1Fighter = p1 && ALL_FIGHTER_IDS.includes(p1) ? p1 : 'hunter';
      GameContext.session.p2Fighter = p2 && ALL_FIGHTER_IDS.includes(p2) ? p2 : 'priya';
      GameContext.session.stage = stage && ALL_STAGE_IDS.includes(stage) ? stage : 'castro_street';
      GameContext.session.training.dummyBehavior = 'idle';
      this.scene.start(SceneKeys.Fight);
      return;
    }

    this.scene.start(SceneKeys.Title);
  }
}
