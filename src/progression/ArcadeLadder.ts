import { REGULAR_FIGHTER_IDS } from '../sim/types';
import type { FighterId, StageId } from '../sim/types';

export interface LadderStop {
  opponent: FighterId;
  stage: StageId;
}

const HUNTER_LADDER: LadderStop[] = [
  { opponent: 'al', stage: 'castro_street' },
  { opponent: 'priya', stage: 'castro_street' },
  { opponent: 'kevin', stage: 'sand_hill_road' },
  { opponent: 'chad', stage: 'sand_hill_road' },
  { opponent: 'elon', stage: 'palo_alto' },
];

/**
 * Builds a five-match arcade ladder for the given fighter: Hunter's is the
 * authored campaign order; every other regular fighter gets a generated
 * ladder covering the other four regulars (no duplicates, no self-match),
 * always finishing against Elon.
 */
export function buildLadder(fighter: FighterId): LadderStop[] {
  if (fighter === 'hunter') return HUNTER_LADDER;
  const others = REGULAR_FIGHTER_IDS.filter((id) => id !== fighter);
  return [
    { opponent: others[0], stage: 'castro_street' },
    { opponent: others[1], stage: 'castro_street' },
    { opponent: others[2], stage: 'sand_hill_road' },
    { opponent: others[3], stage: 'sand_hill_road' },
    { opponent: 'elon', stage: 'palo_alto' },
  ];
}
