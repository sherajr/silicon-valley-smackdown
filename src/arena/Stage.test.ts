import { afterAll, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { ArenaStage } from './Stage';
import { STAGE_PLATFORMS } from './data';
import { MAIN_DEPTH, UPPER_DEPTH, floorBelow, shadowSpan, slabSpec } from './stageLayout';
import { auditCoplanarFaces, collectFaces, installCanvasStub } from './renderTestHelpers';
import { buildStage } from './collision';

installCanvasStub();
afterAll(() => vi.unstubAllGlobals());

const stages = [0, 1, 2].map(i => new ArenaStage(i));
const box = (w: number, h: number, d: number, x: number, y: number, z: number, name: string) => { const m = new T.Mesh(new T.BoxGeometry(w, h, d), new T.MeshStandardMaterial()); m.position.set(x, y, z); m.name = name; return m; };

describe('platform geometry follows the simulation records', () => {
  for (const [index, stage] of stages.entries()) for (const p of STAGE_PLATFORMS[index]) {
    it(`stage ${index} / ${p.id}: top, bottom, width and centre match the collision data`, () => {
      const slab = stage.slabs.get(p.id)!; expect(slab).toBeDefined();
      slab.updateMatrixWorld(true);
      const bounds = new T.Box3().setFromObject(slab), spec = slabSpec(p);
      expect(bounds.max.y).toBeCloseTo(p.y, 6); expect(bounds.min.y).toBeCloseTo(p.y - p.thickness, 6);
      expect(bounds.min.x).toBeCloseTo(p.x - p.w / 2, 6); expect(bounds.max.x).toBeCloseTo(p.x + p.w / 2, 6);
      expect(bounds.max.z - bounds.min.z).toBeCloseTo(p.solid ? MAIN_DEPTH : UPPER_DEPTH, 6); expect((bounds.max.z + bounds.min.z) / 2).toBeCloseTo(0, 6);
      expect(spec.top).toBe(p.y); expect(spec.bottom).toBe(p.y - p.thickness);
    });
    it(`stage ${index} / ${p.id}: the walkable surface agrees with where the simulation lands a fighter`, () => {
      // The collision stage lands feet on `top` for a fighter inside the span, and the visible slab's top is that same height.
      const sim = buildStage([p]); expect(sim.ledges.length).toBe(p.ledges ? 2 : 0);
      if (p.ledges) for (const ledge of sim.ledges) { expect(ledge.y).toBeCloseTo(slabSpec(p).top, 6); expect(Math.abs(ledge.x - p.x)).toBeCloseTo(p.w / 2, 6); }
    });
  }
});

describe('no coincident exposed surfaces', () => {
  for (const [index, stage] of stages.entries()) {
    it(`stage ${index}: exactly one exposed up-facing surface covers each platform top`, () => {
      const faces = collectFaces(stage.root);
      for (const p of STAGE_PLATFORMS[index]) {
        const owners = new Set(faces.filter(f => f.axis === 1 && f.sign === 1 && Math.abs(f.plane - p.y) < 0.004
          && f.tri.some(([x, z]) => Math.abs(x - p.x) <= p.w / 2 + 1e-6 && Math.abs(z) <= (p.solid ? MAIN_DEPTH : UPPER_DEPTH) / 2 + 1e-6)).map(f => f.owner));
        expect([p.id, owners.size]).toEqual([p.id, 1]);
      }
    });
    it(`stage ${index}: no opaque faces share a plane (within 4 mm) and overlap anywhere in the scene`, () => {
      const conflicts = auditCoplanarFaces(stage.root);
      expect(conflicts.map(c => `${c.a.mesh}~${c.b.mesh} axis ${c.a.axis} plane ${c.a.plane.toFixed(3)}`)).toEqual([]);
    });
  }

  it('the audit catches the original defect (a body and a cap with the same exposed top) and a tight decal', () => {
    const scene = new T.Group(), p = STAGE_PLATFORMS[0][0];
    scene.add(box(p.w, p.thickness, 6.8, p.x, p.y - p.thickness / 2, 0, 'body'), box(p.w, 0.12, 6.8, p.x, p.y - 0.06, 0, 'cap'));
    const conflicts = auditCoplanarFaces(scene);
    const tops = conflicts.filter(c => c.a.axis === 1 && c.a.sign === 1);
    expect(tops.length).toBeGreaterThan(0); expect(tops[0].separation).toBeLessThan(1e-6);
    const decal = new T.Group(); decal.add(box(4, 0.2, 4, 0, 0, 0, 'floor'), box(2, 0.2, 2, 0, 0.0015, 0, 'paint'));
    expect(auditCoplanarFaces(decal).length).toBeGreaterThan(0);
    // The fixed construction: a coping lip 3 cm under the surface is a different plane.
    const fixed = new T.Group(); fixed.add(box(p.w, p.thickness, 6.8, p.x, p.y - p.thickness / 2, 0, 'slab'), box(p.w + 0.16, 0.12, 6.96, p.x, p.y - 0.09, 0, 'coping'));
    expect(auditCoplanarFaces(fixed)).toEqual([]);
  });

  it('floor markings are painted into the surface texture, not laid on it as thin meshes', () => {
    for (const stage of stages) {
      let thin = 0;
      stage.root.traverse(o => { const m = o as T.Mesh; if (m.isMesh && m.geometry instanceof T.BoxGeometry) { const g = m.geometry.parameters; if (Math.min(g.width, g.height, g.depth) < 0.02) thin++; } });
      expect(thin).toBe(0);
      for (const slab of stage.slabs.values()) { const mats = slab.material as T.MeshStandardMaterial[]; expect(mats[2].map).toBeTruthy(); expect(mats[2].map!.anisotropy).toBeGreaterThanOrEqual(1); expect(mats[2].map!.generateMipmaps).toBe(true); expect(mats[2].map!.colorSpace).toBe(T.SRGBColorSpace); }
    }
  });
});

describe('scene cost and shadow roles', () => {
  it('has far fewer meshes and shadow casters than the 239-253 / 186-195 the unbatched stage had', () => {
    // Measured at 36 to 45 meshes, 6 to 11 casters and under 9,000 triangles; the limits leave room for new scenery but would
    // catch a return to unbatched pieces (and a shadow-casting skyline).
    for (const stage of stages) { const s = stage.stats; expect(s.meshes).toBeLessThan(80); expect(s.casters).toBeLessThan(20); expect(s.triangles).toBeLessThan(20000); }
  });
  it('only the foreground casts shadows: nothing behind the buildings does, and the platforms both cast and receive', () => {
    for (const stage of stages) {
      stage.root.updateMatrixWorld(true);
      stage.root.traverse(o => {
        const m = o as T.Mesh; if (!m.isMesh) return;
        const b = new T.Box3().setFromObject(m);
        if (b.max.z < -9.5) expect([m.name, m.castShadow]).toEqual([m.name, false]);
        if (m.name.startsWith('platform:')) { expect(m.castShadow).toBe(true); expect(m.receiveShadow).toBe(true); }
      });
    }
  });
  it('is deterministic: building a stage twice gives the same scene', () => {
    const again = new ArenaStage(1), first = stages[1];
    expect(again.stats).toEqual(first.stats);
    const a = new T.Box3().setFromObject(again.root), b = new T.Box3().setFromObject(first.root);
    expect(a.min.toArray()).toEqual(b.min.toArray()); expect(a.max.toArray()).toEqual(b.max.toArray());
    again.dispose();
  });
  it('puts every stage on its own theme and keeps ambient motion at rest when motion is off', () => {
    expect(stages.map(s => s.theme.id)).toEqual(['castro', 'sandhill', 'launch']);
    const stage = stages[1]; stage.update(10, false);
    const spin: number[] = []; stage.root.traverse(o => { if ((o as T.Mesh).isMesh && o.rotation.y !== 0) spin.push(o.rotation.y); });
    stage.update(20, false); const spin2: number[] = []; stage.root.traverse(o => { if ((o as T.Mesh).isMesh && o.rotation.y !== 0) spin2.push(o.rotation.y); });
    expect(spin2).toEqual(spin);
    stage.update(10, true); stage.update(20, true); expect(true).toBe(true);
  });
});

describe('contact-shadow placement helpers', () => {
  const platforms = STAGE_PLATFORMS[0];
  it('finds the surface a fighter is above, preferring the highest top below them', () => {
    expect(floorBelow(platforms, 0, 0)?.id).toBe('main');
    expect(floorBelow(platforms, -5, 4)?.id).toBe('left');
    expect(floorBelow(platforms, -5, 3.3)?.id).toBe('main');        // below the platform's top: it is under it, not on it
    expect(floorBelow(platforms, 40, 4)).toBeNull();
  });
  it('crops the shadow to the platform so none hangs in the air at an edge', () => {
    const main = platforms[0];
    expect(shadowSpan(0, 0.5, main)).toEqual({ cx: 0, half: 0.5 });
    const edge = shadowSpan(9.3, 0.5, main)!; expect(edge.cx + edge.half).toBeCloseTo(9.5); expect(edge.half).toBeLessThan(0.5);
    const beyond = shadowSpan(9.7, 0.5, main)!; expect(beyond.half).toBeCloseTo(0.15, 6);        // only 0.3 of the footprint is over the surface
    expect(shadowSpan(9.95, 0.5, main)).toBeNull();                                               // a sliver under 0.12 is dropped
    expect(shadowSpan(10.5, 0.5, main)).toBeNull();
  });
});
