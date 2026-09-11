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
}

function drawRect(ctx: CanvasRenderingContext2D, r: Rect, fill: string, outline: string): void {
  const x = Math.round(RIG_ANCHOR_X + r.x);
  const y = Math.round(RIG_ANCHOR_Y + r.y);
  const w = Math.round(r.w);
  const h = Math.round(r.h);
  ctx.fillStyle = outline;
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
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

  drawRect(ctx, pose.legBack, darken(visual.secondary, 0.15), outline);
  drawRect(ctx, pose.shoeBack, darken(visual.accent, 0.1), outline);
  drawRect(ctx, pose.legFront, visual.secondary, outline);
  drawRect(ctx, pose.shoeFront, visual.accent, outline);
  drawRect(ctx, pose.torso, visual.primary, outline);
  drawRect(ctx, shift(pose.armBack), darken(visual.skin, 0.12), outline);
  drawRect(ctx, shift(pose.head), visual.skin, outline);
  drawRect(ctx, shift(pose.hair), visual.hair, outline);
  drawRect(ctx, pose.armFront, visual.skin, outline);
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
