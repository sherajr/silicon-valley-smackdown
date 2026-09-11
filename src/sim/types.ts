// Core simulation types shared across the fixed-step combat engine, character
// data, AI, and presentation layers. Positions/sizes are expressed in "sim
// units" which map 1:1 to pixels on the 480x270 base canvas.

export type FighterId = 'hunter' | 'kevin' | 'al' | 'priya' | 'chad' | 'elon';

export const ALL_FIGHTER_IDS: FighterId[] = ['hunter', 'kevin', 'al', 'priya', 'chad', 'elon'];
export const REGULAR_FIGHTER_IDS: FighterId[] = ['hunter', 'kevin', 'al', 'priya', 'chad'];

export type StageId = 'castro_street' | 'sand_hill_road' | 'palo_alto';
export const ALL_STAGE_IDS: StageId[] = ['castro_street', 'sand_hill_road', 'palo_alto'];

export type Difficulty = 'easy' | 'normal' | 'hard';

/** A physical/logical action a player can request each simulation frame. */
export type ActionId =
  | 'moveLeft'
  | 'moveRight'
  | 'up'
  | 'down'
  | 'basic'
  | 'special'
  | 'block'
  | 'grab'
  | 'pause';

/** Normalized input snapshot for one fighter for a single sim frame. */
export interface PlayerFrameInput {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  basicHeld: boolean;
  specialHeld: boolean;
  blockHeld: boolean;
  grabHeld: boolean;
  /** Edge-triggered: true only on the frame the button transitioned from up to down. */
  basicPressed: boolean;
  specialPressed: boolean;
  grabPressed: boolean;
  blockPressed: boolean;
  pausePressed: boolean;
}

export function neutralFrameInput(): PlayerFrameInput {
  return {
    left: false,
    right: false,
    up: false,
    down: false,
    basicHeld: false,
    specialHeld: false,
    blockHeld: false,
    grabHeld: false,
    basicPressed: false,
    specialPressed: false,
    grabPressed: false,
    blockPressed: false,
    pausePressed: false,
  };
}

export type AttackHeight = 'high' | 'mid' | 'low' | 'overhead' | 'unblockable';

/** 1 = facing/moving right, -1 = facing/moving left. */
export type Facing = 1 | -1;

export type FighterStateName =
  | 'intro'
  | 'idle'
  | 'walk'
  | 'dash'
  | 'jump'
  | 'crouch'
  | 'attack'
  | 'block'
  | 'blockstun'
  | 'guardbreak'
  | 'hitstun'
  | 'grabbing'
  | 'grabbed'
  | 'knockdown'
  | 'wakeup'
  | 'victory'
  | 'ko';

export interface Vec2 {
  x: number;
  y: number;
}

/** Axis-aligned box in a fighter's local space; x grows toward the fighter's facing. */
export interface LocalBox {
  x: number;
  y: number; // measured from the fighter's ground anchor, negative = up
  w: number;
  h: number;
}

export interface HitEffect {
  damage: number;
  height: AttackHeight;
  guardDamage: number;
  stunFrames: number; // hitstun applied to grounded, non-comboed-out target
  blockstunFrames: number;
  knockback: Vec2; // applied away from attacker; y negative = up
  launches?: boolean;
  forceKnockdown?: boolean;
  hitstopFrames: number;
}

export interface MoveHitWindow {
  /** Frame within the move (0-based) this hit becomes active. */
  startupFrame: number;
  activeFrames: number;
  box: LocalBox;
  effect: HitEffect;
  /** Minimum frames before this same move instance can hit the same target again. */
  reHitInterval?: number;
}

export type ProjectileMotion = 'linear' | 'arc' | 'ground';

export interface ProjectileDef {
  motion: ProjectileMotion;
  speed: number; // px/frame along facing
  gravity?: number; // px/frame^2, for 'arc'
  vy0?: number; // initial vertical velocity for 'arc' (negative = up)
  life: number; // frames before despawn
  spawnOffset: Vec2;
  box: LocalBox;
  effect: HitEffect;
  maxActiveInstances: number;
  /** If set, projectile is stationary and only becomes active (dangerous) after this many frames. */
  telegraphFrames?: number;
}

export type MoveKind =
  | 'basic1'
  | 'basic2'
  | 'basic3'
  | 'crouchBasic'
  | 'jumpBasic'
  | 'forwardBasic'
  | 'special'
  | 'downSpecial'
  | 'grab'
  | 'super';

export interface MoveDef {
  id: string;
  name: string;
  command: string;
  kind: MoveKind;
  height: AttackHeight;
  startup: number;
  recovery: number;
  hits: MoveHitWindow[];
  cooldown: number;
  meterCost: number;
  projectile?: ProjectileDef;
  isGrab?: boolean;
  isCounter?: boolean;
  counterWindow?: { start: number; end: number };
  /** For counter moves: the riposte hit applied to whoever triggered the counter. */
  counterEffect?: HitEffect;
  chainsFrom?: MoveKind[];
  /** Ground-target telegraphed strike (Chad's Down Round / Elon's super). */
  targetedStrike?: TargetedStrikeDef;
  /** Forward creep during startup for committed lunging attacks (blocked by pushbox collision, so it can't pass through a defender for free). */
  lunge?: { speed: number; frames: number };
  totalFrames: number;
}

export interface TargetedStrikeDef {
  delayFrames: number;
  activeFrames: number;
  offset: Vec2;
  box: LocalBox;
  effect: HitEffect;
  markerRadius: number;
}

export interface CharacterVisual {
  skin: string;
  hair: string;
  primary: string;
  secondary: string;
  accent: string;
  outline: string;
}

export interface CharacterDef {
  id: FighterId;
  name: string;
  profession: string;
  tagline: string;
  introLine: string;
  winLine: string;
  maxHealth: number;
  walkSpeed: number;
  dashSpeed: number;
  jumpVelocity: number;
  power: number; // 1-5 indicator
  speed: number; // 1-5 indicator
  reach: number; // 1-5 indicator
  width: number; // pushbox width
  height: number; // pushbox height
  visual: CharacterVisual;
  moves: Record<MoveKind, MoveDef>;
  locked?: boolean;
  /** Boss-only: fraction of max health at which Crunch Mode triggers (see CombatSim). */
  bossPhaseThreshold?: number;
}
