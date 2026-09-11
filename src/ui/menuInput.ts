import type { PlayerFrameInput } from '../sim/types';

export interface MenuNav {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  confirm: boolean;
  cancel: boolean;
}

const INITIAL_DELAY_MS = 260;
const REPEAT_MS = 120;

/**
 * Combines both players' raw frame input into edge-triggered menu navigation,
 * with press-and-hold repeat (initial delay then a steady repeat rate) for
 * the directional axes. Confirm/cancel are always single-shot edges.
 */
export class MenuNavRepeater {
  private heldSince: Partial<Record<'up' | 'down' | 'left' | 'right', number>> = {};
  private nextFire: Partial<Record<'up' | 'down' | 'left' | 'right', number>> = {};

  update(p1: PlayerFrameInput, p2: PlayerFrameInput): MenuNav {
    const now = performance.now();
    const rawHeld = {
      up: p1.up || p2.up,
      down: p1.down || p2.down,
      left: p1.left || p2.left,
      right: p1.right || p2.right,
    };
    const out: MenuNav = {
      up: false,
      down: false,
      left: false,
      right: false,
      confirm: p1.basicPressed || p2.basicPressed,
      cancel: p1.blockPressed || p2.blockPressed,
    };
    for (const dir of ['up', 'down', 'left', 'right'] as const) {
      if (!rawHeld[dir]) {
        delete this.heldSince[dir];
        delete this.nextFire[dir];
        continue;
      }
      if (this.heldSince[dir] === undefined) {
        this.heldSince[dir] = now;
        this.nextFire[dir] = now;
      }
      const next = this.nextFire[dir]!;
      if (now >= next) {
        out[dir] = true;
        this.nextFire[dir] = now + (next === this.heldSince[dir] ? INITIAL_DELAY_MS : REPEAT_MS);
      }
    }
    return out;
  }
}
