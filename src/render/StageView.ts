import Phaser from 'phaser';
import { BASE_WIDTH, BASE_HEIGHT, GROUND_Y } from '../sim/constants';
import type { StageDef } from '../data/stages';

/**
 * Procedurally drawn layered stage background: sky gradient, three parallax
 * bands, a floor, sign text, and a couple of small looping ambient
 * animations. Built from flat vector shapes so it reads as pixel-art at the
 * game's native low resolution without needing external art assets.
 */
export class StageView {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private ambientTimers: Phaser.Time.TimerEvent[] = [];
  private ambientTweens: Phaser.Tweens.Tween[] = [];
  private crunchOverlay!: Phaser.GameObjects.Rectangle;

  constructor(scene: Phaser.Scene, stage: StageDef) {
    this.scene = scene;
    this.container = scene.add.container(0, 0);
    this.container.setDepth(-100);

    const { palette } = stage;
    const sky = scene.add.graphics();
    sky.fillGradientStyle(
      Phaser.Display.Color.HexStringToColor(palette.sky[0]).color,
      Phaser.Display.Color.HexStringToColor(palette.sky[0]).color,
      Phaser.Display.Color.HexStringToColor(palette.sky[1]).color,
      Phaser.Display.Color.HexStringToColor(palette.sky[1]).color,
      1,
    );
    sky.fillRect(0, 0, BASE_WIDTH, GROUND_Y);
    this.container.add(sky);

    this.buildBand(palette.far, GROUND_Y - 90, 0.55, 7, 34);
    this.buildBand(palette.mid, GROUND_Y - 55, 0.4, 5, 46);
    this.buildBand(palette.near, GROUND_Y - 26, 0.22, 4, 60);

    const floor = scene.add.rectangle(BASE_WIDTH / 2, GROUND_Y + (BASE_HEIGHT - GROUND_Y) / 2, BASE_WIDTH, BASE_HEIGHT - GROUND_Y, Phaser.Display.Color.HexStringToColor(palette.floor).color);
    this.container.add(floor);
    const floorLine = scene.add.rectangle(BASE_WIDTH / 2, GROUND_Y, BASE_WIDTH, 2, Phaser.Display.Color.HexStringToColor(palette.accent).color, 0.6);
    this.container.add(floorLine);

    this.buildSigns(stage);
    this.buildAmbient(stage);

    this.crunchOverlay = scene.add.rectangle(BASE_WIDTH / 2, BASE_HEIGHT / 2, BASE_WIDTH, BASE_HEIGHT, 0xaa1111, 0);
    this.crunchOverlay.setDepth(-50);
    this.container.add(this.crunchOverlay);
  }

  private buildBand(color: string, baseY: number, alpha: number, count: number, sizeBase: number): void {
    const c = Phaser.Display.Color.HexStringToColor(color).color;
    for (let i = 0; i < count; i++) {
      const w = sizeBase + ((i * 37) % 26);
      const h = sizeBase * 0.6 + ((i * 53) % 34);
      const x = (i / count) * (BASE_WIDTH + 60) - 20;
      const rect = this.scene.add.rectangle(x, baseY - h / 2 + 30, w, h, c, alpha);
      this.container.add(rect);
    }
  }

  private buildSigns(stage: StageDef): void {
    const positions = [70, BASE_WIDTH / 2, BASE_WIDTH - 70];
    stage.signs.forEach((text, i) => {
      const t = this.scene.add.text(positions[i % positions.length], GROUND_Y - 120 - (i % 2) * 18, text, {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: stage.palette.neon,
      });
      t.setOrigin(0.5, 0.5);
      t.setAlpha(0.85);
      this.container.add(t);
      const blink = this.scene.tweens.add({ targets: t, alpha: { from: 0.85, to: 0.35 }, duration: 1400 + i * 260, yoyo: true, repeat: -1 });
      this.ambientTweens.push(blink);
    });
  }

  private buildAmbient(stage: StageDef): void {
    if (stage.id === 'castro_street') {
      const train = this.scene.add.rectangle(-40, GROUND_Y - 70, 46, 10, Phaser.Display.Color.HexStringToColor(stage.palette.mid).color, 0.7);
      this.container.add(train);
      const tw = this.scene.tweens.add({
        targets: train,
        x: BASE_WIDTH + 60,
        duration: 9000,
        repeat: -1,
        delay: 2000,
        onRepeat: () => train.setX(-40),
      });
      this.ambientTweens.push(tw);
    } else if (stage.id === 'sand_hill_road') {
      const ticker = this.scene.add.text(BASE_WIDTH, GROUND_Y - 100, 'SVS +4.2%   HYPE CO +12%   BURN RATE -3%   ', {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: stage.palette.accent,
      });
      this.container.add(ticker);
      const tw = this.scene.tweens.add({
        targets: ticker,
        x: -260,
        duration: 12000,
        repeat: -1,
        onRepeat: () => ticker.setX(BASE_WIDTH),
      });
      this.ambientTweens.push(tw);
    } else if (stage.id === 'palo_alto') {
      const countdown = this.scene.add.text(BASE_WIDTH - 46, 20, 'T-00:12', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: stage.palette.neon,
      });
      this.container.add(countdown);
      let seconds = 12;
      const timer = this.scene.time.addEvent({
        delay: 1000,
        loop: true,
        callback: () => {
          seconds = seconds <= 0 ? 12 : seconds - 1;
          countdown.setText(`T-00:${seconds.toString().padStart(2, '0')}`);
        },
      });
      this.ambientTimers.push(timer);

      for (let i = 0; i < 6; i++) {
        const antenna = this.scene.add.rectangle(30 + i * 70, GROUND_Y - 100, 2, 18, Phaser.Display.Color.HexStringToColor(stage.palette.neon).color, 0.8);
        this.container.add(antenna);
        const tw = this.scene.tweens.add({ targets: antenna, alpha: { from: 0.9, to: 0.15 }, duration: 500 + i * 90, yoyo: true, repeat: -1 });
        this.ambientTweens.push(tw);
      }
    }
  }

  setCrunchLighting(active: boolean): void {
    this.scene.tweens.add({ targets: this.crunchOverlay, alpha: active ? 0.28 : 0, duration: 400 });
  }

  destroy(): void {
    for (const t of this.ambientTimers) t.remove();
    for (const tw of this.ambientTweens) tw.stop();
    this.container.destroy(true);
  }
}
