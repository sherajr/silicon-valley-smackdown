import Phaser from 'phaser';
import { BASE_WIDTH, BASE_HEIGHT } from './sim/constants';
import { BootScene } from './scenes/BootScene';
import { TitleScene } from './scenes/TitleScene';
import { MainMenuScene } from './scenes/MainMenuScene';
import { CharacterSelectScene } from './scenes/CharacterSelectScene';
import { StageSelectScene } from './scenes/StageSelectScene';
import { VersusIntroScene } from './scenes/VersusIntroScene';
import { FightScene } from './scenes/FightScene';
import { ResultsScene } from './scenes/ResultsScene';
import { ArcadeIntermissionScene } from './scenes/ArcadeIntermissionScene';
import { EndingScene } from './scenes/EndingScene';
import { HowToPlayScene } from './scenes/HowToPlayScene';
import { SettingsScene } from './scenes/SettingsScene';
import { CreditsScene } from './scenes/CreditsScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: BASE_WIDTH,
  height: BASE_HEIGHT,
  parent: 'app',
  backgroundColor: '#0a0a12',
  pixelArt: true,
  antialias: false,
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [
    BootScene,
    TitleScene,
    MainMenuScene,
    CharacterSelectScene,
    StageSelectScene,
    VersusIntroScene,
    FightScene,
    ResultsScene,
    ArcadeIntermissionScene,
    EndingScene,
    HowToPlayScene,
    SettingsScene,
    CreditsScene,
  ],
};

const fallback = document.getElementById('loading-fallback');
fallback?.remove();

const game = new Phaser.Game(config);

// Test-only hook: lets the Playwright e2e suite reach into a running match to
// force outcomes (e.g. an instant KO) instead of waiting on real combat, so
// tests stay fast and deterministic. Inert unless the page URL explicitly
// opts in, so ordinary play never exposes internals.
if (new URLSearchParams(location.search).get('e2e') === '1') {
  (window as unknown as { __e2eGame?: Phaser.Game }).__e2eGame = game;
}
