import * as T from 'three';
import { mulberry32 } from './canvasUtil';
import { FIGHTER_ACCENTS } from './data';
import type { GameEvent } from './Simulation';

/**
 * Combat effects. Two layers, each a single draw call: a glow batch (additive sparks, streaks, rings, flares) and a dust
 * batch (soft alpha). Every particle lives in a fixed ring buffer and is integrated in the vertex shader from its spawn
 * data, so there is no per-particle material, no per-particle object and no per-frame allocation; capacity is set by the
 * quality preset. `describeEvent` turns a simulation event into particle descriptors as plain data, so what each event
 * looks like (and how it scales with hit strength) is testable without a GPU.
 */
export type Kind = 'disc' | 'streak' | 'ring' | 'flare';
const KIND_CODE: Record<Kind, number> = { disc: 0, streak: 1, ring: 2, flare: 3 };

export interface Particle {
  layer: 'glow' | 'dust';
  kind: Kind;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** Seconds alive, and size at birth and at death (world units). */
  life: number; size0: number; size1: number;
  /** Linear colour (above 1 for HDR highlights that bloom) and opacity. */
  r: number; g: number; b: number; a: number;
  gravity: number; drag: number; spin: number;
  /** Seconds after the event before it appears. */
  delay: number;
}

export interface EventContext {
  /** The fighter the event is about (the victim for a hit) and the other one. */
  victim?: { x: number; y: number; vx: number; vy: number; character: number; facing: number };
  other?: { x: number; y: number };
  /** Effects the player's preferences allow. */
  reducedMotion?: boolean;
}
export interface EventEffect { particles: Particle[]; shake: number }

const lin = (hex: string, k = 1) => { const c = new T.Color(hex); return [c.r * k, c.g * k, c.b * k] as const; };
const PAL = {
  white: lin('#fff6dd', 2.2), amber: lin('#ffb35a', 2.2), hot: lin('#fff0c8', 3.0), block: lin('#6fd0ff', 2.4), counter: lin('#ffd45c', 3), armor: lin('#8fb4e8', 2.2),
  tech: lin('#7dffea', 2.4), catch: lin('#ffd27a', 2.4), pummel: lin('#ffe9a8', 2), release: lin('#c9d6ff', 2.2), pickup: lin('#adffc2', 2.2), coffee: lin('#f5d5a1', 2),
  impact: lin('#ffb468', 2.8), recover: lin('#bfeaff', 2.2), ledge: lin('#ffe3a1', 2.4), dust: lin('#e8dcc8', 1), smoke: lin('#9aa3ad', 1),
};

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
/** How hard a hit feels, 0 to 1, from the damage dealt and how fast the victim is launched. */
export function hitSignificance(damage: number, speed: number) { return clamp(damage / 22 * 0.55 + speed / 1.3 * 0.55, 0, 1); }

/** A particle with sensible defaults; pass only what differs. */
export const makeParticle = (o: Partial<Particle> & { kind: Kind }): Particle => ({
  layer: 'glow', x: 0, y: 0, z: 0.4, vx: 0, vy: 0, vz: 0, life: 0.3, size0: 0.3, size1: 0.3, r: 1, g: 1, b: 1, a: 1, gravity: 0, drag: 0, spin: 0, delay: 0, ...o,
});

type Rnd = () => number;
const colorOf = (c: readonly number[]) => ({ r: c[0], g: c[1], b: c[2] });

