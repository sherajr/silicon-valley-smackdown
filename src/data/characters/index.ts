import { HUNTER } from './hunter';
import { KEVIN } from './kevin';
import { AL } from './al';
import { PRIYA } from './priya';
import { CHAD } from './chad';
import { MAUL } from './maul';
import { ELON, ELON_BOSS } from './elon';
import type { CharacterDef, FighterId } from '../../sim/types';

export { HUNTER, KEVIN, AL, PRIYA, CHAD, MAUL, ELON, ELON_BOSS };

/** Playable roster (versus/training character select). Elon appears here once unlocked. */
export const CHARACTERS: Record<FighterId, CharacterDef> = {
  hunter: HUNTER,
  kevin: KEVIN,
  al: AL,
  priya: PRIYA,
  chad: CHAD,
  maul: MAUL,
  elon: ELON,
};

export function getCharacter(id: FighterId): CharacterDef {
  return CHARACTERS[id];
}
