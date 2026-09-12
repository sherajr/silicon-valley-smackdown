import { SIM_FPS } from './constants';

/** Keep the last partial second at 0:01 until timeout. */
export function formatRoundClock(frames: number): string {
  const seconds = Math.max(0, Math.ceil(frames / SIM_FPS));
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}
