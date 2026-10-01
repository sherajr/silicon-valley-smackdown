import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { FighterRig } from './FighterRig';
import type { PoseInput } from './FighterRig';
import { newFighter } from './Simulation';
import type { Fighter } from './Simulation';
import { FIGHTER_ACCENTS } from './data';
import { ctl, faceOff, make } from './testHelpers';
import { auditCoplanarFaces, collectFaces } from './renderTestHelpers';

const input = (extra: Partial<PoseInput> = {}): PoseInput => ({ x: 0, y: 0, moved: 0, attackAge: null, time: 1, dt: 1 / 60, snap: false, ...extra });
const fighter = (character = 0, extra: Partial<Fighter> = {}): Fighter => Object.assign(newFighter(0, character), extra);
const meshes = (root: T.Object3D) => { let n = 0; root.traverse(o => { if ((o as T.Mesh).isMesh) n++; }); return n; };
const emissive = (rig: FighterRig) => { let hit: T.MeshStandardMaterial | null = null; rig.root.traverse(o => { const m = (o as T.Mesh).material as T.MeshStandardMaterial | undefined; if (!hit && m && (m as T.MeshStandardMaterial).isMeshStandardMaterial && m.emissiveIntensity < 5 && o.userData.prop !== true && m.metalness < 0.5 && m.roughness > 0.5) hit = m; }); return hit!; };

describe('construction', () => {
  it('builds all six fighters with merged static parts and the joints the animation needs', () => {
    for (let c = 0; c < 6; c++) {
      const rig = new FighterRig(c);
      expect(rig.arms.length).toBe(2); expect(rig.legs.length).toBe(2); expect(rig.hands.length).toBe(2);
      const n = meshes(rig.root); expect(n).toBeGreaterThan(14); expect(n).toBeLessThan(110);
      rig.dispose();
    }
  });
  it('can be built and disposed repeatedly', () => { for (let i = 0; i < 12; i++) new FighterRig(i % 6).dispose(); });
});

describe('no coincident surfaces on a fighter', () => {
  it('has no overlapping, same-facing, axis-aligned faces on one plane in any character: the floor flicker defect, checked on faces, hair, glasses, clothing and props', () => {
    for (let c = 0; c < 6; c++) {
      const rig = new FighterRig(c);
      for (const extra of [{}, { guarding: true, shield: 70 }] as Partial<Fighter>[]) {
        rig.pose(fighter(c, extra), input({ snap: true }));
        const conflicts = auditCoplanarFaces(rig.root).map(k => `${k.a.mesh} against ${k.b.mesh} at ${k.a.plane.toFixed(3)} (axis ${k.a.axis})`);
        expect(conflicts, `character ${c}`).toEqual([]);
      }
      rig.dispose();
    }
  });

  it('inspects real flat faces, and would catch one laid exactly on top of another', () => {
    const rig = new FighterRig(1), scene = new T.Scene(); scene.add(rig.root);
    rig.pose(fighter(1), input({ snap: true }));
    const faces = collectFaces(scene); expect(faces.length).toBeGreaterThan(40);
    // A tiny opaque patch on the plane of a face in the middle of the list, facing the same way: the audit must flag it.
    const f = faces[Math.floor(faces.length / 2)], c = f.tri.reduce((s, p) => [s[0] + p[0] / 3, s[1] + p[1] / 3], [0, 0]);
    const at = f.axis === 0 ? [f.plane, c[0], c[1]] : f.axis === 1 ? [c[0], f.plane, c[1]] : [c[0], c[1], f.plane];
    const patch = new T.Mesh(new T.PlaneGeometry(0.002, 0.002), new T.MeshBasicMaterial());
    patch.position.set(at[0], at[1], at[2]);
    if (f.axis === 0) patch.rotation.y = f.sign * Math.PI / 2; else if (f.axis === 1) patch.rotation.x = -f.sign * Math.PI / 2; else if (f.sign < 0) patch.rotation.y = Math.PI;
    scene.add(patch);
    expect(auditCoplanarFaces(scene).length).toBeGreaterThan(0);
    patch.geometry.dispose(); (patch.material as T.Material).dispose(); rig.dispose();
  });
});

