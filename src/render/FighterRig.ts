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
  /** Small inset highlight drawn on top, e.g. a laptop/tablet screen glow. */
  glowColor?: string;
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

/** Converts a local-space rect to rounded canvas pixel coordinates, using the shared rig anchor. Exported so per-character detail painters can align accessories to the same posed body parts. */
export function rectPx(r: Rect): { x: number; y: number; w: number; h: number } {
  return {
    x: Math.round(RIG_ANCHOR_X + r.x),
    y: Math.round(RIG_ANCHOR_Y + r.y),
    w: Math.round(r.w),
    h: Math.round(r.h),
  };
}

function drawRect(ctx: CanvasRenderingContext2D, r: Rect, fill: string, outline: string, highlight?: string): void {
  const { x, y, w, h } = rectPx(r);
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

/** The posed rect for every body part, in local space -- handed to a DetailPainter so accessories track the body through every pose (anticipation, impact, crouch, knockdown, ...) automatically. */
export interface PoseLayout {
  head: Rect;
  hair: Rect;
  torso: Rect;
  armBack: Rect;
  armFront: Rect;
  legBack: Rect;
  legFront: Rect;
  shoeBack: Rect;
  shoeFront: Rect;
}

/**
 * Draws a character-specific layer of clothing/accessory detail (headphones,
 * vest seams, lapels, glasses, ...) on top of the base rig, using the same
 * posed rects so every accessory follows the body through every animation
 * frame instead of being redrawn by hand per pose.
 */
export type DetailPainter = (ctx: CanvasRenderingContext2D, layout: PoseLayout, visual: CharacterVisual, opts: { eyesClosed: boolean }) => void;

/** Draws a fully posed character (facing right) onto a fresh canvas sized RIG_CANVAS_W x RIG_CANVAS_H. */
export function renderPose(pose: Pose, visual: CharacterVisual, detail?: DetailPainter): HTMLCanvasElement {
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
  const pantsHi = lighten(visual.pants, 0.15);
  const hairHi = lighten(visual.hair, 0.2);

  const legBackRect = pose.legBack;
  const shoeBackRect = pose.shoeBack;
  const legFrontRect = pose.legFront;
  const shoeFrontRect = pose.shoeFront;
  const torsoRect = pose.torso;
  const armBackRect = shift(pose.armBack);
  const headRect = shift(pose.head);
  const hairRect = shift(pose.hair);
  const armFrontRect = pose.armFront;

  drawRect(ctx, legBackRect, darken(visual.pants, 0.18), outline);
  drawRect(ctx, shoeBackRect, darken(visual.accent, 0.12), outline);
  drawRect(ctx, legFrontRect, visual.pants, outline, pantsHi);
  drawRect(ctx, shoeFrontRect, visual.accent, outline, lighten(visual.accent, 0.2));
  drawRect(ctx, torsoRect, visual.primary, outline, primaryHi);
  drawRect(ctx, armBackRect, darken(visual.skin, 0.14), outline);
  drawRect(ctx, headRect, visual.skin, outline, skinHi);
  drawRect(ctx, hairRect, visual.hair, outline, hairHi);
  drawFace(ctx, headRect, outline, !!pose.eyesClosed);
  drawRect(ctx, armFrontRect, visual.skin, outline, skinHi);

  if (detail) {
    const layout: PoseLayout = {
      head: headRect,
      hair: hairRect,
      torso: torsoRect,
      armBack: armBackRect,
      armFront: armFrontRect,
      legBack: legBackRect,
      legFront: legFrontRect,
      shoeBack: shoeBackRect,
      shoeFront: shoeFrontRect,
    };
    detail(ctx, layout, visual, { eyesClosed: !!pose.eyesClosed });
  }

  if (pose.prop) {
    drawRect(ctx, pose.prop, pose.prop.color ?? visual.accent, outline);
    if (pose.prop.glowColor) {
      const { x, y, w, h } = rectPx(pose.prop);
      ctx.fillStyle = pose.prop.glowColor;
      ctx.fillRect(x + Math.round(w * 0.16), y + Math.round(h * 0.14), Math.max(1, Math.round(w * 0.68)), Math.max(1, Math.round(h * 0.4)));
    }
  }

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
