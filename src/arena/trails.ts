import * as T from 'three';

/**
 * Trail ribbons for launched fighters and projectiles. Every ribbon shares one preallocated, dynamic geometry (a strip of
 * quads per ribbon), so any number of trails is a single draw call and nothing is allocated per frame.
 *
 * A ribbon only grows when its subject actually moves in the drawn space, so a fighter frozen in hitstop does not sprout
 * a trail that implies motion; ribbons age on a clock the caller can hold still for the same reason.
 */
export const TRAIL_POINTS = 14;
const MIN_STEP = 0.07;

interface Slot {
  key: string | null;
  /** x, y, z, birth for each sample, oldest first. */
  samples: Float32Array; count: number;
  head: T.Vector3;
  r: number; g: number; b: number; width: number; life: number;
  fed: boolean;
  dirty: boolean;
}

export class TrailSet {
  readonly mesh: T.Mesh;
  private slots: Slot[] = [];
  private position: T.BufferAttribute;
  private color: T.BufferAttribute;
  private geometry: T.BufferGeometry;
  private material: T.MeshBasicMaterial;
  private clock = 0;
  readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = Math.max(1, capacity);
    const vertsPer = TRAIL_POINTS * 2, verts = this.capacity * vertsPer;
    this.geometry = new T.BufferGeometry();
    this.position = new T.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(T.DynamicDrawUsage);
    this.color = new T.BufferAttribute(new Float32Array(verts * 4), 4).setUsage(T.DynamicDrawUsage);
    const index: number[] = [];
    for (let s = 0; s < this.capacity; s++) for (let k = 0; k < TRAIL_POINTS - 1; k++) { const a = s * vertsPer + k * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    this.geometry.setIndex(index); this.geometry.setAttribute('position', this.position); this.geometry.setAttribute('color', this.color);
    this.material = new T.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, fog: false });
    this.mesh = new T.Mesh(this.geometry, this.material); this.mesh.frustumCulled = false; this.mesh.renderOrder = 7;
    for (let s = 0; s < this.capacity; s++) this.slots.push({ key: null, samples: new Float32Array(TRAIL_POINTS * 4), count: 0, head: new T.Vector3(), r: 1, g: 1, b: 1, width: 0.2, life: 0.3, fed: false, dirty: true });
  }

  /** Feeds the ribbon for `key` with the subject's current position. Colour is linear and may exceed 1 for bloom. */
  follow(key: string, x: number, y: number, z: number, color: readonly number[], width: number, life: number) {
    let slot = this.slots.find(s => s.key === key);
    if (!slot) { slot = this.slots.find(s => s.key === null); if (!slot) return; slot.key = key; slot.count = 0; }
    slot.head.set(x, y, z); slot.r = color[0]; slot.g = color[1]; slot.b = color[2]; slot.width = width; slot.life = life; slot.fed = true; slot.dirty = true;
    const last = slot.count - 1;
    if (last < 0 || Math.hypot(x - slot.samples[last * 4], y - slot.samples[last * 4 + 1]) >= MIN_STEP) {
      if (slot.count === TRAIL_POINTS - 1) { slot.samples.copyWithin(0, 4, slot.count * 4); slot.count--; }
      const o = slot.count * 4; slot.samples[o] = x; slot.samples[o + 1] = y; slot.samples[o + 2] = z; slot.samples[o + 3] = this.clock; slot.count++;
    }
  }

  /** Ages the ribbons and rebuilds their vertices. `dt` of 0 holds everything still (hitstop). */
  update(dt: number) {
    this.clock += dt;
    let touched = false;
    for (let s = 0; s < this.slots.length; s++) {
      const slot = this.slots[s];
      if (slot.key === null) { if (slot.dirty) { this.collapse(s); slot.dirty = false; touched = true; } continue; }
      // Drop expired samples from the tail.
      let drop = 0; while (drop < slot.count && this.clock - slot.samples[drop * 4 + 3] > slot.life) drop++;
      if (drop) { slot.samples.copyWithin(0, drop * 4, slot.count * 4); slot.count -= drop; }
      if (slot.count === 0 && !slot.fed) { slot.key = null; this.collapse(s); slot.dirty = false; touched = true; continue; }
      this.build(s, slot); slot.fed = false; slot.dirty = false; touched = true;
    }
    if (touched) { this.position.needsUpdate = true; this.color.needsUpdate = true; }
  }

  private collapse(s: number) {
    const vp = TRAIL_POINTS * 2, p = this.position.array as Float32Array, c = this.color.array as Float32Array;
    p.fill(0, s * vp * 3, (s + 1) * vp * 3); c.fill(0, s * vp * 4, (s + 1) * vp * 4);
  }

  private build(s: number, slot: Slot) {
    const vp = TRAIL_POINTS * 2, pos = this.position.array as Float32Array, col = this.color.array as Float32Array;
    // Samples oldest to newest, then the live head as the final point so the ribbon never lags its subject.
    const n = slot.count + (slot.fed ? 1 : 0);
    const point = (i: number, out: number[]) => {
      if (i < slot.count) { out[0] = slot.samples[i * 4]; out[1] = slot.samples[i * 4 + 1]; out[2] = slot.samples[i * 4 + 2]; out[3] = slot.samples[i * 4 + 3]; }
      else { out[0] = slot.head.x; out[1] = slot.head.y; out[2] = slot.head.z; out[3] = this.clock; }
    };
    const a = [0, 0, 0, 0], b = [0, 0, 0, 0], c = [0, 0, 0, 0];
    for (let k = 0; k < TRAIL_POINTS; k++) {
      const v = (s * vp + k * 2) * 3, w = (s * vp + k * 2) * 4;
      if (k >= n) { // unused tail: collapse onto the last real point with no opacity
        const last = Math.max(0, n - 1); point(last, a);
        for (let side = 0; side < 2; side++) { pos[v + side * 3] = a[0]; pos[v + side * 3 + 1] = a[1]; pos[v + side * 3 + 2] = a[2]; col[w + side * 4] = col[w + side * 4 + 1] = col[w + side * 4 + 2] = col[w + side * 4 + 3] = 0; }
        continue;
      }
      point(k, b); point(Math.max(0, k - 1), a); point(Math.min(n - 1, k + 1), c);
      let tx = c[0] - a[0], ty = c[1] - a[1]; const len = Math.hypot(tx, ty) || 1; tx /= len; ty /= len;
      const age = Math.min(1, Math.max(0, (this.clock - b[3]) / slot.life)), taper = Math.pow(1 - age, 0.8), half = slot.width * 0.5 * taper, alpha = Math.pow(1 - age, 1.6);
      for (let side = 0; side < 2; side++) {
        const sgn = side ? 1 : -1;
        pos[v + side * 3] = b[0] - ty * half * sgn; pos[v + side * 3 + 1] = b[1] + tx * half * sgn; pos[v + side * 3 + 2] = b[2];
        col[w + side * 4] = slot.r; col[w + side * 4 + 1] = slot.g; col[w + side * 4 + 2] = slot.b; col[w + side * 4 + 3] = alpha;
      }
    }
  }

  /** Active ribbons, for tests. */
  get active() { return this.slots.filter(s => s.key !== null).length; }
  clear() { for (let s = 0; s < this.slots.length; s++) { this.slots[s].key = null; this.slots[s].count = 0; this.collapse(s); } this.position.needsUpdate = true; this.color.needsUpdate = true; }
  dispose() { this.geometry.dispose(); this.material.dispose(); }
}
