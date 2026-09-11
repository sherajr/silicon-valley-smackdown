import { describe, expect, it } from 'vitest';
import { AIController } from './AIController';
import { CombatSim } from '../sim/CombatSim';
import { HUNTER } from '../data/characters/hunter';
import { AL } from '../data/characters/al';
import { neutralFrameInput } from '../sim/types';

describe('AIController', () => {
  it('never touches inputs before it has any observation history', () => {
    const ai = new AIController('al', 'hard', 7);
    const sim = new CombatSim({ p1Def: HUNTER, p2Def: AL, powerupsEnabled: false, seed: 1 });
    const input = ai.decide(1, sim.p2);
    expect(input.basicPressed).toBe(false);
    expect(input.left || input.right).toBe(false);
  });

  it('drives a CPU fighter through a full match without throwing, and eventually acts', () => {
    const sim = new CombatSim({ p1Def: HUNTER, p2Def: AL, powerupsEnabled: false, seed: 3 });
    sim.p1.state = 'idle';
    sim.p1.stateTimer = 0;
    sim.p2.state = 'idle';
    sim.p2.stateTimer = 0;
    const ai = new AIController('al', 'hard', 99);
    let anyButtonPressed = false;
    let anyMovement = false;
    for (let i = 1; i <= 600; i++) {
      ai.observe(i, sim.p1);
      const p2Input = ai.decide(i, sim.p2);
      if (p2Input.basicPressed || p2Input.specialPressed || p2Input.grabPressed) anyButtonPressed = true;
      if (p2Input.left || p2Input.right) anyMovement = true;
      sim.step(neutralFrameInput(), p2Input);
      if (sim.ended) sim.resetRound();
    }
    expect(anyButtonPressed).toBe(true);
    expect(anyMovement).toBe(true);
  });

  it('reaction delay is longer on easy than on hard on average', () => {
    let easyTotal = 0;
    let hardTotal = 0;
    const trials = 40;
    for (let i = 0; i < trials; i++) {
      const easy = new AIController('kevin', 'easy', 1000 + i) as unknown as { reactionFrames: number };
      const hard = new AIController('kevin', 'hard', 2000 + i) as unknown as { reactionFrames: number };
      easyTotal += easy.reactionFrames;
      hardTotal += hard.reactionFrames;
    }
    expect(easyTotal / trials).toBeGreaterThan(hardTotal / trials);
  });
});
