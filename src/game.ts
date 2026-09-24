import Phaser from 'phaser';
import { BASE_WIDTH, BASE_HEIGHT } from './sim/constants';
import { GameContext } from './GameContext';
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
  // Transparent so the 3D canvas (inserted behind Phaser's own canvas -- see
  // src/render3d/GameRenderer3D.ts) shows through wherever Phaser doesn't paint over it. Every
  // non-3D scene is unaffected: #app's own CSS background (index.html) is the same #100a30, and
  // 2D FightScene still paints an opaque StageView covering the whole canvas as before.
  transparent: true,
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
  // The soundtrack plays through a detached `new Audio()` element that never enters the DOM, so
  // there is no way to observe it from a test without a handle on the manager that owns it. The
  // packaged desktop app in particular resolves the track through smackdown:// with a different
  // base than the browser build, and that is only worth asserting if playback can be read back.
  (window as unknown as { __e2eAudio?: unknown }).__e2eAudio = GameContext.audio;
  // Lets tests jump straight into a specific match (fighters/stage/mode) instead of driving menu
  // navigation, e.g. for the 3D presentation compositing/mirror-match checks in
  // tests/e2e/render3d-compositing.spec.ts. Inert unless ?e2e=1, same as the hooks above.
  (window as unknown as { __e2eContext?: unknown }).__e2eContext = GameContext;
}
