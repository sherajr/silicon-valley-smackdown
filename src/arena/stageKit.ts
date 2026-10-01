import * as T from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { StaticBatch } from './staticBatch';
import type { BatchFlags } from './staticBatch';
import { signTexture } from './textures';
import type { SignSpec, TexOpts } from './textures';
import { mulberry32 } from './canvasUtil';
import { applyHeightFog } from './heightFog';

/** Emissive intensity for lights and signs that should bloom: above the bloom threshold, below blown-out. */
export const GLOW = 1.7;
export interface MatOpts { rough?: number; metal?: number; glow?: number; /** Picks up the arena's reflection environment (polished or glassy surfaces only). */ env?: boolean }
export interface UvSpec { tileW: number; tileH: number; ox?: number; oy?: number }
export interface PartOpts extends BatchFlags { rot?: [number, number, number]; scale?: [number, number, number]; uv?: UvSpec }
type Disposable = { dispose(): void };

/**
 * Helpers the arena builders share: a material cache, batched primitives (merged at `flush()` into a few meshes), signs,
 * trees and everything the stage owns so it can be disposed together. Anything that moves is created directly and is
 * never batched.
 */
export class StageKit {
  readonly root: T.Group;
  readonly tex: TexOpts;
  readonly batch = new StaticBatch();
  readonly owned: Disposable[] = [];
  readonly swayers: { object: T.Object3D; phase: number; amount: number }[] = [];
  readonly spinners: { object: T.Object3D; y: number; z: number }[] = [];
  private mats = new Map<string, T.MeshStandardMaterial>();
  /** Materials that reflect the arena environment, with how strongly. The renderer fills in the map. */
  readonly reflective: { material: T.MeshStandardMaterial; strength: number }[] = [];
  private scratch = { m: new T.Matrix4(), p: new T.Vector3(), q: new T.Quaternion(), e: new T.Euler(), s: new T.Vector3(1, 1, 1) };

  constructor(root: T.Group, tex: TexOpts) { this.root = root; this.tex = tex; }

  /** Standard material keyed by its parameters. Colours are authored in sRGB hex like the rest of the project. */
  mat(color: string, o: MatOpts = {}): T.MeshStandardMaterial {
    const key = `${color}|${o.rough ?? 0.8}|${o.metal ?? 0.06}|${o.glow ?? 0}|${o.env ? 1 : 0}`;
    let m = this.mats.get(key);
    if (!m) {
      m = new T.MeshStandardMaterial({ color, roughness: o.rough ?? 0.8, metalness: o.metal ?? 0.06, emissive: o.glow ? color : '#000000', emissiveIntensity: o.glow ?? 0 });
      applyHeightFog(m); this.mats.set(key, m); if (o.env) this.reflective.push({ material: m, strength: 1.3 });
    }
    return m;
  }
  /** Registers a material the kit did not create as reflective. */
  reflect<M extends T.MeshStandardMaterial>(material: M, strength = 1) { this.reflective.push({ material, strength }); return material; }
  glowMat(color: string, intensity = GLOW) { return this.mat(color, { rough: 0.5, metal: 0, glow: intensity }); }
  /** Registers a material the kit did not create so it is disposed with the stage. */
  own<M extends Disposable>(thing: M): M { this.owned.push(thing); return thing; }

