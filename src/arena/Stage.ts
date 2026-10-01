import * as T from 'three';
import { ACCENTS, STAGE_PLATFORMS } from './data';
import type { Platform } from './data';
import { slabSpec } from './stageLayout';
import { STAGE_THEMES } from './stageThemes';
import type { StageTheme } from './stageThemes';
import { GLOW, StageKit } from './stageKit';
import type { UvSpec } from './stageKit';
import { createSky } from './sky';
import type { SkyRig } from './sky';
import { facadeTextures, glowSpriteTexture, roofTextures } from './textures';
import type { TexOpts } from './textures';
import { hashString, mulberry32 } from './canvasUtil';
import { applyHeightFog } from './heightFog';

export interface StageOptions { anisotropy?: number }
interface Facade {
  /** Near buildings: full standard shading (and reflections where the arena is glass). */
  material: T.MeshStandardMaterial;
  /** Distant skyline: plain diffuse shading. Far surfaces gain nothing from specular or reflections, and there is a lot of them. */
  far: T.MeshLambertMaterial;
  tileW: number; tileH: number;
}

/**
 * One arena: sky, distant ridges and skyline, the platforms, and the dressing around them.
 *
 * The platforms are built from the same `STAGE_PLATFORMS` records the simulation collides with. Each platform is a single
 * slab whose top face sits at exactly `p.y`; its floor markings are painted into that face's texture, not laid on top as
 * extra geometry. Everything else is batched static scenery (a few dozen meshes) or a small number of moving parts.
 */
export class ArenaStage {
  readonly root = new T.Group();
  readonly index: number;
  readonly theme: StageTheme;
  readonly accent: string;
  /** The visible body of each platform, by platform id. */
  readonly slabs = new Map<string, T.Mesh>();
  private kit: StageKit;
  private sky: SkyRig;
  private tex: TexOpts;
  private facades: Facade[] = [];
  private halo: T.Texture;
  private spinners: { object: T.Object3D; y: number; z: number }[];
  private swayers: { object: T.Object3D; phase: number; amount: number }[];

  constructor(index: number, options: StageOptions = {}) {
    this.index = index; this.theme = STAGE_THEMES[index]; this.accent = ACCENTS[index];
    this.tex = { anisotropy: options.anisotropy ?? 1 };
    this.kit = new StageKit(this.root, this.tex); this.spinners = this.kit.spinners; this.swayers = this.kit.swayers;
    this.sky = createSky(this.theme, this.tex); this.root.add(this.sky.group);
    this.halo = this.kit.own(glowSpriteTexture(this.tex));
    this.buildFacades();
    this.ridges(); this.skyline();
    for (const p of STAGE_PLATFORMS[index]) this.platform(p);
    if (index === 0) this.castro(); else if (index === 1) this.sandHill(); else this.launchNight();
    this.kit.flush();
  }

  // ------------------------------------------------------------------------------------------------------------
  // Shared pieces
  // ------------------------------------------------------------------------------------------------------------
  private buildFacades() {
    const t = this.theme;
    this.facades = t.walls.map((wall, i) => {
      const f = facadeTextures({ cols: 5, rows: 6, wall, spandrel: t.spandrel, glass: t.glass ? '#0d1b2e' : '#101c26', mullion: t.glass ? '#3a5578' : '#0e1a24', lit: t.lit, litRatio: t.litRatio, sheen: t.glass ? 1 : 0.25, seed: hashString(t.id) + i * 131 }, this.tex);
      this.kit.owned.push(f.map, f.glow);
      const emissiveIntensity = t.night ? 1.15 : 0.85;
      const material = this.kit.own(applyHeightFog(new T.MeshStandardMaterial({
        map: f.map, emissiveMap: f.glow, emissive: new T.Color('#ffffff'), emissiveIntensity,
        roughness: t.glass ? 0.3 : 0.86, metalness: t.glass ? 0.55 : 0.05,
      })) as T.MeshStandardMaterial);
      if (t.glass) this.kit.reflect(material, 1.2);
      const far = this.kit.own(applyHeightFog(new T.MeshLambertMaterial({ map: f.map, emissiveMap: f.glow, emissive: new T.Color('#ffffff'), emissiveIntensity })) as T.MeshLambertMaterial);
      return { material, far, tileW: f.tileW, tileH: f.tileH };
    });
  }
  private facade(i: number) { return this.facades[((i % this.facades.length) + this.facades.length) % this.facades.length]; }
  private uv(f: Facade, rnd: () => number): UvSpec { return { tileW: f.tileW, tileH: f.tileH, ox: rnd(), oy: rnd() }; }

