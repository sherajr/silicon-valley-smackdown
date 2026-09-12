import Phaser from 'phaser';
import { SceneKeys } from './sceneKeys';
import { GameContext } from '../GameContext';
import { buildFighterVisuals } from '../render/SpriteFactory';
import { ALL_FIGHTER_IDS } from '../sim/types';
import { CHARACTERS } from '../data/characters';

export class BootScene extends Phaser.Scene {
  constructor() {
    super(SceneKeys.Boot);
  }

  create(): void {
    GameContext.audio.init();
    for (const id of ALL_FIGHTER_IDS) {
      buildFighterVisuals(this, CHARACTERS[id]);
    }
    const devViewer = new URLSearchParams(location.search).get('animviewer') === '1';
    this.scene.start(devViewer ? SceneKeys.AnimationViewer : SceneKeys.Title);
  }
}
