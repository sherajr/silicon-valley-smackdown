import * as T from 'three';
import { ROSTER, FIGHTER_ACCENTS } from './data';
import type { Fighter } from './Simulation';

const box = new T.BoxGeometry(1, 1, 1);
const sphere = new T.SphereGeometry(1, 14, 10);
const cylinder = new T.CylinderGeometry(1, 1, 1, 10);
const cone = new T.ConeGeometry(1, 1, 12);
const capsule = new T.CapsuleGeometry(1, 1, 4, 10);
const clamp = T.MathUtils.clamp;
type Limb = { upper: T.Group; lower: T.Group };

/** Original articulated mesh characters: every silhouette, face, accessory and pose is 3D. */
export class FighterRig {
  root = new T.Group();
  body = new T.Group();
  torso = new T.Group();
  head = new T.Group();
  arms: Limb[] = [];
  legs: Limb[] = [];
  shield: T.Mesh;
  private mats: T.MeshStandardMaterial[] = [];
  private matMap = new Map<string, T.MeshStandardMaterial>();
  private scale = 1;
  character: number;
  constructor(character: number) {
    this.character = character;
    const id = ROSTER[character].id, v = ROSTER[character].visual;
    const wide = id === 'al' ? 1.26 : id === 'priya' ? 0.85 : id === 'chad' ? 1.08 : 1;
    this.scale = id === 'kevin' ? 1.055 : id === 'priya' ? 0.96 : 1;
    this.root.add(this.body); this.body.add(this.torso); this.torso.position.y = 1.03;
    // A tapered jacket/body gives the characters shoulders, waists, and human proportions.
    const torsoGeo = new T.LatheGeometry([
      new T.Vector2(0.28 * wide, 0), new T.Vector2(0.35 * wide, 0.12),
      new T.Vector2((id === 'al' ? 0.43 : 0.35) * wide, 0.37), new T.Vector2(0.40 * wide, 0.62),
      new T.Vector2(0.23, 0.74),
    ], 12);
    const trunk = this.mesh(this.torso, torsoGeo, v.primary, 0, 0, 0, 1, 1, 0.68);
    trunk.userData.ownedGeometry = true;
    this.part(this.torso, box, v.pants, 0, -0.01, 0, 0.61 * wide, 0.20, 0.37);
    this.part(this.torso, cylinder, v.skin, 0, 0.77, 0, 0.13, 0.23, 0.13);
    this.torso.add(this.head); this.head.position.set(0, 1.03, 0.01);
    this.part(this.head, sphere, v.skin, 0, 0, 0, 0.33, 0.37, 0.29);
    this.part(this.head, sphere, v.skin, -0.325, -0.01, 0, 0.072, 0.115, 0.067);
    this.part(this.head, sphere, v.skin, 0.325, -0.01, 0, 0.072, 0.115, 0.067);
    this.part(this.head, sphere, v.skin, 0, -0.035, 0.282, 0.067, 0.079, 0.086);
    // Hair is a shaped cap plus swept locks, not a painted flat head texture.
    this.part(this.head, sphere, v.hair, 0, 0.205, -0.025, 0.338, 0.192, 0.291);
    for (let i = 0; i < 4; i++) {
      const hair = this.part(this.head, sphere, v.hair, -0.20 + i * 0.13, 0.23 + i * 0.015, 0.14, 0.115, 0.15, 0.15);
      hair.rotation.z = -0.4;
    }
    for (const x of [-0.125, 0.125]) {
      this.part(this.head, sphere, '#f7f3e6', x, 0.046, 0.255, 0.077, 0.058, 0.028);
      this.part(this.head, sphere, '#24323a', x, 0.046, 0.282, 0.025, 0.036, 0.014);
      const brow = this.part(this.head, box, v.hair, x, 0.135, 0.257, 0.142, 0.035, 0.028);
      brow.rotation.z = x < 0 ? -0.11 : 0.11;
    }
    this.part(this.head, box, '#a66652', 0, -0.174, 0.259, 0.15, 0.025, 0.026);
    for (const side of [-1, 1]) {
      const upper = new T.Group(), lower = new T.Group();
      this.torso.add(upper); upper.position.set(side * 0.42 * wide, 0.60, 0);
      this.part(upper, sphere, v.primary, 0, -0.045, 0, 0.18, 0.20, 0.175);
      this.part(upper, cylinder, v.primary, 0, -0.20, 0, 0.13, 0.34, 0.14);
      upper.add(lower); lower.position.y = -0.36;
      this.part(lower, sphere, v.primary, 0, 0, 0, 0.125, 0.125, 0.13);
      this.part(lower, cylinder, v.primary, 0, -0.16, 0, 0.107, 0.31, 0.113);
      this.part(lower, cylinder, v.secondary, 0, -0.305, 0, 0.116, 0.065, 0.122);
      this.part(lower, sphere, v.skin, 0, -0.40, 0.014, 0.14, 0.15, 0.13);
      this.arms.push({ upper, lower });
      const hip = new T.Group(), knee = new T.Group();
      this.body.add(hip); hip.position.set(side * 0.215 * wide, 1.01, 0);
      this.part(hip, cylinder, v.pants, 0, -0.22, 0, 0.16, 0.43, 0.165);
      hip.add(knee); knee.position.y = -0.44;
      this.part(knee, sphere, v.pants, 0, 0, 0, 0.147, 0.148, 0.15);
      this.part(knee, cylinder, v.pants, 0, -0.21, 0, 0.125, 0.41, 0.13);
      this.part(knee, box, id === 'hunter' || id === 'priya' ? '#e7eee9' : '#202731', 0, -0.46, 0.077, 0.29, 0.20, 0.46);
      this.part(knee, box, FIGHTER_ACCENTS[character], 0, -0.55, 0.08, 0.29, 0.027, 0.45);
      this.legs.push({ upper: hip, lower: knee });
    }
    // Character-specific tailoring and readable signature accessories.
    if (id === 'hunter') {
      for (const x of [-0.185, 0.185]) for (let y = 0.15; y < 0.67; y += 0.12)
        this.part(this.torso, box, v.secondary, x, y, 0.22, 0.31, 0.108, 0.125);
      this.part(this.torso, sphere, v.primary, 0, 0.71, -0.20, 0.31, 0.18, 0.21);
      this.part(this.torso, box, '#a5afb8', 0, 0.36, 0.30, 0.027, 0.66, 0.022);
      this.part(this.arms[0].lower, box, '#1d323f', 0, -0.29, 0.13, 0.15, 0.11, 0.04);
      this.part(this.arms[0].lower, box, '#53ead4', 0, -0.29, 0.155, 0.11, 0.07, 0.01);
      this.part(this.head, sphere, v.hair, 0, -0.21, 0.045, 0.265, 0.105, 0.23);
    } else if (id === 'kevin') {
      this.part(this.torso, box, '#ecdfcd', 0, 0.46, 0.25, 0.24, 0.48, 0.07);
      const tie = this.part(this.torso, cone, '#bd4550', 0, 0.38, 0.30, 0.082, 0.42, 0.035); tie.rotation.z = Math.PI;
      for (const side of [-1, 1]) {
        const lapel = this.part(this.torso, box, '#354567', side * 0.15, 0.49, 0.30, 0.13, 0.45, 0.055); lapel.rotation.z = side * -0.35;
        const glasses = this.part(this.head, box, '#d5b167', side * 0.135, 0.055, 0.29, 0.205, 0.13, 0.025);
        this.part(this.head, box, '#526879', glasses.position.x, 0.055, 0.307, 0.159, 0.085, 0.01);
      }
      this.part(this.head, box, '#d5b167', 0, 0.057, 0.30, 0.06, 0.025, 0.022);
      const prop = makeProp(character); this.arms[0].lower.add(prop); prop.position.set(0, -0.66, 0); prop.scale.setScalar(0.75);
    } else if (id === 'al') {
      this.part(this.head, sphere, v.hair, 0, -0.18, 0.075, 0.285, 0.21, 0.242);
      this.part(this.head, box, '#d8a27e', 0, -0.155, 0.292, 0.12, 0.035, 0.02);
      for (const x of [-0.20, 0.20]) this.part(this.torso, box, '#e5c994', x, 0.38, 0.30, 0.12, 0.63, 0.05);
      for (let y = 0.18; y < 0.65; y += 0.12) this.part(this.torso, sphere, '#e7d8aa', 0, y, 0.36, 0.024, 0.024, 0.018);
      const prop = makeProp(character); this.arms[0].lower.add(prop); prop.position.set(0, -0.46, 0.05); prop.scale.setScalar(0.7);
    } else if (id === 'priya') {
      this.part(this.torso, box, '#f1ddc8', 0, 0.46, 0.25, 0.21, 0.48, 0.07);
      this.part(this.head, sphere, v.hair, 0, -0.18, -0.30, 0.18, 0.39, 0.19);
      this.part(this.head, sphere, v.hair, 0, -0.48, -0.39, 0.11, 0.20, 0.12);
      this.part(this.head, sphere, '#303445', -0.35, -0.015, 0.0, 0.073, 0.12, 0.11);
      const mic = this.part(this.head, box, '#272c36', -0.27, -0.13, 0.18, 0.035, 0.035, 0.32); mic.rotation.y = -0.35;
      this.part(this.head, sphere, '#60f3cb', -0.22, -0.13, 0.32, 0.038, 0.038, 0.038);
      this.part(this.torso, box, '#edc8ff', 0.19, 0.54, 0.28, 0.075, 0.075, 0.025);
    } else if (id === 'chad') {
      this.part(this.torso, box, '#282f36', 0, 0.65, 0.21, 0.12, 0.22, 0.05);
      this.part(this.torso, box, '#b8a47c', 0, 0.45, 0.25, 0.025, 0.43, 0.025);
      this.part(this.head, box, '#c3a252', 0, 0.06, 0.28, 0.57, 0.13, 0.025);
      for (const x of [-0.15, 0.15]) this.part(this.head, box, '#121c28', x, 0.05, 0.307, 0.245, 0.125, 0.025);
      this.part(this.arms[0].lower, cylinder, '#dbbb68', 0, -0.30, 0, 0.127, 0.08, 0.132);
    } else if (id === 'elon') {
      this.part(this.torso, box, '#303b50', 0, 0.35, 0.23, 0.36, 0.59, 0.10);
      this.part(this.torso, box, '#e877a9', 0, 0.5, 0.295, 0.22, 0.038, 0.025);
      for (const x of [-0.23, 0.23]) {
        this.part(this.torso, cylinder, '#909daf', x, 0.36, -0.29, 0.12, 0.59, 0.12);
        this.part(this.torso, cone, '#d9e2eb', x, 0.72, -0.29, 0.12, 0.18, 0.12);
        this.part(this.torso, cone, '#ff9c57', x, -0.03, -0.29, 0.08, 0.22, 0.08).rotation.z = Math.PI;
      }
    }
    this.shield = new T.Mesh(sphere, new T.MeshBasicMaterial({ color: FIGHTER_ACCENTS[character], transparent: true, opacity: 0.15, wireframe: true, depthWrite: false }));
    this.shield.scale.set(1.24, 1.4, 1.1); this.shield.position.y = 1.25; this.shield.visible = false; this.root.add(this.shield);
  }
  private material(color: string) {
    if (!this.matMap.has(color)) { const m = new T.MeshStandardMaterial({ color, roughness: 0.73, metalness: 0.08 }); this.matMap.set(color, m); this.mats.push(m); }
    return this.matMap.get(color)!;
  }
  private mesh(parent: T.Group, geometry: T.BufferGeometry, color: string, x: number, y: number, z: number, sx: number, sy: number, sz: number) {
    const m = new T.Mesh(geometry, this.material(color)); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
  }
  private part(...args: Parameters<FighterRig['mesh']>) { return this.mesh(...args); }
  pose(f: Fighter, time: number, alpha = 1) {
    this.root.visible = f.respawn === 0 && f.stocks > 0;
    this.root.position.set(T.MathUtils.lerp(f.prevX, f.x, alpha), T.MathUtils.lerp(f.prevY, f.y, alpha), 0);
    this.body.scale.setScalar(this.scale);
    this.body.rotation.set(0, f.facing * 1.15, 0);
    this.body.position.y = Math.sin(time * 3.8) * 0.018;
    this.torso.rotation.set(0, 0, 0); this.head.rotation.set(0, 0.1 * Math.sin(time), 0);
    for (let i = 0; i < 2; i++) {
      const arm = this.arms[i], leg = this.legs[i];
      arm.upper.rotation.set(-0.48 - i * 0.25, 0, (i ? -1 : 1) * 0.13);
      arm.lower.rotation.set(-0.72, 0, 0);
      leg.upper.rotation.set(0, 0, (i ? -1 : 1) * 0.09); leg.lower.rotation.set(0.05, 0, 0);
    }
    if (f.grounded && Math.abs(f.vx) > 0.025 && !f.attack && !f.guarding && !f.stun) {
      const stride = Math.sin(time * 16) * Math.min(0.85, Math.abs(f.vx) * 6);
      this.legs[0].upper.rotation.x = stride; this.legs[1].upper.rotation.x = -stride;
      this.legs[0].lower.rotation.x = Math.max(0.0, -stride) * 0.9; this.legs[1].lower.rotation.x = Math.max(0, stride) * 0.9;
      this.arms[0].upper.rotation.x = -stride * 0.75; this.arms[1].upper.rotation.x = stride * 0.75;
      this.body.position.y = Math.abs(Math.sin(time * 16)) * 0.055;
      this.torso.rotation.x = 0.12;
    }
    if (!f.grounded) {
      this.legs[0].upper.rotation.x = -0.7; this.legs[0].lower.rotation.x = 1.05;
      this.legs[1].upper.rotation.x = 0.3; this.legs[1].lower.rotation.x = 0.45;
      this.arms[0].upper.rotation.x = -0.7; this.arms[1].upper.rotation.x = -1.1;
    }
    if (f.attack) {
      const a = f.attack;
      const p = a.age < a.start ? a.age / a.start : Math.max(0, 1 - (a.age - a.start - a.active) / (a.duration - a.start - a.active));
      const strike = Math.sin(clamp(p, 0, 1) * Math.PI / 2);
      this.torso.rotation.y = -0.30 + strike * 0.65;
      this.arms[1].upper.rotation.x = -0.6 - strike * 1.0; this.arms[1].lower.rotation.x = -0.75 + strike * 0.73;
      if (a.kind === 'heavy' || a.kind === 'aerial' || a.kind === 'sweep') {
        this.legs[1].upper.rotation.x = -strike * (a.kind === 'sweep' ? 1 : 1.55); this.legs[1].lower.rotation.x = 0.10;
        this.torso.rotation.x = -strike * 0.2;
        if (a.kind === 'sweep') { this.body.position.y -= 0.26; this.legs[0].lower.rotation.x = 0.8; }
      }
      if (a.kind === 'upper' || a.kind === 'recovery') { this.arms[1].upper.rotation.x = -2.7 * strike; this.body.rotation.y += Math.sin(a.age * 0.25) * (a.kind === 'recovery' ? 0.9 : 0.1); }
      if (a.kind === 'grab' || a.kind === 'slam') {
        this.arms[0].upper.rotation.x = this.arms[1].upper.rotation.x;
        this.arms[0].lower.rotation.x = 0;
        if (a.kind === 'slam') this.torso.rotation.x = strike * 0.5;
      }
    }
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
    if (f.invincible && !f.roll) this.body.visible = Math.floor(f.invincible / 5) % 2 === 0; else this.body.visible = true;
    this.shield.visible = f.guarding;
    this.shield.scale.setScalar(0.72 + f.shield / 200); this.shield.scale.y *= 1.18;
    for (const m of this.mats) { m.emissive.set(f.flash > 6 ? '#ffffff' : f.buff > 0 ? '#254323' : '#000000'); m.emissiveIntensity = f.flash > 6 ? 0.72 : 0.38; }
  }
  dispose() {
    this.mats.forEach(m => m.dispose());
    this.root.traverse(o => { if (o instanceof T.Mesh && o.userData.ownedGeometry) o.geometry.dispose(); });
    (this.shield.material as T.Material).dispose();
    // Props own their materials; shared primitive geometry is retained across matches.
    this.root.traverse(o => { if (o instanceof T.Mesh && o.userData.prop) (o.material as T.Material).dispose(); });
  }
}

