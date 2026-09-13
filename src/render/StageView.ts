import Phaser from 'phaser';
import { BASE_WIDTH, BASE_HEIGHT, GROUND_Y } from '../sim/constants';
import type { StageDef } from '../data/stages';

function hex(color: string): number {
  return Phaser.Display.Color.HexStringToColor(color).color;
}

/**
 * True only when the stage's painted background really decoded at (at least) the game's logical
 * resolution. A missing file or a placeholder/failed texture falls through to the procedural
 * stage rather than stretching a broken image across the arena.
 */
export function stagePaintingUsable(scene: Phaser.Scene, stageId: string): boolean {
  const key = `stage_${stageId}`;
  if (!scene.textures.exists(key)) return false;
  const source = scene.textures.get(key).source?.[0];
  return !!source && source.width >= BASE_WIDTH && source.height >= BASE_HEIGHT;
}

/**
 * Stage background. Normal play uses the painted 480x270 stage image shipped in
 * `public/sprites/stages/<id>.png`, which is a complete composition -- sky, skyline, foliage,
 * street-level detail and floor are all painted in. When that image is present the only things
 * drawn over it are a subtle floor contact line (so GROUND_Y stays readable) and the Crunch Mode
 * lighting overlay: the procedural sky bands, parallax buildings, sign text and street props
 * below would all duplicate or cover detail the painting already has, and the sign text in
 * particular used to collide with the round banner.
 *
 * The procedural path -- sky gradient, three parallax bands of windowed buildings, a tiled floor,
 * sign text and per-stage ambient props -- remains the genuine fallback for a stage whose painted
 * image is missing or failed to load, so the game still renders a complete stage without it.
 */
export class StageView {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private ambientTimers: Phaser.Time.TimerEvent[] = [];
  private ambientTweens: Phaser.Tweens.Tween[] = [];
  private crunchOverlay!: Phaser.GameObjects.Rectangle;
  /** Which source actually rendered, so callers/tests can assert painted art really is on screen. */
  readonly source: 'painted' | 'procedural';

  constructor(scene: Phaser.Scene, stage: StageDef) {
    this.scene = scene;
    this.container = scene.add.container(0, 0);
    this.container.setDepth(-100);

    const { palette } = stage;
    this.source = stagePaintingUsable(scene, stage.id) ? 'painted' : 'procedural';

    if (this.source === 'painted') {
      const bg = scene.add.image(BASE_WIDTH / 2, BASE_HEIGHT / 2, `stage_${stage.id}`);
      bg.setDisplaySize(BASE_WIDTH, BASE_HEIGHT);
      this.container.add(bg);
      const floorLine = scene.add.rectangle(BASE_WIDTH / 2, GROUND_Y, BASE_WIDTH, 1, hex(palette.accent), 0.28);
      this.container.add(floorLine);
    } else {
      const sky = scene.add.graphics();
      // Discrete sky bands preserve the arcade palette at native resolution.
      sky.fillStyle(hex(palette.sky[0])).fillRect(0, 0, BASE_WIDTH, 90);
      sky.fillStyle(hex(palette.sky[1])).fillRect(0, 90, BASE_WIDTH, GROUND_Y - 90);
      this.container.add(sky);
      this.buildSkyDressing(stage);
      this.buildBand(palette.far, GROUND_Y - 92, 1, 7, 32, false);
      this.buildBand(palette.mid, GROUND_Y - 58, 1, 5, 46, true);
      this.buildBand(palette.near, GROUND_Y - 28, 1, 4, 62, true);
      this.buildFloor(palette.floor, palette.accent);
      this.buildSigns(stage);
      this.buildAmbient(stage);
    }

    this.crunchOverlay = scene.add.rectangle(BASE_WIDTH / 2, BASE_HEIGHT / 2, BASE_WIDTH, BASE_HEIGHT, 0xaa1111, 0);
    this.crunchOverlay.setDepth(-50);
    this.container.add(this.crunchOverlay);
  }