  private place(geometry: T.BufferGeometry, x: number, y: number, z: number, o: PartOpts) {
    const { m, p, q, e, s } = this.scratch;
    e.set(...(o.rot ?? [0, 0, 0])); q.setFromEuler(e); p.set(x, y, z); s.set(...(o.scale ?? [1, 1, 1]));
    geometry.applyMatrix4(m.compose(p, q, s));
  }
  private facadeUv(geometry: T.BufferGeometry, sx: number, sy: number, sz: number, uv: UvSpec) {
    const pos = geometry.getAttribute('position'), nor = geometry.getAttribute('normal'), out = geometry.getAttribute('uv') as T.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i));
      if (ny > 0.5) { out.setXY(i, 0.03, 0.03); continue; }                   // roofs and undersides sample the plain wall corner of the tile
      const along = nx > 0.5 ? pos.getZ(i) + sz / 2 : pos.getX(i) + sx / 2;
      out.setXY(i, along / uv.tileW + (uv.ox ?? 0), (pos.getY(i) + sy / 2) / uv.tileH + (uv.oy ?? 0));
    }
  }

  /** A batched box centred at (x, y, z). */
  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, material: T.Material | string, o: PartOpts = {}) {
    const geometry = new T.BoxGeometry(sx, sy, sz);
    if (o.uv) this.facadeUv(geometry, sx, sy, sz, o.uv);
    this.place(geometry, x, y, z, { ...o, scale: undefined });
    this.batch.add(geometry, typeof material === 'string' ? this.mat(material) : material, o);
  }
  /** Any geometry, batched: positioned, rotated and scaled once, now. */
  put(geometry: T.BufferGeometry, material: T.Material | string, x: number, y: number, z: number, o: PartOpts = {}) {
    this.place(geometry, x, y, z, o);
    this.batch.add(geometry, typeof material === 'string' ? this.mat(material) : material, o);
  }
  /** An un-batched mesh (animated or individually textured). The geometry is owned and disposed with the stage. */
  mesh(geometry: T.BufferGeometry, material: T.Material, x: number, y: number, z: number, o: { cast?: boolean; receive?: boolean; parent?: T.Object3D } = {}) {
    const mesh = new T.Mesh(geometry, material); mesh.position.set(x, y, z); mesh.castShadow = o.cast ?? false; mesh.receiveShadow = o.receive ?? false;
    (o.parent ?? this.root).add(mesh); this.owned.push(geometry); return mesh;
  }

  /** A flat textured sign. `brightness` above 1 makes it glow in the HDR pipeline (neon). */
  sign(spec: SignSpec, x: number, y: number, z: number, brightness = 1, rotY = 0) {
    const map = signTexture(spec, this.tex), geo = new T.PlaneGeometry(spec.w, spec.h), mat = applyHeightFog(new T.MeshBasicMaterial({ map, color: new T.Color(brightness, brightness, brightness) })) as T.MeshBasicMaterial;
    this.owned.push(map, geo, mat);
    const mesh = new T.Mesh(geo, mat); mesh.position.set(x, y, z); mesh.rotation.y = rotY; this.root.add(mesh); return mesh;
  }

  /**
   * A stylised tree: a batched trunk and a faceted canopy of coloured blobs merged into one mesh that sways gently about
   * the trunk's base. `ground` is the height of the surface it stands on.
   */
  tree(x: number, z: number, height: number, leaf: [string, string], trunk = '#7d6b57', ground = 0) {
    this.box(x, ground + height * 0.5, z, 0.2, height, 0.2, trunk);
    const rnd = mulberry32(Math.round(x * 31 + z * 17 + height * 7)), blobs: T.BufferGeometry[] = [], c1 = new T.Color(leaf[0]), c2 = new T.Color(leaf[1]), tmp = new T.Color();
    for (let i = 0; i < 6; i++) {
      const g = new T.IcosahedronGeometry(0.62 + rnd() * 0.5, 1);
      g.translate((rnd() - 0.5) * 1.5, height * 0.84 + (rnd() - 0.5) * 1.2, (rnd() - 0.5) * 1.0);
      const colors = new Float32Array(g.getAttribute('position').count * 3); tmp.copy(c1).lerp(c2, rnd());
      for (let v = 0; v < colors.length; v += 3) { colors[v] = tmp.r; colors[v + 1] = tmp.g; colors[v + 2] = tmp.b; }
      g.setAttribute('color', new T.BufferAttribute(colors, 3)); g.deleteAttribute('uv'); blobs.push(g);
    }
    const merged = mergeGeometries(blobs, false)!; for (const b of blobs) b.dispose();
    const mat = this.own(new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, flatShading: true }));
    const canopy = new T.Group(); canopy.position.set(x, ground, z); this.root.add(canopy);
    const mesh = this.mesh(merged, mat, 0, 0, 0, { cast: true, receive: true, parent: canopy });
    mesh.name = 'canopy'; this.swayers.push({ object: canopy, phase: x * 0.37 + z, amount: 0.012 });
  }

  /**
   * Small emissive bulbs along a curve: one instanced mesh for the glass and one `Points` draw for the soft halos, so any
   * number of lamps costs two draw calls. `halo` is the glow sprite texture.
   */
  bulbs(points: T.Vector3[], color: string, halo: T.Texture, size = 0.9) {
    const geo = new T.SphereGeometry(0.085, 10, 8), mat = this.own(new T.MeshBasicMaterial({ color: new T.Color(color).multiplyScalar(2.6) }));
    const inst = new T.InstancedMesh(geo, mat, points.length), m = new T.Matrix4();
    points.forEach((p, i) => inst.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)));
    inst.instanceMatrix.needsUpdate = true; inst.frustumCulled = false; this.root.add(inst); this.owned.push(geo, inst);
    const pg = new T.BufferGeometry().setFromPoints(points), pm = new T.PointsMaterial({ map: halo, color: new T.Color(color).multiplyScalar(1.4), size, sizeAttenuation: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending });
    const glow = new T.Points(pg, pm); glow.frustumCulled = false; this.root.add(glow); this.owned.push(pg, pm);
  }

  /** Merges every batched piece into a few meshes. Call once, after all scenery is added. */
  flush() { const { geometries } = this.batch.build(this.root); this.owned.push(...geometries); }

  dispose() {
    for (const o of this.owned) o.dispose();
    for (const m of this.mats.values()) m.dispose();
    this.owned.length = 0; this.mats.clear();
  }
}
