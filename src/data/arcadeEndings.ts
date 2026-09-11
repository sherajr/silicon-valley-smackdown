import type { FighterId } from '../sim/types';

export const ARCADE_ENDINGS: Record<FighterId, string[]> = {
  hunter: [
    'Hunter walks out of Palo Alto Launch Night with a signed term sheet and a cracked phone screen.',
    'The Last Funding Round is closed. Hunter\'s startup, "Disrupt-o-Matic," ships a product nobody asked for -- and somehow it works.',
    'Six months later, at a much smaller coffee shop, Hunter is already pitching the next thing.',
  ],
  kevin: [
    'Kevin wins the fight and immediately bills the Valley for his time.',
    'His firm opens a new practice area: Combat Law. The retainer is steep, but so is the win rate.',
    'Somewhere, a term sheet gets three new footnotes.',
  ],
  al: [
    'Al raises a glass to absolutely nobody in particular and wanders off into the night.',
    'He never did remember winning the tournament. Everyone else remembers it very well.',
    'Same bar, same time, tomorrow.',
  ],
  priya: [
    'Priya adds "Undefeated Combat Champion" to her own resume before anyone else\'s.',
    'She has already scheduled a follow-up call with Elon\'s former staff. Five minutes, tops.',
    'Somewhere, a LinkedIn notification goes off.',
  ],
  chad: [
    'Chad closes the tournament the way he closes everything: mostly by watching other people work.',
    '"Great execution," he says, to no one who did any of the execution.',
    'He is already drafting the term sheet for a rematch.',
  ],
  elon: [
    'Elon wins his own tournament, which he insists was the plan all along.',
    'The roadmap updates itself. Victory ships, eventually, on schedule this time.',
    'Somewhere, a rocket lands upright, and everyone agrees to be impressed.',
  ],
};

export const CREDITS_PARODY_NOTE =
  'Elon and every other character in this game are fictional, exaggerated arcade caricatures created for comic effect. ' +
  'Any resemblance to real people or companies is parody, not depiction.';
