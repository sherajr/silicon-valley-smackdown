import { describe, expect, it, vi } from 'vitest';

// FighterView imports the real 'phaser' package, which throws ("window is not defined") on plain
// import in this project's node Vitest environment. Only TintModes is read at runtime by update().
vi.mock('phaser', () => ({
  default: { TintModes: { FILL: 1, MULTIPLY: 0 } },
}));

import { FighterView, neutralImpact, type FighterImpact } from './FighterView';
import { SIM_FPS } from '../sim/constants';
import type { FighterRuntime } from '../sim/FighterRuntime';

const MS_PER_TICK = 1000 / SIM_FPS;
const HITSTUN_SNAP_MS = 120;
const KNOCKDOWN_FALL_MS = 180;
const WAKEUP_STIR_MS = 140;

function hitImpact(): FighterImpact {
  return { hit: true, blocked: false, blockedCrouching: false };
}
function blockImpact(crouching: boolean): FighterImpact {
  return { hit: false, blocked: true, blockedCrouching: crouching };
}

/**
 * Builds a FighterView without calling its real constructor (which needs a live Phaser Scene).
 * update()'s body only touches the handful of sprite/shadow members stubbed here.
 *
 * setFrame/playAnim are deliberately NOT redeclared on the type: FighterView already declares
 * them privately, and intersecting a type with a same-named member collapses to `never`
 * regardless of visibility. They are overridden at runtime through an unrelated cast instead.
 */
type TestableFighterView = FighterView & { selectedFrame: string; tintMode: number | null };

interface ViewOverrides {
  /** Override the frame lists, e.g. to model a source that authors only one frame per state. */
  visuals?: Record<string, unknown>;
}

