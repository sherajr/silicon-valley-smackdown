import * as T from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Collects static scenery that is already positioned in stage space and merges it into one mesh per
 * (material, shadow role). The stage used to be about 240 separate meshes with about 190 shadow casters; batching
 * keeps the same pictures in a few dozen draw calls and lets each piece say whether it casts or receives shadows.
 * Moving parts (trees, spinners, the sculpture) are not batched.
 */
export interface BatchFlags { cast?: boolean; receive?: boolean; /** Render order of the merged mesh. Distant scenery uses a later order so nearer opaque surfaces reject its hidden fragments early. */ order?: number }

interface Group { material: T.Material; cast: boolean; receive: boolean; order: number; geometries: T.BufferGeometry[] }

/** Position, normal and uv only, non-indexed: the one layout every source geometry can be converted to and merged in. */
function normalise(source: T.BufferGeometry): T.BufferGeometry {
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  for (const name of Object.keys(geometry.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') geometry.deleteAttribute(name);
  geometry.clearGroups();
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  if (!geometry.getAttribute('uv')) geometry.setAttribute('uv', new T.BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 2), 2));
  return geometry;
}

export class StaticBatch {
  private groups = new Map<string, Group>();
  /** Source pieces added, for statistics. */
  pieces = 0;

  add(geometry: T.BufferGeometry, material: T.Material, flags: BatchFlags = {}) {
    const cast = flags.cast ?? false, receive = flags.receive ?? true, order = flags.order ?? 0, key = `${material.uuid}|${cast ? 1 : 0}${receive ? 1 : 0}|${order}`;
    let group = this.groups.get(key);
    if (!group) { group = { material, cast, receive, order, geometries: [] }; this.groups.set(key, group); }
    group.geometries.push(normalise(geometry)); this.pieces++;
    geometry.dispose();
  }

  /** Merges every group into a single mesh, adds it to `parent`, and returns the merged geometries (owned by the caller). */
  build(parent: T.Object3D): { meshes: T.Mesh[]; geometries: T.BufferGeometry[] } {
    const meshes: T.Mesh[] = [], geometries: T.BufferGeometry[] = [];
    for (const group of this.groups.values()) {
      const merged = mergeGeometries(group.geometries, false);
      for (const g of group.geometries) g.dispose();
      if (!merged) throw new Error('Static batch could not merge its geometries');
      merged.computeBoundingSphere(); merged.computeBoundingBox();
      const mesh = new T.Mesh(merged, group.material);
      mesh.castShadow = group.cast; mesh.receiveShadow = group.receive; mesh.renderOrder = group.order; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      parent.add(mesh); meshes.push(mesh); geometries.push(merged);
    }
    this.groups.clear();
    return { meshes, geometries };
  }
}
