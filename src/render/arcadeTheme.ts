import Phaser from 'phaser';
import { BASE_WIDTH, BASE_HEIGHT } from '../sim/constants';

export const ARCADE = {
  ink: '#100a30', panel: '#241052', cyan: '#00e5ff',
  magenta: '#ff36c8', yellow: '#fff23d', text: '#f5f1ff',
} as const;

/** Static pixel geometry with a quiet central reading area. */
export function drawArcadeBackdrop(scene: Phaser.Scene): void {
  scene.cameras.main.setBackgroundColor(ARCADE.ink);
  const g = scene.add.graphics().setDepth(-200);
  g.fillStyle(0x241052).fillRect(12, 12, BASE_WIDTH - 24, BASE_HEIGHT - 24);
  const colors = [0x00e5ff, 0xff36c8, 0xfff23d];
  for (let i = 0; i < 3; i++) {
    g.fillStyle(colors[i]);
    g.fillRect(0, i * 4, BASE_WIDTH, 3);
    g.fillRect(0, BASE_HEIGHT - 4 - i * 4, BASE_WIDTH, 3);
    for (let y = 24 + i * 8; y < BASE_HEIGHT - 20; y += 32) {
      g.fillRect(3, y, 5, 5);
      g.fillRect(BASE_WIDTH - 8, y + 8, 5, 5);
    }
  }
  g.lineStyle(1, 0x00e5ff, 0.18);
  for (let x = 16; x < BASE_WIDTH; x += 16) g.lineBetween(x, BASE_HEIGHT - 46, x, BASE_HEIGHT - 34);
  for (let y = BASE_HEIGHT - 36; y < BASE_HEIGHT - 32; y += 8) g.lineBetween(14, y, BASE_WIDTH - 14, y);
}
