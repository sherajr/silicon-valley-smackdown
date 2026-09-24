// Presentation-only: loads a fighter's GLB, drives its AnimationMixer from simulation state, and
// positions it in world space. Never mutates combat state. Mirrors FighterView.ts's contract
// (see src/render/FighterView.ts) but for a real skinned 3D model instead of a Phaser sprite.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { SIM_FPS } from '../sim/constants';
import { simToWorldX, simToWorldY } from './coordinates';
import { resolveClip, type FighterModelEntry } from './ModelRegistry';
import type { FighterRuntime } from '../sim/FighterRuntime';
import type { FighterImpact } from '../render/FighterView';
import type { FighterStateName } from '../sim/types';

const MS_PER_SIM_TICK = 1000 / SIM_FPS;

interface LoadedSource {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
  /** World units to raise the model so its lowest bind-pose vertex sits at y=0. */
  footOffset: number;
}

const loader = new GLTFLoader();
const sourceCache = new Map<string, Promise<LoadedSource>>();

/** Loaded once per GLB path and reused for every instance (P1, P2, previews): geometry, textures
 * and the base skeleton are shared read-only source data. Each FighterModel3D instance clones its
 * own skinned hierarchy via SkeletonUtils so P1/P2 poses, materials (tint) and mixers never
 * interfere -- required for an honest mirror match (see FightScene's mirror tint handling). */
function loadSource(glbPath: string): Promise<LoadedSource> {
  let cached = sourceCache.get(glbPath);
  if (!cached) {
    const base = import.meta.env.BASE_URL;
    cached = loader.loadAsync(`${base}${glbPath}`).then((gltf) => {
      const box = new THREE.Box3().setFromObject(gltf.scene);
      return { scene: gltf.scene, animations: gltf.animations, footOffset: -box.min.y };
    });
    sourceCache.set(glbPath, cached);
  }
  return cached;
}

export class FighterModel3D {
  readonly group = new THREE.Group();
  private mixer: THREE.AnimationMixer | null = null;
  private actionsByClip = new Map<string, THREE.AnimationAction>();
  private currentAction: THREE.AnimationAction | null = null;
  private currentClipName = '';
  private loaded = false;
  private disposed = false;
  private clonedMaterials: THREE.Material[] = [];

  // Mirrors FighterView's own state-elapsed-ticks tracking (see FighterView.update), so combat
  // animation time follows simulation progress -- including hit-stop and pause -- rather than
  // wall-clock time. A fresh hit restarts the reaction even if the state name is unchanged.
  private lastState: FighterStateName | null = null;
  private lastSimFrame = -1;
  private stateElapsedTicks = 0;
  private readonly entry: FighterModelEntry;

  constructor(entry: FighterModelEntry, scene: THREE.Scene, palette?: { tintOverride?: number }) {
    this.entry = entry;
    scene.add(this.group);
    void this.load(palette?.tintOverride);
  }

  private async load(tintOverride?: number): Promise<void> {
    try {
      const source = await loadSource(this.entry.glbPath);
      if (this.disposed) return; // scene closed while the load was in flight

      const model = cloneSkeleton(source.scene) as THREE.Object3D;
      model.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.castShadow = true;
          obj.receiveShadow = true;
          if (tintOverride !== undefined) {
            const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
            const tinted = materials.map((m) => {
              const clonedMat = (m as THREE.MeshStandardMaterial).clone();
              clonedMat.color = new THREE.Color(tintOverride);
              this.clonedMaterials.push(clonedMat);
              return clonedMat;
            });
            obj.material = Array.isArray(obj.material) ? tinted : tinted[0];
          }
        }
      });

      const pivot = new THREE.Group();
      pivot.rotation.y = this.entry.baseYRotation;
      pivot.scale.setScalar(this.entry.modelScale);
      pivot.position.y = source.footOffset * this.entry.modelScale;
      pivot.add(model);
      this.group.add(pivot);

      this.mixer = new THREE.AnimationMixer(model);
      for (const clip of source.animations) {
        this.actionsByClip.set(clip.name, this.mixer.clipAction(clip));
      }
      this.loaded = true;
    } catch (err) {
      // Presentation must fail loudly, not silently show nothing and claim 3D succeeded.
      console.error(`[FighterModel3D] failed to load ${this.entry.glbPath}`, err);
    }
  }

  get isLoaded(): boolean {
    return this.loaded;
  }

  resetReactionState(): void {
    this.lastState = null;
    this.lastSimFrame = -1;
    this.stateElapsedTicks = 0;
  }

  setWorldPosition(simX: number, simY: number): void {
    this.group.position.set(simToWorldX(simX), simToWorldY(simY), 0);
  }

  /** Whole-model Y rotation for facing, never negative-scale mirroring (see ModelRegistry). */
  setFacing(facing: 1 | -1): void {
    this.group.rotation.y = facing === -1 ? Math.PI : 0;
  }

  update(f: FighterRuntime, impact: FighterImpact, simFrameCount: number): void {
    this.setWorldPosition(f.x, f.y);
    this.setFacing(f.facing);
    if (!this.loaded || !this.mixer) return;

    if (this.lastSimFrame >= 0 && simFrameCount < this.lastSimFrame) this.resetReactionState();
    const ticksAdvanced = this.lastSimFrame < 0 ? 0 : Math.max(0, simFrameCount - this.lastSimFrame);
    this.lastSimFrame = simFrameCount;

    if (f.state !== this.lastState) {
      this.stateElapsedTicks = 0;
      this.lastState = f.state;
    } else if (impact.hit || impact.blocked) {
      this.stateElapsedTicks = 0;
    } else {
      this.stateElapsedTicks += ticksAdvanced;
    }

    const moveKind = f.state === 'attack' ? (f.activeMove?.def.kind ?? null) : null;
    const { clip, speed } = resolveClip(this.entry, f.state, moveKind);
    this.playClip(clip);

    const action = this.currentAction;
    if (!action) return;
    // Driven directly by sim-tick elapsed time (not wall-clock deltaMs), so playback follows
    // hit-stop/pause exactly like FighterView's pose selection does.
    const elapsedSeconds = (this.stateElapsedTicks * MS_PER_SIM_TICK * speed) / 1000;
    const duration = action.getClip().duration || 1;
    action.time = action.loop === THREE.LoopOnce ? Math.min(elapsedSeconds, duration) : elapsedSeconds % duration;
    this.mixer.update(0);
  }

  private playClip(clipName: string): void {
    if (this.currentClipName === clipName) return;
    const next = this.actionsByClip.get(clipName);
    if (!next) {
      console.warn(`[FighterModel3D] missing clip "${clipName}" on ${this.entry.glbPath}`);
      return;
    }
    this.currentAction?.stop();
    next.reset().play();
    next.setLoop(THREE.LoopRepeat, Infinity);
    this.currentAction = next;
    this.currentClipName = clipName;
  }

  dispose(): void {
    this.disposed = true;
    this.mixer?.stopAllAction();
    this.group.parent?.remove(this.group);
    for (const mat of this.clonedMaterials) mat.dispose();
    // Geometry/textures/base skeleton are shared source data (see loadSource) and outlive this
    // instance; only per-instance cloned data (the skeleton clone's own bone Object3Ds, and the
    // tinted materials above) is this instance's to dispose.
    this.group.traverse((obj) => {
      if (obj instanceof THREE.SkinnedMesh) obj.skeleton?.dispose();
    });
  }
}
