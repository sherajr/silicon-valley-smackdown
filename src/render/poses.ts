import type { Pose, Rect, RectStyle } from './FighterRig';

export interface Build {
  legLen: number;
  legW: number;
  footH: number;
  torsoW: number;
  torsoH: number;
  headSize: number;
  armW: number;
  armLen: number;
  hipY: number; // y of hip (top of legs), negative
  shoulderY: number; // y of shoulder (top of torso), negative
}

export function buildFor(width: number, height: number): Build {
  const legLen = height * 0.44;
  const torsoH = height * 0.38;
  const headSize = height * 0.24;
  return {
    legLen,
    legW: width * 0.24,
    footH: height * 0.06,
    torsoW: width * 0.62,
    torsoH,
    headSize,
    armW: width * 0.16,
    armLen: height * 0.34,
    hipY: -legLen,
    shoulderY: -legLen - torsoH,
  };
}

function baseLegs(b: Build, spread: number): { legBack: Rect; shoeBack: Rect; legFront: Rect; shoeFront: Rect } {
  return {
    legBack: { x: -b.legW / 2 - spread, y: b.hipY, w: b.legW, h: b.legLen - b.footH },
    shoeBack: { x: -b.legW / 2 - spread - 1, y: -b.footH, w: b.legW + 2, h: b.footH },
    legFront: { x: -b.legW / 2 + spread, y: b.hipY, w: b.legW, h: b.legLen - b.footH },
    shoeFront: { x: -b.legW / 2 + spread + (spread >= 0 ? 4 : -4), y: -b.footH, w: b.legW + 2, h: b.footH },
  };
}

export function basePose(b: Build): Pose {
  const legs = baseLegs(b, 0);
  return {
    ...legs,
    torso: { x: -b.torsoW / 2, y: b.shoulderY, w: b.torsoW, h: b.torsoH },
    armBack: { x: -b.torsoW / 2 - b.armW * 0.3, y: b.shoulderY + 2, w: b.armW, h: b.armLen },
    head: { x: -b.headSize / 2 + 2, y: b.shoulderY - b.headSize + 2, w: b.headSize, h: b.headSize },
    hair: { x: -b.headSize / 2, y: b.shoulderY - b.headSize - 1, w: b.headSize + 2, h: b.headSize * 0.4 },
    armFront: { x: b.torsoW / 2 - b.armW * 0.7, y: b.shoulderY + 2, w: b.armW, h: b.armLen },
    prop: null,
  };
}

export function clone(p: Pose): Pose {
  return JSON.parse(JSON.stringify(p));
}

export function withProp(p: Pose, prop: RectStyle | null): Pose {
  const next = clone(p);
  next.prop = prop;
  return next;
}

export type HairStyle = 'short' | 'slick' | 'messy' | 'ponytail' | 'swept' | 'founder';

/** Reshapes the hair rect (silhouette only, not just color) so heads read as distinct per character. */
export function withHairStyle(p: Pose, style: HairStyle): Pose {
  const next = clone(p);
  const h = next.hair;
  const originalH = h.h;
  switch (style) {
    case 'short': // Hunter: a little tousled and tall
      h.h *= 1.35;
      h.y -= h.h - originalH; // grow upward only, never further down over the face
      break;
    case 'slick': // Kevin: neat, thin, close to the head
      h.h *= 0.55;
      break;
    case 'messy': // Al: wide, uneven, overflowing the head
      h.w *= 1.3;
      h.x -= h.w * 0.1;
      h.h *= 1.25;
      h.y -= h.h - originalH + originalH * 0.15; // grow upward, with a little extra clearance over the eyes
      break;
    case 'ponytail': // Priya: swept back and trailing behind
      h.h *= 0.7;
      h.x -= h.w * 0.55;
      h.w *= 1.45;
      break;
    case 'swept': // Chad: longer, swept back off the forehead
      h.h *= 0.85;
      h.w *= 1.15;
      h.x -= h.w * 0.05;
      break;
    case 'founder': { // Elon: a bit fuller on top
      const before = h.h;
      h.h *= 1.15;
      h.y -= h.h - before;
      h.w *= 1.05;
      break;
    }
  }
  return next;
}

// ---------------------------------------------------------------------
// Idle / locomotion
// ---------------------------------------------------------------------

export function idleFrames(b: Build): Pose[] {
  const frames: Pose[] = [];
  const bob = [0, -1, -2, -1];
  for (const dy of bob) {
    const p = basePose(b);
    p.torso.y += dy;
    p.head.y += dy;
    p.hair.y += dy;
    p.armBack.y += dy * 0.6;
    p.armFront.y += dy * 0.6;
    frames.push(p);
  }
  return frames;
}

export function walkFrames(b: Build): Pose[] {
  const spreads = [10, 5, 0, -10, -5, 0];
  return spreads.map((spread, i) => {
    const p = basePose(b);
    const legs = baseLegs(b, spread);
    Object.assign(p, legs);
    const armSwing = -spread * 0.5;
    p.armBack.x += armSwing;
    p.armFront.x += armSwing * 0.6;
    const bounce = i % 3 === 0 ? -1 : 0;
    p.torso.y += bounce;
    p.head.y += bounce;
    p.hair.y += bounce;
    return p;
  });
}

