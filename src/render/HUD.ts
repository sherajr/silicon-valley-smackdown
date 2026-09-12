import Phaser from 'phaser';
import { BASE_WIDTH, MAX_GUARD, MAX_HYPE, ROUNDS_TO_WIN } from '../sim/constants';
import type { FighterRuntime } from '../sim/FighterRuntime';
import type { CharacterDef } from '../sim/types';

interface SideWidgets {
  container: Phaser.GameObjects.Container;
  healthBarBg: Phaser.GameObjects.Rectangle;
  healthBar: Phaser.GameObjects.Rectangle;
  healthBarChip: Phaser.GameObjects.Rectangle;
  guardBar: Phaser.GameObjects.Rectangle;
  hypeBar: Phaser.GameObjects.Rectangle;
  hypeLabel: Phaser.GameObjects.Text;
  nameText: Phaser.GameObjects.Text;
  roundPips: Phaser.GameObjects.Rectangle[];
  buffText: Phaser.GameObjects.Text;
  comboText: Phaser.GameObjects.Text;
  displayedHealth: number;
}

const BAR_W = 170;

export class HUD {
  private scene: Phaser.Scene;
  private p1: SideWidgets;
  private p2: SideWidgets;
  private timerText: Phaser.GameObjects.Text;
  private calloutText: Phaser.GameObjects.Text;
  private roundBanner: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, p1Def: CharacterDef, p2Def: CharacterDef, p1Label: string, p2Label: string) {
    this.scene = scene;
    this.p1 = this.buildSide(8, p1Def.name, p1Label, false);
    this.p2 = this.buildSide(BASE_WIDTH - 8, p2Def.name, p2Label, true);

    this.timerText = scene.add.text(BASE_WIDTH / 2, 12, '90', { fontFamily: 'monospace', fontSize: '16px', color: '#ffffff' }).setOrigin(0.5, 0);
    this.calloutText = scene.add
      .text(BASE_WIDTH / 2, 60, '', { fontFamily: 'monospace', fontSize: '12px', color: '#ffd23f' })
      .setOrigin(0.5, 0.5)
      .setAlpha(0);
    // y=132 deliberately sits below StageView's background sign band (GROUND_Y-120, +/- 18 --
    // e.g. Castro Street's centered "$9 Pour Over" sign lands at y=92) and above fighters'
    // heads, so the K.O./round announcement never visually collides with stage set dressing.
    this.roundBanner = scene.add
      .text(BASE_WIDTH / 2, 132, '', { fontFamily: 'monospace', fontSize: '18px', color: '#ffffff' })
      .setOrigin(0.5, 0.5)
      .setAlpha(0);

    this.setDepthAll(500);
  }

  private setDepthAll(depth: number): void {
    this.p1.container.setDepth(depth);
    this.p2.container.setDepth(depth);
    this.timerText.setDepth(depth);
    this.calloutText.setDepth(depth + 1);
    this.roundBanner.setDepth(depth + 1);
  }

  private buildSide(x: number, name: string, label: string, rightAligned: boolean): SideWidgets {
    const container = this.scene.add.container(x, 6);
    const barOriginX = rightAligned ? 1 : 0;
    const sign = rightAligned ? -1 : 1;
    const bg = this.scene.add.rectangle(0, 0, BAR_W, 8, 0x1a1a22).setOrigin(barOriginX, 0);
    const chip = this.scene.add.rectangle(0, 0, BAR_W, 8, 0xffcf5c).setOrigin(barOriginX, 0);
    const bar = this.scene.add.rectangle(0, 0, BAR_W, 8, 0x35c26b).setOrigin(barOriginX, 0);
    const guard = this.scene.add.rectangle(0, 10, BAR_W * 0.7, 3, 0x4fb0e0).setOrigin(barOriginX, 0);
    const hype = this.scene.add.rectangle(0, 15, 0, 3, 0xff5da2).setOrigin(barOriginX, 0);
    const hypeLabel = this.scene.add.text(0, 19, '', { fontFamily: 'monospace', fontSize: '7px', color: '#ff9fd0' }).setOrigin(rightAligned ? 1 : 0, 0);
    const nameText = this.scene.add
      .text(0, -10, `${label} ${name}`.toUpperCase(), { fontFamily: 'monospace', fontSize: '8px', color: '#ffffff' })
      .setOrigin(rightAligned ? 1 : 0, 0);
    const buffText = this.scene.add.text(0, 24, '', { fontFamily: 'monospace', fontSize: '7px', color: '#9fe8d8' }).setOrigin(rightAligned ? 1 : 0, 0);
    const comboText = this.scene.add.text(0, 34, '', { fontFamily: 'monospace', fontSize: '9px', color: '#ffd23f' }).setOrigin(rightAligned ? 1 : 0, 0);
    const pips: Phaser.GameObjects.Rectangle[] = [];
    for (let i = 0; i < ROUNDS_TO_WIN; i++) {
      pips.push(this.scene.add.rectangle(sign * i * 10, -18, 6, 6, 0x3a3a44).setOrigin(barOriginX, 0));
    }
    container.add([bg, chip, bar, guard, hype, hypeLabel, nameText, buffText, comboText, ...pips]);
    return {
      container,
      healthBarBg: bg,
      healthBar: bar,
      healthBarChip: chip,
      guardBar: guard,
      hypeBar: hype,
      hypeLabel,
      nameText,
      roundPips: pips,
      buffText,
      comboText,
      displayedHealth: 1,
    };
  }

  private updateSide(w: SideWidgets, f: FighterRuntime, wins: number): void {
    const pct = Phaser.Math.Clamp(f.health / f.def.maxHealth, 0, 1);
    w.displayedHealth = Phaser.Math.Linear(w.displayedHealth, pct, 0.15);
    w.healthBar.width = BAR_W * pct;
    w.healthBarChip.width = BAR_W * w.displayedHealth;
    w.guardBar.width = (BAR_W * 0.7 * Phaser.Math.Clamp(f.guard / MAX_GUARD, 0, 1));
    const hypePct = Phaser.Math.Clamp(f.hype / MAX_HYPE, 0, 1);
    w.hypeBar.width = BAR_W * 0.7 * hypePct;
    w.hypeBar.fillColor = hypePct >= 1 ? 0xffe36e : 0xff5da2;
    w.hypeLabel.setText(hypePct >= 1 ? 'HYPE READY' : '');
    for (let i = 0; i < w.roundPips.length; i++) {
      w.roundPips[i].setFillStyle(i < wins ? 0xffd23f : 0x3a3a44);
    }
    const buffs: string[] = [];
    if (f.modifiers.gpuFrames > 0) buffs.push(`GPU ${Math.ceil(f.modifiers.gpuFrames / 60)}s`);
    if (f.modifiers.coffeeFrames > 0) buffs.push(`COFFEE ${Math.ceil(f.modifiers.coffeeFrames / 60)}s`);
    w.buffText.setText(buffs.join('  '));
    w.comboText.setText(f.comboCount > 1 ? `${f.comboCount} HIT COMBO` : '');
  }

  update(p1: FighterRuntime, p2: FighterRuntime, scoreP1: number, scoreP2: number, clockFrames: number): void {
    this.updateSide(this.p1, p1, scoreP1);
    this.updateSide(this.p2, p2, scoreP2);
    this.timerText.setText(Math.ceil(clockFrames / 60).toString());
  }

  showCallout(text: string): void {
    this.calloutText.setText(text);
    this.calloutText.setAlpha(1);
    this.scene.tweens.add({ targets: this.calloutText, alpha: 0, delay: 500, duration: 400 });
  }

  showRoundBanner(text: string, holdMs = 900): void {
    this.roundBanner.setText(text);
    this.roundBanner.setAlpha(1);
    this.roundBanner.setScale(0.6);
    this.scene.tweens.add({ targets: this.roundBanner, scale: 1, duration: 220, ease: 'Back.Out' });
    this.scene.tweens.add({ targets: this.roundBanner, alpha: 0, delay: holdMs, duration: 300 });
  }

  destroy(): void {
    this.p1.container.destroy(true);
    this.p2.container.destroy(true);
    this.timerText.destroy();
    this.calloutText.destroy();
    this.roundBanner.destroy();
  }
}
