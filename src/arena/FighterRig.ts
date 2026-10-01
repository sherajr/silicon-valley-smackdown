import * as T from 'three';
import { FIGHTER_ACCENTS, ROSTER } from './data';
import type { Fighter } from './Simulation';
import { G, makeProp, surfaceMaterial } from './rigParts';
import type { SurfaceClass } from './rigParts';
import { StaticBatch } from './staticBatch';

export { makeProp };
const clamp = T.MathUtils.clamp, lerp = T.MathUtils.lerp;
type Limb = { upper: T.Group; lower: T.Group };
type Chan = { o: T.Object3D; k: 'rx' | 'ry' | 'rz' | 'py'; angle: boolean };

/** What the renderer tells a rig about this frame. Position and move age are already interpolated. */
export interface PoseInput {
  x: number; y: number;
  /** Distance the fighter moved on screen since the previous drawn frame; the stride is driven by it. */
  moved: number;
  /** Fractional age of the current move (never blended across two moves), or null. */
  attackAge: number | null;
  /** Animation clock in seconds. It does not advance in hitstop, pause or frame-step. */
  time: number;
  /** Display delta in seconds, used for blending only. */
  dt: number;
  /** This frame jumped (respawn, reset, ledge snap): show the target pose immediately. */
  snap: boolean;
}