function makeView(opts: ViewOverrides = {}): TestableFighterView {
  const view = Object.create(FighterView.prototype) as TestableFighterView;
  const noop = () => {};
  Object.assign(view, {
    selectedFrame: '',
    tintMode: null,
    currentKey: '',
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
      setTintMode: (m: number) => {
        view.tintMode = m;
      },
      clearTint: noop,
      anims: { stop: noop },
      setTexture: noop,
      play: noop,
      x: 0,
      y: 0,
    },
    shadow: { setScale: noop, setAlpha: noop, x: 0, y: 0 },
    visuals: {
      source: 'rig',
      originX: 0.5,
      originY: 0.93,
      cellW: 128,
      cellH: 92,
      gameplayScale: 1,
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
      ...opts.visuals,
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

describe('FighterView reaction routing', () => {
  it('renders a standing block impact from the guard frames, not the pre-impact stance', () => {
    const view = makeView();
    view.update(fighter({ state: 'blockstun' }), 0, blockImpact(false), 16.67, 10);
    expect(view.selectedFrame).toBe('block1');
  });

  it('renders a crouching block impact from the crouch frames', () => {
    const view = makeView();
    view.update(fighter({ state: 'blockstun' }), 0, blockImpact(true), 16.67, 10);
    expect(view.selectedFrame).toBe('crouch1');
  });

  it('renders a guard break as a stagger, never as another guard pose', () => {
    const view = makeView();
    view.update(fighter({ state: 'guardbreak' }), 0, neutralImpact(), 16.67, 10);
    expect(view.selectedFrame).toBe('hitstun0');
  });

  it('holds the pre-impact guard stance while merely blocking', () => {
    const view = makeView();
    view.update(fighter({ state: 'block' }), 0, neutralImpact(), 16.67, 10);
    expect(view.selectedFrame).toBe('block0');
  });

  it('does not age the hitstun snap across hit-stop-frozen render ticks', () => {
    const view = makeView();
    const f = fighter({ state: 'hitstun' });
    view.update(f, 0, hitImpact(), 16.67, 100);
    expect(view.selectedFrame).toBe('hitstun0');

    // Real hit-stop: CombatSim.frameCount does not advance, but renderFrame() still runs every
    // display frame with real wall-clock delta -- exactly what used to leak into the pose.
    for (let i = 0; i < 9; i++) view.update(f, 0, neutralImpact(), 16.67, 100);
    expect(view.selectedFrame).toBe('hitstun0');
  });

  it('restarts the snap when a second hit lands while the state name is still hitstun', () => {
    const view = makeView();
    const f = fighter({ state: 'hitstun' });
    view.update(f, 0, hitImpact(), 16.67, 100);
    const ticks = Math.ceil(HITSTUN_SNAP_MS / MS_PER_TICK) + 1;
    for (let i = 1; i <= ticks; i++) view.update(f, 0, neutralImpact(), 16.67, 100 + i);
    expect(view.selectedFrame).toBe('hitstun1'); // settled into the daze hold

    view.update(f, 0, hitImpact(), 16.67, 200);
    expect(view.selectedFrame).toBe('hitstun0');
  });

  it('sequences knockdown from the fall frame into the grounded hold', () => {
    const view = makeView();
    const f = fighter({ state: 'knockdown' });
    view.update(f, 0, neutralImpact(), 16.67, 50);
    expect(view.selectedFrame).toBe('down0');
    const ticks = Math.ceil(KNOCKDOWN_FALL_MS / MS_PER_TICK) + 1;
    for (let i = 1; i <= ticks; i++) view.update(f, 0, neutralImpact(), 16.67, 50 + i);
    expect(view.selectedFrame).toBe('down1');
  });

  it('sequences wakeup from the stir frame into the rising stance', () => {
    const view = makeView();
    const f = fighter({ state: 'wakeup' });
    view.update(f, 0, neutralImpact(), 16.67, 50);
    expect(view.selectedFrame).toBe('wake0');
    const ticks = Math.ceil(WAKEUP_STIR_MS / MS_PER_TICK) + 1;
    for (let i = 1; i <= ticks; i++) view.update(f, 0, neutralImpact(), 16.67, 50 + i);
    expect(view.selectedFrame).toBe('wake1');
  });

  it('gives dash its own animation rather than reusing idle', () => {
    const view = makeView();
    view.update(fighter({ state: 'dash' }), 0, neutralImpact(), 16.67, 10);
    expect(view.selectedFrame).toBe('dash');
    view.update(fighter({ state: 'idle' }), 0, neutralImpact(), 16.67, 11);
    expect(view.selectedFrame).toBe('idle');
  });

  it('selects jump rise/apex/fall from the simulation vy, not a timer', () => {
    const view = makeView();
    view.update(fighter({ state: 'jump', vy: -6 }), 0, neutralImpact(), 16.67, 10);
    expect(view.selectedFrame).toBe('rise');
    view.update(fighter({ state: 'jump', vy: 0.2 }), 0, neutralImpact(), 16.67, 11);
    expect(view.selectedFrame).toBe('apex');
    view.update(fighter({ state: 'jump', vy: 5 }), 0, neutralImpact(), 16.67, 12);
    expect(view.selectedFrame).toBe('fall');
  });

  it('ends the damage flash on wall-clock time so a long freeze cannot hold it on', () => {
    const view = makeView();
    const f = fighter({ state: 'hitstun' });
    // Hit lands, then the sim frame count stays frozen for the whole hit-stop.
    view.update(f, 0, hitImpact(), 16.67, 100);
    expect(view.tintMode).toBe(1); // FILL: flashing white
    for (let i = 0; i < 5; i++) view.update(f, 0, neutralImpact(), 16.67, 100);
    expect(view.tintMode).toBe(0); // MULTIPLY: flash expired despite the sim still being frozen
  });

  it('clamps sequencing to what a source actually authors, so single-frame art never indexes past its cell', () => {
    // Models the painted sheets, which author exactly one cell per reaction state.
    const view = makeView({
      visuals: { hitstunFrames: ['hurt'], knockdownFrames: ['hurt'], jumpFrames: ['jump'], blockFrames: ['block'], crouchFrames: ['crouch'] },
    });
    const f = fighter({ state: 'hitstun' });
    view.update(f, 0, hitImpact(), 16.67, 100);
    expect(view.selectedFrame).toBe('hurt');
    const ticks = Math.ceil(HITSTUN_SNAP_MS / MS_PER_TICK) + 1;
    for (let i = 1; i <= ticks; i++) view.update(f, 0, neutralImpact(), 16.67, 100 + i);
    expect(view.selectedFrame).toBe('hurt'); // clamped, not undefined

    view.update(fighter({ state: 'jump', vy: 5 }), 0, neutralImpact(), 16.67, 200);
    expect(view.selectedFrame).toBe('jump');
    // A guard break still routes to the hurt cell, so it reads as a recoil even with one frame.
    view.update(fighter({ state: 'guardbreak' }), 0, neutralImpact(), 16.67, 201);
    expect(view.selectedFrame).toBe('hurt');
  });

  it('clears a held reaction when the round resets and the sim frame counter returns to zero', () => {
    const view = makeView();
    const f = fighter({ state: 'hitstun' });
    view.update(f, 0, hitImpact(), 16.67, 500);
    const ticks = Math.ceil(HITSTUN_SNAP_MS / MS_PER_TICK) + 1;
    for (let i = 1; i <= ticks; i++) view.update(f, 0, neutralImpact(), 16.67, 500 + i);
    expect(view.selectedFrame).toBe('hitstun1');

    // New round: CombatSim.frameCount goes back to 0. The stale elapsed count must not survive,
    // and the backwards jump must not be read as a huge negative tick delta.
    view.update(fighter({ state: 'hitstun' }), 0, neutralImpact(), 16.67, 0);
    expect(view.selectedFrame).toBe('hitstun0');
  });
});
