import {
  DEFAULT_P1_BINDINGS,
  DEFAULT_P2_BINDINGS,
  PAUSE_CODE,
  clonePlayerBindings,
  type PlayerBindings,
} from './bindings';
import { neutralFrameInput, type PlayerFrameInput } from '../sim/types';

// Codes this game ever binds to gameplay actions, plus arrows/space, for
// scroll-prevention purposes. Kept in one place so remapping additions stay covered.
const GAMEPLAY_CODES = new Set([
  'KeyA', 'KeyB', 'KeyC', 'KeyD', 'KeyE', 'KeyF', 'KeyG', 'KeyH', 'KeyI', 'KeyJ',
  'KeyK', 'KeyL', 'KeyM', 'KeyN', 'KeyO', 'KeyP', 'KeyQ', 'KeyR', 'KeyS', 'KeyT',
  'KeyU', 'KeyV', 'KeyW', 'KeyX', 'KeyY', 'KeyZ',
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space',
  'Numpad4', 'Numpad5', 'Numpad6', 'NumpadAdd',
  'Digit4', 'Digit5', 'Digit6', 'Equal', 'Semicolon',
]);

type FocusListener = (focused: boolean) => void;

/** Actions that expose a discrete press edge in PlayerFrameInput (as opposed to moveLeft/moveRight/up/down, which are read as level state only). */
type EdgeAction = 'basic' | 'special' | 'block' | 'grab';
const EDGE_ACTIONS: EdgeAction[] = ['basic', 'special', 'block', 'grab'];

function emptyEdgeState(): Record<EdgeAction, boolean> {
  return { basic: false, special: false, block: false, grab: false };
}

/**
 * Tracks physical key state via KeyboardEvent.code (so e.g. Numpad4 and
 * Digit4 are distinguished regardless of Num Lock) and produces normalized,
 * per-player action frames. Capture happens once per fixed sim tick via
 * captureFrame(), but press/release *edges* are latched at DOM event time
 * (see updateActionEdges) rather than derived by diffing held-state between
 * polls: a key that goes down and back up entirely between two captureFrame()
 * calls would otherwise vanish (both samples would see it not held) even
 * though a real press happened. Latching at event time means a full tap
 * between ticks still produces exactly one press edge on the next sample, and
 * OS key-repeat (which never toggles held-state) never re-latches an edge.
 */
export class InputManager {
  private held = new Set<string>();
  private p1Bindings: PlayerBindings;
  private p2Bindings: PlayerBindings;
  /** Whether each edge-action is currently down (any of its bound codes held), tracked incrementally at event time so repeats and bound-code aliases can't double-fire. */
  private actionDown: Record<'p1' | 'p2', Record<EdgeAction, boolean>> = { p1: emptyEdgeState(), p2: emptyEdgeState() };
  /** Sticky "a press edge happened since the last captureFrame() read" flag, consumed (and cleared) by captureFrame(). */
  private edgePressed: Record<'p1' | 'p2', Record<EdgeAction, boolean>> = { p1: emptyEdgeState(), p2: emptyEdgeState() };
  private prevPauseHeld = false;
  private focused = true;
  private focusListeners: FocusListener[] = [];
  private remapCapture: ((code: string) => void) | null = null;
  private target: Window;