  /** Three hazy mountain ridges, each fading from a lighter crest to the haze colour at its base. */
  private ridges() {
    const t = this.theme, k = this.kit, mat = k.own(new T.MeshBasicMaterial({ vertexColors: true, fog: false }));
    for (let layer = 0; layer < 3; layer++) {
      const points: T.Vector2[] = [];
      for (let i = 0; i <= 16; i++) points.push(new T.Vector2(-130 + i * 16.5, 1 + layer * 0.7 + Math.sin(i * 0.75 + layer) * 2.6 + Math.sin(i * 1.6) * 1.2));
      const ridge = new T.SplineCurve(points).getPoints(200), shape = new T.Shape();
      shape.moveTo(-130, -40); for (const p of ridge) shape.lineTo(p.x, p.y); shape.lineTo(135, -40); shape.closePath();
      const geo = new T.ShapeGeometry(shape), pos = geo.getAttribute('position'), colors = new Float32Array(pos.count * 3);
      const [top, bottom] = t.ridges[layer], c1 = new T.Color(top), c2 = new T.Color(bottom), c = new T.Color();
      for (let i = 0; i < pos.count; i++) { c.copy(c2).lerp(c1, T.MathUtils.smoothstep(pos.getY(i), -14, 5)); colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }
      geo.setAttribute('color', new T.BufferAttribute(colors, 3));
      k.mesh(geo, mat, 0, -layer * 1.5, -92 + layer * 11);
    }
  }

  /** Deterministic skyline in three depth bands. Buildings reach far below the stage so the canyon never shows empty sky. */
  private skyline() {
    const t = this.theme, k = this.kit, rnd = mulberry32(hashString(t.id) ^ 0x51ed), count = 42;
    const trim = k.mat(t.fascia, { rough: 0.75, metal: 0 }), beacon = k.glowMat('#ff5a4a', 3);
    for (let i = 0; i < count; i++) {
      const band = i % 3, z = [-18, -30, -46][band] - rnd() * 6, x = -68 + (i / count) * 136 + (rnd() - 0.5) * 3;
      const w = 3 + rnd() * 3.6, d = 3 + rnd() * 2.2;
      // The skyline sits below the horizon line of the play camera: low behind the fighters (so the stage centre is calm and
      // the sky and sun show), rising toward the edges where it frames the view. Taller buildings recede.
      const rise = T.MathUtils.smoothstep(Math.abs(x), 8, 34), ceiling = [5.5, 8, 12][band] + rise * [5, 7, 9][band];
      const top = ceiling * (0.45 + rnd() * 0.55) - (band === 0 ? 1 : 0);
      const f = this.facade(i);
      // Order 1: drawn after the stage and fighters, so wherever they cover the skyline its fragments are rejected unshaded.
      const far = { receive: false, order: 1 };
      k.box(x, (top - 46) / 2, z, w, top + 46, d, f.far, { uv: this.uv(f, rnd), ...far });
      k.box(x, top + 0.12, z, w + 0.2, 0.22, d + 0.2, trim, far);
      if (rnd() < 0.4) { const sh = 0.8 + rnd() * 1.6; k.box(x + (rnd() - 0.5) * w * 0.2, top + 0.15 + sh / 2, z, w * 0.55, sh, d * 0.55, f.far, { uv: this.uv(f, rnd), ...far }); }
      if (rnd() < 0.3) { const ah = 1.5 + rnd() * 2.5; k.box(x, top + 0.19 + ah / 2, z, 0.1, ah, 0.1, trim, far); k.box(x, top + 0.19 + ah, z, 0.17, 0.17, 0.17, beacon, far); }
    }
  }

