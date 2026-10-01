import { HUNTER } from '../data/characters/hunter';
import { KEVIN } from '../data/characters/kevin';
import { AL } from '../data/characters/al';
import { PRIYA } from '../data/characters/priya';
import { CHAD } from '../data/characters/chad';
import { ELON } from '../data/characters/elon';
import { FIGHTERS } from './fighterDefinitions';

// The original roster remains the source of names, palettes, quips, and signature attacks.
export const ROSTER = [HUNTER, KEVIN, AL, PRIYA, CHAD, ELON];
export const STAGE_NAMES = ['Castro Street', 'Sand Hill Road', 'Palo Alto'];
export const STAGE_TAGS = ['COFFEE CLASH', 'HOSTILE TAKEOVER', 'LAUNCH NIGHT'];
export const ACCENTS = ['#53ead4', '#ffa960', '#ae96ff'];
/** One short playstyle label per fighter, for the selection cards. */
export const ROLES = ['RUSHDOWN', 'ZONER', 'GRAPPLER', 'SPEEDSTER', 'CONTROL', 'HEAVY'];
export const FIGHTER_ACCENTS = ['#57ebd6', '#70adff', '#ff9470', '#cf96ff', '#efcd6b', '#f280a3'];
// Derived from the typed fighter definitions, which are the single source of truth for gameplay numbers.
export const SPECIAL_NAMES = FIGHTERS.map(f => f.moves.special.name);
export const RECOVERY_NAMES = FIGHTERS.map(f => f.moves.recovery.name);
export const MOVE_SPEED = FIGHTERS.map(f => f.walk);
export const WEIGHT = FIGHTERS.map(f => f.weight);

/**
 * A walkable top surface. `x`, `y`, `w` describe the top (centre, height, width). Collision and rendering read the
 * same record. Solid platforms are blocks: top, both sides and underside all collide, and their body reaches
 * `thickness` below the top. One-way platforms only catch a fighter who is falling onto them from above.
 */
export interface Platform {
  id: string;
  x: number; y: number; w: number;
  solid: boolean;
  thickness: number;
  /** The top corners of this platform can be grabbed. Only meaningful for solid platforms. */
  ledges: boolean;
}
const main = (): Platform => ({ id: 'main', x: 0, y: 0, w: 19, solid: true, thickness: 1.06, ledges: true });
const upper = (id: string, x: number, y: number, w: number): Platform => ({ id, x, y, w, solid: false, thickness: 0.34, ledges: false });
export const STAGE_PLATFORMS: Platform[][] = [
  [main(), upper('left', -5, 3.4, 4.7), upper('right', 5, 3.4, 4.7), upper('top', 0, 6.25, 4.3)],
  [main(), upper('left', -5.4, 3.25, 4), upper('top', 0, 6.1, 4.3), upper('right', 5.4, 3.25, 4)],
  [main(), upper('left', -5.4, 3.6, 4.5), upper('right', 5.4, 3.6, 4.5)],
];
