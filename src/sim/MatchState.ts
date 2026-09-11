import { CombatSim } from './CombatSim';
import { ROUNDS_TO_WIN } from './constants';
import { Rng } from './rng';
import type { SimEvent, PlayerSlot } from './events';
import type { CharacterDef, PlayerFrameInput } from './types';
import type { StageId, Difficulty } from './types';

export interface MatchRules {
  stage: StageId;
  powerupsEnabled: boolean;
  difficulty?: Difficulty;
}

/**
 * Wraps CombatSim with best-of-N round bookkeeping. A draw repeats the
 * current round without awarding a win to either side.
 */
export class MatchState {
  sim: CombatSim;
  scoreP1 = 0;
  scoreP2 = 0;
  roundNumber = 1;
  matchWinner: PlayerSlot | null = null;
  rules: MatchRules;
  private seedBase: number;
  private roundSeedOffset = 0;

  constructor(p1Def: CharacterDef, p2Def: CharacterDef, rules: MatchRules, seed: number) {
    this.rules = rules;
    this.seedBase = seed;
    this.sim = new CombatSim({ p1Def, p2Def, powerupsEnabled: rules.powerupsEnabled, seed: seed + this.roundSeedOffset });
  }

  step(p1In: PlayerFrameInput, p2In: PlayerFrameInput): SimEvent[] {
    const wasEnded = this.sim.ended;
    const events = this.sim.step(p1In, p2In);
    if (!wasEnded && this.sim.ended && this.sim.result) {
      this.applyRoundResult();
    }
    return events;
  }

  private applyRoundResult(): void {
    const result = this.sim.result!;
    if (result.reason !== 'draw') {
      if (result.winner === 'p1') this.scoreP1++;
      else if (result.winner === 'p2') this.scoreP2++;
      this.roundNumber++;
    }
    if (this.scoreP1 >= ROUNDS_TO_WIN) this.matchWinner = 'p1';
    else if (this.scoreP2 >= ROUNDS_TO_WIN) this.matchWinner = 'p2';
  }

  isRoundDraw(): boolean {
    return this.sim.ended && this.sim.result?.reason === 'draw';
  }

  isMatchOver(): boolean {
    return this.matchWinner !== null;
  }

  /** Starts the next round (or a repeat of a drawn round). Resets all transient combat state. */
  startNextRound(): void {
    this.roundSeedOffset++;
    this.sim.rng = new Rng(this.seedBase + this.roundSeedOffset);
    this.sim.resetRound();
  }

  resetMatch(): void {
    this.scoreP1 = 0;
    this.scoreP2 = 0;
    this.roundNumber = 1;
    this.matchWinner = null;
    this.roundSeedOffset = 0;
    this.sim.resetRound();
  }
}
