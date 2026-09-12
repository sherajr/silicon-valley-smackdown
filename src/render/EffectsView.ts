import Phaser from 'phaser';
import { GROUND_Y } from '../sim/constants';
import type { ProjectileInstance } from '../sim/Projectile';
import type { PickupInstance } from '../sim/Pickups';
import type { FighterRuntime } from '../sim/FighterRuntime';
import { lighten } from './colorUtil';

function hexNum(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

type ProjectileIcon = 'ipad' | 'briefcase' | 'bottle' | 'paper' | 'money' | 'rocket' | 'truck';

const PROJECTILE_ICONS: Record<string, ProjectileIcon> = {
  hunter_ipad_yeet: 'ipad',
  kevin_briefcase_briefing: 'briefcase',
  al_bottle_service: 'bottle',
  priya_resume_blast: 'paper',
  priya_lets_connect: 'paper',
  chad_cash_burn: 'money',
  elon_rocket_reply: 'rocket',
  elon_cybertruck_shuffle: 'truck',
};

const PROJECTILE_SPINS: Set<ProjectileIcon> = new Set(['ipad', 'paper']);

/** Draws one projectile's icon in local space (centered on its own origin) so only x/y need updating per frame. */
function drawProjectileIcon(gfx: Phaser.GameObjects.Graphics, icon: ProjectileIcon, w: number, h: number, facing: 1 | -1): void {
  gfx.clear();
  const hw = w / 2;
  const hh = h / 2;
  switch (icon) {
    case 'ipad': {
      gfx.fillStyle(0x0e0e12, 1);
      gfx.fillRoundedRect(-hw - 1, -hh - 1, w + 2, h + 2, 2);
      gfx.fillStyle(0xd7dee3, 1);
      gfx.fillRoundedRect(-hw, -hh, w, h, 2);
      gfx.fillStyle(0x8fe9ff, 0.95);
      gfx.fillRoundedRect(-hw * 0.68, -hh * 0.72, w * 0.68, h * 0.72, 1);
      break;
    }
    case 'briefcase': {
      gfx.fillStyle(0x100b06, 1);
      gfx.fillRoundedRect(-hw - 1, -hh - 1, w + 2, h + 2, 1);
      gfx.fillStyle(0x8a5a1f, 1);
      gfx.fillRoundedRect(-hw, -hh, w, h, 1);
      gfx.fillStyle(0x5c3a12, 1);
      gfx.fillRect(-hw * 0.3, -hh - 2, hw * 0.6, 3); // handle
      gfx.fillStyle(0xc9a24b, 1);
      gfx.fillRect(-1, -1, 2, 2); // latch
      break;
    }
    case 'bottle': {
      gfx.fillStyle(0x0d130d, 1);
      gfx.fillRect(-hw * 0.35 - 1, -hh - 1, hw * 0.7 + 2, h * 0.35 + 2);
      gfx.fillRect(-hw - 1, -hh + h * 0.3 - 1, w + 2, h * 0.7 + 2);
      gfx.fillStyle(0x4c7a3f, 1);
      gfx.fillRect(-hw * 0.35, -hh, hw * 0.7, h * 0.35); // neck
      gfx.fillRect(-hw, -hh + h * 0.3, w, h * 0.7); // body
      gfx.fillStyle(hexNum(lighten('#4c7a3f', 0.35)), 0.8);
      gfx.fillRect(-hw * 0.6, -hh + h * 0.4, w * 0.15, h * 0.4); // glass highlight
      break;
    }
    case 'paper': {
      gfx.fillStyle(0x2a2620, 1);
      gfx.beginPath();
      gfx.moveTo(facing * hw + facing, 0);
      gfx.lineTo(-hw - facing, -hh - 1);
      gfx.lineTo(-hw - facing, hh + 1);
      gfx.closePath();
      gfx.fillPath();
      gfx.fillStyle(0xf2e6c8, 1);
      gfx.beginPath();
      gfx.moveTo(facing * hw, 0);
      gfx.lineTo(-hw, -hh);
      gfx.lineTo(-hw, hh);
      gfx.closePath();
      gfx.fillPath();
      gfx.lineStyle(1, 0xcabf9c, 1);
      gfx.lineBetween(-hw * 0.2, 0, -hw, 0);
      break;
    }
    case 'money': {
      gfx.fillStyle(0x0c170c, 1);
      gfx.fillRoundedRect(-hw - 1, -hh - 1, w + 2, h + 2, 2);
      gfx.fillStyle(0x3fae4e, 1);
      gfx.fillRoundedRect(-hw, -hh, w, h, 2);
      gfx.fillStyle(0xdff5df, 1);
      gfx.fillCircle(0, 0, Math.min(hw, hh) * 0.55);
      gfx.fillStyle(0x1e7a2e, 1);
      gfx.fillRect(-0.5, -hh * 0.6, 1, h * 0.6); // $ stroke
      break;
    }
    case 'rocket': {
      const nose = facing * hw;
      gfx.fillStyle(0x2a2d33, 1);
      gfx.fillRoundedRect(-hw - facing * hw * 0.3, -hh, w * 0.75, h, 2);
      gfx.fillStyle(0xd0d6de, 1);
      gfx.beginPath();
      gfx.moveTo(nose, 0);
      gfx.lineTo(nose - facing * hw * 0.6, -hh);
      gfx.lineTo(nose - facing * hw * 0.6, hh);
      gfx.closePath();
      gfx.fillPath();
      gfx.fillStyle(0xff8a3f, 0.9);
      gfx.fillTriangle(-nose, -hh * 0.5, -nose, hh * 0.5, -nose - facing * hw * 0.9, 0); // flame trailing behind
      break;
    }
    case 'truck': {
      gfx.fillStyle(0x0e0e12, 1);
      gfx.fillRoundedRect(-hw - 1, -hh * 0.4 - 1, w + 2, h * 0.4 + 2, 1);
      gfx.fillStyle(0x9aa0aa, 1);
      gfx.fillRoundedRect(-hw, -hh * 0.4, w, h * 0.4, 1); // bed
      gfx.fillStyle(0x7d838d, 1);
      gfx.fillRoundedRect(-hw * 0.2, -hh, hw * 0.9, hh * 0.7, 1); // cab
      gfx.fillStyle(0x141414, 1);
      gfx.fillCircle(-hw * 0.5, hh * 0.05, 2);
      gfx.fillCircle(hw * 0.5, hh * 0.05, 2);
      break;
    }
  }
}

function drawPickupIcon(gfx: Phaser.GameObjects.Graphics, kind: string): void {
  gfx.clear();
  if (kind === 'gpu') {
    gfx.fillStyle(0x0b1f1c, 1);
    gfx.fillRect(-7, -7, 14, 14);
    gfx.fillStyle(0x35d0c0, 1);
    gfx.fillRect(-6, -6, 12, 12);
    gfx.fillStyle(0x0b1f1c, 1);
    for (const t of [-4, 0, 4]) {
      gfx.fillRect(t - 0.5, -8, 1, 2);
      gfx.fillRect(t - 0.5, 6, 1, 2);
    }
    gfx.fillStyle(hexNum(lighten('#35d0c0', 0.4)), 1);
    gfx.fillRect(-3, -3, 6, 6);
  } else if (kind === 'coffee') {
    gfx.fillStyle(0x2a1a0d, 1);
    gfx.fillRoundedRect(-6, -6, 12, 12, 1);
    gfx.fillStyle(0xc98a4a, 1);
    gfx.fillRoundedRect(-5, -5, 10, 10, 1);
    gfx.fillStyle(0x5a3a1f, 1);
    gfx.fillRect(-4, -4, 8, 2); // coffee surface
    gfx.lineStyle(1.4, 0xc98a4a, 1);
    gfx.beginPath();
    gfx.arc(5, -1, 3, Phaser.Math.DegToRad(-70), Phaser.Math.DegToRad(70));
    gfx.strokePath(); // handle
    gfx.lineStyle(1, 0xe4c9a8, 0.8);
    gfx.lineBetween(-2, -8, -3, -11);
    gfx.lineBetween(2, -8, 1, -11); // steam
  } else {
    gfx.fillStyle(0x143312, 1);
    gfx.fillCircle(0, 0, 8);
    gfx.fillStyle(0x4fd06a, 1);
    gfx.fillCircle(0, 0, 6.5);
    gfx.lineStyle(1.2, 0xdff5df, 1);
    gfx.beginPath();
    gfx.moveTo(-3, 0);
    gfx.lineTo(-1, 2.5);
    gfx.lineTo(3.5, -2.5);
    gfx.strokePath(); // checkmark: signing bonus "approved"
  }
}

interface Spark {
  gfx: Phaser.GameObjects.Rectangle;
  life: number;
  maxLife: number;
}

export class EffectsView {
  private scene: Phaser.Scene;
  private cam: Phaser.Cameras.Scene2D.Camera;
  private arenaOffsetX: number;
  private sparks: Spark[] = [];
  private projectileSprites = new Map<number, { gfx: Phaser.GameObjects.Graphics; icon: ProjectileIcon }>();
  private pickupSprite: Phaser.GameObjects.Container | null = null;
  private pickupIconGfx: Phaser.GameObjects.Graphics | null = null;
  private pickupKind: string | null = null;
  private markerSprites = new Map<string, Phaser.GameObjects.Arc>();
  private reducedEffects = false;
  private screenShakeEnabled = true;
  private ageMs = 0;

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
    const life = big ? 230 : 130; // ms; matches the previous 14/8-frame life at 60Hz but now clock-based
    this.sparks.push({ gfx, life, maxLife: life });
    if (this.screenShakeEnabled && !this.reducedEffects) {
      this.cam.shake(big ? 140 : 70, big ? 0.006 : 0.003);
    }
  }

  spawnKoBurst(worldX: number, worldY: number): void {
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const gfx = this.scene.add.rectangle(this.arenaOffsetX + worldX, worldY, 5, 5, 0xfff23d);
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
      let entry = this.projectileSprites.get(p.id);
      const icon = PROJECTILE_ICONS[p.moveId] ?? 'paper';
      if (!entry) {
        const gfx = this.scene.add.graphics();
        gfx.setDepth(400);
        drawProjectileIcon(gfx, icon, Math.max(8, p.def.box.w + 4), Math.max(8, p.def.box.h + 4), p.facing);
        entry = { gfx, icon };
        this.projectileSprites.set(p.id, entry);
      }
      entry.gfx.x = this.arenaOffsetX + p.x;
      entry.gfx.y = GROUND_Y + p.y;
      if (PROJECTILE_SPINS.has(entry.icon)) entry.gfx.rotation += 0.35 * p.facing;
    }
    for (const [id, entry] of this.projectileSprites) {
      if (!seen.has(id)) {
        entry.gfx.destroy();
        this.projectileSprites.delete(id);
      }
    }
  }

  updatePickup(pickup: PickupInstance | null): void {
    if (!pickup) {
      if (this.pickupSprite) {
        this.pickupSprite.destroy();
        this.pickupSprite = null;
        this.pickupIconGfx = null;
        this.pickupKind = null;
      }
      return;
    }
    if (!this.pickupSprite || this.pickupKind !== pickup.kind) {
      this.pickupSprite?.destroy();
      const gfx = this.scene.add.graphics();
      drawPickupIcon(gfx, pickup.kind);
      this.pickupSprite = this.scene.add.container(0, 0, [gfx]);
      this.pickupIconGfx = gfx;
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

  /**
   * Advances effect lifetimes by real elapsed time (ms) rather than once per
   * render call, so spark duration is identical at 60Hz and on a high-refresh
   * display instead of decaying twice as fast at 120Hz.
   */
  tick(deltaMs: number): void {
    this.ageMs += deltaMs;
    this.sparks = this.sparks.filter((s) => {
      s.life -= deltaMs;
      s.gfx.setAlpha(Math.max(0, s.life / s.maxLife));
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
    for (const [, entry] of this.projectileSprites) entry.gfx.destroy();
    this.projectileSprites.clear();
    this.pickupSprite?.destroy();
    for (const [, m] of this.markerSprites) m.destroy();
    this.markerSprites.clear();
  }
}
