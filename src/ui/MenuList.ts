import Phaser from 'phaser';

export interface MenuItemConfig {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

/**
 * A simple vertical keyboard+mouse navigable menu. Both players' confirm/cancel
 * bindings and mouse hover/click work; focus is always visibly indicated.
 */
export class MenuList {
  private scene: Phaser.Scene;
  private texts: Phaser.GameObjects.Text[] = [];
  private items: MenuItemConfig[];
  private index = 0;
  container: Phaser.GameObjects.Container;

  constructor(scene: Phaser.Scene, x: number, y: number, spacing: number, items: MenuItemConfig[], style?: Partial<Phaser.Types.GameObjects.Text.TextStyle>) {
    this.scene = scene;
    this.items = items;
    this.container = scene.add.container(x, y);
    items.forEach((item, i) => {
      const t = scene.add.text(0, i * spacing, item.label, {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: item.disabled ? '#5a5a66' : '#f5f1ff',
        ...style,
      });
      t.setOrigin(0.5, 0.5);
      t.setInteractive({ useHandCursor: !item.disabled });
      t.on('pointerover', () => this.setIndex(i));
      t.on('pointerup', () => {
        if (!item.disabled) item.onSelect();
      });
      this.texts.push(t);
      this.container.add(t);
    });
    this.refreshVisuals();
  }

  private refreshVisuals(): void {
    this.texts.forEach((t, i) => {
      const focused = i === this.index;
      t.setColor(this.items[i].disabled ? '#5a5a66' : focused ? '#fff23d' : '#00e5ff');
      t.setText((focused ? '> ' : '  ') + this.items[i].label);
      t.setScale(focused ? 1.08 : 1);
    });
  }

  setIndex(i: number): void {
    if (this.items[i]?.disabled) return;
    this.index = Phaser.Math.Wrap(i, 0, this.items.length);
    this.refreshVisuals();
  }

  moveUp(): void {
    let next = this.index;
    for (let n = 0; n < this.items.length; n++) {
      next = Phaser.Math.Wrap(next - 1, 0, this.items.length);
      if (!this.items[next].disabled) break;
    }
    this.index = next;
    this.refreshVisuals();
  }

  moveDown(): void {
    let next = this.index;
    for (let n = 0; n < this.items.length; n++) {
      next = Phaser.Math.Wrap(next + 1, 0, this.items.length);
      if (!this.items[next].disabled) break;
    }
    this.index = next;
    this.refreshVisuals();
  }

  confirm(): void {
    const item = this.items[this.index];
    if (item && !item.disabled) item.onSelect();
  }

  destroy(): void {
    this.container.destroy(true);
  }
}
