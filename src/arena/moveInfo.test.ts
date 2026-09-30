import { describe, it, expect } from 'vitest';
import { FIGHTERS } from './fighterDefinitions';
import { MOVE_ORDER, describeBand, describeCombos, describeMoves } from './moveInfo';
import { MOVE_IDS } from './moveDefinitions';

describe('move descriptions come from the simulation data', () => {
  it('lists every move slot for every fighter', () => {
    expect([...MOVE_ORDER].sort()).toEqual([...MOVE_IDS].sort());
    for (let c = 0; c < 6; c++) expect(describeMoves(c)).toHaveLength(MOVE_IDS.length);
  });
  it('frame data matches the definitions exactly', () => {
    for (let c = 0; c < 6; c++) for (const row of describeMoves(c)) {
      const m = FIGHTERS[c].moves[row.id];
      if (row.id === 'pummel') continue;
      expect(row.startup, `${FIGHTERS[c].id}.${row.id}`).toBe(m.start);
      expect(row.active).toBe(m.active);
      expect(row.startup + row.active + row.endlag).toBeLessThanOrEqual(m.duration + 1);
    }
  });
  it('names, damage and inputs are present and fighter-specific', () => {
    const hunter = describeMoves(0), kevin = describeMoves(1);
    expect(hunter.find(r => r.id === 'down')!.note).toContain('dives');
    expect(kevin.find(r => r.id === 'down')!.note).toContain('counter');
    expect(kevin.find(r => r.id === 'down')!.damage).toContain('counter');
    expect(hunter.find(r => r.id === 'grab')!.input).toBe('M');
    expect(describeMoves(5).find(r => r.id === 'recovery')!.note).toContain('landing lag');
    expect(describeMoves(4).find(r => r.id === 'heavy')!.note).toContain('armor');
    expect(describeMoves(3).find(r => r.id === 'down')!.note).toContain('dash');
    for (const row of hunter) { expect(row.name.length).toBeGreaterThan(2); expect(row.input.length).toBeGreaterThan(0); }
  });
  it('marks routes as true combos, pressure or reads, and shows their inputs', () => {
    for (let c = 0; c < 6; c++) {
      const combos = describeCombos(c);
      expect(combos.some(x => x.kind === 'true')).toBe(true); expect(combos.some(x => x.kind !== 'true')).toBe(true);
      for (const x of combos) { expect(x.inputs.length).toBeGreaterThan(0); expect(x.note.length).toBeGreaterThan(10); }
    }
  });
  it('turns verified limits into readable bands', () => {
    const [jab, route] = describeCombos(0);
    expect(describeBand(jab)).toBe('any %');
    expect(describeBand(route)).toBe('0-40%, 0-10% vs DI away');
    expect(describeBand(describeCombos(4)[1])).toBe('any %, DI does not help');
    expect(describeBand(describeCombos(0)[2])).toBe('');
  });
});
