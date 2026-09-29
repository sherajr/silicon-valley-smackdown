import { HUNTER } from '../data/characters/hunter';
import { KEVIN } from '../data/characters/kevin';
import { AL } from '../data/characters/al';
import { PRIYA } from '../data/characters/priya';
import { CHAD } from '../data/characters/chad';
import { ELON } from '../data/characters/elon';

// The original roster remains the source of names, palettes, quips, and signature attacks.
export const ROSTER = [HUNTER, KEVIN, AL, PRIYA, CHAD, ELON];
export const STAGE_NAMES = ['Castro Street', 'Sand Hill Road', 'Palo Alto'];
export const STAGE_TAGS = ['COFFEE CLASH', 'HOSTILE TAKEOVER', 'LAUNCH NIGHT'];
export const ACCENTS = ['#53ead4', '#ffa960', '#ae96ff'];
export const FIGHTER_ACCENTS = ['#57ebd6', '#70adff', '#ff9470', '#cf96ff', '#efcd6b', '#f280a3'];
export const SPECIAL_NAMES = ['iPad Yeet', 'Briefcase Briefing', 'Bottle Service', 'Résumé Blast', 'Cash Burn', 'Rocket Reply'];
export const RECOVERY_NAMES = ['Elevator Pitch', 'Appeal to the Court', 'Last Call Lift', 'Career Ladder', 'Bridge Funding', 'To the Moon'];
export const MOVE_SPEED = [0.145, 0.127, 0.117, 0.171, 0.124, 0.147];
export const WEIGHT = [1, 1.10, 1.23, 0.88, 1.12, 1.06];
export interface Platform { x: number; y: number; w: number }
export const STAGE_PLATFORMS: Platform[][] = [
  [{ x: 0, y: 0, w: 19 }, { x: -5, y: 3.4, w: 4.7 }, { x: 5, y: 3.4, w: 4.7 }, { x: 0, y: 6.25, w: 4.3 }],
  [{ x: 0, y: 0, w: 19 }, { x: -5.4, y: 3.25, w: 4 }, { x: 0, y: 6.1, w: 4.3 }, { x: 5.4, y: 3.25, w: 4 }],
  [{ x: 0, y: 0, w: 19 }, { x: -5.4, y: 3.6, w: 4.5 }, { x: 5.4, y: 3.6, w: 4.5 }],
];