describe('invulnerability is readable, never a blink', () => {
  it('keeps the fighter visible on every frame, with a gentle accent pulse and a halo', () => {
    for (const character of [0, 3, 5]) {
      const rig = new FighterRig(character), accent = new T.Color(FIGHTER_ACCENTS[character]);
      let min = 9, max = 0, changes = 0, lastIntensity = -1;
      for (let i = 0; i < 240; i++) {
        const f = fighter(character, { invincible: 120 - (i % 120) }); rig.pose(f, input({ time: i / 60 }));
        expect(rig.root.visible).toBe(true); expect(rig.body.visible).toBe(true); expect(rig.halo.visible).toBe(true);
        const m = emissive(rig); min = Math.min(min, m.emissiveIntensity); max = Math.max(max, m.emissiveIntensity);
        expect(m.emissive.r).toBeCloseTo(accent.r, 5);
        if (Math.abs(m.emissiveIntensity - lastIntensity) > 0.05) changes++; lastIntensity = m.emissiveIntensity;
      }
      expect(min).toBeGreaterThanOrEqual(0.09); expect(max).toBeLessThanOrEqual(0.31);        // restrained
      expect(changes).toBeLessThan(5);                                                          // slow, smooth: not a strobe
      rig.dispose();
    }
  });
  it('shows nothing while rolling (the roll is its own readable state) and nothing extra when not protected', () => {
    const rig = new FighterRig(0);
    rig.pose(fighter(0, { invincible: 30, roll: 10 }), input()); expect(rig.halo.visible).toBe(false);
    rig.pose(fighter(0, { invincible: 0 }), input()); expect(rig.halo.visible).toBe(false); expect(emissive(rig).emissiveIntensity).toBe(0);
    rig.dispose();
  });
  it('still hides a fighter who is waiting to respawn or out of stocks', () => {
    const rig = new FighterRig(1);
    rig.pose(fighter(1, { respawn: 40 }), input()); expect(rig.root.visible).toBe(false);
    rig.pose(fighter(1, { stocks: 0 }), input()); expect(rig.root.visible).toBe(false);
    rig.pose(fighter(1), input()); expect(rig.root.visible).toBe(true);
    rig.dispose();
  });
});

describe('motion', () => {
  it('drives the stride by distance actually moved, so a fighter who is not moving does not walk in place', () => {
    const rig = new FighterRig(0), walking = fighter(0, { vx: 0.12 });
    rig.pose(walking, input({ moved: 0.1, snap: true }));
    const angles: number[] = [];
    for (let i = 0; i < 20; i++) { rig.pose(walking, input({ moved: 0.1 })); angles.push(rig.legs[0].upper.rotation.x); }
    expect(Math.max(...angles) - Math.min(...angles)).toBeGreaterThan(0.3);                    // legs swing while travelling
    for (let i = 0; i < 40; i++) rig.pose(walking, input({ moved: 0 }));                       // let the pose settle
    const held: number[] = [];
    for (let i = 0; i < 20; i++) { rig.pose(walking, input({ moved: 0 })); held.push(rig.legs[0].upper.rotation.x); }
    expect(Math.max(...held) - Math.min(...held)).toBeLessThan(0.01);                          // frozen when the picture is not moving (hitstop)
    rig.dispose();
  });

  it('eases a turn-around instead of snapping, but never turns late for a move', () => {
    const rig = new FighterRig(0), right = fighter(0, { facing: 1 }), left = fighter(0, { facing: -1 });
    rig.pose(right, input({ snap: true })); expect(rig.body.rotation.y).toBeCloseTo(1.15);
    rig.pose(left, input()); const first = rig.body.rotation.y; expect(first).toBeLessThan(1.15); expect(first).toBeGreaterThan(-1.15);      // part-way
    for (let i = 0; i < 60; i++) rig.pose(left, input()); expect(rig.body.rotation.y).toBeCloseTo(-1.15, 2);
    // A move starts exactly on its own facing.
    const s = make(); faceOff(s, 2, 0); s.fighters[0].facing = 1; s.step([ctl({ attack: true }), ctl()]);
    const attacker = s.fighters[0]; expect(attacker.attack).not.toBeNull();
    rig.pose(right, input({ snap: true })); rig.pose({ ...attacker, facing: -1 }, input({ attackAge: 0 })); expect(rig.body.rotation.y).toBeCloseTo(-1.15);
    rig.dispose();
  });

  it('draws a move at fractional ages: the arm travels between the whole-frame poses', () => {
    const s = make(); faceOff(s, 2, 0); s.step([ctl({ attack: true }), ctl()]); const f = s.fighters[0], rig = new FighterRig(0);
    expect(f.attack!.id).toBe('jab1');
    const arm = (age: number) => { rig.pose(f, input({ attackAge: age, snap: true })); return rig.arms[0].upper.rotation.x; };
    const a3 = arm(3), a35 = arm(3.5), a4 = arm(4);
    expect(a35).toBeGreaterThanOrEqual(Math.min(a3, a4) - 1e-9); expect(a35).toBeLessThanOrEqual(Math.max(a3, a4) + 1e-9);
    expect(a3).not.toBeCloseTo(a4, 3);
    rig.dispose();
  });

  it('shows the first frame of a pose at once when told to snap (respawn, reset)', () => {
    const rig = new FighterRig(2); rig.pose(fighter(2, { guarding: true }), input({ snap: true }));
    const guarded = rig.arms[0].upper.rotation.x; rig.pose(fighter(2), input({ snap: true }));
    expect(rig.arms[0].upper.rotation.x).not.toBeCloseTo(guarded, 1);
    rig.pose(fighter(2, { guarding: true }), input()); expect(rig.arms[0].upper.rotation.x).not.toBeCloseTo(guarded, 3);    // an unsnapped change eases
    rig.dispose();
  });
});

