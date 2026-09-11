import { describe, expect, it } from 'vitest';
import { InputManager } from './InputManager';
import { DEFAULT_P1_BINDINGS, DEFAULT_P2_BINDINGS } from './bindings';

/**
 * Minimal stand-in for `window`: records addEventListener registrations and
 * lets a test dispatch synthetic key events directly to them, so InputManager
 * can be exercised in Node (vitest's configured environment) without a DOM.
 */
class FakeTarget {
  private listeners: Record<string, Array<(e: unknown) => void>> = {};
  document = {
    hidden: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  addEventListener(type: string, cb: (e: unknown) => void): void {
    (this.listeners[type] ??= []).push(cb);
  }

  removeEventListener(type: string, cb: (e: unknown) => void): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter((l) => l !== cb);
  }

  fire(type: string, e: unknown): void {
    for (const l of this.listeners[type] ?? []) l(e);
  }
}

function keyEvent(code: string, opts: { repeat?: boolean } = {}): KeyboardEvent {
  return {
    code,
    repeat: opts.repeat ?? false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    target: null,
    preventDefault: () => {},
  } as unknown as KeyboardEvent;
}

function makeManager(): { input: InputManager; target: FakeTarget } {
  const target = new FakeTarget();
  const input = new InputManager(DEFAULT_P1_BINDINGS, DEFAULT_P2_BINDINGS, target as unknown as Window);
  return { input, target };
}

describe('InputManager press-edge latching', () => {
  it('reports a press edge for a full tap that begins and ends between two captureFrame() calls', () => {
    const { input, target } = makeManager();
    target.fire('keydown', keyEvent('KeyV')); // P1 basic
    target.fire('keyup', keyEvent('KeyV'));

    const frame = input.captureFrame();
    expect(frame.p1.basicPressed).toBe(true);
    expect(frame.p1.basicHeld).toBe(false); // already released by the time this sample is taken
  });

  it('only reports the press edge once, on the next capture after it happened', () => {
    const { input, target } = makeManager();
    target.fire('keydown', keyEvent('KeyV'));
    target.fire('keyup', keyEvent('KeyV'));

    expect(input.captureFrame().p1.basicPressed).toBe(true);
    expect(input.captureFrame().p1.basicPressed).toBe(false);
  });

  it('reports both held:true and pressed:true when a key is still down at capture time', () => {
    const { input, target } = makeManager();
    target.fire('keydown', keyEvent('KeyV'));

    const frame = input.captureFrame();
    expect(frame.p1.basicPressed).toBe(true);
    expect(frame.p1.basicHeld).toBe(true);
  });

  it('does not re-latch a press edge from OS key-repeat while the key stays down', () => {
    const { input, target } = makeManager();
    target.fire('keydown', keyEvent('KeyV'));
    expect(input.captureFrame().p1.basicPressed).toBe(true);

    // OS auto-repeat: more keydown events for the same physical key, never released.
    target.fire('keydown', keyEvent('KeyV', { repeat: true }));
    target.fire('keydown', keyEvent('KeyV', { repeat: true }));
    const frame = input.captureFrame();
    expect(frame.p1.basicPressed).toBe(false);
    expect(frame.p1.basicHeld).toBe(true);
  });

  it('produces a fresh press edge on a genuine second press after release', () => {
    const { input, target } = makeManager();
    target.fire('keydown', keyEvent('KeyV'));
    target.fire('keyup', keyEvent('KeyV'));
    expect(input.captureFrame().p1.basicPressed).toBe(true);

    target.fire('keydown', keyEvent('KeyV'));
    expect(input.captureFrame().p1.basicPressed).toBe(true);
  });

  it('tracks P1 and P2 independently, including aliased codes', () => {
    const { input, target } = makeManager();
    target.fire('keydown', keyEvent('KeyV')); // P1 basic only
    const frame = input.captureFrame();
    expect(frame.p1.basicPressed).toBe(true);
    expect(frame.p2.basicPressed).toBe(false);

    // P2 basic has two aliased codes (Numpad4 / Digit4); either should edge independently of P1.
    target.fire('keydown', keyEvent('Digit4'));
    target.fire('keyup', keyEvent('Digit4'));
    const frame2 = input.captureFrame();
    expect(frame2.p2.basicPressed).toBe(true);
    expect(frame2.p1.basicPressed).toBe(false);
  });

  it('clearAllHeld (blur/focus loss) discards buffered edges so a stale press cannot fire after refocus', () => {
    const { input, target } = makeManager();
    target.fire('keydown', keyEvent('KeyV'));
    input.clearAllHeld();
    const frame = input.captureFrame();
    expect(frame.p1.basicPressed).toBe(false);
    expect(frame.p1.basicHeld).toBe(false);
  });
});
