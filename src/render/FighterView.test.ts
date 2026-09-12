import { describe, expect, it, vi } from 'vitest';

// FighterView.ts imports the real 'phaser' package, which throws ("window is not defined")
// on plain import in this project's node Vitest environment. Mocking it out is the same
// approach Codex's own source-review probe used to exercise this file's real logic in Node.
vi.mock('phaser', () => ({
  default: { TintModes: { FILL: 1, MULTIPLY: 0 } },
}));

import { FighterView, type FighterImpact } from './FighterView';
import { SIM_FPS } from '../sim/constants';
import type { FighterRuntime } from '../sim/FighterRuntime';

const MS_PER_TICK = 1000 / SIM_FPS;
const HITSTUN_SNAP_MS = 120;

function noImpact(): FighterImpact {
  return { hit: false, blocked: false, blockedCrouching: false };
}

/** Builds a FighterView without ever calling its real constructor (which needs a live Phaser
 * Scene to create sprites/textures) -- same technique as Codex's probe.cjs. update()'s own body
 * only ever touches the handful of sprite/shadow methods stubbed below. */
// Deliberately does NOT redeclare setFrame/playAnim here: FighterView already declares them
// (privately), and intersecting a type with a same-named member collapses to `never` regardless
// of visibility. They're overridden at runtime below, through an unrelated cast, instead.
type TestableFighterView = FighterView & { selectedFrame: string };

function makeView(): TestableFighterView {
  const view = Object.create(FighterView.prototype) as TestableFighterView;
  const noop = () => {};
  Object.assign(view, {
    selectedFrame: '',
    flashMs: 0,
    paletteTint: null,
    lastState: null,
    lastSimFrame: -1,
    stateElapsedTicks: 0,
    blockImpactTicks: -1,
    blockImpactCrouching: false,
    sprite: {
      setFlipX: noop,
      setTint: noop,
      setTintMode: noop,
      clearTint: noop,
      anims: { stop: noop },
      setTexture: noop,
      play: noop,
    },
    shadow: { setScale: noop, setAlpha: noop },
    visuals: {
      idleAnim: 'idle',
      walkAnim: 'walk',
      dashAnim: 'dash',
      victoryAnim: 'victory',
      jumpFrames: ['rise', 'apex', 'fall'],
      crouchFrames: ['crouch0', 'crouch1'],
      blockFrames: ['block0', 'block1'],
      hitstunFrames: ['hitstun0', 'hitstun1'],
      knockdownFrames: ['down0', 'down1'],
      wakeupFrames: ['wake0', 'wake1'],
      koFrames: ['ko0'],
      moveFrames: {},
      portraitFrame: 'portrait',
    },
  });
  const overrides = view as unknown as { setFrame: (key: string) => void; playAnim: (key: string) => void };
  overrides.setFrame = (key: string) => {
    view.selectedFrame = key;
  };
  overrides.playAnim = (key: string) => {
    view.selectedFrame = key;
  };
  return view;
}

function fighter(overrides: Partial<FighterRuntime>): FighterRuntime {
  return { state: 'idle', facing: 1, x: 0, y: 0, vy: 0, blocking: false, activeMove: null, ...overrides } as unknown as FighterRuntime;
}

describe('FighterView reaction routing (regression: confirmed broken by the Codex review)', () => {
  it('a real block selects the standing guard-impact frame, not the pre-existing block stance', () => {
    const view = makeView();
    const f = fighter({ state: 'blockstun' });
    view.update(f, 0, { hit: false, blocked: true, blockedCrouching: false }, 16.67, 10);
    expect(view.selectedFrame).toBe('block1');
  });

  it('a crouching block selects the crouch guard-impact frame', () => {
    const view = makeView();
    const f = fighter({ state: 'blockstun' });
    view.update(f, 0, { hit: false, blocked: true, blockedCrouching: true }, 16.67, 10);
    expect(view.selectedFrame).toBe('crouch1');
  });

  it('guard break renders as a stagger (hitstun frames), not the calm guard pose', () => {
    const view = makeView();
    const f = fighter({ state: 'guardbreak' });
    view.update(f, 0, noImpact(), 16.67, 10);
    expect(view.selectedFrame).toBe('hitstun0');
  });

  it('nine hit-stop-frozen render ticks (unchanged sim frame count) do not age the hitstun snap', () => {
    const view = makeView();
    const f = fighter({ state: 'hitstun' });

    view.update(f, 0, { hit: true, blocked: false, blockedCrouching: false }, 16.67, 100);
    expect(view.selectedFrame).toBe('hitstun0');

    // Real hit-stop: CombatSim.frameCount does not advance, but renderFrame() still runs every
    // display frame with real wall-clock delta -- exactly what the bug let leak into the pose.
    for (let i = 0; i < 9; i++) {
      view.update(f, 0, noImpact(), 16.67, 100); // simFrameCount unchanged: frozen
    }
    expect(view.selectedFrame).toBe('hitstun0');
  });

  it('a repeated hit while still in hitstun restarts the snap instead of continuing the old reaction', () => {
    const view = makeView();
    const f = fighter({ state: 'hitstun' });

    view.update(f, 0, { hit: true, blocked: false, blockedCrouching: false }, 16.67, 100);
    const ticksToCrossSnapThreshold = Math.ceil(HITSTUN_SNAP_MS / MS_PER_TICK) + 1;
    for (let i = 1; i <= ticksToCrossSnapThreshold; i++) {
      view.update(f, 0, noImpact(), 16.67, 100 + i); // real sim ticks advancing, no freeze
    }
    expect(view.selectedFrame).toBe('hitstun1'); // settled into the daze-hold pose

    // A second attack lands while still in 'hitstun' (state name unchanged) -- must re-snap.
    view.update(f, 0, { hit: true, blocked: false, blockedCrouching: false }, 16.67, 200);
    expect(view.selectedFrame).toBe('hitstun0');
  });
});
