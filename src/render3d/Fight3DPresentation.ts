// Composes the 3D rendering boundary (GameRenderer3D + Stage3D + two FighterModel3D instances)
// behind the same small surface FightScene already uses for the 2D StageView/FighterView pair,
// so the scene-level integration diff stays minimal. Never touches simulation state.
import type { StageDef } from '../data/stages';
import type { CharacterDef } from '../sim/types';
import type { FighterRuntime } from '../sim/FighterRuntime';
import type { FighterImpact } from '../render/FighterView';
import { GameRenderer3D } from './GameRenderer3D';
import { Stage3D } from './Stage3D';
import { FighterModel3D } from './FighterModel3D';
import { MODEL_REGISTRY } from './ModelRegistry';
import type { GraphicsSettings } from './GraphicsSettings';

export class Fight3DPresentation {
  private renderer: GameRenderer3D;
  private stage: Stage3D;
  private p1Model: FighterModel3D;
  private p2Model: FighterModel3D;

  constructor(
    phaserCanvas: HTMLCanvasElement,
    settings: GraphicsSettings,
    stageDef: StageDef,
    p1Def: CharacterDef,
    p2Def: CharacterDef,
    mirrorTint?: number,
  ) {
    const p1Entry = MODEL_REGISTRY[p1Def.id];
    const p2Entry = MODEL_REGISTRY[p2Def.id];
    if (!p1Entry || !p2Entry) {
      throw new Error(`Fight3DPresentation requires both fighters to have a registry entry (${p1Def.id}, ${p2Def.id})`);
    }
    this.renderer = new GameRenderer3D(phaserCanvas, settings);
    this.stage = new Stage3D(this.renderer.scene, stageDef);
    this.p1Model = new FighterModel3D(p1Entry, this.renderer.scene);
    this.p2Model = new FighterModel3D(p2Entry, this.renderer.scene, mirrorTint !== undefined ? { tintOverride: mirrorTint } : undefined);
  }

  resetReactionState(): void {
    this.p1Model.resetReactionState();
    this.p2Model.resetReactionState();
  }

  setCrunchLighting(active: boolean): void {
    this.stage.setCrunchLighting(active);
  }

  /** Resync the 3D canvas to Phaser's canvas rect -- call after any layout change the
   * ResizeObserver might not have caught yet (e.g. immediately after scene creation). */
  syncViewport(): void {
    this.renderer.sync();
  }

  update(p1: FighterRuntime, p2: FighterRuntime, p1Impact: FighterImpact, p2Impact: FighterImpact, simFrameCount: number): void {
    this.p1Model.update(p1, p1Impact, simFrameCount);
    this.p2Model.update(p2, p2Impact, simFrameCount);
    this.renderer.render();
  }

  get diagnostics(): { drawCalls: number; triangles: number; p1Loaded: boolean; p2Loaded: boolean } {
    return {
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      p1Loaded: this.p1Model.isLoaded,
      p2Loaded: this.p2Model.isLoaded,
    };
  }

  dispose(): void {
    this.p1Model.dispose();
    this.p2Model.dispose();
    this.stage.dispose();
    this.renderer.dispose();
  }
}