export function makeProp(character: number): T.Group {
  const g = new T.Group();
  const add = (geo: T.BufferGeometry, color: string, x: number, y: number, z: number, a: number, b: number, c: number) => {
    const m = new T.Mesh(geo, new T.MeshStandardMaterial({ color, roughness: 0.48, metalness: 0.25 }));
    m.position.set(x, y, z); m.scale.set(a, b, c); m.userData.prop = true; g.add(m); return m;
  };
  if (character === 0) {
    add(box, '#a3b5c7', 0, 0, 0, 0.60, 0.77, 0.06); add(box, '#2dc8d2', 0, 0, 0.035, 0.52, 0.66, 0.01);
    add(box, '#c7fff0', 0, 0, 0.044, 0.26, 0.06, 0.01);
  } else if (character === 1) {
    add(box, '#66412a', 0, 0, 0, 0.71, 0.46, 0.23); add(box, '#d1a765', 0, 0.28, 0, 0.28, 0.12, 0.07);
    add(box, '#e4bd64', 0, 0.09, 0.123, 0.1, 0.13, 0.02);
  } else if (character === 2) {
    add(cylinder, '#39815c', 0, 0, 0, 0.12, 0.44, 0.12); add(cylinder, '#32794f', 0, 0.29, 0, 0.06, 0.18, 0.06);
    add(cylinder, '#ecdb9f', 0, 0.02, 0, 0.125, 0.19, 0.125); add(cylinder, '#dabd65', 0, 0.4, 0, 0.067, 0.06, 0.067);
  } else if (character === 3) {
    add(box, '#f4eadc', 0, 0, 0, 0.49, 0.65, 0.03);
    for (let y = -0.2; y < 0.3; y += 0.10) add(box, '#8871bb', 0, y, 0.022, 0.34, 0.023, 0.01);
  } else if (character === 4) {
    add(box, '#a2ce8c', 0, 0, 0, 0.68, 0.3, 0.16); add(box, '#ecdfac', 0, 0, 0.089, 0.12, 0.31, 0.03);
  } else {
    add(cylinder, '#cfdae6', 0, 0, 0, 0.13, 0.63, 0.13);
    add(cone, '#e2769f', 0, 0.43, 0, 0.13, 0.26, 0.13);
    add(cone, '#ffb469', 0, -0.43, 0, 0.095, 0.35, 0.095).rotation.z = Math.PI;
    add(box, '#596d84', 0, -0.22, 0, 0.38, 0.18, 0.09);
  }
  return g;
}
