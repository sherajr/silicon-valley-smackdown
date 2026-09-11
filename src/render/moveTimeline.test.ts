import { describe, expect, it } from 'vitest';
import { poseIndexForMove } from './moveTimeline';
import { HUNTER } from '../data/characters/hunter';

describe('poseIndexForMove', () => {
  it('holds anticipation (index 0) for the entire startup window, before any hit is active', () => {
    const def = HUNTER.moves.basic1; // startup 4, hits: [window(4,3,...)]
    for (let frame = 0; frame < 4; frame++) {
      expect(poseIndexForMove({ frame, def }, 2)).toBe(0);
    }
  });

  it('switches to the contact pose exactly when the hit window becomes active, not at a fraction of total duration', () => {
    const def = HUNTER.moves.basic1; // active frames [4, 7)
    expect(poseIndexForMove({ frame: 3, def }, 2)).toBe(0);
    expect(poseIndexForMove({ frame: 4, def }, 2)).toBe(1);
    expect(poseIndexForMove({ frame: 11, def }, 2)).toBe(1); // still recovering, still shows the post-anticipation pose
  });

  it('with three poses, shows anticipation, then contact strictly during the active window, then recovery for the rest', () => {
    const def = HUNTER.moves.forwardBasic; // startup 10, active [10, 14)
    expect(poseIndexForMove({ frame: 0, def }, 3)).toBe(0);
    expect(poseIndexForMove({ frame: 9, def }, 3)).toBe(0);
    expect(poseIndexForMove({ frame: 10, def }, 3)).toBe(1);
    expect(poseIndexForMove({ frame: 13, def }, 3)).toBe(1);
    expect(poseIndexForMove({ frame: 14, def }, 3)).toBe(2); // recovery: still committed, no longer mid-swing
    expect(poseIndexForMove({ frame: def.totalFrames - 1, def }, 3)).toBe(2);
  });

  it('spreads multiple mid poses across a Super with several hit windows, in frame order', () => {
    const def = HUNTER.moves.super; // hits at startupFrame 22, 30, 38, 46 (this test's 5-pose layout: windup, wind, release, recover, finisher)
    const first = poseIndexForMove({ frame: 22, def }, 5);
    const middle = poseIndexForMove({ frame: 38, def }, 5);
    const last = poseIndexForMove({ frame: def.totalFrames - 1, def }, 5);
    expect(first).toBe(1);
    expect(middle).toBeGreaterThanOrEqual(first);
    expect(middle).toBeLessThanOrEqual(3);
    expect(last).toBe(4);
  });

  it('releases a projectile move\'s contact pose at its release frame rather than an arbitrary time split', () => {
    const def = HUNTER.moves.special; // no `hits`, has a projectile with releaseFrame defaulting to startup (12)
    const releaseFrame = def.projectile!.releaseFrame ?? def.startup;
    expect(poseIndexForMove({ frame: releaseFrame - 1, def }, 3)).toBe(0);
    expect(poseIndexForMove({ frame: releaseFrame, def }, 3)).toBe(1);
  });

  it('always returns index 0 for a single-pose move regardless of frame', () => {
    const def = HUNTER.moves.basic1;
    expect(poseIndexForMove({ frame: 0, def }, 1)).toBe(0);
    expect(poseIndexForMove({ frame: def.totalFrames - 1, def }, 1)).toBe(0);
  });
});
