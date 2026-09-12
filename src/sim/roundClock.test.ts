import { describe, expect, it } from 'vitest';
import { CombatSim } from './CombatSim';
import { MatchState } from './MatchState';
import { SIM_FPS, ROUND_TIME_FRAMES } from './constants';
import { formatRoundClock } from './roundClock';
import { isHitWindowActive } from './moveTiming';
import { HUNTER } from '../data/characters/hunter';
import { CHARACTERS } from '../data/characters';
import { neutralFrameInput } from './types';

const input = neutralFrameInput();
function fresh() { return new CombatSim({p1Def: HUNTER, p2Def: HUNTER, seed: 1, powerupsEnabled: false}); }
describe('eight minute round clock', () => {
  it('ends on exactly tick 28,800, including impact freezes', () => {
    const sim = fresh();
    expect(SIM_FPS).toBe(60);
    expect(sim.clockFrames).toBe(28800);
    sim.freezeFrames = 12;
    for (let i = 0; i < 28799; i++) sim.step(input, input);
    expect(sim.clockFrames).toBe(1);
    expect(sim.ended).toBe(false);
    sim.step(input, input);
    expect(sim.clockFrames).toBe(0);
    expect(sim.result).toEqual({winner: 'draw', reason: 'draw'});
    const frame = sim.frameCount;
    expect(sim.step(input, input)).toEqual([]);
    expect(sim.frameCount).toBe(frame);
    expect(sim.clockFrames).toBe(0);
  });
  it('awards timeout once and resets the next round to eight minutes', () => {
    const match = new MatchState(HUNTER, HUNTER, {stage: 'castro_street',powerupsEnabled: false}, 1);
    match.sim.p2.health = 100;
    match.sim.clockFrames = 1;
    match.sim.freezeFrames = 3;
    expect(match.step(input, input)).toContainEqual({type: 'roundTimeout'});
    expect(match.sim.result).toEqual({winner:'p1',reason:'timeout'});
    match.step(input, input);
    expect(match.scoreP1).toBe(1);
    match.startNextRound();
    expect(match.sim.clockFrames).toBe(ROUND_TIME_FRAMES);
    expect(match.sim.ended).toBe(false);
  });
  it.each([[28800,'8:00'],[28799,'8:00'],[28740,'7:59'],[3600,'1:00'],[3540,'0:59'],[1,'0:01'],[0,'0:00'],[-1,'0:00']])('formats %i frames as %s', (frames, text) => {
    expect(formatRoundClock(frames)).toBe(text);
  });
});
describe('authored move frame boundaries', () => {
  for (const character of Object.values(CHARACTERS)) {
    for (const move of Object.values(character.moves)) {
      it(character.id + '/' + move.kind + ' uses integral frame windows inside its duration', () => {
        expect(Number.isInteger(move.totalFrames)).toBe(true);
        expect(move.totalFrames).toBeGreaterThan(0);
        for (const hit of move.hits) {
          expect(Number.isInteger(hit.startupFrame)).toBe(true);
          expect(Number.isInteger(hit.activeFrames)).toBe(true);
          expect(hit.activeFrames).toBeGreaterThan(0);
          expect(hit.startupFrame + hit.activeFrames).toBeLessThanOrEqual(move.totalFrames);
          expect(isHitWindowActive(hit, hit.startupFrame - 1)).toBe(false);
          expect(isHitWindowActive(hit, hit.startupFrame)).toBe(true);
          expect(isHitWindowActive(hit, hit.startupFrame + hit.activeFrames - 1)).toBe(true);
          expect(isHitWindowActive(hit, hit.startupFrame + hit.activeFrames)).toBe(false);
        }
      });
    }
  }
});
