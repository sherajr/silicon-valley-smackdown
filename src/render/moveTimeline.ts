import type { MoveDef } from '../sim/types';

/**
 * Maps a move's current simulation frame to one of its authored pose indices,
 * keyed to the move's real startup/active/recovery frame ranges instead of
 * dividing total duration evenly across however many poses exist. Anticipation
 * (index 0) shows until the first real hit/release frame, the contact pose(s)
 * span the active window, and the final index (recovery) holds for the rest
 * of the move -- including while the fighter is still committed afterward.
 */
export function poseIndexForMove(move: { frame: number; def: MoveDef }, frameCount: number): number {
  if (frameCount <= 1) return 0;

  const def = move.def;
  const total = Math.max(1, def.totalFrames);
  const startup = Math.min(def.startup, total);

  const contactStart = def.hits.length
    ? Math.min(...def.hits.map((h) => h.startupFrame))
    : startup;
  const contactEndRaw = def.hits.length
    ? Math.max(...def.hits.map((h) => h.startupFrame + h.activeFrames))
    : def.projectile
      ? (def.projectile.releaseFrame ?? startup) + 1
      : startup + 1;
  const contactEnd = Math.max(contactStart + 1, Math.min(contactEndRaw, total));

  const f = move.frame;
  if (frameCount === 2) {
    return f < contactStart ? 0 : 1;
  }

  if (f < contactStart) return 0;
  if (f >= contactEnd) return frameCount - 1;

  const midCount = frameCount - 2;
  const span = Math.max(1, contactEnd - contactStart);
  const within = Math.min(midCount - 1, Math.floor(((f - contactStart) / span) * midCount));
  return 1 + within;
}