export function jumpPose(b: Build): Pose {
  const p = basePose(b);
  p.legBack.y += 6;
  p.legBack.h -= 6;
  p.legFront.y += 4;
  p.legFront.h -= 4;
  p.armBack.y -= 4;
  p.armFront.y -= 4;
  return p;
}

export function crouchPose(b: Build): Pose {
  const p = basePose(b);
  const crouchDrop = b.legLen * 0.4;
  p.legBack.h -= crouchDrop;
  p.legBack.y += crouchDrop;
  p.legFront.h -= crouchDrop;
  p.legFront.y += crouchDrop;
  p.torso.y += crouchDrop * 0.9;
  p.torso.h -= crouchDrop * 0.1;
  p.head.y += crouchDrop * 0.9;
  p.hair.y += crouchDrop * 0.9;
  p.armBack.y += crouchDrop * 0.8;
  p.armFront.y += crouchDrop * 0.8;
  return p;
}

export function blockPose(b: Build): Pose {
  const p = basePose(b);
  p.armFront.x -= b.armW * 0.4;
  p.armFront.y -= b.armLen * 0.35;
  p.armFront.h *= 0.7;
  p.armBack.x -= b.armW * 0.2;
  p.torso.x -= 1;
  p.bodyTilt = -2;
  return p;
}

export function hitstunPose(b: Build): Pose {
  const p = basePose(b);
  p.bodyTilt = -6;
  p.armBack.x -= 3;
  p.armFront.x -= 2;
  p.head.x -= 3;
  p.eyesClosed = true;
  return p;
}

export function knockdownPose(b: Build): Pose {
  const p = basePose(b);
  const flatten = b.legLen * 0.8;
  p.legBack.y += flatten;
  p.legBack.h = Math.max(2, p.legBack.h - flatten);
  p.legFront.y += flatten;
  p.legFront.h = Math.max(2, p.legFront.h - flatten);
  p.shoeBack.y = -2;
  p.shoeFront.y = -2;
  p.torso.y += flatten * 0.85;
  p.torso.h *= 0.5;
  p.head.y += flatten * 0.95;
  p.hair.y += flatten * 0.95;
  p.armBack.y += flatten * 0.9;
  p.armFront.y += flatten * 0.9;
  p.armBack.h *= 0.5;
  p.armFront.h *= 0.5;
  p.eyesClosed = true;
  return p;
}

export function wakeupPose(b: Build): Pose {
  const p = crouchPose(b);
  p.bodyTilt = 2;
  return p;
}

export function victoryPose(b: Build): Pose {
  const p = basePose(b);
  p.armFront.y -= b.armLen * 0.6;
  p.armFront.x += 2;
  p.head.y -= 1;
  return p;
}

/** Confident wide stance for selection-screen/portrait art -- distinct from the gameplay idle frame. */
export function portraitPose(b: Build): Pose {
  const p = basePose(b);
  const legs = baseLegs(b, 6);
  Object.assign(p, legs);
  p.armBack.x -= 1;
  p.armFront.x += 1;
  p.head.y -= 1;
  p.bodyTilt = -1;
  return p;
}

export function koPose(b: Build): Pose {
  const p = knockdownPose(b);
  p.eyesClosed = true;
  return p;
}

// ---------------------------------------------------------------------
// Attack archetypes. Each returns [anticipation, impact, recovery?] poses.
// ---------------------------------------------------------------------

export function jabArchetype(b: Build, prop: RectStyle | null): Pose[] {
  const wind = basePose(b);
  wind.armFront.x -= 2;
  wind.bodyTilt = -1;

  const hit = basePose(b);
  hit.armFront.x += b.armLen * 0.9;
  hit.armFront.w += 2;
  hit.bodyTilt = 2;
  if (prop) hit.prop = { ...prop, x: prop.x + b.armLen * 0.9 };

  return [wind, hit];
}

export function hookArchetype(b: Build, prop: RectStyle | null): Pose[] {
  const wind = basePose(b);
  wind.armFront.x -= b.armW * 0.6;
  wind.armFront.y -= 2;
  wind.bodyTilt = -3;

  const hit = basePose(b);
  hit.armFront.x += b.armLen * 0.75;
  hit.armFront.y -= 4;
  hit.bodyTilt = 5;
  if (prop) hit.prop = { ...prop, x: prop.x + b.armLen * 0.75, y: prop.y - 4 };

  return [wind, hit];
}

export function kickArchetype(b: Build, height: 'low' | 'mid' | 'high'): Pose[] {
  const wind = basePose(b);
  wind.legFront.h *= 0.7;
  wind.legFront.y += b.legLen * 0.2;

  const hit = basePose(b);
  const raise = height === 'low' ? 0.15 : height === 'mid' ? 0.4 : 0.7;
  hit.legFront.x += b.legLen * 0.7;
  hit.legFront.y -= b.legLen * raise;
  hit.legFront.w += 1;
  hit.shoeFront.x = hit.legFront.x - 1;
  hit.shoeFront.y = hit.legFront.y;
  hit.bodyTilt = -4;
  hit.armBack.x -= 2;

  return [wind, hit];
}

