import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { CameraRig, MENU_ENVELOPE, SHAKE_CAP, SHAKE_EPSILON, matchPose, menuPose } from './cameraRig';
import type { CameraFrame } from './cameraRig';

const pose = () => ({ position: new Vector3(), target: new Vector3() });
const frame = (extra: Partial<CameraFrame> = {}): CameraFrame => ({ dt: 1 / 60, menu: false, time: 0, focus: [{ x: 0, y: 0 }], aspect: 16 / 9, paused: false, ...extra });
/** Runs `seconds` of frames at `fps`. */
function run(rig: CameraRig, seconds: number, fps: number, extra: Partial<CameraFrame> = {}) {
  const n = Math.round(seconds * fps);
  for (let i = 0; i < n; i++) rig.update(frame({ dt: 1 / fps, time: i / fps, ...extra }));
}

describe('match framing', () => {
  it('keeps the camera the gameplay was tuned with', () => {
    const p = matchPose([{ x: -4, y: 0 }, { x: 4, y: 0 }], 16 / 9, pose());
    expect(p.position.x).toBeCloseTo(0); expect(p.position.y).toBeCloseTo(7.5); expect(p.position.z).toBeCloseTo(19.8);
    expect(p.target.toArray()).toEqual([0, 2.65, 0]);
  });
  it('pulls back for a wide span or a tall one, never beyond 37, and centres on a lone fighter', () => {
    expect(matchPose([{ x: -16, y: 0 }, { x: 16, y: 0 }], 16 / 9, pose()).position.z).toBeGreaterThan(30);
    expect(matchPose([{ x: -300, y: 0 }, { x: 300, y: 0 }], 16 / 9, pose()).position.z).toBe(37);
    expect(matchPose([{ x: 0, y: -2 }, { x: 0, y: 16 }], 16 / 9, pose()).position.z).toBeGreaterThan(19.8);
    const lone = matchPose([{ x: 12, y: 20 }], 16 / 9, pose());
    expect(lone.position.x).toBe(5); expect(lone.target.y).toBeCloseTo(8 * 0.7 + 2.65);
    expect(matchPose([], 16 / 9, pose()).position.toArray()).toEqual([0, 7.5, 19.8]);
  });
});

describe('menu framing', () => {
  it('stays inside its composition envelope for any time and aspect', () => {
    for (const aspect of [0.5, 0.9, 1.25, 16 / 9, 21 / 9]) for (let t = 0; t < 4000; t += 7.3) {
      const { pose: p } = menuPose(t, aspect, pose());
      expect(p.position.x).toBeGreaterThanOrEqual(MENU_ENVELOPE.x[0]); expect(p.position.x).toBeLessThanOrEqual(MENU_ENVELOPE.x[1]);
      expect(p.position.y).toBeGreaterThanOrEqual(MENU_ENVELOPE.y[0]); expect(p.position.y).toBeLessThanOrEqual(MENU_ENVELOPE.y[1]);
      expect(p.position.z).toBeGreaterThanOrEqual(MENU_ENVELOPE.z[0]); expect(p.position.z).toBeLessThanOrEqual(MENU_ENVELOPE.z[1]);
    }
  });
  it('shifts the picture beside the title on landscape screens only', () => {
    expect(menuPose(0, 16 / 9, pose()).shift).toBeGreaterThan(0.1);
    expect(menuPose(0, 0.5, pose()).shift).toBe(0);
  });
});