describe('expression and shield', () => {
  it('opens the mouth when hit, and blinks briefly', () => {
    const rig = new FighterRig(0);
    rig.pose(fighter(0), input({ time: 2 })); expect((rig as unknown as { mouthOpen: T.Object3D }).mouthOpen.visible).toBe(false);
    rig.pose(fighter(0, { stun: 20 }), input({ time: 2 })); expect((rig as unknown as { mouthOpen: T.Object3D }).mouthOpen.visible).toBe(true);
    const scales = new Set<number>(); for (let i = 0; i < 600; i++) { rig.pose(fighter(0), input({ time: i / 60 })); scales.add(Math.round((rig as unknown as { eyes: T.Object3D[] }).eyes[0].scale.y * 10)); }
    expect(Math.min(...scales)).toBeLessThan(3); expect(Math.max(...scales)).toBe(10);
    rig.dispose();
  });
  it('shows a shield shell that shrinks as the shield wears down, and a ripple that plays out', () => {
    const rig = new FighterRig(4);
    rig.pose(fighter(4), input()); expect(rig.shield.visible).toBe(false);
    rig.pose(fighter(4, { guarding: true, shield: 100 }), input()); const full = rig.shield.scale.x; expect(rig.shield.visible).toBe(true);
    rig.pose(fighter(4, { guarding: true, shield: 20 }), input()); expect(rig.shield.scale.x).toBeLessThan(full);
    rig.shieldHit(1); const mat = rig.shield.material as T.ShaderMaterial;
    rig.pose(fighter(4, { guarding: true }), input({ dt: 0.1 })); expect(mat.uniforms.uRippleAge.value).toBeLessThan(1);
    for (let i = 0; i < 10; i++) rig.pose(fighter(4, { guarding: true }), input({ dt: 0.1 })); expect(mat.uniforms.uRippleAge.value).toBe(1);
    rig.dispose();
  });
  it('exposes the hands for holding an opponent', () => {
    const rig = new FighterRig(0); rig.pose(fighter(0, { facing: 1 }), input({ x: 3, y: 1, snap: true })); rig.root.updateMatrixWorld(true);
    const mid = rig.handMidpoint(new T.Vector3()); expect(Number.isFinite(mid.x + mid.y + mid.z)).toBe(true); expect(mid.y).toBeGreaterThan(1); expect(mid.y).toBeLessThan(3);
    const chest = rig.chestWorld(new T.Vector3()); expect(chest.y).toBeGreaterThan(mid.y - 1.5);
    rig.dispose();
  });
});