  /** One platform: a single slab with one exposed top face, plus trim that never shares a plane with it. */
  private platform(p: Platform) {
    const t = this.theme, k = this.kit, spec = slabSpec(p), roofSpec = p.solid ? t.roof.base : t.roof.upperBase;
    const roof = roofTextures({ w: p.w, d: spec.d, kind: p.solid ? 'main' : 'upper', base: roofSpec, seam: t.roof.seam, edge: t.roof.edge, edgeDark: t.roof.edgeDark, mark: t.roof.mark, glow: p.solid ? t.roof.glow : null, seed: hashString(`${t.id}:${p.id}`) }, this.tex);
    k.owned.push(roof.map); if (roof.glow) k.owned.push(roof.glow);
    const top = k.own(applyHeightFog(new T.MeshStandardMaterial({ map: roof.map, roughness: 0.84, metalness: 0, emissiveMap: roof.glow, emissive: new T.Color(roof.glow ? '#ffffff' : '#000000'), emissiveIntensity: 1.9 })) as T.MeshStandardMaterial);
    const side = k.mat(t.fascia, { rough: 0.68, metal: 0.15 }), under = k.mat('#0c141c', { rough: 0.9, metal: 0 });
    // BoxGeometry face order: +x, -x, +y (the walkable top), -y, +z (front), -z.
    const geometry = new T.BoxGeometry(spec.w, spec.h, spec.d), body = new T.Mesh(geometry, [side, side, top, under, side, side]);
    body.position.set(spec.cx, spec.cy, spec.cz); body.castShadow = true; body.receiveShadow = true; body.name = `platform:${p.id}`;
    this.root.add(body); k.owned.push(geometry); this.slabs.set(p.id, body);
    const trim = k.mat(t.trim, { rough: 0.55, metal: 0.12 });
    if (p.solid) {
      // A coping lip just below the surface (its top is 0.03 under the walkable face), accent and gold lines, ledge lamps.
      k.box(p.x, p.y - 0.09, 0, p.w + 0.16, 0.12, spec.d + 0.16, trim, { cast: true });
      k.box(p.x, p.y - 0.34, spec.d / 2 + 0.03, p.w - 0.3, 0.07, 0.04, k.glowMat(this.accent, 1.25));
      k.box(p.x, p.y - 0.84, spec.d / 2 + 0.03, p.w - 0.3, 0.05, 0.04, k.glowMat('#f3ae73', GLOW * 0.55));
      if (p.ledges) for (const side of [-1, 1]) k.box(p.x + side * p.w / 2, p.y - 0.03, spec.d / 2 + 0.06, 0.24, 0.12, 0.08, k.glowMat('#ffe3a1', 1.5));
      k.sign({ text: 'SV / SMACKDOWN', w: 6.2, h: 0.4, bg: t.fascia, ink: '#b2c6ca', font: 30 }, p.x, p.y - 0.59, spec.d / 2 + 0.075);
      // The building the stage stands on: scenery only, set well back so nothing reads as a wall at the fighters' plane.
      const f = this.facade(0);
      k.box(p.x, -24, -4.3, p.w - 3, 46, 4.6, f.material, { uv: { tileW: f.tileW, tileH: f.tileH, ox: 0.1, oy: 0.3 }, receive: true });
    } else {
      k.box(p.x, p.y - 0.10, 0, p.w + 0.12, 0.08, spec.d + 0.12, trim, { cast: true });
      k.box(p.x, p.y - 0.18, spec.d / 2 + 0.03, p.w - 0.1, 0.06, 0.04, k.glowMat(this.accent, 1.1));
      k.box(p.x, p.y - 0.37, 0, p.w * 0.6, 0.15, 1.2, k.mat('#1d2a35', { rough: 0.8 }), { cast: true });
    }
  }

  /** Slender lattice tower used by the launch arena and for crane silhouettes. */
  private bridge(z: number) {
    const k = this.kit, orange = k.mat('#b4533f', { rough: 0.55, metal: 0.25 }), deck = k.mat('#7c6676', { rough: 0.7 });
    for (const x of [-31, -17]) {
      k.box(x, 0.5, z, 0.4, 31, 0.6, orange); k.box(x + 1.3, 0.5, z, 0.4, 31, 0.6, orange);
      for (const y of [0, 3.5, 7, 10.5, 14]) k.box(x + 0.65, y, z, 1.62, 0.25, 0.5, orange);
    }
    k.box(-24, -2, z, 36, 0.25, 1.2, deck);
    const curve = new T.QuadraticBezierCurve3(new T.Vector3(-30.4, 15.7, z + 0.4), new T.Vector3(-23.9, -1.5, z + 0.4), new T.Vector3(-16.4, 15.7, z + 0.4));
    k.put(new T.TubeGeometry(curve, 36, 0.05, 5, false), orange, 0, 0, 0);
    for (let i = 1; i < 18; i++) { const p = curve.getPoint(i / 18); k.box(p.x, (p.y - 2) / 2, z + 0.4, 0.03, p.y + 2, 0.03, '#c98b79'); }
  }

