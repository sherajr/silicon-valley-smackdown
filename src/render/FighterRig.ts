import type { CharacterVisual } from '../sim/types';
import { darken, lighten } from './colorUtil';

/** Fixed canvas footprint for every generated fighter texture, so ground anchors never drift between poses. */
export const RIG_CANVAS_W = 128;
export const RIG_CANVAS_H = 92;
export const RIG_ANCHOR_X = 52;
export const RIG_ANCHOR_Y = 86;

export interface Rect {
  x: number; // local space, +x = character's front (right); mirrored via sprite flipX for facing left
  y: number; // local space, 0 = ground, negative = up
  w: number;
  h: number;
}

export interface RectStyle extends Rect {
  color?: string; // overrides the default part color
}

/** A single posed frame: every body part's rectangle in local space (ground anchor at 0,0). */
export interface Pose {
  legBack: Rect;
  shoeBack: Rect;
  legFront: Rect;
  shoeFront: Rect;
  torso: Rect;
  armBack: Rect;
  head: Rect;
  hair: Rect;
  armFront: Rect;
  prop?: RectStyle | null;
  /** Optional whole-pose lean/rotation-ish offset applied to head+torso+hair for wobble/impact flavor. */
  bodyTilt?: number;
  /** Hides the face (eyes closed/turned away), used for knockdown/KO poses. */
  eyesClosed?: boolean;
}

function drawRect(ctx: CanvasRenderingContext2D, r: Rect, fill: string, outline: string, highlight?: string): void {
  const x = Math.round(RIG_ANCHOR_X + r.x);
  const y = Math.round(RIG_ANCHOR_Y + r.y);
  const w = Math.round(r.w);
  const h = Math.round(r.h);
  ctx.fillStyle = outline;
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  if (highlight && w > 2 && h > 2) {
    ctx.fillStyle = highlight;
    const hs = Math.max(1, Math.round(Math.min(w, h) * 0.28));
    ctx.fillRect(x, y, w - hs, hs);
  }
}

function drawFace(ctx: CanvasRenderingContext2D, head: Rect, outline: string, closed: boolean): void {
  const x = Math.round(RIG_ANCHOR_X + head.x);
  const y = Math.round(RIG_ANCHOR_Y + head.y);
  const w = Math.round(head.w);
  const h = Math.round(head.h);
  // Eyes sit in the front-upper half of the head (facing right = front is +x).
  const eyeY = y + Math.round(h * 0.38);
  const browY = eyeY - 1;
  ctx.fillStyle = outline;
  if (closed) {
    ctx.fillRect(x + Math.round(w * 0.35), eyeY, Math.max(2, Math.round(w * 0.4)), 1);
    return;
  }
  const eyeW = Math.max(1, Math.round(w * 0.16));
  const backEyeX = x + Math.round(w * 0.22);
  const frontEyeX = x + Math.round(w * 0.56);
  ctx.fillRect(backEyeX, eyeY, eyeW, 2);
  ctx.fillRect(frontEyeX, eyeY, eyeW, 2);
  // A tiny brow tick over the front eye reads as "determined" at this scale.
  ctx.fillRect(frontEyeX, browY - 1, eyeW, 1);
}

/** Draws a fully posed character (facing right) onto a fresh canvas sized RIG_CANVAS_W x RIG_CANVAS_H. */
export function renderPose(pose: Pose, visual: CharacterVisual): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = RIG_CANVAS_W;
  canvas.height = RIG_CANVAS_H;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  const outline = visual.outline;
  const tilt = pose.bodyTilt ?? 0;
  const shift = (r: Rect): Rect => ({ ...r, x: r.x + tilt * 0.4 });

  const skinHi = lighten(visual.skin, 0.16);
  const primaryHi = lighten(visual.primary, 0.18);
  const secondaryHi = lighten(visual.secondary, 0.15);
  const hairHi = lighten(visual.hair, 0.2);

  drawRect(ctx, pose.legBack, darken(visual.secondary, 0.18), outline);
  drawRect(ctx, pose.shoeBack, darken(visual.accent, 0.12), outline);
  drawRect(ctx, pose.legFront, visual.secondary, outline, secondaryHi);
  drawRect(ctx, pose.shoeFront, visual.accent, outline, lighten(visual.accent, 0.2));
  drawRect(ctx, pose.torso, visual.primary, outline, primaryHi);
  drawRect(ctx, shift(pose.armBack), darken(visual.skin, 0.14), outline);
  const headRect = shift(pose.head);
  drawRect(ctx, headRect, visual.skin, outline, skinHi);
  drawRect(ctx, shift(pose.hair), visual.hair, outline, hairHi);
  drawFace(ctx, headRect, outline, !!pose.eyesClosed);
  drawRect(ctx, pose.armFront, visual.skin, outline, skinHi);
  if (pose.prop) drawRect(ctx, pose.prop, pose.prop.color ?? visual.accent, outline);

  return canvas;
}

export function highlightRim(canvas: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const ctx = canvas.getContext('2d')!;
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = lighten(color, 0.3);
  ctx.globalAlpha = 0.08;
  ctx.fillRect(0, 0, canvas.width, canvas.height * 0.4);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}
