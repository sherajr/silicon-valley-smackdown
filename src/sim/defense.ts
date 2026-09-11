import type { AttackHeight } from './types';

export type DefenseOutcome = 'hit' | 'blocked' | 'evaded';

/**
 * Declared-height defense resolution. Standing block stops mid/high/overhead;
 * crouch-block stops mid/low but loses to overhead; crouching (blocking or
 * not) ducks under high strikes entirely (no chip, no stun).
 */
export function resolveDefense(crouching: boolean, airborne: boolean, blocking: boolean, height: AttackHeight): DefenseOutcome {
  if (height === 'unblockable') return 'hit';

  if (height === 'low') {
    if (airborne) return 'evaded';
    if (blocking && crouching) return 'blocked';
    return 'hit';
  }
  if (height === 'high') {
    if (crouching) return 'evaded';
    if (!airborne && blocking) return 'blocked';
    return 'hit';
  }
  if (height === 'mid') {
    if (!airborne && blocking) return 'blocked';
    return 'hit';
  }
  // overhead
  if (crouching) return 'hit'; // crouch-block loses to overhead
  if (!airborne && blocking) return 'blocked';
  return 'hit';
}