  // ------------------------------------------------------------------------------------------------------------
  // Castro Street: warm peach sunset, cool teal rooftop, cafe lights
  // ------------------------------------------------------------------------------------------------------------
  private castro() {
    const k = this.kit, t = this.theme, rnd = mulberry32(5);
    this.bridge(-40);
    const dark = k.mat('#18262e', { rough: 0.6, metal: 0.2 }), awning = [k.mat('#2f7d7a', { rough: 0.7 }), k.mat('#c9784f', { rough: 0.7 })];
    for (const [i, side] of ([-1, 1] as const).entries()) {
      const x = side * 12.4, f = this.facade(i + 1);
      k.box(x, (2.5 - 46) / 2, -8, 7.8, 48.5, 4.6, f.material, { uv: this.uv(f, rnd), receive: true });
      k.box(x, 2.62, -8, 8.3, 0.26, 5.0, dark);
      for (const dx of [-2.45, 0, 2.45]) k.box(x + dx, -0.25, -5.66, 1.7, 2.6, 0.04, k.glowMat('#ffc58a', 0.5));
      k.box(x, 1.25, -5.25, 7.4, 0.12, 1.0, awning[i], { rot: [0.35, 0, 0] });
      k.box(side * 15.7, 5.6, -8, 0.14, 6.4, 0.14, dark);
    }
    k.sign({ text: 'UNICORN COFFEE', w: 5.6, h: 0.58, bg: '#14232b', ink: '#d9f4ea', font: 44, glow: '#7fffd4', border: '#5fd7bf' }, -13.6, 2.2, -5.6, 1.1);
    k.sign({ text: 'NO PITCHES AFTER 5', w: 5.6, h: 0.58, bg: '#2d2433', ink: '#ffd2ac', font: 38, glow: '#ff9a68', border: '#d9825a' }, 13.6, 2.2, -5.6, 1.1);
    // Planters and trees at the ends of the stage, a coffee counter behind the fighters.
    for (const x of [-9.9, 9.9]) { k.box(x, -0.55, -4.4, 1.5, 1.1, 1.5, '#3c4f58', { cast: true }); k.tree(x, -4.4, 5.4, ['#4fa08a', '#3a8571'], '#8c7b66', 0); }
    k.box(-7.1, 0.75, -2.65, 1.75, 1.5, 0.5, '#243b44', { cast: true });
    k.box(-7.1, 1.53, -2.65, 1.95, 0.08, 0.7, '#e9ddc0', { cast: true });
    k.sign({ text: '$9 POUR OVER', w: 1.56, h: 0.6, bg: '#1b323b', ink: '#f7d096', font: 66, border: '#c9a56a' }, -7.1, 0.82, -2.37);
    for (const dx of [-0.55, 0.55]) k.box(-7.1 + dx, 1.74, -2.65, 0.16, 0.34, 0.16, '#e9ddc0');
    // Cafe string lights: two swags of bulbs on thin cable, halos in one extra draw.
    const bulbs: T.Vector3[] = [];
    for (const [y, z, sag, n] of [[8.7, -8, 2.6, 22], [7.2, -9.5, 2.2, 20]] as const) {
      const a = new T.Vector3(-15.7, y, z), b = new T.Vector3(15.7, y, z), mid = new T.Vector3(0, y - sag * 2, z);
      const curve = new T.QuadraticBezierCurve3(a, mid, b); k.put(new T.TubeGeometry(curve, 48, 0.028, 5, false), '#2b3942', 0, 0, 0);
      for (let i = 0; i < n; i++) bulbs.push(curve.getPoint((i + 0.5) / n).add(new T.Vector3(0, -0.14, 0)));
    }
    k.bulbs(bulbs, '#ffc98a', this.halo, 1.1);
    void t;
  }

