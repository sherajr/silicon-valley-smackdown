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
 */
export class ActionQueue {
  private queue: QueueEntry[] = [];
  private framesSinceBasicPress = Infinity;
  private framesSinceSpecialPress = Infinity;

  /** Feed one sim frame of raw input. Call once per tick, before consumeReady(). */
  push(input: PlayerFrameInput): void {
    for (const e of this.queue) e.age++;
    this.queue = this.queue.filter((e) => e.age <= ATTACK_BUFFER_FRAMES);

    if (this.framesSinceBasicPress <= CHORD_WINDOW_FRAMES) this.framesSinceBasicPress++;
    else this.framesSinceBasicPress = Infinity;
    if (this.framesSinceSpecialPress <= CHORD_WINDOW_FRAMES) this.framesSinceSpecialPress++;
    else this.framesSinceSpecialPress = Infinity;

    const basicNow = input.basicPressed;
    const specialNow = input.specialPressed;
    const chordNow =
      (basicNow && specialNow) ||
      (basicNow && this.framesSinceSpecialPress <= CHORD_WINDOW_FRAMES) ||
      (specialNow && this.framesSinceBasicPress <= CHORD_WINDOW_FRAMES);

    const dir = { left: input.left, right: input.right, down: input.down };
    if (chordNow) {
      this.queue.push({ type: 'chord', age: 0, ...dir });
      this.framesSinceBasicPress = Infinity;
      this.framesSinceSpecialPress = Infinity;
    } else {
      if (basicNow) {
        this.queue.push({ type: 'basic', age: 0, ...dir });
        this.framesSinceBasicPress = 0;
      }
      if (specialNow) {
        this.queue.push({ type: 'special', age: 0, ...dir });
        this.framesSinceSpecialPress = 0;
      }
    }
    if (input.grabPressed) this.queue.push({ type: 'grab', age: 0, ...dir });
  }

  /** Returns and removes the oldest buffered action, or null if none pending. Clears the rest (a new move discards other stale requests). */
  consumeReady(): ResolvedAction | null {
    if (this.queue.length === 0) return null;
    const [first] = this.queue;
    this.queue = [];
    return { type: first.type, left: first.left, right: first.right, down: first.down };
  }

  hasPending(): boolean {
    return this.queue.length > 0;
  }

  clear(): void {
    this.queue = [];
    this.framesSinceBasicPress = Infinity;
    this.framesSinceSpecialPress = Infinity;
  }
}
