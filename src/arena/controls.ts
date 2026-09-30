/** One fighter's input for one simulation tick. Buttons are "held this tick"; the simulation detects fresh presses itself. */
export interface Controls { x: number; up: boolean; down: boolean; jump: boolean; attack: boolean; special: boolean; shield: boolean; grab: boolean }
export const noInput = (): Controls => ({ x: 0, up: false, down: false, jump: false, attack: false, special: false, shield: false, grab: false });
