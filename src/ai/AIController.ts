import { neutralFrameInput, type Difficulty, type FighterId, type PlayerFrameInput } from '../sim/types';
import type { FighterRuntime } from '../sim/FighterRuntime';
import type { PickupInstance } from '../sim/Pickups';
import { Rng } from '../sim/rng';
import { AI_REACTION_MS, SIM_FPS } from '../sim/constants';

interface OpponentSnapshot {
  frame: number;
  x: number;
  facing: 1 | -1;
  state: string;
  moveId: string | null;
  health: number;
}

type Intent = 'approach' | 'retreat' | 'poke' | 'heavy' | 'special' | 'downSpecial' | 'grab' | 'block' | 'jumpIn' | 'wait' | 'super';

interface TendencyWeights {
  zoning: number; // preference for special/projectile play at range
  rush: number; // preference for closing distance and pressuring
  grabby: number; // preference for going for grabs up close
  defensive: number; // preference for blocking/retreating
}

const TENDENCIES: Record<FighterId, TendencyWeights> = {
  hunter: { zoning: 0.5, rush: 0.6, grabby: 0.35, defensive: 0.35 },
  kevin: { zoning: 0.55, rush: 0.25, grabby: 0.3, defensive: 0.65 },
  al: { zoning: 0.15, rush: 0.75, grabby: 0.6, defensive: 0.25 },
  priya: { zoning: 0.35, rush: 0.7, grabby: 0.3, defensive: 0.3 },
  chad: { zoning: 0.6, rush: 0.2, grabby: 0.35, defensive: 0.55 },
  elon: { zoning: 0.55, rush: 0.5, grabby: 0.35, defensive: 0.4 },
};

function reactionFramesFor(difficulty: Difficulty, rng: Rng): number {
  const [minMs, maxMs] = AI_REACTION_MS[difficulty];
  const ms = rng.range(minMs, maxMs);
  return Math.max(1, Math.round((ms / 1000) * SIM_FPS));
}

function mistakeRateFor(difficulty: Difficulty): number {
  if (difficulty === 'easy') return 0.32;
  if (difficulty === 'normal') return 0.16;
  return 0.07;
}

function aggressionFor(difficulty: Difficulty): number {
  if (difficulty === 'easy') return 0.55;
  if (difficulty === 'normal') return 0.75;
  return 0.95;
}

/**
 * Produces the same normalized PlayerFrameInput a human controller would.
 * Reacts only to a delayed snapshot of the opponent (never the live/raw
 * state) and re-picks a short "intent" periodically rather than every frame,
 * so behavior reads as decisions rather than twitching.
 */
export class AIController {
  private rng: Rng;
  private reactionFrames: number;
  private mistakeRate: number;
  private aggression: number;
  private weights: TendencyWeights;
  private history: OpponentSnapshot[] = [];
  private intent: Intent = 'wait';
  private intentTimer = 0;
  private tapHold: Partial<Record<'basic' | 'special' | 'grab', number>> = {};
  private crunchBonus = false;
  private tendency: FighterId;
  private difficulty: Difficulty;

  constructor(tendency: FighterId, difficulty: Difficulty, seed: number) {
    this.tendency = tendency;
    this.difficulty = difficulty;
    this.rng = new Rng(seed);
    this.reactionFrames = reactionFramesFor(difficulty, this.rng);
    this.mistakeRate = mistakeRateFor(difficulty);
    this.aggression = aggressionFor(difficulty);
    this.weights = TENDENCIES[tendency];
  }

  /** Call once per sim frame with the current frame count and both fighters, before decide(). */
  observe(frame: number, opponent: FighterRuntime): void {
    this.history.push({
      frame,
      x: opponent.x,
      facing: opponent.facing,
      state: opponent.state,
      moveId: opponent.activeMove?.def.id ?? null,
      health: opponent.health,
    });
    const cutoff = frame - this.reactionFrames - 30;
    while (this.history.length > 0 && this.history[0].frame < cutoff) this.history.shift();
    if (opponent.isCrunchMode) this.crunchBonus = true;
  }