  // ------------------------------------------------------------------------------------------------------------
  // Sand Hill Road: amber and gold against deep blue glass
  // ------------------------------------------------------------------------------------------------------------
  private sandHill() {
    const k = this.kit, rnd = mulberry32(9), gold = k.mat('#e0b25e', { rough: 0.24, metal: 0.95, env: true }), stone = k.mat('#3a4048', { rough: 0.5, metal: 0.2 });
    for (const [i, side] of ([-1, 1] as const).entries()) {
      const x = side * 14.4, f = this.facade(i);
      k.box(x, (13 - 46) / 2, -10, 8.4, 59, 5, f.material, { uv: this.uv(f, rnd), receive: true });
      k.box(x, 13.12, -10, 8.8, 0.3, 5.4, gold);
      for (let dx = -3.6; dx <= 3.7; dx += 1.8) k.box(x + dx, 3.5, -7.44, 0.1, 21, 0.12, gold);
      k.box(x, -1.2, -7.4, 8.6, 0.5, 0.22, stone);
    }
    k.sign({ text: 'REVENUE OPTIONAL', w: 7, h: 1, bg: '#16283a', ink: '#f6d192', font: 42, glow: '#ffb060', border: '#c99a52' }, -14.4, 6.5, -7.4, 1.15);
    k.sign({ text: 'WE FUND VISION', w: 7, h: 1, bg: '#16283a', ink: '#f6d192', font: 44, glow: '#ffb060', border: '#c99a52' }, 14.4, 6.5, -7.4, 1.15);
    // Polished gold sculpture on a plinth, turning slowly. Its reflections change as it turns.
    const knot = k.mesh(new T.TorusKnotGeometry(1.0, 0.17, 140, 14), gold, -7, 1.9, -2.7, { cast: true, receive: false });
    this.spinners.push({ object: knot, y: 0.25, z: 0.12 });
    k.box(-7, 0.3, -2.7, 1.5, 0.6, 1.1, stone, { cast: true }); k.box(-7, 0.63, -2.7, 1.62, 0.06, 1.22, gold);
    k.box(7, 0.62, -2.7, 3.6, 1.24, 1.0, '#2a3a44', { cast: true });
    k.sign({ text: 'SAND HILL / CAPITAL', w: 3.4, h: 1.0, bg: '#1e3138', ink: '#e8c892', font: 46, border: '#c9a56a' }, 7, 0.78, -2.17);
    // Topiary on planters, uplit.
    for (const x of [-10.8, 10.8]) { k.box(x, -0.55, -4.5, 1.6, 1.1, 1.6, stone, { cast: true }); k.tree(x, -4.5, 4.4, ['#4a7d52', '#2f5f46'], '#8b7a60', 0); }
    for (const x of [-10.8, 10.8]) k.box(x, 0.04, -3.64, 1.3, 0.1, 0.06, k.glowMat('#ffd596', 1.8));
    const lamp: T.Vector3[] = []; for (let x = -12; x <= 12; x += 3) lamp.push(new T.Vector3(x, 9.8 + Math.sin(x) * 0.25, -8.5)); k.bulbs(lamp, '#ffd596', this.halo, 1.2);
  }