/** Streaks flying out from a point inside a cone around `angle` (radians). */
function sparks(out: Particle[], rnd: Rnd, x: number, y: number, count: number, angle: number, spread: number, speed: [number, number], life: [number, number], size: [number, number], color: readonly number[], gravity = 5, drag = 2.2) {
  for (let i = 0; i < count; i++) {
    const a = angle + (rnd() - 0.5) * spread, s = speed[0] + rnd() * (speed[1] - speed[0]);
    out.push(makeParticle({ kind: 'streak', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: (rnd() - 0.5) * 2, life: life[0] + rnd() * (life[1] - life[0]), size0: size[0] + rnd() * (size[1] - size[0]), size1: 0.05, ...colorOf(color), gravity, drag }));
  }
}
const ring = (out: Particle[], x: number, y: number, size: number, color: readonly number[], life = 0.26, delay = 0) => out.push(makeParticle({ kind: 'ring', x, y, z: 0.55, life, size0: size * 0.25, size1: size, ...colorOf(color), a: 0.9, delay }));
const flare = (out: Particle[], x: number, y: number, size: number, color: readonly number[], life = 0.14, spin = 0) => out.push(makeParticle({ kind: 'flare', x, y, z: 0.6, life, size0: size * 0.5, size1: size, ...colorOf(color), spin }));
const puffs = (out: Particle[], rnd: Rnd, x: number, y: number, count: number, spreadX: number, rise: number, size: number, alpha = 0.34) => {
  for (let i = 0; i < count; i++) {
    const dir = count > 1 ? (i / (count - 1) - 0.5) * 2 : 0;
    out.push(makeParticle({ layer: 'dust', kind: 'disc', x: x + dir * 0.25, y: y + size * 0.22, z: 0.3, vx: dir * spreadX * (0.7 + rnd() * 0.5), vy: rise * (0.4 + rnd() * 0.6), vz: (rnd() - 0.5) * 0.8, life: 0.42 + rnd() * 0.2, size0: size * 0.6, size1: size * (1.6 + rnd() * 0.6), r: PAL.dust[0], g: PAL.dust[1], b: PAL.dust[2], a: alpha, gravity: -0.5, drag: 3.2 }));
  }
};

/**
 * What an event looks like. Pure: the same event and context give the same particles for the same random stream. Counts
 * scale with hit strength; `reducedMotion` halves them and slows the sparks.
 */