  /** Call once per sim frame to get this frame's normalized input for the CPU fighter. */
  decide(frame: number, self: FighterRuntime): PlayerFrameInput {
    const out = neutralFrameInput();
    const snap = this.delayedSnapshot(frame);
    if (!snap) return out;

    for (const key of Object.keys(this.tapHold) as Array<'basic' | 'special' | 'grab'>) {
      const t = this.tapHold[key];
      if (t !== undefined) {
        if (t > 0) this.tapHold[key] = t - 1;
        else delete this.tapHold[key];
      }
    }

    const distance = Math.abs(self.x - snap.x);
    const facingOpp: 1 | -1 = snap.x >= self.x ? 1 : -1;
    const canAct = self.state === 'idle' || self.state === 'walk' || self.state === 'crouch' || self.state === 'dash';

    const reactionSpeed = this.crunchBonus ? Math.max(1, Math.round(this.reactionFrames * 0.7)) : this.reactionFrames;
    void reactionSpeed;

    // React to an opponent mid-attack: sometimes block/retreat, scaled by difficulty (never a guaranteed/instant block).
    if (snap.state === 'attack' && canAct && this.rng.next() > this.mistakeRate) {
      const reactDefensively = this.rng.chance(0.55 + this.weights.defensive * 0.3);
      if (reactDefensively && distance < 70) {
        this.intent = distance < 34 ? 'block' : 'retreat';
        this.intentTimer = 14;
      }
    }

    if (this.intentTimer <= 0) {
      this.intent = this.pickIntent(self, distance);
      this.intentTimer = Math.round(this.rng.range(10, 26));
    }
    this.intentTimer--;

    this.applyIntent(out, self, facingOpp, distance, canAct);
    return out;
  }

  private delayedSnapshot(frame: number): OpponentSnapshot | null {
    const targetFrame = frame - this.reactionFrames;
    let best: OpponentSnapshot | null = null;
    for (const h of this.history) {
      if (h.frame <= targetFrame) best = h;
      else break;
    }
    return best ?? this.history[0] ?? null;
  }

  private pickIntent(self: FighterRuntime, distance: number): Intent {
    if (self.hype >= 100 && distance < 90 && this.rng.chance(0.5 + this.aggression * 0.3)) return 'super';

    if (distance > 130) {
      if (this.rng.chance(this.weights.zoning * 0.8)) return 'special';
      return 'approach';
    }
    if (distance > 60) {
      const roll = this.rng.next();
      if (roll < this.weights.zoning * 0.35) return 'special';
      if (roll < this.weights.zoning * 0.35 + this.weights.rush * 0.45) return 'approach';
      if (roll < this.weights.zoning * 0.35 + this.weights.rush * 0.45 + 0.15) return 'downSpecial';
      return this.rng.chance(this.aggression) ? 'approach' : 'wait';
    }
    // close range
    const roll = this.rng.next();
    if (roll < this.weights.grabby * 0.4) return 'grab';
    if (roll < this.weights.grabby * 0.4 + 0.3) return 'heavy';
    if (roll < this.weights.grabby * 0.4 + 0.55) return 'poke';
    if (this.rng.chance(this.weights.defensive * 0.4)) return 'block';
    return this.rng.chance(this.aggression) ? 'poke' : 'retreat';
  }

  private applyIntent(out: PlayerFrameInput, self: FighterRuntime, facingOpp: 1 | -1, distance: number, canAct: boolean): void {
    const grounded = self.y >= 0;
    switch (this.intent) {
      case 'approach':
        if (facingOpp === 1) out.right = true;
        else out.left = true;
        if (distance > 150 && grounded && this.rng.chance(0.02)) out.up = true;
        break;
      case 'retreat':
        if (facingOpp === 1) out.left = true;
        else out.right = true;
        break;
      case 'jumpIn':
        if (grounded) out.up = true;
        if (facingOpp === 1) out.right = true;
        else out.left = true;
        break;
      case 'block':
        out.blockHeld = true;
        break;
      case 'poke':
        if (canAct && distance < 55) this.tap(out, 'basic');
        else if (facingOpp === 1) out.right = true;
        else out.left = true;
        break;
      case 'heavy':
        if (canAct && distance < 60) {
          if (facingOpp === 1) out.right = true;
          else out.left = true;
          this.tap(out, 'basic');
        }
        break;
      case 'grab':
        if (canAct && distance < 40) this.tap(out, 'grab');
        else if (facingOpp === 1) out.right = true;
        else out.left = true;
        break;
      case 'special':
        if (canAct) this.tap(out, 'special');
        break;
      case 'downSpecial':
        if (canAct) {
          out.down = true;
          this.tap(out, 'special');
        }
        break;
      case 'super':
        if (canAct) {
          this.tap(out, 'basic');
          this.tap(out, 'special');
        }
        break;
      case 'wait':
      default:
        break;
    }
  }

  private tap(out: PlayerFrameInput, action: 'basic' | 'special' | 'grab'): void {
    if (this.tapHold[action] !== undefined) return;
    this.tapHold[action] = 3;
    if (action === 'basic') {
      out.basicHeld = true;
      out.basicPressed = true;
    } else if (action === 'special') {
      out.specialHeld = true;
      out.specialPressed = true;
    } else {
      out.grabHeld = true;
      out.grabPressed = true;
    }
  }
}
