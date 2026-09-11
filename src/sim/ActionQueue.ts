import { ATTACK_BUFFER_FRAMES, CHORD_WINDOW_FRAMES } from './constants';
import type { PlayerFrameInput } from './types';

export type QueuedActionType = 'basic' | 'special' | 'grab' | 'chord';

interface QueueEntry {
  type: QueuedActionType;
  age: number;
  /** Directional state at the moment this action was pressed, for Forward+Basic detection. */
  left: boolean;
  right: boolean;
  down: boolean;
}

export interface ResolvedAction {
  type: QueuedActionType;
  left: boolean;
  right: boolean;
  down: boolean;
}

/**
 * Buffers discrete action presses for a few frames so a request made just
 * before a fighter becomes actionable still executes, and recognizes the
 * Basic+Special "Super" chord within a short simultaneity window. Movement
 * (left/right/up/down) and held-block are read directly off the raw frame
 * input elsewhere and never pass through this queue.
 *
 * Chord detection: a lone Basic or Special press is only *held* (kept out of
 * the ready queue) while a Super is actually affordable -- that's what gives
 * its partner button a real window to arrive. If Super isn't affordable, a
 * lone press resolves immediately so ordinary attacks stay fully responsive.
 * A held press that times out without a partner is flushed into the ready
 * queue unchanged, so it still executes as its original single action.
 */
export class ActionQueue {
  private ready: QueueEntry[] = [];
  private held: QueueEntry | null = null;

  /**
   * Feed one sim frame of raw input. Call once per tick, before consumeReady().
   * @param superAvailable Whether the owning fighter currently has enough meter
   *   (and no active Super cooldown) to make a chord worth waiting for.
   * @param frozen During hit-stop, pass true: new presses are still recorded,
   *   but nothing already buffered ages or expires while state is frozen.
   */
  push(input: PlayerFrameInput, superAvailable: boolean, frozen = false): void {
    if (!frozen) {
      for (const e of this.ready) e.age++;
      this.ready = this.ready.filter((e) => e.age <= ATTACK_BUFFER_FRAMES);

      if (this.held) {
        this.held.age++;
        if (this.held.age > CHORD_WINDOW_FRAMES) {
          this.ready.push(this.held);
          this.held = null;
        }
      }
    }

    const basicNow = input.basicPressed;
    const specialNow = input.specialPressed;
    const dir = { left: input.left, right: input.right, down: input.down };

    if (basicNow && specialNow) {
      // Both pressed on the very same frame: an unambiguous chord, no need to hold.
      this.held = null;
      this.ready.push({ type: 'chord', age: 0, ...dir });
    } else if (this.held && this.held.type === 'special' && basicNow) {
      this.ready.push({ type: 'chord', age: 0, ...dir });
      this.held = null;
    } else if (this.held && this.held.type === 'basic' && specialNow) {
      this.ready.push({ type: 'chord', age: 0, ...dir });
      this.held = null;
    } else {
      if (basicNow) {
        if (superAvailable && !this.held) this.held = { type: 'basic', age: 0, ...dir };
        else this.ready.push({ type: 'basic', age: 0, ...dir });
      }
      if (specialNow) {
        if (superAvailable && !this.held) this.held = { type: 'special', age: 0, ...dir };
        else this.ready.push({ type: 'special', age: 0, ...dir });
      }
    }

    if (input.grabPressed) this.ready.push({ type: 'grab', age: 0, ...dir });
  }

  /** Returns and removes the oldest buffered ready action, or null if none pending. Clears the rest (a new move discards other stale requests). Does not touch a still-pending chord hold. */
  consumeReady(): ResolvedAction | null {
    if (this.ready.length === 0) return null;
    const [first] = this.ready;
    this.ready = [];
    return { type: first.type, left: first.left, right: first.right, down: first.down };
  }

  hasPending(): boolean {
    return this.ready.length > 0 || this.held !== null;
  }

  clear(): void {
    this.ready = [];
    this.held = null;
  }
}
