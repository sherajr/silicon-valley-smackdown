import * as T from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * Shared building blocks for the procedural fighters: a geometry cache, material classes with believable
 * roughness/metalness (cloth is rough and non-metallic, skin is non-metallic, tech props are polished), and the six
 * signature props that fighters hold and throw. Geometry is cached for the life of the page (a few dozen small meshes);
 * materials are created per fighter so each one can be tinted on its own.
 */
const cache = new Map<string, T.BufferGeometry>();
const keep = (key: string, make: () => T.BufferGeometry) => { let g = cache.get(key); if (!g) { g = make(); cache.set(key, g); } return g; };

export const G = {
  sphere: () => keep('sphere', () => new T.SphereGeometry(1, 22, 16)),
  /** Upper half of a sphere, for hair caps and eyelids. `lat` is the polar angle covered, in turns of pi. */
  cap: (lat: number) => keep(`cap${lat}`, () => new T.SphereGeometry(1, 22, 12, 0, Math.PI * 2, 0, Math.PI * lat)),
  box: () => keep('box', () => new T.BoxGeometry(1, 1, 1)),
  rbox: (radius = 0.18) => keep(`rbox${radius}`, () => new RoundedBoxGeometry(1, 1, 1, 3, radius)),
  /** Unit-height cylinder whose radii are fractions of the part's scale. */
  cyl: (top = 1, bottom = 1) => keep(`cyl${top}/${bottom}`, () => new T.CylinderGeometry(top, bottom, 1, 16, 1)),
  cone: () => keep('cone', () => new T.ConeGeometry(1, 1, 16)),
  torus: (tube = 0.12) => keep(`torus${tube}`, () => new T.TorusGeometry(1, tube, 8, 28)),
  arc: (tube = 0.1, turns = 0.5) => keep(`arc${tube}/${turns}`, () => new T.TorusGeometry(1, tube, 8, 24, Math.PI * 2 * turns)),
  /** A capsule with unit radius whose straight section is `length` long, so limbs end in true hemispheres. */
  capsule: (length: number) => keep(`capsule${length}`, () => new T.CapsuleGeometry(1, length, 6, 14)),
};

export type SurfaceClass = 'cloth' | 'skin' | 'hair' | 'leather' | 'rubber' | 'metal' | 'plastic' | 'glass' | 'paper' | 'glow';
const SURFACE: Record<SurfaceClass, { rough: number; metal: number }> = {
  cloth: { rough: 0.88, metal: 0 }, skin: { rough: 0.56, metal: 0 }, hair: { rough: 0.42, metal: 0.04 }, leather: { rough: 0.4, metal: 0.03 },
  rubber: { rough: 0.62, metal: 0 }, metal: { rough: 0.26, metal: 0.9 }, plastic: { rough: 0.32, metal: 0.02 }, glass: { rough: 0.07, metal: 0.15 },
  paper: { rough: 0.92, metal: 0 }, glow: { rough: 0.5, metal: 0 },
};

export function surfaceMaterial(cls: SurfaceClass, color: string, glow = 0): T.MeshStandardMaterial {
  const s = SURFACE[cls];
  return new T.MeshStandardMaterial({ color, roughness: s.rough, metalness: s.metal, emissive: glow ? color : '#000000', emissiveIntensity: glow });
}

// ---------------------------------------------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------------------------------------------
const propMats = new Map<string, T.MeshStandardMaterial>();
/** The environment the prop materials currently reflect, so a material created later picks it up too. */
const propEnv: { texture: T.Texture | null; intensity: number } = { texture: null, intensity: 0.6 };
const pm = (cls: SurfaceClass, color: string, glow = 0) => {
  const key = `${cls}|${color}|${glow}`; let m = propMats.get(key);
  if (!m) { m = surfaceMaterial(cls, color, glow); m.envMap = propEnv.texture; m.envMapIntensity = propEnv.intensity * (cls === 'metal' || cls === 'glass' ? 1.5 : 1); propMats.set(key, m); }
  return m;
};
const lathe = (key: string, profile: number[][]) => keep(key, () => new T.LatheGeometry(profile.map(([r, y]) => new T.Vector2(r, y)), 28));

