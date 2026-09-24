import { describe, it, expect } from 'vitest';
import { simToWorldX, simToWorldY, simLengthToWorld, WORLD_UNITS_PER_PX } from './coordinates';
import { BASE_WIDTH } from '../sim/constants';

describe('sim-to-world coordinate conversion', () => {
  it('centers the arena horizontally at world x=0', () => {
    expect(simToWorldX(BASE_WIDTH / 2)).toBeCloseTo(0);
  });

  it('maps the left/right walls symmetrically around 0', () => {
    expect(simToWorldX(0)).toBeCloseTo(-simToWorldX(BASE_WIDTH));
  });

  it('grounded (y=0) maps to world y=0', () => {
    expect(simToWorldY(0)).toBeCloseTo(0);
  });

  it('airborne (negative sim y) maps to positive world y -- up is up', () => {
    expect(simToWorldY(-100)).toBeCloseTo(100 * WORLD_UNITS_PER_PX);
    expect(simToWorldY(-100)).toBeGreaterThan(0);
  });

  it('scales lengths by the same factor as positions', () => {
    expect(simLengthToWorld(64)).toBeCloseTo(64 * WORLD_UNITS_PER_PX);
  });
});
