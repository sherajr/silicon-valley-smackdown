import Phaser from 'phaser';
import { GROUND_Y } from '../sim/constants';
import type { ProjectileInstance } from '../sim/Projectile';
import type { PickupInstance } from '../sim/Pickups';
import type { FighterRuntime } from '../sim/FighterRuntime';

const PROJECTILE_COLORS: Record<string, number> = {
  hunter_ipad_yeet: 0xdbe9f0,
  kevin_briefcase_briefing: 0x8a5a1f,
  al_bottle_service: 0x4c7a3f,
  priya_resume_blast: 0xf2e6c8,
  priya_lets_connect: 0xf2e6c8,
  chad_cash_burn: 0x3fae4e,
  elon_rocket_reply: 0xc7ccd3,
  elon_cybertruck_shuffle: 0x9aa0aa,
};

const PICKUP_COLORS: Record<string, number> = {
  gpu: 0x35d0c0,
  coffee: 0xc98a4a,
  signing_bonus: 0x4fd06a,
};

interface Spark {
  gfx: Phaser.GameObjects.Rectangle;
  life: number;
}

export class EffectsView {
  private scene: Phaser.Scene;
  private cam: Phaser.Cameras.Scene2D.Camera;
  private arenaOffsetX: number;
  private sparks: Spark[] = [];
  private projectileSprites = new Map<number, Phaser.GameObjects.Rectangle>();
  private pickupSprite: Phaser.GameObjects.Container | null = null;
  private pickupKind: string | null = null;
  private markerSprites = new Map<string, Phaser.GameObjects.Arc>();
  private reducedEffects = false;
  private screenShakeEnabled = true;

  constructor(scene: Phaser.Scene, arenaOffsetX: number) {
    this.scene = scene;
    this.cam = scene.cameras.main;
    this.arenaOffsetX = arenaOffsetX;
  }

  setPreferences(reducedEffects: boolean, screenShakeEnabled: boolean): void {
    this.reducedEffects = reducedEffects;
    this.screenShakeEnabled = screenShakeEnabled;
  }

  spawnSpark(worldX: number, worldY: number, color: number, big: boolean): void {
    const size = big ? 10 : 6;
    const gfx = this.scene.add.rectangle(this.arenaOffsetX + worldX, worldY, size, size, color, 0.95);
    gfx.setDepth(600);
    this.sparks.push({ gfx, life: big ? 14 : 8 });
    if (this.screenShakeEnabled && !this.reducedEffects) {
      this.cam.shake(big ? 140 : 70, big ? 0.006 : 0.003);
    }
  }

  spawnKoBurst(worldX: number, worldY: number): void {
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const gfx = this.scene.add.rectangle(this.arenaOffsetX + worldX, worldY, 5, 5, 0xffd23f);
      gfx.setDepth(650);
      this.scene.tweens.add({
        targets: gfx,
        x: gfx.x + Math.cos(angle) * 40,
        y: gfx.y + Math.sin(angle) * 30,
        alpha: 0,
        duration: 500,
        onComplete: () => gfx.destroy(),
      });
    }
    if (this.screenShakeEnabled && !this.reducedEffects) this.cam.shake(220, 0.01);
  }

  updateProjectiles(list: ProjectileInstance[]): void {
    const seen = new Set<number>();
    for (const p of list) {
      seen.add(p.id);
      let spr = this.projectileSprites.get(p.id);
      if (!spr) {
        const color = PROJECTILE_COLORS[p.moveId] ?? 0xffffff;
        spr = this.scene.add.rectangle(0, 0, Math.max(6, p.def.box.w), Math.max(6, p.def.box.h), color);
        spr.setDepth(400);
        this.projectileSprites.set(p.id, spr);
      }
      spr.x = this.arenaOffsetX + p.x;
      spr.y = GROUND_Y + p.y;
    }
    for (const [id, spr] of this.projectileSprites) {
      if (!seen.has(id)) {
        spr.destroy();
        this.projectileSprites.delete(id);
      }
    }
  }

  updatePickup(pickup: PickupInstance | null): void {
    if (!pickup) {
      if (this.pickupSprite) {
        this.pickupSprite.destroy();
        this.pickupSprite = null;
        this.pickupKind = null;
      }
      return;
    }
    if (!this.pickupSprite || this.pickupKind !== pickup.kind) {
      this.pickupSprite?.destroy();
      const color = PICKUP_COLORS[pickup.kind] ?? 0xffffff;
      const body = this.scene.add.rectangle(0, 0, 12, 12, color);
      const outline = this.scene.add.rectangle(0, 0, 14, 14, 0x111111).setDepth(-1);
      this.pickupSprite = this.scene.add.container(0, 0, [outline, body]);
      this.pickupSprite.setDepth(380);
      this.pickupKind = pickup.kind;
      this.scene.tweens.add({ targets: this.pickupSprite, y: '+=4', duration: 500, yoyo: true, repeat: -1 });
    }
    this.pickupSprite.x = this.arenaOffsetX + pickup.x;
    this.pickupSprite.y = GROUND_Y - 14;
  }

  showTargetMarker(key: string, worldX: number, radius: number): void {
    let m = this.markerSprites.get(key);
    if (!m) {
      m = this.scene.add.circle(this.arenaOffsetX + worldX, GROUND_Y - 2, radius, 0xff3b3b, 0.18);
      m.setStrokeStyle(1, 0xff3b3b, 0.8);
      m.setDepth(50);
      this.markerSprites.set(key, m);
      this.scene.tweens.add({ targets: m, alpha: { from: 0.5, to: 0.15 }, duration: 220, yoyo: true, repeat: -1 });
    }
  }

  clearTargetMarker(key: string): void {
    const m = this.markerSprites.get(key);
    if (m) {
      m.destroy();
      this.markerSprites.delete(key);
    }
  }

  tick(): void {
    this.sparks = this.sparks.filter((s) => {
      s.life--;
      s.gfx.setAlpha(Math.max(0, s.life / 10));
      if (s.life <= 0) {
        s.gfx.destroy();
        return false;
      }
      return true;
    });
  }

  hurtboxCenter(f: FighterRuntime): { x: number; y: number } {
    return { x: f.x, y: GROUND_Y + f.y - f.def.height * 0.5 };
  }

  destroy(): void {
    for (const s of this.sparks) s.gfx.destroy();
    this.sparks = [];
    for (const [, spr] of this.projectileSprites) spr.destroy();
    this.projectileSprites.clear();
    this.pickupSprite?.destroy();
    for (const [, m] of this.markerSprites) m.destroy();
    this.markerSprites.clear();
  }
}
