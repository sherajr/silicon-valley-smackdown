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
import { AnimationViewerScene } from './scenes/AnimationViewerScene';

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
    // Renders at a crisp 960x540 physical resolution while every gameplay/HUD coordinate,
    // hitbox, speed, and jump height stays authored in the original 480x270 (BASE_WIDTH x
    // BASE_HEIGHT) logical space -- Phaser's Scale Manager applies this as a pure backing-
    // resolution multiplier (nearest-neighbor, since pixelArt is on below), never as a
    // change to the coordinate system CombatSim and every view already use.
    zoom: Phaser.Scale.ZOOM_2X,
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
    AnimationViewerScene,
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
