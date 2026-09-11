// Default key bindings, expressed as physical KeyboardEvent.code values so
// Numpad4/Digit4/Equal etc. are distinguished per MDN's KeyboardEvent.code
// reference: https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code

export type BindableAction = 'moveLeft' | 'moveRight' | 'up' | 'down' | 'basic' | 'special' | 'block' | 'grab';

export const BINDABLE_ACTIONS: BindableAction[] = [
  'moveLeft',
  'moveRight',
  'up',
  'down',
  'basic',
  'special',
  'block',
  'grab',
];

export type PlayerSlot = 'p1' | 'p2';

/** action -> list of physical codes that trigger it, first entry is the "main" one shown in short UI. */
export type PlayerBindings = Record<BindableAction, string[]>;

export function clonePlayerBindings(b: PlayerBindings): PlayerBindings {
  const out = {} as PlayerBindings;
  for (const a of BINDABLE_ACTIONS) out[a] = [...b[a]];
  return out;
}

export const DEFAULT_P1_BINDINGS: PlayerBindings = {
  moveLeft: ['KeyA'],
  moveRight: ['KeyD'],
  up: ['KeyW'],
  down: ['KeyS'],
  basic: ['KeyV'],
  special: ['KeyB'],
  block: ['KeyN'],
  grab: ['KeyM'],
};

/** Numpad layout: 4/5/6/+ with top-row 4/5/6 and the physical =/+ key as defaults. */
export const DEFAULT_P2_BINDINGS: PlayerBindings = {
  moveLeft: ['ArrowLeft'],
  moveRight: ['ArrowRight'],
  up: ['ArrowUp'],
  down: ['ArrowDown'],
  basic: ['Numpad4', 'Digit4'],
  special: ['Numpad5', 'Digit5'],
  block: ['Numpad6', 'Digit6'],
  grab: ['NumpadAdd', 'Equal'],
};

/** Laptop preset: arrows + J/K/L/; for players without a numpad. */
export const LAPTOP_P2_BINDINGS: PlayerBindings = {
  moveLeft: ['ArrowLeft'],
  moveRight: ['ArrowRight'],
  up: ['ArrowUp'],
  down: ['ArrowDown'],
  basic: ['KeyJ'],
  special: ['KeyK'],
  block: ['KeyL'],
  grab: ['Semicolon'],
};

export const PAUSE_CODE = 'Escape';

const LABEL_OVERRIDES: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  NumpadAdd: 'Numpad +',
  Numpad4: 'Numpad 4',
  Numpad5: 'Numpad 5',
  Numpad6: 'Numpad 6',
  Digit4: '4',
  Digit5: '5',
  Digit6: '6',
  Equal: '=/+',
  Semicolon: ';',
  Escape: 'Esc',
  Space: 'Space',
};

/** Human-readable label for a physical key code, without assuming a US legend. */
export function labelForCode(code: string): string {
  if (LABEL_OVERRIDES[code]) return LABEL_OVERRIDES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

export function labelForBinding(codes: string[]): string {
  return codes.map(labelForCode).join(' / ');
}

/** Codes that must never be assigned to combat actions (reserved for pause/back). */
export const RESERVED_CODES = new Set(['Escape']);

export interface BindingConflict {
  player: PlayerSlot;
  action: BindableAction;
  code: string;
}

/** Finds any existing bindings (on either player) that already use `code`, excluding the given action. */
export function findConflicts(
  code: string,
  p1: PlayerBindings,
  p2: PlayerBindings,
  exclude: { player: PlayerSlot; action: BindableAction },
): BindingConflict[] {
  const conflicts: BindingConflict[] = [];
  const scan = (player: PlayerSlot, bindings: PlayerBindings) => {
    for (const action of BINDABLE_ACTIONS) {
      if (player === exclude.player && action === exclude.action) continue;
      if (bindings[action].includes(code)) conflicts.push({ player, action, code });
    }
  };
  scan('p1', p1);
  scan('p2', p2);
  return conflicts;
}