export function describeEvent(e: GameEvent, ctx: EventContext, rnd: Rnd): EventEffect {
  const p: Particle[] = [], v = ctx.victim, calm = ctx.reducedMotion ? 0.5 : 1;
  const x = e.x, y = e.y;                       // the simulation reports the fighter's chest height (feet + 1)
  let shake = 0;
  switch (e.type) {
    case 'hit': {
      const speed = v ? Math.hypot(v.vx, v.vy) : 0, sig = hitSignificance(e.value ?? 8, speed);
      const away = v && speed > 0.05 ? Math.atan2(v.vy, v.vx) : ctx.other ? Math.atan2(y - ctx.other.y, x - ctx.other.x) : 0;
      // The spark starts between the two fighters, a little toward the one that was hit.
      const ox = ctx.other ? x + (ctx.other.x - x) * 0.3 : x, oy = ctx.other ? y + (ctx.other.y + 1 - y) * 0.25 : y;
      const n = Math.round((5 + sig * 17) * calm);
      flare(p, ox, oy, 0.55 + sig * 0.95, PAL.hot, 0.1 + sig * 0.05, 1.2);
      sparks(p, rnd, ox, oy, n, away, 1.1 + sig * 0.5, [5 + sig * 4, 9 + sig * 8], [0.16, 0.24 + sig * 0.16], [0.5, 0.9 + sig * 0.9], PAL.white);
      if (sig > 0.25) sparks(p, rnd, ox, oy, Math.round(n * 0.5), away, 1.6, [3, 8], [0.2, 0.34], [0.4, 0.8], PAL.amber);
      ring(p, ox, oy, 0.9 + sig * 1.3, PAL.white, 0.22 + sig * 0.06);
      if (sig > 0.55) { ring(p, ox, oy, 2.2 + sig * 1.0, PAL.amber, 0.3, 0.04); p.push(makeParticle({ kind: 'streak', x: ox, y: oy, vx: Math.cos(away) * 14, vy: Math.sin(away) * 14, life: 0.14, size0: 2.6, size1: 0.3, ...colorOf(PAL.hot), a: 0.8 })); }
      // A throw's release gets its own cool double ring where the hands let go, so it reads differently from a strike.
      if (e.text === 'throw') { ring(p, ox, oy, 2.6 + sig, PAL.release, 0.3); ring(p, ox, oy, 1.5 + sig, PAL.white, 0.22, 0.04); }
      shake = e.text === 'projectile' ? 0.05 + sig * 0.08 : 0.04 + sig * 0.2;
      break;
    }
    case 'ko': {
      // A burst at the blast boundary, thrown back toward the stage, in the fighter's colour.
      const px = clamp(x, -18, 18), py = clamp(y, -4, 13), accent = lin(FIGHTER_ACCENTS[v?.character ?? 0] ?? '#ffffff', 3.2);
      const inward = Math.atan2(3 - py, -px);
      flare(p, px, py, 7, PAL.hot, 0.26, 0.6);
      sparks(p, rnd, px, py, Math.round(26 * calm), inward, 2.6, [10, 22], [0.45, 0.8], [1.4, 2.8], accent, 6, 1.6);
      sparks(p, rnd, px, py, Math.round(12 * calm), inward, 3.2, [6, 14], [0.4, 0.7], [0.8, 1.6], PAL.white, 6, 1.8);
      ring(p, px, py, 9, accent, 0.55); ring(p, px, py, 5.5, PAL.white, 0.4, 0.05);
      shake = 0.34;
      break;
    }
    case 'block': { sparks(p, rnd, x, y, Math.round(8 * calm), v ? Math.atan2(0, v.facing) : 0, 2.2, [3, 6], [0.16, 0.26], [0.3, 0.6], PAL.block); ring(p, x, y, 1.6, PAL.block, 0.24); break; }
    case 'jump': puffs(p, rnd, x, y - 1, Math.round(4 * calm), 1.6, 0.6, 0.8, 0.45); break;
    case 'land': puffs(p, rnd, x, y - 1, Math.round(6 * calm), 2.6, 0.5, 0.9, 0.55); break;
    case 'roll': puffs(p, rnd, x, y - 1, Math.round(3 * calm), 1.2, 0.3, 0.6, 0.4); break;
    case 'recovery': sparks(p, rnd, x, y - 0.6, Math.round(8 * calm), -Math.PI / 2, 0.9, [4, 8], [0.22, 0.4], [0.5, 1.0], PAL.recover, -2, 1.6); flare(p, x, y - 0.5, 1.5, PAL.recover, 0.18); break;
    case 'catch': ring(p, x, y, 1.9, PAL.catch, 0.26); sparks(p, rnd, x, y, Math.round(8 * calm), Math.PI / 2, 6.28, [2, 5], [0.14, 0.24], [0.3, 0.5], PAL.catch, 0, 3); shake = 0.04; break;
    case 'tech': ring(p, x, y, 3.4, PAL.tech, 0.34); ring(p, x, y, 2, PAL.white, 0.24, 0.05); sparks(p, rnd, x, y, Math.round(12 * calm), Math.PI / 2, 6.28, [4, 9], [0.2, 0.34], [0.4, 0.8], PAL.tech); break;
    case 'pummel': flare(p, x, y, 0.9, PAL.pummel, 0.1); sparks(p, rnd, x, y, Math.round(5 * calm), 0, 6.28, [2, 5], [0.12, 0.2], [0.3, 0.5], PAL.pummel); break;
    case 'throwBreak': ring(p, x, y, 2.4, PAL.release, 0.3); ring(p, x, y, 3.4, PAL.release, 0.34, 0.06); sparks(p, rnd, x, y, Math.round(10 * calm), 0, 6.28, [3, 7], [0.16, 0.3], [0.3, 0.6], PAL.release); break;
    case 'counter': flare(p, x, y, 3.2, PAL.counter, 0.2, 0.8); ring(p, x, y, 4.6, PAL.counter, 0.38); ring(p, x, y, 2.6, PAL.white, 0.26, 0.05); sparks(p, rnd, x, y, Math.round(22 * calm), 0, 6.28, [6, 14], [0.22, 0.42], [0.6, 1.2], PAL.counter); shake = 0.2; break;
    case 'armor': ring(p, x, y, 2.2, PAL.armor, 0.26); sparks(p, rnd, x, y, Math.round(8 * calm), 0, 6.28, [3, 7], [0.16, 0.28], [0.4, 0.8], PAL.armor); break;
    case 'impact': {
      puffs(p, rnd, x, y - 1, Math.round(10 * calm), 5.5, 0.7, 1.2, 0.6);
      ring(p, x, y - 0.9, 5, PAL.impact, 0.36); ring(p, x, y - 0.9, 3, PAL.white, 0.26, 0.04);
      sparks(p, rnd, x, y - 0.8, Math.round(16 * calm), Math.PI / 2, 2.8, [5, 11], [0.24, 0.44], [0.5, 1.0], PAL.impact);
      shake = 0.26; break;
    }
    case 'bounce': sparks(p, rnd, x, y, Math.round(4 * calm), Math.PI / 2, 2, [2, 5], [0.12, 0.2], [0.3, 0.5], PAL.white); break;
    case 'shotBreak': sparks(p, rnd, x, y, Math.round(8 * calm), 0, 6.28, [2, 6], [0.15, 0.28], [0.3, 0.7], PAL.amber); puffs(p, rnd, x, y, 2, 1, 0.3, 0.6, 0.24); break;
    case 'fizzle': puffs(p, rnd, x, y, 2, 0.8, 0.4, 0.5, 0.2); break;
    case 'pickup': {
      const color = e.text?.startsWith('COFFEE') ? PAL.coffee : PAL.pickup;
      sparks(p, rnd, x, y - 0.4, Math.round(10 * calm), Math.PI / 2, 2.4, [1.5, 4], [0.4, 0.7], [0.4, 0.8], color, -1, 1.2); ring(p, x, y - 0.4, 1.8, color, 0.34); break;
    }
    case 'ledge': flare(p, x, y, 1.3, PAL.ledge, 0.16); ring(p, x, y, 1.6, PAL.ledge, 0.22); break;
    default: break;
  }
  return { particles: p, shake: ctx.reducedMotion ? shake * 0.5 : shake };
}