describe('camera shake', () => {
  it('never changes the smoothed base pose and returns to exactly zero', () => {
    const rig = new CameraRig(); run(rig, 3, 60);
    const base = rig.position.clone(), target = rig.target.clone();
    rig.addShake(0.3);
    let peak = 0;
    for (let i = 0; i < 90; i++) { rig.update(frame()); peak = Math.max(peak, rig.offset.length()); expect(rig.position.distanceTo(base)).toBeLessThan(1e-3); expect(rig.target.distanceTo(target)).toBeLessThan(1e-3); }
    expect(peak).toBeGreaterThan(0.02);
    expect(rig.shaking).toBe(false);
    expect(rig.offset.toArray()).toEqual([0, 0, 0]);
    // The camera is exactly the base pose again.
    const cam = new PerspectiveCamera(); rig.apply(cam);
    expect(cam.position.distanceTo(rig.position)).toBe(0);
  });

  it('is capped, takes the strongest request rather than stacking, and is bounded at every frame', () => {
    const rig = new CameraRig(); run(rig, 1, 60);
    rig.addShake(0.34); rig.addShake(0.34); rig.addShake(0.26); rig.addShake(9);
    expect(rig.amplitudeNow).toBe(SHAKE_CAP);
    let maxOffset = 0; for (let i = 0; i < 120; i++) { rig.update(frame()); maxOffset = Math.max(maxOffset, Math.abs(rig.offset.x), Math.abs(rig.offset.y)); }
    expect(maxOffset).toBeLessThanOrEqual(SHAKE_CAP + 1e-9);
  });

  it('is deterministic, so identical hits shake identically', () => {
    const a = new CameraRig(), b = new CameraRig(); run(a, 1, 60); run(b, 1, 60); a.addShake(0.2); b.addShake(0.2);
    for (let i = 0; i < 30; i++) { a.update(frame()); b.update(frame()); expect(a.offset.toArray()).toEqual(b.offset.toArray()); }
  });

  it('decays frame-rate independently and stops below the epsilon', () => {
    const slow = new CameraRig(), fast = new CameraRig(); run(slow, 1, 30); run(fast, 1, 144);
    slow.addShake(0.3); fast.addShake(0.3); run(slow, 0.1, 30); run(fast, 0.1, 144);
    expect(slow.amplitudeNow).toBeCloseTo(fast.amplitudeNow, 2);
    run(slow, 1, 30); expect(slow.amplitudeNow).toBe(0); expect(SHAKE_EPSILON).toBeGreaterThan(0);
  });

  it('moves the view as a pure translation: the look direction stays the base direction', () => {
    const rig = new CameraRig(); run(rig, 3, 60); rig.addShake(0.4); rig.update(frame());
    expect(rig.offset.length()).toBeGreaterThan(0);
    const cam = new PerspectiveCamera(); rig.apply(cam);
    const base = rig.target.clone().sub(rig.position).normalize(), actual = new Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    expect(actual.distanceTo(base)).toBeLessThan(1e-6);
  });

  it('is discarded by a pause or the menu rather than resuming stale, and honours the preference', () => {
    const rig = new CameraRig(); run(rig, 1, 60); rig.addShake(0.3); rig.update(frame({ paused: true }));
    expect(rig.shaking).toBe(false); rig.update(frame()); expect(rig.offset.toArray()).toEqual([0, 0, 0]);
    rig.addShake(0.3); rig.update(frame({ menu: true })); expect(rig.shaking).toBe(false);
    rig.shakeEnabled = false; rig.addShake(0.3); expect(rig.shaking).toBe(false); rig.update(frame()); expect(rig.offset.toArray()).toEqual([0, 0, 0]);
    // Ignores non-positive and NaN requests.
    rig.shakeEnabled = true; rig.addShake(0); rig.addShake(-1); rig.addShake(NaN); expect(rig.shaking).toBe(false);
  });
});

describe('smoothing', () => {
  it('snaps on the first frame, then glides frame-rate independently', () => {
    const rig = new CameraRig(); rig.update(frame({ focus: [{ x: 5, y: 0 }, { x: 5, y: 0 }] }));
    expect(rig.position.x).toBeCloseTo(5);
    const a = new CameraRig(), b = new CameraRig(); run(a, 0.5, 60); run(b, 0.5, 60);
    run(a, 0.6, 30, { focus: [{ x: 4, y: 0 }, { x: 4, y: 0 }] }); run(b, 0.6, 144, { focus: [{ x: 4, y: 0 }, { x: 4, y: 0 }] });
    expect(Math.abs(a.position.x - b.position.x)).toBeLessThan(0.05);
    expect(a.position.x).toBeGreaterThan(0.2); expect(a.position.x).toBeLessThan(4);
  });
  it('slides the framing shift in and out smoothly and settles exactly', () => {
    const rig = new CameraRig(); run(rig, 6, 60, { menu: true }); expect(rig.shift).toBeCloseTo(0.16, 3);
    rig.update(frame()); expect(rig.shift).toBeGreaterThan(0); expect(rig.shift).toBeLessThan(0.16);
    run(rig, 8, 60); expect(rig.shift).toBe(0);
  });
  it('honours a test override and ignores shake while it is set', () => {
    const rig = new CameraRig(); rig.override = { position: new Vector3(1, 2, 3), target: new Vector3(1, 2, 0) };
    const cam = new PerspectiveCamera(); rig.addShake(0.3); rig.update(frame()); rig.apply(cam);
    expect(cam.position.toArray()).toEqual([1, 2, 3]);
  });
});
