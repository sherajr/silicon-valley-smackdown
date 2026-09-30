/**
 * Player-facing move descriptions, generated from the same definitions the simulation runs. Frame data and inputs
 * shown in help and training can therefore never disagree with the game. Pure data: no DOM.
 */
import { FIGHTERS } from './fighterDefinitions';
import type { ComboInfo, MoveDef, MoveId } from './moveDefinitions';

export interface MoveRow {
  id: MoveId;
  name: string;
  /** P1 key names. Arrows are relative to the way the fighter faces; "(air)" needs the fighter airborne. */
  input: string;
  group: 'Normal' | 'Aerial' | 'Special' | 'Grab and throws';
  startup: number;
  active: number;
  /** Frames between the last active frame and being able to act. */
  endlag: number;
  damage: string;
  note: string;
}

const INPUT: Record<MoveId, string> = {
  jab1: 'V', jab2: 'V, V', jab3: 'V, V, V', heavy: '→ + V', upper: '↑ + V', sweep: '↓ + V',
  nair: 'V (air)', fair: '→ + V (air)', bair: '← + V (air)', uair: '↑ + V (air)', dair: '↓ + V (air)',
  special: 'B', recovery: '↑ + B', down: '↓ + B',
  grab: 'M', pummel: 'V (while holding)', fthrow: 'M (while holding)', bthrow: '← + M (while holding)', uthrow: '↑ + M (while holding)', dthrow: '↓ + M (while holding)',
};
const GROUP: Record<MoveId, MoveRow['group']> = {
  jab1: 'Normal', jab2: 'Normal', jab3: 'Normal', heavy: 'Normal', upper: 'Normal', sweep: 'Normal',
  nair: 'Aerial', fair: 'Aerial', bair: 'Aerial', uair: 'Aerial', dair: 'Aerial',
  special: 'Special', recovery: 'Special', down: 'Special',
  grab: 'Grab and throws', pummel: 'Grab and throws', fthrow: 'Grab and throws', bthrow: 'Grab and throws', uthrow: 'Grab and throws', dthrow: 'Grab and throws',
};
export const MOVE_ORDER = Object.keys(INPUT) as MoveId[];

const damageOf = (m: MoveDef): string => {
  if (m.projectile) return String(m.projectile.damage);
  if (m.counter) return `${m.counter.damage} (counter)`;
  if (m.throwing) return String(m.throwing.damage);
  if (m.pummel) return String(m.pummel);
  if (m.hits.length) return m.hits.map(h => h.damage).join('+');
  return '-';
};

const noteOf = (m: MoveDef): string => {
  const parts: string[] = [];
  if (m.kind === 'counter') parts.push(`counter window f${m.counter!.from}-${m.counter!.to}; loses to grabs`);
  if (m.kind === 'dash') parts.push('fast dash; cancels into jab, heavy or grab');
  if (m.kind === 'slam') parts.push(m.dive ? 'dives to the nearest surface, impact on landing' : 'ground impact');
  if (m.armor) parts.push(`armor f${m.armor.from}-${m.armor.to}; loses to grabs and hits over ${m.armor.limit}%`);
  if (m.recovery) parts.push(m.landing ? `long landing lag (${m.landing}f) after use` : 'one per airborne sequence');
  if (m.cancels?.some(c => c.into === 'jump')) parts.push('jump-cancel on hit');
  if (m.cancels?.some(c => c.on === 'hit' && c.into !== 'jump')) parts.push('on-hit cancel');
  if (m.landing && !m.recovery) parts.push(`${m.landing}f landing lag`);
  if (m.projectile) parts.push(m.projectile.accel ? 'slow start, accelerates' : m.projectile.gravity > 0.002 ? 'lobbed arc, bounces once' : 'straight shot');
  if (m.grab) parts.push(`reach ${m.grab.box.x1.toFixed(2)}`);
  return parts.join('; ');
};

export function describeMoves(character: number): MoveRow[] {
  const f = FIGHTERS[character];
  return MOVE_ORDER.map(id => {
    const m = f.moves[id];
    const last = m.throwing ? m.throwing.release : m.start + m.active - 1;
    const pummelGap = m.pummel ? 3 : 0;
    return { id, name: m.name, input: INPUT[id], group: GROUP[id], startup: m.start + pummelGap, active: m.active, endlag: Math.max(0, m.duration - last - 1), damage: damageOf(m), note: noteOf(m) };
  });
}

export const describeCombos = (character: number): ComboInfo[] => FIGHTERS[character].combos;

/** "0-40%, 0-10% if they hold away" from a combo's verified limits. */
export function describeBand(c: ComboInfo): string {
  if (!c.limits) return '';
  const cap = (n: number) => (n >= 100 ? 'any %' : `0-${n}%`);
  if (c.limits.none >= 150) return 'any %';
  const away = c.limits.away < 0 ? 'escapes DI away' : c.limits.away >= c.limits.none ? 'DI does not help' : `${cap(c.limits.away)} vs DI away`;
  return `${cap(c.limits.none)}, ${away}`;
}

/** The P1/P2 key names shown in the throw hint. */
export const THROW_HINT = { p1: 'M + direction: throw · V: pummel · tap M when grabbed to tech', p2: '; + direction: throw · J: pummel · tap ; when grabbed to tech' };
