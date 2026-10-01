/**
 * Helpers for tests that build real Three.js scene graphs in Node. Not imported by the game.
 *
 * `installCanvasStub` gives `document.createElement('canvas')` a drawing context that accepts every call, so the
 * procedural textures can be constructed without a browser. `auditCoplanarFaces` scans a scene graph for the defect behind
 * the original flicker: two opaque, same-facing, axis-aligned faces on (nearly) the same plane that overlap.
 */
import { vi } from 'vitest';
import * as T from 'three';

export function installCanvasStub() {
  const ctx = new Proxy({}, {
    get: (_t, key) => {
      if (key === 'createImageData') return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (key === 'measureText') return () => ({ width: 10 });
      return () => {};
    },
    set: () => true,
  });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
}

export interface Face {
  /** Axis index of the face normal (0 = x, 1 = y, 2 = z) and its sign as seen by a viewer on that side. */
  axis: number; sign: number; plane: number;
  /** Triangle vertices projected onto the two other axes. */
  tri: [number, number][];
  owner: string;
  mesh: string;
}
export interface Conflict { a: Face; b: Face; separation: number }

const v0 = new T.Vector3(), v1 = new T.Vector3(), v2 = new T.Vector3(), e1 = new T.Vector3(), e2 = new T.Vector3(), n = new T.Vector3();

/** Every axis-aligned triangle of every visible, opaque, depth-writing mesh, in world space. */
export function collectFaces(root: T.Object3D): Face[] {
  root.updateMatrixWorld(true);
  const faces: Face[] = [];
  root.traverse(o => {
    const mesh = o as T.Mesh;
    if (!mesh.isMesh || !mesh.visible || (o as T.InstancedMesh).isInstancedMesh) return;
    const geo = mesh.geometry, pos = geo.getAttribute('position'), index = geo.index, count = index ? index.count : pos.count;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (let t = 0; t < count / 3; t++) {
      const group = geo.groups.find(g => t * 3 >= g.start && t * 3 < g.start + g.count), material = Array.isArray(mesh.material) ? materials[group?.materialIndex ?? 0] : materials[0];
      if (!material || material.transparent || !material.depthWrite) continue;
      const get = (k: number, out: T.Vector3) => out.fromBufferAttribute(pos, index ? index.getX(t * 3 + k) : t * 3 + k).applyMatrix4(mesh.matrixWorld);
      get(0, v0); get(1, v1); get(2, v2);
      n.crossVectors(e1.subVectors(v1, v0), e2.subVectors(v2, v0)); if (n.lengthSq() < 1e-14) continue; n.normalize();
      const axis = Math.abs(n.x) > 0.9999 ? 0 : Math.abs(n.y) > 0.9999 ? 1 : Math.abs(n.z) > 0.9999 ? 2 : -1; if (axis < 0) continue;
      const toward = Math.sign(n.getComponent(axis)), back = material.side === T.BackSide, double = material.side === T.DoubleSide;
      const signs = double ? [1, -1] : [back ? -toward : toward];
      const project = (v: T.Vector3): [number, number] => axis === 0 ? [v.y, v.z] : axis === 1 ? [v.x, v.z] : [v.x, v.y];
      for (const sign of signs) faces.push({ axis, sign, plane: v0.getComponent(axis), tri: [project(v0), project(v1), project(v2)], owner: `${mesh.uuid}:${Math.floor(t / 2)}`, mesh: mesh.name || mesh.uuid.slice(0, 6) });
    }
  });
  return faces;
}

const inside = (p: [number, number], tri: [number, number][]) => {
  const [a, b, c] = tri, d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (Math.abs(d) < 1e-12) return false;
  const w1 = ((b[1] - c[1]) * (p[0] - c[0]) + (c[0] - b[0]) * (p[1] - c[1])) / d, w2 = ((c[1] - a[1]) * (p[0] - c[0]) + (a[0] - c[0]) * (p[1] - c[1])) / d, w3 = 1 - w1 - w2;
  const eps = 1e-6; return w1 > eps && w2 > eps && w3 > eps;
};
const samples = (tri: [number, number][]): [number, number][] => {
  const [a, b, c] = tri, m: [number, number] = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
  return [m, ...tri.map((v): [number, number] => [m[0] + (v[0] - m[0]) * 0.6, m[1] + (v[1] - m[1]) * 0.6]), ...[[a, b], [b, c], [c, a]].map(([p, q]): [number, number] => [(p[0] + q[0]) / 2 * 0.5 + m[0] * 0.5, (p[1] + q[1]) / 2 * 0.5 + m[1] * 0.5])];
};

/**
 * Pairs of overlapping, same-facing faces from different pieces of geometry whose planes are closer than `tolerance`
 * (default 4 mm, about two depth-buffer steps at the far edge of the playfield with the project's near/far planes).
 */
export function auditCoplanarFaces(root: T.Object3D, tolerance = 0.004): Conflict[] {
  const faces = collectFaces(root), buckets = new Map<string, Face[]>(), scale = 1 / tolerance;
  for (const f of faces) { const key = `${f.axis}:${f.sign}:${Math.round(f.plane * scale)}`; (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(f); }
  const conflicts: Conflict[] = [];
  for (const f of faces) {
    const base = Math.round(f.plane * scale);
    for (const step of [-1, 0, 1]) for (const g of buckets.get(`${f.axis}:${f.sign}:${base + step}`) ?? []) {
      if (g === f || g.owner === f.owner || Math.abs(g.plane - f.plane) >= tolerance || f.owner > g.owner) continue;
      if (samples(f.tri).some(p => inside(p, g.tri)) || samples(g.tri).some(p => inside(p, f.tri))) conflicts.push({ a: f, b: g, separation: Math.abs(g.plane - f.plane) });
    }
  }
  return conflicts;
}