  private buildSkyDressing(stage: StageDef): void {
    if (stage.id === 'palo_alto') {
      // A scatter of stars for the night sky.
      for (let i = 0; i < 22; i++) {
        const x = (i * 53) % BASE_WIDTH;
        const y = ((i * 37) % (GROUND_Y - 140)) + 6;
        const star = this.scene.add.rectangle(x, y, 1, 1, 0xffffff, 0.5 + ((i * 13) % 5) * 0.08);
        this.container.add(star);
        const tw = this.scene.tweens.add({ targets: star, alpha: { from: star.alpha, to: 0.15 }, duration: 900 + ((i * 61) % 1400), yoyo: true, repeat: -1 });
        this.ambientTweens.push(tw);
      }
    } else {
      // A soft low sun/glow disc for the warmer daylight stages.
      const sun = this.scene.add.rectangle(BASE_WIDTH * 0.78, GROUND_Y * 0.32, 40, 40, 0xfff23d);
      this.container.add(sun);
    }
  }

  private buildBand(color: string, baseY: number, alpha: number, count: number, sizeBase: number, addWindows: boolean): void {
    const c = hex(color);
    for (let i = 0; i < count; i++) {
      const w = sizeBase + ((i * 37) % 26);
      const h = sizeBase * 0.6 + ((i * 53) % 34);
      const x = (i / count) * (BASE_WIDTH + 60) - 20;
      const y = baseY - h / 2 + 30;
      const rect = this.scene.add.rectangle(x, y, w, h, c, alpha);
      this.container.add(rect);
      const roofTrim = this.scene.add.rectangle(x, y - h / 2 + 1, w, 2, c, Math.min(1, alpha + 0.25));
      this.container.add(roofTrim);
      if (addWindows && w > 22 && h > 22) this.addWindows(x, y, w, h, alpha);
    }
  }

  private addWindows(cx: number, cy: number, w: number, h: number, parentAlpha: number): void {
    const cols = Math.max(2, Math.min(5, Math.floor(w / 12)));
    const rows = Math.max(2, Math.min(4, Math.floor(h / 13)));
    const winW = 4;
    const winH = 5;
    const marginX = w / (cols + 1);
    const marginY = h / (rows + 1);
    for (let r = 0; r < rows; r++) {
      for (let col = 0; col < cols; col++) {
        if ((r * cols + col + Math.round(cx)) % 4 === 0) continue; // a few unlit/missing windows for variety
        const wx = cx - w / 2 + marginX * (col + 1);
        const wy = cy - h / 2 + marginY * (r + 1);
        const lit = (r * cols + col + Math.round(cx / 7)) % 3 === 0;
        const win = this.scene.add.rectangle(wx, wy, winW, winH, lit ? 0xfff23d : 0x100a30, lit ? 0.55 : 0.3 + parentAlpha * 0.2);
        this.container.add(win);
        if (lit && Math.random() < 0.15) {
          const tw = this.scene.tweens.add({ targets: win, alpha: { from: 0.55, to: 0.2 }, duration: 1400 + ((wx * 7) % 900), yoyo: true, repeat: -1 });
          this.ambientTweens.push(tw);
        }
      }
    }
  }

