import { MathUtils, Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';

/**
 * Camera logic with no WebGL: a smoothed base pose, and a separate transient shake offset that is never fed back into
 * the smoothing. (The old code added random noise to the position that the next frame then smoothed from, so the
 * shake accumulated, never settled to a clean zero, and left the view direction inconsistent with the position.)
 */
export interface Focus { x: number; y: number }
export interface Pose { position: Vector3; target: Vector3 }

/** Largest shake displacement in world units, whatever hits stack up. */
export const SHAKE_CAP = 0.42;
/** Below this amplitude the shake is switched off exactly, so the camera returns to its clean base pose. */
export const SHAKE_EPSILON = 0.004;
const SHAKE_DECAY = 13;

/** Where the match camera wants to be for the fighters still in play. Matches the camera the gameplay was tuned with. */
export function matchPose(focus: readonly Focus[], aspect: number, out: Pose): Pose {
  let sx = 0, sy = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const f of focus) { sx += f.x; sy += f.y; minX = Math.min(minX, f.x); maxX = Math.max(maxX, f.x); minY = Math.min(minY, f.y); maxY = Math.max(maxY, f.y); }
  const n = focus.length, cx = n ? MathUtils.clamp(sx / n, -5, 5) : 0, cy = n ? MathUtils.clamp(sy / n, 0, 8) : 0;
  const span = n > 1 ? maxX - minX : 8, tall = n > 1 ? maxY - minY : 0;
  const distance = MathUtils.clamp(Math.max(19.8, (span + 8) / (0.64 * aspect), (tall + 8) / 0.62), 19.8, 37);
  out.position.set(cx, cy * 0.7 + 7.5, distance); out.target.set(cx, cy * 0.7 + 2.65, 0);
  return out;
}

/** Menu camera ranges: the slow presentation never leaves this envelope. */
export const MENU_ENVELOPE = { x: [6.6, 7.8], y: [5.8, 6.2], z: [16.4, 21] } as const;

/**
 * Home and selection camera: a slow, small drift. `shift` is the fraction of the frame width the picture is pushed to
 * the right so the two showcase fighters sit in the space beside the title block (landscape screens only).
 */
export function menuPose(time: number, aspect: number, out: Pose): { pose: Pose; shift: number; shiftY: number } {
  const sway = Math.sin(time * 0.09) * 0.55, bob = Math.sin(time * 0.07) * 0.22;
  const portrait = Math.max(0, 1.3 - aspect) * 5.5;
  out.position.set(7.2 + sway, 6.0 + bob * 0.5, 16.5 + portrait); out.target.set(3.5 + sway * 0.4, 2.5 + bob * 0.2, 0);
  return { pose: out, shift: aspect >= 1.25 ? 0.16 : 0, shiftY: aspect < 1 ? 0.2 : 0 };
}

export interface CameraFrame {
  dt: number;
  menu: boolean;
  time: number;
  focus: readonly Focus[];
  aspect: number;
  paused: boolean;
}

export class CameraRig {
  readonly position = new Vector3(9, 7, 21);
  readonly target = new Vector3(0, 2.7, 0);
  /** Transient shake displacement, applied on top of the base pose. */
  readonly offset = new Vector3();
  /** Framing shift (fraction of the frame width to the right, and of its height downward), smoothed. */
  shift = 0;
  shiftY = 0;
  /** Camera-shake preference. Off means addShake is ignored. */
  shakeEnabled = true;
  /** Test hook: when set, the camera is placed here and nothing else moves it. */
  override: Pose | null = null;
  private desired: Pose = { position: new Vector3(), target: new Vector3() };
  private amplitude = 0;
  private clock = 0;
  private snapNext = true;
  private final = new Vector3();

  /** Next update places the camera at its desired pose without gliding (first frame, or a hard scene change). */
  snap() { this.snapNext = true; }
  get shaking() { return this.amplitude > 0; }
  get amplitudeNow() { return this.amplitude; }

  addShake(amount: number) {
    if (!this.shakeEnabled || !(amount > 0)) return;
    this.amplitude = Math.min(SHAKE_CAP, Math.max(this.amplitude, amount));
  }
  clearShake() { this.amplitude = 0; this.offset.set(0, 0, 0); }

  update(f: CameraFrame) {
    const dt = Math.min(0.1, Math.max(0, f.dt));
    let wantShift = 0, wantShiftY = 0;
    if (f.menu) { const m = menuPose(f.time, f.aspect, this.desired); wantShift = m.shift; wantShiftY = m.shiftY; } else matchPose(f.focus, f.aspect, this.desired);
    const rate = f.menu ? 3 : 3.2, blend = this.snapNext ? 1 : 1 - Math.exp(-dt * rate);
    this.position.lerp(this.desired.position, blend); this.target.lerp(this.desired.target, blend);
    const ease = this.snapNext ? 1 : 1 - Math.exp(-dt * 2.2);
    this.shift += (wantShift - this.shift) * ease; if (Math.abs(this.shift - wantShift) < 1e-4) this.shift = wantShift;
    this.shiftY += (wantShiftY - this.shiftY) * ease; if (Math.abs(this.shiftY - wantShiftY) < 1e-4) this.shiftY = wantShiftY;
    this.snapNext = false;
    // Shake only exists during live play. A pause or the menu discards it rather than letting it resume stale later.
    if (f.paused || f.menu || !this.shakeEnabled) { this.clearShake(); return; }
    if (this.amplitude <= 0) { this.offset.set(0, 0, 0); return; }
    this.clock += dt;
    this.amplitude *= Math.exp(-dt * SHAKE_DECAY);
    if (this.amplitude < SHAKE_EPSILON) { this.clearShake(); return; }
    const t = this.clock, a = this.amplitude;
    // Smooth, bounded pseudo-noise: two incommensurate sines per axis. Never random, so it is reproducible and cannot spike.
    this.offset.set(a * (0.55 * Math.sin(t * 41.3 + 0.7) + 0.45 * Math.sin(t * 67.9 + 2.1)), a * 0.7 * (0.55 * Math.sin(t * 47.1 + 4.2) + 0.45 * Math.sin(t * 73.7 + 1.3)), 0);
  }

  /** Final camera: base plus shake, translated together so the view direction stays that of the base pose. */
  apply(camera: PerspectiveCamera) {
    if (this.override) { camera.position.copy(this.override.position); camera.lookAt(this.override.target); return; }
    camera.position.copy(this.position).add(this.offset);
    this.final.copy(this.target).add(this.offset); camera.lookAt(this.final);
  }
}