/** A prop group: x/y/z/scale per piece, geometry shared, materials shared by class and colour. */
export function makeProp(character: number): T.Group {
  const g = new T.Group();
  const add = (geo: T.BufferGeometry, mat: T.Material, x: number, y: number, z: number, sx: number, sy = sx, sz = sx, rz = 0) => {
    const m = new T.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.z = rz; m.castShadow = true; m.userData.prop = true; g.add(m); return m;
  };
  if (character === 0) {           // Hunter: a tablet with an aluminium body and a lit screen
    add(G.rbox(0.12), pm('metal', '#b7c4d2'), 0, 0, 0, 0.6, 0.77, 0.06);
    add(G.rbox(0.06), pm('glass', '#0e2a33', 0.5), 0, 0, 0.034, 0.52, 0.67, 0.012);
    add(G.box(), pm('glow', '#c7fff0', 1.4), 0, 0.2, 0.042, 0.3, 0.05, 0.006);
    add(G.sphere(), pm('glass', '#1a2733'), 0, 0.345, 0.034, 0.014);
  } else if (character === 1) {    // Kevin: a leather briefcase with brass clasps
    add(G.rbox(0.1), pm('leather', '#6a4328'), 0, 0, 0, 0.71, 0.46, 0.23);
    add(G.arc(0.1, 0.5), pm('leather', '#4d311d'), 0, 0.21, 0, 0.17, 0.17, 0.5);
    for (const x of [-0.2, 0.2]) add(G.rbox(0.2), pm('metal', '#e0bb63'), x, 0.07, 0.125, 0.1, 0.12, 0.025);
    add(G.box(), pm('metal', '#e0bb63'), 0, 0.2, 0, 0.7, 0.012, 0.234);
  } else if (character === 2) {    // Al: a green glass bottle with a cream label and a gold cap
    add(lathe('bottle', [[0, -0.22], [0.115, -0.22], [0.125, -0.18], [0.125, 0.05], [0.1, 0.12], [0.05, 0.2], [0.045, 0.34], [0.0, 0.34]]), pm('glass', '#2f7a52'), 0, 0, 0, 1);
    add(G.cyl(), pm('paper', '#ecdfae'), 0, -0.04, 0, 0.128, 0.16, 0.128);
    add(G.cyl(), pm('metal', '#dabd65'), 0, 0.345, 0, 0.055, 0.05, 0.055);
  } else if (character === 3) {    // Priya: a stack of resumes with purple lines and a clip
    add(G.rbox(0.05), pm('paper', '#f4eadc'), 0, 0, 0, 0.49, 0.65, 0.03);
    for (let y = -0.2; y < 0.3; y += 0.1) add(G.box(), pm('paper', '#8871bb'), 0, y, 0.018, 0.34, 0.022, 0.006);
    add(G.rbox(0.2), pm('metal', '#9aa7b8'), 0, 0.3, 0.02, 0.2, 0.06, 0.03);
  } else if (character === 4) {    // Chad: a bundle of cash with a gold band
    add(G.rbox(0.06), pm('paper', '#a6d296'), 0, 0, 0, 0.68, 0.3, 0.16);
    add(G.rbox(0.1), pm('metal', '#d9bf62'), 0, 0, 0.0, 0.12, 0.31, 0.17);
    add(G.box(), pm('paper', '#8fbf7e'), 0, 0.0, 0.082, 0.5, 0.2, 0.004);
  } else {                         // Elon: a rocket with a lathed body, nose cone and engine glow
    add(lathe('rocket', [[0, -0.34], [0.13, -0.34], [0.14, -0.28], [0.14, 0.2], [0.11, 0.32], [0.05, 0.42], [0, 0.48]]), pm('metal', '#d3dce6'), 0, 0, 0, 1);
    add(G.cone(), pm('plastic', '#e2769f'), 0, 0.4, 0, 0.1, 0.2, 0.1);
    add(G.cone(), pm('glow', '#ffb469', 2.2), 0, -0.45, 0, 0.1, 0.34, 0.1, Math.PI);
    for (const s of [-1, 1]) add(G.box(), pm('plastic', '#596d84'), s * 0.17, -0.22, 0, 0.1, 0.22, 0.05);
  }
  return g;
}

/** Gives the shared prop materials (briefcase, tablet, rocket, bottle ...) the arena's environment map. */
export function setPropEnvironment(texture: T.Texture | null, intensity: number) {
  propEnv.texture = texture; propEnv.intensity = intensity;
  for (const [key, m] of propMats) { const cls = key.split('|')[0]; m.envMap = texture; m.envMapIntensity = intensity * (cls === 'metal' || cls === 'glass' ? 1.5 : 1); m.needsUpdate = true; }
}

/** Releases cached geometry and prop materials (page unload or a full renderer dispose). */
export function disposeRigParts() {
  for (const g of cache.values()) g.dispose();
  for (const m of propMats.values()) m.dispose();
  cache.clear(); propMats.clear();
}
