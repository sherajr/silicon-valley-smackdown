// Single source of truth for every fighter's 3D asset: where its GLB lives, how to scale/orient
// it, and which authored animation clip plays for each simulation state or move. Adding a new 3D
// fighter means adding one entry here -- FightScene and the renderer never hardcode a character id.
import type { FighterId, FighterStateName, MoveKind } from '../sim/types';

/** Animation "roles" the presentation layer can ask for. One clip may serve several roles (the
 * shipped 2D sprite art does the same thing -- see SpriteFactory.buildArtVisuals's moveFrames). */
export type AnimRole =
  | 'idle'
  | 'walk'
  | 'dash'
  | 'jump'
  | 'crouch'
  | 'block'
  | 'hurt'
  | 'victory'
  | MoveKind;

export interface FighterModelEntry {
  glbPath: string;
  /** Uniform scale applied after load so the model's authored height matches the roster's
   * established on-screen size. Tuned by comparing against a rendered frame, not assumed. */
  modelScale: number;
  /** Radians of Y rotation applied so the model faces +worldX (facing=1 / right) before any
   * per-frame facing flip. Whole-model rotation, never negative-scale mirroring (see
   * FighterModel3D.setFacing) -- negative scale would invert the skeleton and normals. */
  baseYRotation: number;
  /** Vertical offset (world units) from the loaded model's own origin to its measured ground
   * contact point, applied once at load time. Kept separate from Blender-side origin edits so the
   * source .blend's bind pose is never touched (see export_maul_glb.py). */
  footOffset: number;
  /** role -> exact clip name baked into the GLB (see scripts/art/export_maul_glb.py CLIPS). */
  clips: Partial<Record<AnimRole, string>>;
  /** Playback speed multiplier per role, for states that reuse another role's clip at a
   * different cadence (dash reusing the walk clip faster, matching the 2D dash/walk relationship
   * in SpriteFactory.buildArtVisuals: "dash replays the walk cells at a sprint cadence"). */
  speedMult?: Partial<Record<AnmSpeedKey, number>>;
}

type AnmSpeedKey = 'dash';

/** Resolves the clip (and playback speed) for a fighter state + optional active move kind.
 * Centralizes the same reuse pattern the 2D art already uses (see moveFrames in SpriteFactory):
 * most attack kinds share one fuller-swing clip, distinct moves get their own clip only once
 * authored. Falls back to 'idle' if a role has no mapped clip, so a partially-authored roster
 * entry degrades to a held pose instead of throwing. */
export function resolveClip(
  entry: FighterModelEntry,
  state: FighterStateName,
  moveKind: MoveKind | null,
): { clip: string; speed: number } {
  const role = roleFor(state, moveKind);
  const clip = entry.clips[role] ?? entry.clips.idle ?? Object.values(entry.clips)[0];
  const speed = role === 'dash' ? (entry.speedMult?.dash ?? 1) : 1;
  return { clip: clip!, speed };
}

function roleFor(state: FighterStateName, moveKind: MoveKind | null): AnimRole {
  switch (state) {
    case 'idle':
    case 'intro':
      return 'idle';
    case 'walk':
      return 'walk';
    case 'dash':
      return 'dash';
    case 'jump':
      return 'jump';
    case 'crouch':
    case 'wakeup':
      return 'crouch';
    case 'block':
    case 'blockstun':
      return 'block';
    case 'hitstun':
    case 'guardbreak':
    case 'grabbed':
    case 'knockdown':
    case 'ko':
      return 'hurt';
    case 'victory':
      return 'victory';
    case 'attack':
      return moveKind ?? 'idle';
    default:
      return 'idle';
  }
}

export const MODEL_REGISTRY: Partial<Record<FighterId, FighterModelEntry>> = {
  maul: {
    glbPath: 'models/fighters/maul/maul.glb',
    // Tuned against a rendered frame (see docs/3d-conversion-checklist.md) rather than assumed.
    modelScale: 0.37,
    // The model faces -Y in Blender's Z-up space (see scripts/art/maul_sprites.py's camera
    // comment). +90 deg about Y was tried first on the assumption that Blender's glTF Y-up
    // export maps Blender Y to +glTF Z, but a screenshot (docs/handoffs/evidence/
    // 3d-facing-p1-closeup.png / -p2-closeup.png) showed both fighters facing directly away from
    // each other -- exactly 180 deg off. -90 deg (i.e. +270) is the measured-correct value.
    baseYRotation: -Math.PI / 2,
    footOffset: 0, // computed at load time from the model's own bounding box; see FighterModel3D
    clips: {
      idle: 'Maul_Idle',
      walk: 'Maul_Walk',
      dash: 'Maul_Walk',
      jump: 'Maul_Jump',
      crouch: 'Maul_Crouch',
      block: 'Maul_Block',
      hurt: 'Maul_Hurt',
      victory: 'Maul_Idle',
      basic1: 'Maul_Basic1',
      // Shared fuller swing for the rest of the attack-kind moves, matching how the shipped 2D
      // art also recombines the same cells across these moves (see SpriteFactory moveFrames).
      // Per-move bespoke coverage is a follow-up -- see the checklist.
      basic2: 'Maul_Attack',
      basic3: 'Maul_Attack',
      crouchBasic: 'Maul_Attack',
      jumpBasic: 'Maul_Attack',
      forwardBasic: 'Maul_Attack',
      special: 'Maul_Attack',
      downSpecial: 'Maul_Attack',
      grab: 'Maul_Attack',
      super: 'Maul_Attack',
    },
    speedMult: { dash: 1.8 },
  },
};

export function has3DModel(id: FighterId): boolean {
  return id in MODEL_REGISTRY;
}