/** Head silhouette (radius, height), revolved and flattened front to back: a smooth skull that narrows to a chin. */
const HEAD_PROFILE: [number, number][] = [[0, 0.385], [0.12, 0.368], [0.22, 0.315], [0.295, 0.205], [0.33, 0.06], [0.325, -0.05], [0.3, -0.16], [0.255, -0.26], [0.19, -0.335], [0.1, -0.378], [0, -0.388]];
const SHIELD_VERTEX = `varying vec3 vNormal; varying vec3 vView; varying vec3 vLocal;
void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vNormal = normalize(normalMatrix * normal); vView = normalize(-mv.xyz); vLocal = normalize(position); gl_Position = projectionMatrix * mv; }`;
const SHIELD_FRAGMENT = `uniform vec3 uColor; uniform float uOpacity; uniform vec3 uRipple; uniform float uRippleAge;
varying vec3 vNormal; varying vec3 vView; varying vec3 vLocal;
void main() {
  float fres = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.4);
  float ripple = 0.0;
  if (uRippleAge < 1.0) { float d = acos(clamp(dot(vLocal, normalize(uRipple)), -1.0, 1.0)); float ring = sin((d - uRippleAge * 1.6) * 16.0) * exp(-abs(d - uRippleAge * 1.6) * 5.0); ripple = max(ring, 0.0) * (1.0 - uRippleAge); }
  float a = (0.05 + fres * 0.5 + ripple * 0.9) * uOpacity;
  gl_FragColor = vec4(uColor * (1.0 + ripple * 2.0), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Original articulated mesh characters: every silhouette, face, accessory and pose is 3D. */
export class FighterRig {
  root = new T.Group();
  body = new T.Group();
  torso = new T.Group();
  head = new T.Group();
  arms: Limb[] = [];
  legs: Limb[] = [];
  shield: T.Mesh;
  halo: T.Mesh;
  character: number;
  /** Wrist markers and a chest marker, so a held opponent can be drawn in the captor's hands. */
  readonly hands: T.Object3D[] = [];
  readonly chest = new T.Object3D();
  private mats: T.MeshStandardMaterial[] = [];
  private matMap = new Map<string, T.MeshStandardMaterial>();
  private batches = new Map<T.Object3D, StaticBatch>();
  private owned: { dispose(): void }[] = [];
  private shieldMat: T.ShaderMaterial;
  private haloMat: T.MeshBasicMaterial;
  private scale = 1;
  private id: string;
  private accent: string;
  private eyes: T.Group[] = [];
  private brows: T.Mesh[] = [];
  private mouthClosed!: T.Mesh;
  private mouthOpen!: T.Group;
  private channels: Chan[] = [];
  private shown!: Float32Array;
  private primed = false;
  private phase = 0;
  private rippleAge = 1;
  private tint = new T.Color();
  private shieldLow = new T.Color('#ff7a5a');
  private tmpA = new T.Vector3();
  private scratch = { m: new T.Matrix4(), p: new T.Vector3(), q: new T.Quaternion(), e: new T.Euler(), s: new T.Vector3() };

  constructor(character: number) {
    this.character = character;
    const def = ROSTER[character], id = def.id, v = def.visual;
    this.id = id; this.accent = FIGHTER_ACCENTS[character];
    const wide = id === 'al' ? 1.26 : id === 'priya' ? 0.85 : id === 'chad' ? 1.08 : 1;
    this.scale = id === 'kevin' ? 1.055 : id === 'priya' ? 0.96 : 1;
    this.root.add(this.body); this.body.add(this.torso); this.torso.position.y = 1.03; this.torso.add(this.head); this.head.position.set(0, 1.03, 0.01);

    const skin = this.mat('skin', v.skin), hair = this.mat('hair', v.hair), cloth = this.mat('cloth', v.primary), cloth2 = this.mat('cloth', v.secondary), pants = this.mat('cloth', v.pants);
    const sneaker = id === 'hunter' || id === 'priya', shoe = this.mat(sneaker ? 'plastic' : 'leather', sneaker ? '#e9efea' : '#1d232d'), sole = this.mat('rubber', sneaker ? '#f4f4ee' : '#12161c'), trim = this.mat('plastic', this.accent);

    // --- Torso: a smooth lathed trunk with rounded shoulders, a hip block and a neck.
    const profile = [[0.27 * wide, 0], [0.31 * wide, 0.08], [0.33 * wide, 0.2], [(id === 'al' ? 0.44 : 0.37) * wide, 0.38], [0.41 * wide, 0.55], [0.40 * wide, 0.64], [0.30 * wide, 0.71], [0.17, 0.76]].map(([r, y]) => new T.Vector2(r, y));
    const trunk = new T.LatheGeometry(profile, 28); this.owned.push(trunk);
    this.part(this.torso, trunk, cloth, 0, 0, 0, 1, 1, 0.68);
    this.part(this.torso, G.rbox(0.2), pants, 0, -0.01, 0, 0.62 * wide, 0.22, 0.38);
    this.part(this.torso, G.cyl(), skin, 0, 0.8, 0.0, 0.125, 0.24, 0.125);

    // --- Head: skull, jaw, ears, nose, then eyes, brows and mouth as separate moving parts.
    const headGeo = new T.LatheGeometry(HEAD_PROFILE.map(([r, y]) => new T.Vector2(r, y)), 30); this.owned.push(headGeo);
    this.part(this.head, headGeo, skin, 0, 0, 0, 1, 1, 0.92);
    for (const s of [-1, 1]) { this.part(this.head, G.sphere(), skin, s * 0.325, -0.01, 0, 0.065, 0.105, 0.06); this.part(this.head, G.sphere(), this.mat('skin', this.shade(v.skin, 0.85)), s * 0.335, -0.01, 0.01, 0.036, 0.07, 0.03); }
    this.part(this.head, G.sphere(), skin, 0, -0.045, 0.295, 0.058, 0.07, 0.075);
    const eyeColor = id === 'priya' ? '#2a1a14' : id === 'al' ? '#3a4a3a' : id === 'kevin' ? '#34495a' : '#352a22';
    const white = this.mat('plastic', '#f7f3e6'), iris = this.mat('glass', eyeColor), pupil = this.mat('glass', '#10141a'), spark = this.mat('glow', '#ffffff', 1.2);
    for (const s of [-1, 1]) {
      const eye = new T.Group(); eye.position.set(s * 0.125, 0.05, 0.274); this.head.add(eye); this.eyes.push(eye);
      this.dyn(eye, G.sphere(), white, 0, 0, 0, 0.067, 0.071, 0.042); this.dyn(eye, G.sphere(), iris, s * 0.004, 0, 0.026, 0.046, 0.05, 0.022);
      this.dyn(eye, G.sphere(), pupil, s * 0.004, 0, 0.037, 0.022, 0.026, 0.012); this.dyn(eye, G.sphere(), spark, s * 0.004 + 0.014, 0.02, 0.046, 0.011, 0.011, 0.008);
      const brow = this.dyn(this.head, G.rbox(0.4), hair, s * 0.125, 0.14, 0.282, 0.15, 0.036, 0.034); brow.rotation.z = s * -0.11; brow.userData.side = s; this.brows.push(brow);
    }
    const lip = this.mat('skin', '#9c5a4a');
    this.mouthClosed = this.dyn(this.head, G.arc(0.14, 0.5), lip, 0, -0.158, 0.286, 0.075, 0.06, 0.07, 0, 0, Math.PI);
    const open = new T.Group(); open.position.set(0, -0.172, 0.282); this.head.add(open); this.mouthOpen = open; open.visible = false;
    this.dyn(open, G.sphere(), this.mat('plastic', '#3b1b1f'), 0, 0, 0, 0.062, 0.05, 0.03); this.dyn(open, G.box(), white, 0, 0.026, 0.026, 0.07, 0.014, 0.006);

    // --- Arms and legs: tapered limbs with real joints, hands with thumbs, shoes with soles.
    for (const side of [-1, 1]) {
      const upper = new T.Group(), lower = new T.Group();
      this.torso.add(upper); upper.position.set(side * 0.42 * wide, 0.60, 0);
      this.part(upper, G.sphere(), cloth, 0, -0.04, 0, 0.18, 0.2, 0.175);
      this.part(upper, G.cyl(1, 0.84), cloth, 0, -0.2, 0, 0.125, 0.34, 0.13);
      upper.add(lower); lower.position.y = -0.36;
      this.part(lower, G.sphere(), cloth, 0, 0, 0, 0.115, 0.115, 0.12);
      this.part(lower, G.cyl(1, 0.86), cloth, 0, -0.16, 0, 0.108, 0.31, 0.113);
      this.part(lower, G.cyl(), cloth2, 0, -0.305, 0, 0.116, 0.065, 0.122);
      this.part(lower, G.sphere(), skin, 0, -0.4, 0.016, 0.098, 0.115, 0.088);
      this.part(lower, G.capsule(0.05), skin, side * 0.085, -0.375, 0.05, 0.034, 0.034, 0.034, 0.3, 0, side * 0.5);
      const wrist = new T.Object3D(); wrist.position.set(0, -0.4, 0.04); lower.add(wrist); this.hands.push(wrist);
      this.arms.push({ upper, lower });
      const hip = new T.Group(), knee = new T.Group();
      this.body.add(hip); hip.position.set(side * 0.215 * wide, 1.01, 0);
      this.part(hip, G.sphere(), pants, 0, -0.02, 0, 0.165, 0.165, 0.165);
      this.part(hip, G.cyl(1, 0.84), pants, 0, -0.22, 0, 0.16, 0.43, 0.165);
      hip.add(knee); knee.position.y = -0.44;
      this.part(knee, G.sphere(), pants, 0, 0, 0, 0.146, 0.148, 0.15);
      this.part(knee, G.cyl(1, 0.8), pants, 0, -0.21, 0, 0.128, 0.41, 0.132);
      this.part(knee, G.rbox(0.3), shoe, 0, -0.455, 0.075, 0.29, 0.2, 0.46);
      this.part(knee, G.sphere(), shoe, 0, -0.5, 0.275, 0.135, 0.085, 0.12);
      this.part(knee, G.rbox(0.25), sole, 0, -0.554, 0.085, 0.3, 0.046, 0.49);
      this.part(knee, G.box(), trim, 0, -0.51, 0.082, 0.292, 0.018, 0.455);
      this.legs.push({ upper: hip, lower: knee });
    }
    this.chest.position.set(0, 0.36, 0.2); this.torso.add(this.chest);
    this.dress(id, { hair, cloth, cloth2, character });
    this.bake();

    // --- Shield shell and invulnerability halo.
    const shieldGeo = new T.SphereGeometry(1, 40, 28); this.owned.push(shieldGeo);
    this.shieldMat = new T.ShaderMaterial({ transparent: true, depthWrite: false, side: T.DoubleSide, fog: false, uniforms: { uColor: { value: new T.Color(this.accent) }, uOpacity: { value: 1 }, uRipple: { value: new T.Vector3(1, 0, 0) }, uRippleAge: { value: 1 } }, vertexShader: SHIELD_VERTEX, fragmentShader: SHIELD_FRAGMENT });
    this.shield = new T.Mesh(shieldGeo, this.shieldMat); this.shield.scale.set(1.24, 1.4, 1.1); this.shield.position.y = 1.25; this.shield.visible = false; this.shield.renderOrder = 4; this.root.add(this.shield);
    const haloGeo = new T.RingGeometry(0.58, 0.74, 56); this.owned.push(haloGeo);
    this.haloMat = new T.MeshBasicMaterial({ color: new T.Color(this.accent).multiplyScalar(2.2), transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false });
    this.halo = new T.Mesh(haloGeo, this.haloMat); this.halo.rotation.x = -Math.PI / 2; this.halo.position.y = 0.06; this.halo.visible = false; this.halo.renderOrder = 3; this.root.add(this.halo);

    this.buildChannels();
  }

  // ------------------------------------------------------------------------------------------------------------
  // Construction helpers
  // ------------------------------------------------------------------------------------------------------------
  private shade(hex: string, k: number) { const c = new T.Color(hex); return `#${c.multiplyScalar(k).getHexString()}`; }
  private mat(cls: SurfaceClass, color: string, glow = 0) {
    const key = `${cls}|${color}|${glow}`; let m = this.matMap.get(key);
    if (!m) { m = surfaceMaterial(cls, color, glow); this.matMap.set(key, m); if (!glow) this.mats.push(m); this.owned.push(m); }
    return m;
  }
  /** A static piece, merged with its siblings of the same material when the rig is baked. */
  private part(group: T.Object3D, geo: T.BufferGeometry, mat: T.Material, x: number, y: number, z: number, sx: number, sy = sx, sz = sx, rx = 0, ry = 0, rz = 0) {
    const { m, p, q, e, s } = this.scratch, g = geo.clone();
    g.applyMatrix4(m.compose(p.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), s.set(sx, sy, sz)));
    let batch = this.batches.get(group); if (!batch) { batch = new StaticBatch(); this.batches.set(group, batch); }
    batch.add(g, mat, { cast: true, receive: true });
  }
  /** A moving piece that stays its own mesh (eyes, brows, mouth). */
  private dyn(group: T.Object3D, geo: T.BufferGeometry, mat: T.Material, x: number, y: number, z: number, sx: number, sy = sx, sz = sx, rx = 0, ry = 0, rz = 0) {
    const mesh = new T.Mesh(geo, mat); mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); mesh.rotation.set(rx, ry, rz); mesh.castShadow = false; group.add(mesh); return mesh;
  }
  private bake() { for (const [group, batch] of this.batches) { const { geometries } = batch.build(group); this.owned.push(...geometries); } this.batches.clear(); }

  /** Character-specific clothing, hair and signature accessories. */
  private dress(id: string, k: { hair: T.Material; cloth: T.Material; cloth2: T.Material; character: number }) {
    const { hair, cloth, cloth2 } = k, T0 = this.torso, H = this.head, arm0 = this.arms[0].lower;
    const metal = (c: string) => this.mat('metal', c), plastic = (c: string) => this.mat('plastic', c), fabric = (c: string) => this.mat('cloth', c);
    const hairCap = (lat: number, y: number, sx = 0.345, sy = 0.39, sz = 0.318, tilt = -0.3) => this.part(H, G.cap(lat), hair, 0, y, -0.012, sx, sy, sz, tilt);
    if (id === 'hunter') {
      hairCap(0.44, 0.035, 0.345, 0.395, 0.318);
      this.part(H, G.sphere(), hair, 0, 0.3, 0.13, 0.2, 0.12, 0.2); this.part(H, G.sphere(), hair, 0.17, 0.27, 0.1, 0.12, 0.11, 0.14);
      for (const s of [-1, 1]) this.part(H, G.sphere(), hair, s * 0.305, 0.1, 0.02, 0.075, 0.13, 0.11);
      this.part(H, G.sphere(), hair, 0, -0.262, 0.03, 0.245, 0.085, 0.205); this.part(H, G.rbox(0.4), hair, 0, -0.103, 0.289, 0.13, 0.026, 0.04);
      // Quilted puffer vest over a hoodie, with a hood bunched behind the neck and a smartwatch.
      for (let i = 0; i < 5; i++) this.part(T0, G.rbox(0.45), cloth2, 0, 0.1 + i * 0.118, 0, i === 4 ? 0.62 : 0.79 - i * 0.012, 0.126, i === 4 ? 0.46 : 0.55);
      this.part(T0, G.sphere(), cloth, 0, 0.71, -0.2, 0.31, 0.18, 0.21);
      this.part(arm0, G.rbox(0.3), this.mat('plastic', '#1d323f'), 0, -0.29, 0.13, 0.15, 0.11, 0.045); this.part(arm0, G.rbox(0.2), this.mat('glow', '#53ead4', 1.6), 0, -0.29, 0.158, 0.11, 0.07, 0.012);
    } else if (id === 'kevin') {
      hairCap(0.4, 0.05, 0.35, 0.4, 0.322, -0.38); this.part(H, G.rbox(0.4), hair, 0.0, 0.34, 0.06, 0.34, 0.07, 0.2, -0.3);
      for (const s of [-1, 1]) this.part(H, G.sphere(), hair, s * 0.31, 0.1, 0.0, 0.065, 0.12, 0.1);
      // Shirt, tie, lapels; round gold glasses with tinted lenses.
      this.part(T0, G.rbox(0.2), fabric('#ecdfcd'), 0, 0.46, 0.245, 0.24, 0.5, 0.075); this.part(T0, G.cone(), fabric('#bd4550'), 0, 0.37, 0.295, 0.082, 0.42, 0.035, 0, 0, Math.PI);
      for (const s of [-1, 1]) {
        this.part(T0, G.rbox(0.3), cloth, s * 0.15, 0.49, 0.295, 0.13, 0.46, 0.06, 0, 0, s * -0.35);
        this.part(H, G.torus(0.11), metal('#d5b167'), s * 0.13, 0.055, 0.285, 0.088, 0.088, 0.09); this.part(H, G.cyl(), this.mat('glass', '#526879'), s * 0.13, 0.055, 0.287, 0.078, 0.01, 0.078, Math.PI / 2);
        this.part(H, G.box(), metal('#d5b167'), s * 0.27, 0.07, 0.15, 0.012, 0.012, 0.28, 0, s * 0.2);
      }
      this.part(H, G.box(), metal('#d5b167'), 0, 0.06, 0.29, 0.06, 0.012, 0.012);
      const prop = makeProp(k.character); arm0.add(prop); prop.position.set(0, -0.66, 0); prop.scale.setScalar(0.75);
    } else if (id === 'al') {
      this.part(H, G.cap(0.4), hair, 0, 0.0, -0.05, 0.34, 0.39, 0.31, -0.62); this.part(H, G.sphere(), hair, 0, -0.18, 0.075, 0.292, 0.21, 0.246);
      for (const s of [-1, 1]) this.part(H, G.sphere(), hair, s * 0.31, 0.06, -0.02, 0.07, 0.13, 0.11);
      this.part(H, G.rbox(0.4), hair, 0, -0.105, 0.285, 0.2, 0.05, 0.05);
      // A rumpled bowling shirt with cream panels and buttons, and a crooked loose tie.
      for (const x of [-0.2, 0.2]) this.part(T0, G.rbox(0.3), fabric('#e5c994'), x, 0.38, 0.305, 0.12, 0.63, 0.05);
      for (let y = 0.18; y < 0.65; y += 0.12) this.part(T0, G.sphere(), plastic('#e7d8aa'), 0, y, 0.372, 0.026);
      this.part(T0, G.cone(), cloth2, 0.03, 0.4, 0.34, 0.06, 0.36, 0.03, 0, 0, Math.PI + 0.15);
      const prop = makeProp(k.character); arm0.add(prop); prop.position.set(0, -0.46, 0.05); prop.scale.setScalar(0.7);
    } else if (id === 'priya') {
      hairCap(0.42, 0.05, 0.345, 0.39, 0.32, -0.34);
      // Ponytail, headset with a mint microphone, blazer lapel and pocket square.
      this.part(H, G.capsule(0.4), hair, 0, -0.2, -0.36, 0.1, 0.1, 0.1, 0.35); this.part(H, G.sphere(), hair, 0, 0.13, -0.3, 0.17, 0.16, 0.17); this.part(H, G.torus(0.2), plastic('#d9c7ff'), 0, 0.13, -0.27, 0.1, 0.1, 0.1, Math.PI / 2);
      this.part(H, G.arc(0.07, 0.5), this.mat('plastic', '#2d2d38'), 0, 0.02, 0, 0.375, 0.375, 0.34, 0, 0, 0);
      this.part(H, G.sphere(), this.mat('plastic', '#303445'), -0.36, -0.015, 0, 0.07, 0.12, 0.11); this.part(H, G.capsule(0.28), plastic('#272c36'), -0.3, -0.1, 0.17, 0.018, 0.018, 0.018, Math.PI / 2, -0.4);
      this.part(H, G.sphere(), this.mat('glow', '#60f3cb', 1.8), -0.22, -0.13, 0.31, 0.04);
      this.part(T0, G.rbox(0.2), fabric('#f1ddc8'), 0, 0.46, 0.245, 0.21, 0.5, 0.07); this.part(T0, G.rbox(0.3), fabric('#edc8ff'), 0.19, 0.54, 0.285, 0.075, 0.075, 0.025);
      for (const s of [-1, 1]) this.part(T0, G.rbox(0.3), cloth, s * 0.13, 0.48, 0.29, 0.1, 0.46, 0.055, 0, 0, s * -0.3);
    } else if (id === 'chad') {
      hairCap(0.44, 0.04, 0.345, 0.395, 0.318, -0.3); this.part(H, G.rbox(0.45), hair, 0.0, 0.31, 0.12, 0.3, 0.1, 0.2, -0.25);
      // Quarter-zip with a collar, and wraparound sunglasses.
      this.part(T0, G.rbox(0.3), fabric('#282f36'), 0, 0.65, 0.215, 0.14, 0.2, 0.05); this.part(T0, G.box(), metal('#b8a47c'), 0, 0.47, 0.26, 0.022, 0.4, 0.02);
      this.part(H, G.rbox(0.3), metal('#c3a252'), 0, 0.06, 0.285, 0.57, 0.13, 0.026);
      for (const s of [-1, 1]) this.part(H, G.rbox(0.35), this.mat('glass', '#0f1824'), s * 0.15, 0.05, 0.305, 0.245, 0.125, 0.03);
      this.part(arm0, G.cyl(), metal('#dbbb68'), 0, -0.3, 0, 0.127, 0.08, 0.132);
    } else if (id === 'elon') {
      hairCap(0.4, 0.06, 0.34, 0.39, 0.315, -0.34);
      // A rocket pack on the back: two thrusters with nose cones and warm nozzles, and a chest panel with a pink band.
      this.part(T0, G.rbox(0.2), plastic('#303b50'), 0, 0.35, 0.23, 0.36, 0.59, 0.1); this.part(T0, G.rbox(0.3), plastic('#e877a9'), 0, 0.5, 0.288, 0.22, 0.038, 0.025);
      for (const x of [-0.23, 0.23]) {
        this.part(T0, G.cyl(), metal('#909daf'), x, 0.36, -0.29, 0.12, 0.59, 0.12); this.part(T0, G.cone(), plastic('#d9e2eb'), x, 0.72, -0.29, 0.12, 0.18, 0.12);
        this.part(T0, G.cone(), this.mat('glow', '#ff9c57', 1.8), x, -0.03, -0.29, 0.085, 0.22, 0.085, Math.PI);
      }
    }
  }

  // ------------------------------------------------------------------------------------------------------------
  // Pose blending: the pose code below writes a target pose straight onto the joints; this smooths the joints toward it.
  // ------------------------------------------------------------------------------------------------------------
  private buildChannels() {
    const c = this.channels;
    const rot = (o: T.Object3D, axes: string) => { for (const a of axes) c.push({ o, k: `r${a}` as Chan['k'], angle: true }); };
    rot(this.body, 'yz'); c.push({ o: this.body, k: 'py', angle: false }); rot(this.torso, 'xyz'); rot(this.head, 'xyz');
    for (const a of this.arms) { rot(a.upper, 'xz'); rot(a.lower, 'x'); }
    for (const l of this.legs) { rot(l.upper, 'xz'); rot(l.lower, 'x'); }
    this.shown = new Float32Array(c.length);
  }
  private read(ch: Chan) { return ch.k === 'py' ? ch.o.position.y : ch.k === 'rx' ? ch.o.rotation.x : ch.k === 'ry' ? ch.o.rotation.y : ch.o.rotation.z; }
  private write(ch: Chan, v: number) { if (ch.k === 'py') ch.o.position.y = v; else if (ch.k === 'rx') ch.o.rotation.x = v; else if (ch.k === 'ry') ch.o.rotation.y = v; else ch.o.rotation.z = v; }
  private settle(rate: number, dt: number, snap: boolean) {
    const k = snap || !isFinite(rate) ? 1 : 1 - Math.exp(-Math.max(0, dt) * rate), TAU = Math.PI * 2;
    for (let i = 0; i < this.channels.length; i++) {
      const ch = this.channels[i], target = this.read(ch);
      if (!this.primed || k >= 1) this.shown[i] = target;
      else { let d = target - this.shown[i]; if (ch.angle) d -= TAU * Math.round(d / TAU); this.shown[i] += d * k; }
      this.write(ch, this.shown[i]);
    }
    this.primed = true;
  }

  /** Sets an arm's shoulder and elbow angles (negative x lifts the arm forward and up). */
  private arm(a: Limb, shoulder: number, elbow: number, out = 0) { a.upper.rotation.x = shoulder; a.lower.rotation.x = elbow; a.upper.rotation.z = out; }
  private leg(l: Limb, hip: number, knee: number) { l.upper.rotation.x = hip; l.lower.rotation.x = knee; }

  /** Gives the fighter's reflective surfaces the arena's environment map. Shiny classes reflect more than cloth and skin. */
  setEnvironment(texture: T.Texture | null, intensity: number) {
    for (const [key, m] of this.matMap) { const cls = key.split('|')[0]; m.envMap = texture; m.envMapIntensity = intensity * (cls === 'metal' || cls === 'glass' ? 1.5 : cls === 'cloth' ? 0.7 : 1); m.needsUpdate = true; }
  }

  /** Shield ripple: where the block landed, in the shield's local space (x toward the attacker). */
  shieldHit(dirX: number) { (this.shieldMat.uniforms.uRipple.value as T.Vector3).set(dirX || 1, 0.25, 0.3); this.rippleAge = 0; }

  /** World position midway between the two hands, for attaching a held opponent. */
  handMidpoint(out: T.Vector3) {
    this.hands[0].getWorldPosition(out); this.hands[1].getWorldPosition(this.tmpA);
    return out.add(this.tmpA).multiplyScalar(0.5);
  }
  chestWorld(out: T.Vector3) { return this.chest.getWorldPosition(out); }

  pose(f: Fighter, input: PoseInput) {
    const { time, dt } = input, age = input.attackAge;
    this.root.visible = f.respawn === 0 && f.stocks > 0;
    this.root.position.set(input.x, input.y, 0);
    this.body.scale.setScalar(this.scale);
    this.body.rotation.set(0, f.facing * 1.15, 0);
    this.body.position.y = Math.sin(time * 3.8) * 0.018;
    this.torso.rotation.set(0, 0, 0); this.head.rotation.set(0.02 * Math.sin(time * 1.3), 0.1 * Math.sin(time), 0);
    // The body is turned three-quarters to the camera, so which arm is nearer depends on facing.
    const near = this.arms[f.facing > 0 ? 0 : 1], far = this.arms[f.facing > 0 ? 1 : 0];
    for (let i = 0; i < 2; i++) {
      const arm = this.arms[i], leg = this.legs[i];
      arm.upper.rotation.set(-0.48 - i * 0.25 + Math.sin(time * 1.9 + i * 1.7) * 0.02, 0, (i ? -1 : 1) * 0.13);
      arm.lower.rotation.set(-0.72, 0, 0);
      leg.upper.rotation.set(0, 0, (i ? -1 : 1) * 0.09); leg.lower.rotation.set(0.05, 0, 0);
    }
    const free = !f.attack && !f.guarding && !f.stun && f.heldBy === null && !f.hold;
    // Stride: driven by how far the fighter has actually moved on screen, so feet stay planted and hitstop is still.
    if (f.grounded) this.phase += input.moved * 3.6;
    const walking = f.grounded && free && Math.abs(f.vx) > 0.025;
    if (walking) {
      const amp = Math.min(0.85, Math.abs(f.vx) * 6), s = Math.sin(this.phase), c = Math.cos(this.phase);
      this.legs[0].upper.rotation.x = s * amp; this.legs[1].upper.rotation.x = -s * amp;
      this.legs[0].lower.rotation.x = Math.max(0, -s) * amp * 1.1; this.legs[1].lower.rotation.x = Math.max(0, s) * amp * 1.1;
      this.arms[0].upper.rotation.x = -s * amp * 0.75; this.arms[1].upper.rotation.x = s * amp * 0.75;
      this.body.position.y = Math.abs(c) * 0.055; this.torso.rotation.x = 0.1 + amp * 0.06; this.torso.rotation.z = s * 0.03;
    }
    if (!f.grounded) {
      // Rising tucks the legs and lifts the arms; falling spreads them. Blended, so a jump has a start and an end.
      const rise = clamp(f.vy / 0.4, -1, 1), tuck = 0.55 + 0.3 * rise;
      this.legs[0].upper.rotation.x = -0.7 * tuck; this.legs[0].lower.rotation.x = 1.0 * tuck + 0.1;
      this.legs[1].upper.rotation.x = 0.3 * tuck; this.legs[1].lower.rotation.x = 0.45 * tuck + 0.1;
      this.arms[0].upper.rotation.x = -0.7 - 0.3 * rise; this.arms[1].upper.rotation.x = -1.1 - 0.2 * rise;
      this.arms[0].upper.rotation.z = 0.35; this.arms[1].upper.rotation.z = -0.35;
    }
    if (f.heldBy !== null) this.heldPose(time);
    else if (f.hold) this.holdPose(time, near, far);
    if (f.attack && f.heldBy === null) this.attackPose(f, near, far, time, age ?? f.attack.age);
    if (f.guarding) for (const arm of this.arms) { arm.upper.rotation.x = -0.9; arm.lower.rotation.x = -1.75; }
    if (f.stun) {
      this.body.rotation.z = clamp(-f.vx * 2.0, -0.85, 0.85);
      this.arms[0].upper.rotation.x = -2; this.arms[1].upper.rotation.x = -2.2;
      this.torso.rotation.x = -0.25; this.head.rotation.x = -0.2;
    }
    if (f.roll) {
      this.body.rotation.z = -f.facing * Math.PI * 2 * (1 - f.roll / 25);
      this.body.position.y = 0.6; this.legs.forEach(l => { l.upper.rotation.x = -1.2; l.lower.rotation.x = 1.6; });
    }
    if (f.busy > 0 && !f.stun && !f.roll && !f.attack && f.heldBy === null) this.busyPose(f);

    // Blend toward the pose just written. Moves are exact (their timeline is authoritative); everything else eases.
    const rate = f.attack || f.roll ? Infinity : f.stun ? 45 : f.heldBy !== null || f.hold ? 24 : f.guarding ? 28 : f.busy > 0 ? 22 : !f.grounded ? 18 : 14;
    this.settle(rate, dt, input.snap);

    this.face(f, time, age);
    this.tintMaterials(f, time);
    // Shield shell and its ripple.
    this.shield.visible = f.guarding;
    if (f.guarding) {
      this.shield.scale.set(1.24, 1.4, 1.1).multiplyScalar(0.72 + f.shield / 200); this.shield.scale.y *= 1.18;
      const low = clamp(1 - f.shield / 100, 0, 1), c = this.shieldMat.uniforms.uColor.value as T.Color; c.set(this.accent).lerp(this.shieldLow, low * 0.8);
      this.shieldMat.uniforms.uOpacity.value = 0.8 + 0.5 * low;
    }
    if (this.rippleAge < 1) { this.rippleAge = Math.min(1, this.rippleAge + Math.max(0, dt) / 0.35); this.shieldMat.uniforms.uRippleAge.value = this.rippleAge; } else this.shieldMat.uniforms.uRippleAge.value = 1;
  }

  /** Expression: mouth, brows and a periodic blink. */
  private face(f: Fighter, time: number, age: number | null) {
    const a = f.attack, striking = !!a && (age ?? a.age) >= a.start * 0.6 && !a.def.grab, open = f.stun > 0 || f.heldBy !== null || striking || (a?.id === 'special' && a.age > 2);
    this.mouthOpen.visible = open; this.mouthClosed.visible = !open;
    const angry = striking || f.guarding ? 0.34 : f.stun > 0 ? -0.2 : 0.11;
    for (const b of this.brows) b.rotation.z = (b.userData.side as number) * -angry;
    const t = (time + this.character * 1.7) % 3.9, blink = t < 0.11 ? 1 - Math.sin(t / 0.11 * Math.PI) * 0.92 : 1, squint = f.stun > 0 ? 0.5 : 1;
    for (const e of this.eyes) e.scale.y = blink * squint;
  }

  /** Emissive tint: hit flash, counter and armor windows, overclock, and a slow gentle pulse (never a blink) while invulnerable. */
  private tintMaterials(f: Fighter, time: number) {
    const a = f.attack;
    const counter = !!a?.def.counter && !a.countered && a.age >= a.def.counter.from && a.age <= a.def.counter.to;
    const armor = !!a?.def.armor && a.age >= a.def.armor.from && a.age <= a.def.armor.to;
    let intensity = 0;
    if (f.flash > 6) { this.tint.set('#ffffff'); intensity = 0.72; }
    else if (counter) { this.tint.set('#8a7020'); intensity = 0.55; }
    else if (armor) { this.tint.set('#4a6f99'); intensity = 0.55; }
    else if (f.buff > 0) { this.tint.set('#254323'); intensity = 0.38; }
    else if (f.invincible && !f.roll) { this.tint.set(this.accent); intensity = 0.1 + 0.2 * (0.5 + 0.5 * Math.sin(time * 5.2)); }
    for (const m of this.mats) { m.emissive.copy(this.tint); m.emissiveIntensity = intensity; }
    const protectedNow = f.invincible > 0 && !f.roll && f.respawn === 0;
    this.halo.visible = protectedNow;
    if (protectedNow) { const pulse = 0.5 + 0.5 * Math.sin(time * 5.2); this.haloMat.opacity = 0.35 + 0.35 * pulse; this.halo.scale.setScalar(1 + 0.06 * pulse); }
  }

  /** The fighter being held: lifted, arms flailing, shaking. */
  private heldPose(time: number) {
    this.body.position.y += 0.22;
    this.torso.rotation.z = Math.sin(time * 24) * 0.12; this.torso.rotation.x = -0.15;
    for (let i = 0; i < 2; i++) {
      this.arm(this.arms[i], -2.3 + Math.sin(time * 28 + i * 2) * 0.35, -0.6, (i ? -1 : 1) * 0.45);
      this.leg(this.legs[i], 0.2 + Math.sin(time * 20 + i) * 0.25, 0.5);
    }
  }
  /** The captor before a throw or pummel: both arms forward holding the target at chest height. */
  private holdPose(time: number, near: Limb, far: Limb) {
    this.arm(near, -1.35, -0.9); this.arm(far, -1.3, -0.95);
    this.torso.rotation.x = 0.1; this.body.position.y += Math.sin(time * 9) * 0.02;
  }
  /** Recovery lag that is not hitstun: tech stumble, landing crouch, end of a roll. */
  private busyPose(f: Fighter) {
    if (f.busyKind === 'tech') { this.torso.rotation.x = -0.35; this.arm(this.arms[0], -0.5, -0.4, 0.5); this.arm(this.arms[1], -0.5, -0.4, -0.5); this.body.position.y -= 0.05; }
    else { this.body.position.y -= 0.2; this.legs.forEach(l => { l.upper.rotation.x = -0.6; l.lower.rotation.x = 1.1; }); this.torso.rotation.x = 0.25; }
  }

  /** One pose per move. Progress runs 0 to 1 over the startup, holds through the active frames, then eases back. */
  private attackPose(f: Fighter, near: Limb, far: Limb, time: number, age: number) {
    const a = f.attack!, d = a.def;
    const wind = clamp(age / Math.max(1, a.start), 0, 1);
    const back = clamp((age - a.start - a.active) / Math.max(1, a.duration - a.start - a.active), 0, 1);
    const s = Math.sin((age < a.start ? wind : 1 - back) * Math.PI / 2);          // 0 -> 1 -> 0 strike weight
    const L = this.legs;
    switch (a.id) {
      case 'jab1': this.arm(near, lerp(-0.5, -1.55, s), lerp(-1.0, -0.05, s)); this.torso.rotation.y = -0.15 + s * 0.35; break;
      case 'jab2': this.arm(far, lerp(-0.6, -1.6, s), lerp(-1.0, -0.05, s)); this.torso.rotation.y = 0.15 - s * 0.35; break;
      case 'jab3': this.arm(near, lerp(-2.3, -1.15, s), lerp(-1.3, -0.1, s)); this.arm(far, -0.9, -1.2); this.torso.rotation.y = -0.6 + s * 1.2; this.torso.rotation.x = s * 0.3; break;
      case 'heavy': this.arm(near, lerp(-0.5, -1.5, s), lerp(-1.4, 0, s)); this.arm(far, -1.0, -1.3); this.torso.rotation.x = s * 0.38; this.torso.rotation.y = -0.4 + s * 0.8; this.leg(L[0], s * 0.5, 0.2); this.leg(L[1], -s * 0.6, 0.2); break;
      case 'upper': this.arm(near, lerp(-0.2, -2.85, s), lerp(-1.2, -0.1, s)); this.body.position.y += lerp(-0.14, 0.12, s); this.torso.rotation.x = -s * 0.15; this.leg(L[0], -0.3, 0.8); break;
      case 'sweep': this.body.position.y -= 0.26; this.leg(L[near === this.arms[0] ? 1 : 0], -1.3 * s, 0.1); this.leg(L[near === this.arms[0] ? 0 : 1], 0.3, 0.9); this.torso.rotation.x = 0.3; this.arm(near, -0.6, -0.9); break;
      case 'nair': this.torso.rotation.y = age * 0.7; this.leg(L[0], -1.2, 0.3); this.leg(L[1], -0.9, 0.3); this.arm(near, -1.3, -0.3, 0.9); this.arm(far, -1.3, -0.3, -0.9); break;
      case 'fair': this.arm(near, -1.5, -0.2); this.arm(far, -1.3, -0.6); this.leg(L[0], -1.3 * s, 0.1); this.leg(L[1], 0.1, 0.9); this.torso.rotation.x = -0.15 * s; break;
      case 'bair': this.leg(L[0], 1.2 * s, 0.2); this.leg(L[1], -0.2, 0.6); this.torso.rotation.x = 0.4 * s; this.arm(near, -1.0, -0.6); this.arm(far, -1.2, -0.5); break;
      case 'uair': this.arm(near, lerp(-1.0, -2.95, s), -0.1); this.arm(far, -2.6 * s, -0.3); this.leg(L[0], -0.5, 1.2); this.leg(L[1], -0.3, 1.0); this.torso.rotation.x = -0.25 * s; break;
      case 'dair': this.leg(L[0], -0.5, 0.2); this.leg(L[1], -0.35, 0.2); this.arm(near, -0.4, -0.3, 0.8); this.arm(far, -0.4, -0.3, -0.8); this.torso.rotation.x = 0.45 * s; break;
      case 'special': {
        const fire = d.projectile ? d.projectile.fire : a.start, p = clamp(age / Math.max(1, fire), 0, 1), thrown = age >= fire;
        // A long startup (Elon's rocket) reads as a telegraph: both arms up, trembling, then the throw.
        if (fire >= 18 && !thrown) { this.arm(near, -2.8 + Math.sin(time * 40) * 0.08, -0.4); this.arm(far, -2.7, -0.4); this.body.position.y += p * 0.12; }
        else { this.arm(near, thrown ? lerp(-1.6, -0.7, back) : lerp(-0.4, -2.6, p), thrown ? -0.05 : -0.9); this.torso.rotation.y = thrown ? 0.5 * (1 - back) : -0.4 * p; }
        break;
      }
      case 'recovery': {
        this.arm(near, -2.9, -0.1); this.arm(far, -2.9, -0.1); this.leg(L[0], 0.1, 0.3); this.leg(L[1], 0.05, 0.25);
        this.body.rotation.z = clamp(-f.vx * 1.6, -0.6, 0.6); this.body.rotation.y += Math.sin(age * 0.25) * 0.5; this.torso.rotation.x = -0.1;
        break;
      }
      case 'down': this.downPose(f, near, far, age); break;
      case 'grab': this.arm(near, lerp(-0.6, -1.5, s), lerp(-0.9, -0.15, s), 0.12); this.arm(far, lerp(-0.6, -1.45, s), lerp(-0.9, -0.15, s), -0.12); this.torso.rotation.x = 0.22 * s; break;
      case 'pummel': { const hit = clamp(1 - Math.abs(age - 3) / 3, 0, 1); this.arm(near, -1.35 - hit * 0.55, -0.9 + hit * 0.7); this.arm(far, -1.3, -0.95); this.torso.rotation.x = 0.1 + hit * 0.25; break; }
      case 'fthrow': { const r = d.throwing!.release, t = clamp(age / r, 0, 1), out = age >= r ? 1 - back * 0.6 : 0; this.arm(near, lerp(-1.4, -1.6, out), lerp(-0.9, -0.05, out)); this.arm(far, lerp(-1.3, -1.5, out), lerp(-0.95, -0.05, out)); this.torso.rotation.y = lerp(-0.25, 0.6, t * t); this.torso.rotation.x = 0.2 * out; break; }
      case 'bthrow': { const r = d.throwing!.release, t = clamp(age / r, 0, 1); this.arm(near, -2.0, -0.5); this.arm(far, -1.9, -0.5); this.torso.rotation.y = -t * Math.PI * 0.9; this.torso.rotation.x = 0.1; break; }
      case 'uthrow': { const r = d.throwing!.release, t = clamp(age / r, 0, 1); this.arm(near, lerp(-1.35, -3.1, t), lerp(-0.9, -0.1, t)); this.arm(far, lerp(-1.3, -3.05, t), lerp(-0.95, -0.1, t)); this.body.position.y += t * 0.1; this.torso.rotation.x = -0.2 * t; break; }
      case 'dthrow': { const r = d.throwing!.release, t = clamp(age / r, 0, 1); this.arm(near, lerp(-3.0, -0.4, t * t), -0.2); this.arm(far, lerp(-2.9, -0.4, t * t), -0.2); this.torso.rotation.x = 0.85 * t * t; this.leg(L[0], -0.3, 0.5); this.leg(L[1], -0.2, 0.5); break; }
      default: break;
    }
  }

  /** Down specials: slam phases, counter stance, dash lean. */
  private downPose(f: Fighter, near: Limb, far: Limb, age: number) {
    const a = f.attack!, d = a.def, L = this.legs;
    if (d.kind === 'counter') {
      const open = d.counter!, live = !a.countered && age >= open.from && age <= open.to;
      if (a.countered) { this.arm(near, -1.6, -0.05); this.arm(far, -1.0, -1.2); this.torso.rotation.y = 0.7; this.torso.rotation.x = 0.2; return; }
      this.arm(near, live ? -2.4 : -1.0, -1.6); this.arm(far, live ? -2.2 : -1.0, -1.7); this.torso.rotation.x = live ? -0.2 : 0.05; this.body.position.y -= live ? 0.06 : 0;
    } else if (d.kind === 'dash') {
      this.torso.rotation.x = 0.55; this.arm(near, 0.7, -0.3); this.arm(far, 0.6, -0.3); this.leg(L[0], -0.9, 0.2); this.leg(L[1], 0.7, 0.9); this.body.position.y -= 0.05;
    } else {
      const windup = age < a.start && !a.diving;
      if (a.diving) { this.torso.rotation.x = 0.95; this.arm(near, -0.3, -0.2); this.arm(far, -0.3, -0.2); this.leg(L[0], 0.1, 0.1); this.leg(L[1], 0.05, 0.1); }
      else if (windup) { const p = clamp(age / Math.max(1, a.start), 0, 1); this.arm(near, lerp(-0.5, -3.0, p), -0.3); this.arm(far, lerp(-0.5, -2.9, p), -0.3); this.body.position.y += p * 0.15; this.torso.rotation.x = -0.15 * p; }
      else { const fade = clamp((age - a.start) / Math.max(1, a.duration - a.start), 0, 1); this.body.position.y -= 0.3 * (1 - fade * 0.6); this.torso.rotation.x = 0.7 * (1 - fade); this.arm(near, -0.1, -0.2); this.arm(far, -0.1, -0.2); this.leg(L[0], -0.8, 1.3); this.leg(L[1], -0.7, 1.2); }
    }
  }

  /** Frees everything this rig owns. Shared geometry and prop materials are kept for the next match. */
  dispose() {
    for (const o of this.owned) o.dispose();
    this.shieldMat.dispose(); this.haloMat.dispose(); this.owned.length = 0; this.mats.length = 0; this.matMap.clear();
  }
}