// -------------------------------------------------------------------------------------------------------------------
// GPU batches
// -------------------------------------------------------------------------------------------------------------------
const VERTEX = `attribute vec3 aOrigin; attribute vec3 aVel; attribute vec4 aTiming; attribute vec4 aColor; attribute vec4 aMode;
uniform float uTime;
varying vec2 vUv; varying vec4 vColor; varying float vT; varying float vKind;
void main() {
  float age = uTime - aTiming.x;
  float t = age / max(aTiming.y, 1e-4);
  vKind = aMode.x; vUv = uv; vColor = aColor; vT = t;
  if (aTiming.y <= 0.0 || age < 0.0 || t >= 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float drag = aMode.z;
  float travel = drag > 0.001 ? (1.0 - exp(-drag * age)) / drag : age;
  vec3 pos = aOrigin + aVel * travel + vec3(0.0, -0.5 * aMode.y * age * age, 0.0);
  vec3 vel = aVel * exp(-drag * age) + vec3(0.0, -aMode.y * age, 0.0);
  float size = mix(aTiming.z, aTiming.w, 1.0 - (1.0 - t) * (1.0 - t));
  vec4 mv = viewMatrix * vec4(pos, 1.0);
  vec2 corner = position.xy, offset;
  if (aMode.x > 0.5 && aMode.x < 1.5) {
    vec2 dir = (viewMatrix * vec4(vel, 0.0)).xy; float sp = length(dir);
    dir = sp > 1e-4 ? dir / sp : vec2(1.0, 0.0);
    float len = size * (1.0 + sp * 0.2);
    offset = dir * corner.x * len + vec2(-dir.y, dir.x) * corner.y * size * 0.2;
  } else {
    float ang = aMode.w * age, c = cos(ang), s = sin(ang);
    offset = mat2(c, -s, s, c) * corner * size;
  }
  mv.xy += offset;
  gl_Position = projectionMatrix * mv;
}`;
const FRAGMENT = `varying vec2 vUv; varying vec4 vColor; varying float vT; varying float vKind;
void main() {
  vec2 p = vUv * 2.0 - 1.0; float r = length(p), a;
  if (vKind < 0.5) a = pow(max(0.0, 1.0 - r), 2.0);
  else if (vKind < 1.5) a = smoothstep(1.0, 0.15, abs(p.y)) * smoothstep(1.0, 0.35, abs(p.x));
  else if (vKind < 2.5) { float w = 0.1 + 0.16 * (1.0 - vT); a = smoothstep(w, 0.0, abs(r - 0.8)) * smoothstep(1.0, 0.9, r); }
  else { float h = pow(max(0.0, 1.0 - abs(p.x) * 5.0), 2.0) * max(0.0, 1.0 - abs(p.y)), v = pow(max(0.0, 1.0 - abs(p.y) * 5.0), 2.0) * max(0.0, 1.0 - abs(p.x)); a = clamp(h + v + pow(max(0.0, 1.0 - r * 1.2), 3.0), 0.0, 1.0); }
  float fade = 1.0 - vT; fade *= fade;
  gl_FragColor = vec4(vColor.rgb, vColor.a * a * fade);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

class Batch {
  readonly mesh: T.Mesh;
  private geometry: T.InstancedBufferGeometry;
  private material: T.ShaderMaterial;
  private origin: T.InstancedBufferAttribute; private vel: T.InstancedBufferAttribute; private timing: T.InstancedBufferAttribute; private color: T.InstancedBufferAttribute; private mode: T.InstancedBufferAttribute;
  private cursor = 0;
  private dirty = false;
  /** Latest time any particle in this batch dies, for knowing when it is idle. */
  busyUntil = 0;
  readonly capacity: number;
  /** Test hook: how many instances the vertex shader would draw right now at clock `now`. */
  liveCount(now: number) { const a = this.timing.array as Float32Array; let n = 0; for (let i = 0; i < this.capacity; i++) { const age = now - a[i * 4]; if (a[i * 4 + 1] > 0 && age >= 0 && age / a[i * 4 + 1] < 1) n++; } return n; }

  constructor(capacity: number, additive: boolean, order: number) {
    this.capacity = capacity;
    const quad = new T.PlaneGeometry(1, 1);
    this.geometry = new T.InstancedBufferGeometry(); this.geometry.index = quad.index; this.geometry.setAttribute('position', quad.getAttribute('position')); this.geometry.setAttribute('uv', quad.getAttribute('uv'));
    const make = (n: number) => new T.InstancedBufferAttribute(new Float32Array(capacity * n), n).setUsage(T.DynamicDrawUsage);
    this.origin = make(3); this.vel = make(3); this.timing = make(4); this.color = make(4); this.mode = make(4);
    this.killAll();
    this.geometry.setAttribute('aOrigin', this.origin); this.geometry.setAttribute('aVel', this.vel); this.geometry.setAttribute('aTiming', this.timing); this.geometry.setAttribute('aColor', this.color); this.geometry.setAttribute('aMode', this.mode);
    this.geometry.instanceCount = capacity;
    this.material = new T.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms: { uTime: { value: 0 } }, transparent: true, depthWrite: false, blending: additive ? T.AdditiveBlending : T.NormalBlending, fog: false });
    this.mesh = new T.Mesh(this.geometry, this.material); this.mesh.frustumCulled = false; this.mesh.renderOrder = order;
  }
  set time(t: number) { this.material.uniforms.uTime.value = t; }
  add(p: Particle, now: number) {
    const i = this.cursor++ % this.capacity;
    this.origin.setXYZ(i, p.x, p.y, p.z); this.vel.setXYZ(i, p.vx, p.vy, p.vz);
    this.timing.setXYZW(i, now + p.delay, p.life, p.size0, p.size1); this.color.setXYZW(i, p.r, p.g, p.b, p.a); this.mode.setXYZW(i, KIND_CODE[p.kind], p.gravity, p.drag, p.spin);
    this.busyUntil = Math.max(this.busyUntil, now + p.delay + p.life); this.dirty = true;
  }
  flush() { if (!this.dirty) return; for (const a of [this.origin, this.vel, this.timing, this.color, this.mode]) a.needsUpdate = true; this.dirty = false; }
  /** Marks every particle dead. Used when the clock is rebased. */
  clear() { this.killAll(); this.timing.needsUpdate = true; this.busyUntil = 0; this.cursor = 0; }
  /**
   * Every instance becomes a dead particle: born long ago with a positive lifetime and no size, so the vertex shader culls
   * it. (Filling the whole attribute with one number made lifetimes negative, which drew every unused instance as a huge
   * invisible quad: 420 full-screen blends per frame.)
   */
  private killAll() { const a = this.timing.array as Float32Array; for (let i = 0; i < this.capacity; i++) { a[i * 4] = -1e6; a[i * 4 + 1] = 1; a[i * 4 + 2] = 0; a[i * 4 + 3] = 0; } }
  dispose() { this.geometry.dispose(); this.material.dispose(); }
}

/** The effect layer added to the scene. */
export class EffectLayer {
  readonly group = new T.Group();
  private glow: Batch; private dust: Batch;
  private rnd = mulberry32(0xc0ffee);
  /** Effect time in seconds. Advances while the game is not paused, hitstop included, so sparks animate through the freeze. */
  clock = 0;
  reducedMotion = false;
  readonly capacity: { glow: number; dust: number };

  constructor(glow: number, dust: number) {
    this.capacity = { glow, dust };
    this.dust = new Batch(Math.max(1, dust), false, 5); this.glow = new Batch(Math.max(1, glow), true, 6);
    this.group.add(this.dust.mesh, this.glow.mesh);
  }

  /** Spawns the particles for an event. Returns the camera-shake amount the event asks for. */
  event(e: GameEvent, ctx: EventContext): number {
    const fx = describeEvent(e, { ...ctx, reducedMotion: ctx.reducedMotion ?? this.reducedMotion }, this.rnd);
    for (const p of fx.particles) this.spawn(p);
    return fx.shake;
  }
  spawn(p: Particle) { (p.layer === 'dust' ? this.dust : this.glow).add(p, this.clock); }

  update(dt: number, paused: boolean) {
    if (!paused) this.clock += dt;
    // Rebase the clock when idle so float precision on the GPU never degrades in a session left open for days.
    if (this.clock > 900 && this.clock > this.glow.busyUntil + 2 && this.clock > this.dust.busyUntil + 2) { this.clock = 0; this.glow.clear(); this.dust.clear(); }
    this.glow.time = this.clock; this.dust.time = this.clock; this.glow.flush(); this.dust.flush();
  }

  /** Test hook: instances currently alive in the glow and dust batches. */
  get alive() { return { glow: this.glow.liveCount(this.clock), dust: this.dust.liveCount(this.clock) }; }

  /** Kills every particle (a new match). */
  clear() { this.glow.clear(); this.dust.clear(); }

  /** True while any effect could still be visible. */
  get busy() { return this.clock < Math.max(this.glow.busyUntil, this.dust.busyUntil); }

  dispose() { this.glow.dispose(); this.dust.dispose(); }
}