  // ------------------------------------------------------------------------------------------------------------
  // Palo Alto Launch Night: violet twilight, cyan technology, warm rocket
  // ------------------------------------------------------------------------------------------------------------
  private launchNight() {
    const k = this.kit, t = this.theme, rnd = mulberry32(17);
    const beam = k.mat('#40557a', { rough: 0.5, metal: 0.55 }), cyan = k.glowMat('#3fe0ff', 2.4);
    for (const x of [-13, 13]) {
      k.box(x, -17, -9, 0.26, 56, 0.28, beam); k.box(x + 2, -17, -9, 0.26, 56, 0.28, beam); k.box(x + 1, -17, -9.9, 2.1, 56, 0.12, '#1c2740', { receive: true });
      for (let y = -2; y < 10.5; y += 1.5) { k.box(x + 1, y, -9, 2.5, 0.13, 0.18, beam, { rot: [0, 0, 0.6] }); k.box(x + 1, y + 0.75, -9, 2.1, 0.09, 0.2, beam); }
      k.box(x + 0.14, 3.5, -8.84, 0.05, 13, 0.03, cyan);
    }
    // Rocket: a smooth lathed fuselage and nose, banded and finned, on a pad at the right gantry.
    const profile = [[0, -1.5], [0.78, -1.5], [0.82, -1.1], [0.82, 4.7], [0.76, 5.5], [0.58, 6.6], [0.32, 7.5], [0, 8.1]].map(([r, y]) => new T.Vector2(r, y));
    const white = k.reflect(k.own(new T.MeshStandardMaterial({ color: '#d7dde6', roughness: 0.26, metalness: 0.7 })), 1.4), warm = k.mat('#ff9c57', { rough: 0.4, metal: 0.2, glow: 0.9 });
    const rocket = k.mesh(new T.LatheGeometry(profile, 36), white, 14, 0, -9, { cast: false, receive: false });
    rocket.position.y = 0;
    for (const y of [0.4, 3.4]) k.put(new T.TorusGeometry(0.83, 0.05, 8, 36), '#e2769f', 14, y, -9, { rot: [Math.PI / 2, 0, 0] });
    k.put(new T.ConeGeometry(0.62, 0.9, 24, 1, true), warm, 14, -1.8, -9, { rot: [Math.PI, 0, 0] });
    for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3 + 0.5; k.box(14 + Math.cos(a) * 1.05, -0.6, -9 + Math.sin(a) * 1.05, 0.12, 1.9, 0.9, '#5d6f88', { rot: [0, -a, 0] }); }
    k.box(14, -1.55, -9, 2.8, 0.3, 2.8, '#27334d');
    k.sign({ text: 'DEMO DAY', w: 6, h: 1.3, bg: '#1d2146', ink: '#d7c8ff', font: 96, glow: '#9b82ff', border: '#7e6be0' }, -12, 7.6, -8.7, 1.25);
    k.sign({ text: 'LIVE DEMO: PROBABLY READY', w: 13.5, h: 0.7, bg: '#1b2240', ink: '#c9b8e8', font: 36, glow: '#8f7fe0', border: '#6a5cc0' }, 0, 8.7, -13, 1.15);
    // Server racks with rows of status LEDs (one instanced mesh for every light).
    const rack = k.mat('#1c2a40', { rough: 0.45, metal: 0.5 }), slot = k.mat('#0c1424', { rough: 0.7 });
    const ledGeo = new T.BoxGeometry(0.07, 0.05, 0.03), ledMat = k.own(new T.MeshBasicMaterial({ color: '#ffffff' })), leds = new T.InstancedMesh(ledGeo, ledMat, 2 * 8 * 5);
    const colors = ['#3fe0ff', '#7dffb4', '#ffc58e'].map(c => new T.Color(c).multiplyScalar(2.4)), m4 = new T.Matrix4(); let n = 0;
    for (const x of [-7.5, 7.5]) {
      k.box(x, 0.95, -2.7, 1.1, 1.9, 0.9, rack, { cast: true });
      for (let y = 0.28; y < 1.75; y += 0.185) { k.box(x, y, -2.23, 0.9, 0.09, 0.04, slot); for (let c = 0; c < 5; c++) { leds.setMatrixAt(n, m4.makeTranslation(x - 0.3 + c * 0.14, y, -2.2)); leds.setColorAt(n, colors[Math.floor(rnd() * colors.length)]); n++; } }
    }
    leds.count = n; leds.instanceMatrix.needsUpdate = true; if (leds.instanceColor) leds.instanceColor.needsUpdate = true; leds.frustumCulled = false; this.root.add(leds); k.owned.push(ledGeo, leds);
    void t;
  }

  // ------------------------------------------------------------------------------------------------------------
  /** Per-frame scenery motion. Everything here is slow and smooth; with motion off it is all at rest. */
  update(time: number, motion: boolean) {
    for (const s of this.swayers) s.object.rotation.z = motion ? Math.sin(time * 0.55 + s.phase) * s.amount : 0;
    for (const s of this.spinners) { s.object.rotation.y = motion ? time * s.y : 0.6; s.object.rotation.z = motion ? time * s.z : 0.2; }
    this.sky.update(time, motion);
  }

  /** Gives every reflective material in this arena its environment map (or removes it), scaled by the arena's strength. */
  setEnvironment(texture: T.Texture | null, intensity: number) {
    for (const { material, strength } of this.kit.reflective) { material.envMap = texture; material.envMapIntensity = intensity * strength; material.needsUpdate = true; }
  }

  /** Counts for tests and statistics. */
  get stats() {
    let meshes = 0, casters = 0, triangles = 0;
    this.root.traverse(o => {
      if (!(o as T.Mesh).isMesh) return; const m = o as T.Mesh; meshes++; if (m.castShadow) casters++;
      const g = m.geometry; triangles += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    });
    return { meshes, casters, triangles };
  }

  dispose() { this.sky.dispose(); this.kit.dispose(); this.slabs.clear(); }
}
