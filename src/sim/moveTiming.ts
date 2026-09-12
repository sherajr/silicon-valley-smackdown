import type { MoveHitWindow } from './types';

/** Zero-based, inclusive start and exclusive end, shared by combat and debug rendering. */
export function isHitWindowActive(hit: MoveHitWindow, frame: number): boolean {
  return frame >= hit.startupFrame && frame < hit.startupFrame + hit.activeFrames;
}