export function heavyLungeArchetype(b: Build, prop: RectStyle | null): Pose[] {
  const wind = basePose(b);
  wind.armFront.x -= b.armW * 0.4;
  wind.torso.x -= 2;
  wind.bodyTilt = -5;

  const hit = basePose(b);
  hit.armFront.x += b.armLen * 1.05;
  hit.armFront.y -= 3;
  hit.torso.x += 3;
  hit.bodyTilt = 8;
  if (prop) hit.prop = { ...prop, x: prop.x + b.armLen * 1.05, y: prop.y - 3 };

  const recover = basePose(b);
  recover.bodyTilt = 3;
  recover.armFront.x += 2;

  return [wind, hit, recover];
}

export function throwArchetype(b: Build, prop: RectStyle | null): Pose[] {
  const wind = basePose(b);
  wind.armFront.x -= b.armW * 0.3;
  wind.armFront.y -= b.armLen * 0.25;
  if (prop) wind.prop = { ...prop, y: prop.y - b.armLen * 0.25 };

  const release = basePose(b);
  release.armFront.x += b.armLen * 0.8;
  release.armFront.y -= b.armLen * 0.15;
  release.bodyTilt = 3;
  if (prop) release.prop = { ...prop, x: prop.x + b.armLen * 0.8, y: prop.y - b.armLen * 0.15 };

  const recover = basePose(b);
  recover.bodyTilt = -1;

  return [wind, release, recover];
}

export function grabArchetype(b: Build): Pose[] {
  const reach = basePose(b);
  reach.armFront.x += b.armLen * 0.55;
  reach.armFront.y += 1;

  const clinch = basePose(b);
  clinch.armFront.x += b.armLen * 0.3;
  clinch.armBack.x += b.armLen * 0.2;
  clinch.torso.x += 3;
  clinch.bodyTilt = 3;

  const slam = basePose(b);
  slam.bodyTilt = 6;
  slam.armFront.y -= 2;
  slam.armBack.y -= 2;

  return [reach, clinch, slam];
}

export function counterStanceArchetype(b: Build, prop: RectStyle | null): Pose[] {
  const stance = basePose(b);
  stance.armFront.x -= 1;
  stance.armBack.x -= 2;
  stance.bodyTilt = -2;
  if (prop) stance.prop = prop;

  const riposte = basePose(b);
  riposte.armFront.x += b.armLen * 0.85;
  riposte.bodyTilt = 5;
  if (prop) riposte.prop = { ...prop, x: prop.x + b.armLen * 0.85 };

  return [stance, riposte];
}

export function lowSweepArchetype(b: Build): Pose[] {
  const wind = crouchPose(b);
  wind.legFront.h *= 0.6;

  const sweep = crouchPose(b);
  sweep.legFront.x += b.legLen * 0.75;
  sweep.legFront.h *= 0.55;
  sweep.shoeFront.x = sweep.legFront.x;
  sweep.bodyTilt = -6;

  return [wind, sweep];
}

export function targetPointArchetype(b: Build, prop: RectStyle | null): Pose[] {
  const point = basePose(b);
  point.armFront.x += b.armLen * 0.7;
  point.armFront.y -= b.armLen * 0.2;
  if (prop) point.prop = { ...prop, x: prop.x + b.armLen * 0.7, y: prop.y - b.armLen * 0.2 };
  const hold = clone(point);
  hold.bodyTilt = 1;
  return [point, hold];
}

export function crouchStrikeArchetype(b: Build, prop: RectStyle | null): Pose[] {
  const wind = crouchPose(b);
  wind.armFront.x -= 2;

  const hit = crouchPose(b);
  hit.armFront.x += b.armLen * 0.75;
  hit.bodyTilt = 2;
  if (prop) hit.prop = { ...prop, x: prop.x + b.armLen * 0.75, y: prop.y + b.legLen * 0.4 };

  return [wind, hit];
}

export function airStrikeArchetype(b: Build, prop: RectStyle | null): Pose[] {
  const wind = jumpPose(b);
  wind.legFront.y -= 2;

  const hit = jumpPose(b);
  hit.armFront.x += b.armLen * 0.6;
  hit.legFront.x += b.legLen * 0.3;
  hit.legFront.y -= b.legLen * 0.15;
  hit.bodyTilt = 4;
  if (prop) hit.prop = { ...prop, x: prop.x + b.armLen * 0.6 };

  return [wind, hit];
}

export function superWindupPose(b: Build): Pose {
  const p = basePose(b);
  p.armFront.y -= b.armLen * 0.3;
  p.armBack.y -= b.armLen * 0.3;
  p.bodyTilt = -3;
  return p;
}

export function superFinisherPose(b: Build, prop: RectStyle | null): Pose {
  const p = basePose(b);
  p.armFront.x += b.armLen * 1.1;
  p.armFront.y -= b.armLen * 0.4;
  p.bodyTilt = 10;
  if (prop) p.prop = { ...prop, x: prop.x + b.armLen * 1.1, y: prop.y - b.armLen * 0.4 };
  return p;
}