  constructor(p1: PlayerBindings = DEFAULT_P1_BINDINGS, p2: PlayerBindings = DEFAULT_P2_BINDINGS, target: Window = window) {
    this.p1Bindings = clonePlayerBindings(p1);
    this.p2Bindings = clonePlayerBindings(p2);
    this.target = target;
    this.keydown = this.keydown.bind(this);
    this.keyup = this.keyup.bind(this);
    this.onBlur = this.onBlur.bind(this);
    this.onFocus = this.onFocus.bind(this);
    this.onVisibility = this.onVisibility.bind(this);
    target.addEventListener('keydown', this.keydown, { capture: true });
    target.addEventListener('keyup', this.keyup, { capture: true });
    target.addEventListener('blur', this.onBlur);
    target.addEventListener('focus', this.onFocus);
    (target.document as Document | undefined)?.addEventListener?.('visibilitychange', this.onVisibility);
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.keydown, { capture: true } as any);
    this.target.removeEventListener('keyup', this.keyup, { capture: true } as any);
    this.target.removeEventListener('blur', this.onBlur);
    this.target.removeEventListener('focus', this.onFocus);
    (this.target.document as Document | undefined)?.removeEventListener?.('visibilitychange', this.onVisibility);
  }

  setBindings(p1: PlayerBindings, p2: PlayerBindings): void {
    this.p1Bindings = clonePlayerBindings(p1);
    this.p2Bindings = clonePlayerBindings(p2);
  }

  getBindings(): { p1: PlayerBindings; p2: PlayerBindings } {
    return { p1: clonePlayerBindings(this.p1Bindings), p2: clonePlayerBindings(this.p2Bindings) };
  }

  onFocusChange(cb: FocusListener): () => void {
    this.focusListeners.push(cb);
    return () => {
      this.focusListeners = this.focusListeners.filter((f) => f !== cb);
    };
  }

  isWindowFocused(): boolean {
    return this.focused;
  }

  /** Next key press (any code) is routed here instead of gameplay state; used by the remap panel. */
  beginRemapCapture(cb: (code: string) => void): void {
    this.remapCapture = cb;
  }

  cancelRemapCapture(): void {
    this.remapCapture = null;
  }

  isCodeHeld(code: string): boolean {
    return this.held.has(code);
  }

  getHeldCodes(): string[] {
    return [...this.held];
  }

  /** Clears held/buffered state, e.g. on blur or on entering a fresh match. Also resets edge memory. */
  clearAllHeld(): void {
    this.held.clear();
    this.actionDown = { p1: emptyEdgeState(), p2: emptyEdgeState() };
    this.edgePressed = { p1: emptyEdgeState(), p2: emptyEdgeState() };
    this.prevPauseHeld = false;
  }

  /** Call exactly once per fixed sim tick. */
  captureFrame(): { p1: PlayerFrameInput; p2: PlayerFrameInput; pausePressed: boolean } {
    const p1 = this.frameFor('p1', this.p1Bindings);
    const p2 = this.frameFor('p2', this.p2Bindings);
    const pauseHeld = this.held.has(PAUSE_CODE);
    const pausePressed = pauseHeld && !this.prevPauseHeld;
    this.prevPauseHeld = pauseHeld;
    p1.pausePressed = pausePressed;
    p2.pausePressed = pausePressed;
    return { p1, p2, pausePressed };
  }

  private frameFor(slot: 'p1' | 'p2', b: PlayerBindings): PlayerFrameInput {
    const heldFor = (action: keyof PlayerBindings) => b[action].some((c) => this.held.has(c));
    const left = heldFor('moveLeft');
    const right = heldFor('moveRight');
    const up = heldFor('up');
    const down = heldFor('down');
    const basicHeld = heldFor('basic');
    const specialHeld = heldFor('special');
    const blockHeld = heldFor('block');
    const grabHeld = heldFor('grab');

    // Press edges were already latched at DOM event time (see updateActionEdges), so a
    // full tap that both began and ended between two captureFrame() calls still reports
    // pressed:true here even though *Held above is already back to false. Consuming
    // (clearing) the flag here means each edge is reported on exactly one frame.
    const edges = this.edgePressed[slot];
    const basicPressed = edges.basic;
    const specialPressed = edges.special;
    const grabPressed = edges.grab;
    const blockPressed = edges.block;
    edges.basic = false;
    edges.special = false;
    edges.grab = false;
    edges.block = false;

    return {
      ...neutralFrameInput(),
      left,
      right,
      up,
      down,
      basicHeld,
      specialHeld,
      blockHeld,
      grabHeld,
      basicPressed,
      specialPressed,
      grabPressed,
      blockPressed,
    };
  }

  /**
   * Recomputes whether each edge-action bound to `code` is currently down (any
   * bound code held) and latches a press edge the instant it transitions from
   * up to down. Runs at DOM event time -- not at captureFrame() poll time -- so
   * a tap can't be lost between polls, and OS key-repeat (which never toggles
   * `held` membership) can never produce a second transition on its own.
   */
  private updateActionEdges(code: string): void {
    for (const [slot, bindings] of [
      ['p1', this.p1Bindings],
      ['p2', this.p2Bindings],
    ] as const) {
      for (const action of EDGE_ACTIONS) {
        if (!bindings[action].includes(code)) continue;
        const nowDown = bindings[action].some((c) => this.held.has(c));
        if (nowDown === this.actionDown[slot][action]) continue;
        this.actionDown[slot][action] = nowDown;
        if (nowDown) this.edgePressed[slot][action] = true;
      }
    }
  }

  private keydown(e: KeyboardEvent): void {
    if (this.remapCapture) {
      if (e.code !== PAUSE_CODE) {
        e.preventDefault();
        const cb = this.remapCapture;
        this.remapCapture = null;
        cb(e.code);
      }
      return;
    }
    if (this.shouldIgnore(e)) return;
    this.held.add(e.code);
    this.updateActionEdges(e.code);
    if (this.shouldPreventDefault(e)) e.preventDefault();
  }

  private keyup(e: KeyboardEvent): void {
    if (this.shouldIgnore(e)) return;
    this.held.delete(e.code);
    this.updateActionEdges(e.code);
    if (this.shouldPreventDefault(e)) e.preventDefault();
  }

  private shouldIgnore(e: KeyboardEvent): boolean {
    const el = e.target as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
  }

  private shouldPreventDefault(e: KeyboardEvent): boolean {
    if (e.ctrlKey || e.altKey || e.metaKey) return false;
    if (e.code === 'F5' || e.code === 'F11' || e.code === 'F12') return false;
    return GAMEPLAY_CODES.has(e.code);
  }

  private onBlur(): void {
    this.focused = false;
    this.clearAllHeld();
    for (const l of this.focusListeners) l(false);
  }

  private onVisibility(): void {
    const doc = this.target.document as Document | undefined;
    if (!doc) return;
    if (doc.hidden) {
      this.focused = false;
      this.clearAllHeld();
      for (const l of this.focusListeners) l(false);
    } else {
      this.notifyFocusRegained();
    }
  }

  /** Call when the canvas/game regains focus (e.g. a click/keydown after blur) to re-arm capture. */
  notifyFocusRegained(): void {
    if (!this.focused) {
      this.focused = true;
      for (const l of this.focusListeners) l(true);
    }
  }

  private onFocus(): void {
    this.notifyFocusRegained();
  }
}
