import { describe, expect, it } from 'vitest';
import { buildLadder } from './ArcadeLadder';
import { REGULAR_FIGHTER_IDS } from '../sim/types';
import type { FighterId } from '../sim/types';

describe('buildLadder', () => {
  it('always ends with Elon as the fifth match', () => {
    for (const id of [...REGULAR_FIGHTER_IDS]) {
      const ladder = buildLadder(id);
      expect(ladder.length).toBe(5);
      expect(ladder[4].opponent).toBe('elon');
    }
  });

  it('never contains a duplicate or self-match opponent', () => {
    for (const id of [...REGULAR_FIGHTER_IDS] as FighterId[]) {
      const ladder = buildLadder(id);
      const opponents = ladder.map((l) => l.opponent);
      expect(opponents.includes(id)).toBe(false);
      expect(new Set(opponents).size).toBe(opponents.length);
    }
  });

  it("matches Hunter's authored campaign order", () => {
    const ladder = buildLadder('hunter');
    expect(ladder.map((l) => l.opponent)).toEqual(['al', 'priya', 'kevin', 'chad', 'elon']);
  });
});