  private buildFloor(floorColor: string, accentColor: string): void {
    const floor = this.scene.add.rectangle(BASE_WIDTH / 2, GROUND_Y + (BASE_HEIGHT - GROUND_Y) / 2, BASE_WIDTH, BASE_HEIGHT - GROUND_Y, hex(floorColor));
    this.container.add(floor);
    // Subtle tiling/plank lines so the floor doesn't read as one flat slab.
    const lineColor = hex(accentColor);
    for (let x = -20; x < BASE_WIDTH + 20; x += 28) {
      const line = this.scene.add.rectangle(x, GROUND_Y + (BASE_HEIGHT - GROUND_Y) / 2, 1, BASE_HEIGHT - GROUND_Y, lineColor, 0.4);
      this.container.add(line);
    }
    const floorLine = this.scene.add.rectangle(BASE_WIDTH / 2, GROUND_Y, BASE_WIDTH, 2, lineColor, 0.65);
    this.container.add(floorLine);
    const floorShadow = this.scene.add.rectangle(BASE_WIDTH / 2, GROUND_Y + 3, BASE_WIDTH, 5, 0x000000, 0.18);
    this.container.add(floorShadow);
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
      this.buildCastroStreet(stage);
    } else if (stage.id === 'sand_hill_road') {
      this.buildSandHillRoad(stage);
    } else if (stage.id === 'palo_alto') {
      this.buildPaloAlto(stage);
    }
  }

  private buildCastroStreet(stage: StageDef): void {
    const train = this.scene.add.rectangle(-40, GROUND_Y - 74, 46, 10, hex(stage.palette.mid), 0.7);
    const trainStripe = this.scene.add.rectangle(-40, GROUND_Y - 74, 46, 2, hex(stage.palette.accent), 0.5);
    this.container.add(train);
    this.container.add(trainStripe);
    const tw = this.scene.tweens.add({
      targets: [train, trainStripe],
      x: BASE_WIDTH + 60,
      duration: 9000,
      repeat: -1,
      delay: 2000,
      onRepeat: () => {
        train.setX(-40);
        trainStripe.setX(-40);
      },
    });
    this.ambientTweens.push(tw);

    // Bike rack: a row of small wheel circles near the patio edge.
    for (let i = 0; i < 4; i++) {
      const bx = 22 + i * 9;
      const wheel = this.scene.add.circle(bx, GROUND_Y - 8, 5, 0x000000, 0);
      wheel.setStrokeStyle(1, hex(stage.palette.near), 0.8);
      this.container.add(wheel);
    }
    const rackRail = this.scene.add.rectangle(22 + 1.5 * 9, GROUND_Y - 13, 9 * 3 + 8, 1, hex(stage.palette.near), 0.8);
    this.container.add(rackRail);

    // A couple of café tables with a cup on top, plus a patron who occasionally reacts.
    const tablePositions = [BASE_WIDTH - 96, BASE_WIDTH - 56];
    for (const tx of tablePositions) {
      const legs = this.scene.add.rectangle(tx, GROUND_Y - 6, 2, 10, 0x2a2018, 0.8);
      const top = this.scene.add.rectangle(tx, GROUND_Y - 12, 16, 2, hex(stage.palette.near), 0.9);
      const cup = this.scene.add.rectangle(tx + 4, GROUND_Y - 15, 3, 3, 0xffffff, 0.85);
      this.container.add(legs);
      this.container.add(top);
      this.container.add(cup);
    }
    const patron = this.scene.add.rectangle(BASE_WIDTH - 76, GROUND_Y - 20, 6, 14, hex(stage.palette.mid), 0.75);
    this.container.add(patron);
    const patronTimer = this.scene.time.addEvent({
      delay: 3200,
      loop: true,
      callback: () => {
        this.scene.tweens.add({ targets: patron, y: patron.y - 3, duration: 180, yoyo: true, ease: 'Sine.InOut' });
      },
    });
    this.ambientTimers.push(patronTimer);

    // A warm string-light chain along the top of the patio.
    for (let i = 0; i < 8; i++) {
      const lx = 40 + i * 55;
      const bulb = this.scene.add.circle(lx, GROUND_Y - 132, 2, hex(stage.palette.accent), 0.8);
      this.container.add(bulb);
      const tw2 = this.scene.tweens.add({ targets: bulb, alpha: { from: 0.85, to: 0.35 }, duration: 900 + i * 110, yoyo: true, repeat: -1 });
      this.ambientTweens.push(tw2);
    }
  }

  private buildSandHillRoad(stage: StageDef): void {
    const ticker = this.scene.add.text(BASE_WIDTH, GROUND_Y - 104, 'SVS +4.2%   HYPE CO +12%   BURN RATE -3%   ', {
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

    // A fountain: concentric rings with a gently pulsing spray.
    const fx = BASE_WIDTH / 2;
    const fy = GROUND_Y - 14;
    const basin = this.scene.add.circle(fx, fy, 14, hex(stage.palette.mid), 0.6);
    basin.setStrokeStyle(1, hex(stage.palette.accent), 0.7);
    this.container.add(basin);
    const spray = this.scene.add.rectangle(fx, fy - 10, 2, 12, 0xdfefff, 0.5);
    this.container.add(spray);
    const tw2 = this.scene.tweens.add({ targets: spray, scaleY: { from: 0.6, to: 1.15 }, alpha: { from: 0.3, to: 0.6 }, duration: 700, yoyo: true, repeat: -1 });
    this.ambientTweens.push(tw2);

    // Parked cars flanking the entrance.
    for (const cx of [46, BASE_WIDTH - 46]) {
      const body = this.scene.add.rectangle(cx, GROUND_Y - 7, 26, 8, hex(stage.palette.near), 0.85);
      const cabin = this.scene.add.rectangle(cx, GROUND_Y - 12, 14, 5, hex(stage.palette.near), 0.85);
      const glint = this.scene.add.rectangle(cx - 4, GROUND_Y - 9, 5, 1, 0xffffff, 0.4);
      this.container.add(body);
      this.container.add(cabin);
      this.container.add(glint);
    }

    // A presenter with a suspiciously steep graph line, and investors who applaud in bursts.
    const graph = this.scene.add.graphics();
    graph.lineStyle(1, hex(stage.palette.accent), 0.8);
    graph.beginPath();
    graph.moveTo(BASE_WIDTH / 2 - 30, GROUND_Y - 92);
    graph.lineTo(BASE_WIDTH / 2 - 14, GROUND_Y - 100);
    graph.lineTo(BASE_WIDTH / 2, GROUND_Y - 118);
    graph.lineTo(BASE_WIDTH / 2 + 16, GROUND_Y - 150);
    graph.strokePath();
    this.container.add(graph);

    const investors = [BASE_WIDTH / 2 - 50, BASE_WIDTH / 2 + 50, BASE_WIDTH / 2 + 70].map((ix) => {
      const inv = this.scene.add.rectangle(ix, GROUND_Y - 18, 6, 14, hex(stage.palette.mid), 0.75);
      this.container.add(inv);
      return inv;
    });
    const applauseTimer = this.scene.time.addEvent({
      delay: 4200,
      loop: true,
      callback: () => {
        for (const inv of investors) {
          this.scene.tweens.add({ targets: inv, y: inv.y - 2, duration: 120, yoyo: true, repeat: 2, ease: 'Sine.InOut' });
        }
      },
    });
    this.ambientTimers.push(applauseTimer);
  }

  private buildPaloAlto(stage: StageDef): void {
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

    // Antenna array with blinking tips.
    for (let i = 0; i < 6; i++) {
      const ax = 30 + i * 70;
      const antenna = this.scene.add.rectangle(ax, GROUND_Y - 100, 2, 18, hex(stage.palette.neon), 0.8);
      const tip = this.scene.add.circle(ax, GROUND_Y - 109, 1.5, hex(stage.palette.neon), 0.9);
      this.container.add(antenna);
      this.container.add(tip);
      const tw = this.scene.tweens.add({ targets: tip, alpha: { from: 0.9, to: 0.1 }, duration: 500 + i * 90, yoyo: true, repeat: -1 });
      this.ambientTweens.push(tw);
    }

    // Server cabinets: dark racks with a scatter of tiny status lights.
    for (const rx of [58, BASE_WIDTH - 58]) {
      const cabinet = this.scene.add.rectangle(rx, GROUND_Y - 20, 20, 34, 0x0c0f18, 0.85);
      cabinet.setStrokeStyle(1, hex(stage.palette.accent), 0.4);
      this.container.add(cabinet);
      for (let r = 0; r < 5; r++) {
        const lightOn = (r + Math.round(rx)) % 2 === 0;
        const light = this.scene.add.rectangle(rx - 6 + (r % 2) * 4, GROUND_Y - 32 + r * 6, 2, 2, lightOn ? hex(stage.palette.accent) : 0x333333, lightOn ? 0.9 : 0.5);
        this.container.add(light);
        if (lightOn) {
          const tw = this.scene.tweens.add({ targets: light, alpha: { from: 0.9, to: 0.25 }, duration: 400 + r * 130, yoyo: true, repeat: -1 });
          this.ambientTweens.push(tw);
        }
      }
    }

    // Distant rocket gantry silhouette with cross-bracing.
    const gantryX = BASE_WIDTH / 2 + 30;
    const gantry = this.scene.add.graphics();
    gantry.lineStyle(1, hex(stage.palette.mid), 0.7);
    gantry.strokeRect(gantryX - 10, GROUND_Y - 150, 20, 90);
    gantry.beginPath();
    gantry.moveTo(gantryX - 10, GROUND_Y - 150);
    gantry.lineTo(gantryX + 10, GROUND_Y - 60);
    gantry.moveTo(gantryX + 10, GROUND_Y - 150);
    gantry.lineTo(gantryX - 10, GROUND_Y - 60);
    gantry.strokePath();
    this.container.add(gantry);
    const rocket = this.scene.add.rectangle(gantryX, GROUND_Y - 130, 6, 20, hex(stage.palette.near), 0.9);
    const rocketTip = this.scene.add.triangle(gantryX, GROUND_Y - 144, -3, 6, 3, 6, 0, -4, hex(stage.palette.near), 0.9);
    this.container.add(rocket);
    this.container.add(rocketTip);
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
