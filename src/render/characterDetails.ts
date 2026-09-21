import { rectPx, type DetailPainter, type PoseLayout, type Rect } from './FighterRig';
import { darken, lighten } from './colorUtil';
import type { CharacterVisual, FighterId } from '../sim/types';

/**
 * Per-character layers of clothing/accessory detail, painted on top of the
 * base rig using the same posed rects (see PoseLayout) so every accessory
 * tracks the body through anticipation, contact, crouch, knockdown, etc.
 * instead of being an ambiguous shared body-part color.
 */

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, width = 1): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1 + 0.5, y1 + 0.5);
  ctx.lineTo(x2 + 0.5, y2 + 0.5);
  ctx.stroke();
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function ring(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, width = 1): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, color: string): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
  ctx.fill();
}

const drawHunterDetails: DetailPainter = (ctx, layout, visual) => {
  const head = rectPx(layout.head);
  const torso = rectPx(layout.torso);
  const legF = rectPx(layout.legFront);
  const legB = rectPx(layout.legBack);
  const shoeF = rectPx(layout.shoeFront);
  const shoeB = rectPx(layout.shoeBack);

  // Large charcoal over-ear headphones: a headband arcing over the hair, two earcups with a cool highlight.
  const band = '#22242b';
  const pad = lighten(band, 0.12);
  const cx = head.x + head.w * 0.5;
  const topY = head.y - 1;
  ctx.strokeStyle = band;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, topY + head.h * 0.15, head.w * 0.62, Math.PI * 1.08, Math.PI * 1.92);
  ctx.stroke();
  const earY = head.y + head.h * 0.5;
  dot(ctx, head.x - 1, earY, 3.2, band);
  dot(ctx, head.x + head.w + 1, earY, 3.2, band);
  dot(ctx, head.x - 1, earY, 1.4, pad);
  dot(ctx, head.x + head.w + 1, earY - 0.6, 1.1, visual.accent); // cyan highlight on the front cup

  // Hoodie hood peeking behind the neck/shoulder + drawstrings at the collar.
  ctx.fillStyle = darken(visual.primary, 0.08);
  ctx.fillRect(torso.x - 1, torso.y - 1, 5, 4);
  line(ctx, torso.x + torso.w * 0.42, torso.y + 1, torso.x + torso.w * 0.4, torso.y + 5, '#e7e9ec', 1);
  line(ctx, torso.x + torso.w * 0.55, torso.y + 1, torso.x + torso.w * 0.53, torso.y + 5, '#e7e9ec', 1);

  // Quilted puffer vest over the hoodie: narrower than the torso (hoodie sleeves show), zipper + horizontal baffles + pockets.
  const vx = torso.x + 1;
  const vw = Math.max(2, torso.w - 2);
  const vy = torso.y + 1;
  const vh = Math.max(2, torso.h - 2);
  rounded(ctx, vx, vy, vw, vh, 1, visual.secondary);
  ctx.strokeStyle = darken(visual.secondary, 0.3);
  ctx.lineWidth = 1;
  for (const frac of [0.32, 0.6]) line(ctx, vx + 1, vy + vh * frac, vx + vw - 1, vy + vh * frac, darken(visual.secondary, 0.3));
  line(ctx, vx + vw * 0.5, vy, vx + vw * 0.5, vy + vh, lighten(visual.secondary, 0.3)); // zipper
  ctx.fillStyle = darken(visual.secondary, 0.2);
  ctx.fillRect(vx + 1, vy + vh * 0.68, Math.max(1, vw * 0.32), Math.max(1, vh * 0.18));
  ctx.fillRect(vx + vw - Math.max(1, vw * 0.32) - 1, vy + vh * 0.68, Math.max(1, vw * 0.32), Math.max(1, vh * 0.18));

  // Jeans: a seam down each leg and a darker knee band.
  for (const leg of [legB, legF]) {
    line(ctx, leg.x + leg.w * 0.5, leg.y + 2, leg.x + leg.w * 0.5, leg.y + leg.h - 1, darken(visual.pants, 0.35));
    ctx.fillStyle = darken(visual.pants, 0.22);
    ctx.fillRect(leg.x, leg.y + leg.h * 0.55, leg.w, Math.max(1, leg.h * 0.12));
  }

  // Sneakers: bright sole strip + lace ticks.
  for (const shoe of [shoeB, shoeF]) {
    ctx.fillStyle = '#eef2f5';
    ctx.fillRect(shoe.x, shoe.y + shoe.h - 1, shoe.w, 1);
    ctx.fillStyle = '#c7ccd1';
    ctx.fillRect(shoe.x + 1, shoe.y, Math.max(1, shoe.w - 2), 1);
  }

  // A couple of warm highlight streaks in the swept-up hair.
  const hair = rectPx(layout.hair);
  line(ctx, hair.x + hair.w * 0.3, hair.y + 1, hair.x + hair.w * 0.22, hair.y + hair.h * 0.7, lighten(visual.hair, 0.32));
  line(ctx, hair.x + hair.w * 0.62, hair.y + 1, hair.x + hair.w * 0.7, hair.y + hair.h * 0.6, lighten(visual.hair, 0.28));
};

const drawKevinDetails: DetailPainter = (ctx, layout, visual) => {
  const head = rectPx(layout.head);
  const torso = rectPx(layout.torso);
  const shoeF = rectPx(layout.shoeFront);

  // Suit lapels: two diagonals from the shoulders toward the chest.
  ctx.strokeStyle = darken(visual.primary, 0.35);
  ctx.lineWidth = 1;
  line(ctx, torso.x + 1, torso.y, torso.x + torso.w * 0.42, torso.y + torso.h * 0.55, darken(visual.primary, 0.35));
  line(ctx, torso.x + torso.w - 1, torso.y, torso.x + torso.w * 0.58, torso.y + torso.h * 0.55, darken(visual.primary, 0.35));

  // Necktie down the center.
  ctx.fillStyle = visual.secondary;
  ctx.fillRect(torso.x + torso.w * 0.46, torso.y + 1, Math.max(1, torso.w * 0.1), torso.h - 2);

  // Thin glasses across the eye line.
  const eyeY = head.y + Math.round(head.h * 0.38);
  ring(ctx, head.x + head.w * 0.32, eyeY, 2.2, visual.accent);
  ring(ctx, head.x + head.w * 0.66, eyeY, 2.2, visual.accent);
  line(ctx, head.x + head.w * 0.4, eyeY, head.x + head.w * 0.58, eyeY, visual.accent);

  // Polished shoe shine.
  dot(ctx, shoeF.x + shoeF.w * 0.7, shoeF.y + 1, 0.9, '#ffffff');
};

const drawAlDetails: DetailPainter = (ctx, layout, visual) => {
  const torso = rectPx(layout.torso);
  const head = rectPx(layout.head);

  // Rumpled shirt: a couple of loose wrinkle scribbles instead of a crisp block.
  const wrinkle = darken(visual.primary, 0.25);
  line(ctx, torso.x + torso.w * 0.2, torso.y + torso.h * 0.3, torso.x + torso.w * 0.4, torso.y + torso.h * 0.42, wrinkle);
  line(ctx, torso.x + torso.w * 0.55, torso.y + torso.h * 0.6, torso.x + torso.w * 0.75, torso.y + torso.h * 0.5, wrinkle);

  // A loose, crooked tie hanging off-center.
  ctx.fillStyle = visual.secondary;
  ctx.save();
  ctx.translate(torso.x + torso.w * 0.58, torso.y);
  ctx.rotate(0.18);
  ctx.fillRect(0, 0, Math.max(1, torso.w * 0.09), torso.h - 1);
  ctx.restore();

  // A small worried sweat-drop for comic imbalance.
  dot(ctx, head.x + head.w + 1, head.y + head.h * 0.25, 1.1, '#bfe3ff');
};

const drawPriyaDetails: DetailPainter = (ctx, layout, visual) => {
  const torso = rectPx(layout.torso);
  const head = rectPx(layout.head);
  const shoeF = rectPx(layout.shoeFront);

  // Bright blazer lapels.
  ctx.strokeStyle = lighten(visual.primary, 0.2);
  line(ctx, torso.x + 1, torso.y, torso.x + torso.w * 0.4, torso.y + torso.h * 0.5, lighten(visual.primary, 0.2));
  line(ctx, torso.x + torso.w - 1, torso.y, torso.x + torso.w * 0.6, torso.y + torso.h * 0.5, lighten(visual.primary, 0.2));

  // Headset: an arc over one ear with a short mic boom.
  const earX = head.x + head.w + 1;
  const earY = head.y + head.h * 0.42;
  ctx.strokeStyle = visual.secondary;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(head.x + head.w * 0.5, head.y - 1, head.w * 0.52, Math.PI * 1.15, Math.PI * 1.65);
  ctx.stroke();
  line(ctx, earX, earY, earX + 2, earY + 2, visual.secondary);
  dot(ctx, earX + 2, earY + 2, 0.9, visual.secondary);

  // Sneaker accent stripe.
  ctx.fillStyle = visual.accent;
  ctx.fillRect(shoeF.x + 1, shoeF.y, Math.max(1, shoeF.w - 2), 1);
};

const drawChadDetails: DetailPainter = (ctx, layout, visual) => {
  const head = rectPx(layout.head);
  const torso = rectPx(layout.torso);
  const armFront = rectPx(layout.armFront);

  // Sunglasses across the eye line.
  const eyeY = head.y + Math.round(head.h * 0.36);
  ctx.fillStyle = visual.secondary;
  ctx.fillRect(head.x + head.w * 0.18, eyeY - 1, head.w * 0.7, Math.max(2, head.h * 0.16));
  dot(ctx, head.x + head.w * 0.2, eyeY, 0.8, lighten(visual.secondary, 0.5));

  // Popped collar.
  line(ctx, torso.x + torso.w * 0.3, torso.y, torso.x + torso.w * 0.42, torso.y - 2, lighten(visual.primary, 0.25));
  line(ctx, torso.x + torso.w * 0.7, torso.y, torso.x + torso.w * 0.58, torso.y - 2, lighten(visual.primary, 0.25));

  // Gold watch tick.
  dot(ctx, armFront.x + armFront.w * 0.5, armFront.y + armFront.h * 0.8, 1, visual.accent);
};

const drawElonDetails: DetailPainter = (ctx, layout, visual) => {
  const torso = rectPx(layout.torso);
  const shoeF = rectPx(layout.shoeFront);

  // Jacket zipper + collar.
  line(ctx, torso.x + torso.w * 0.5, torso.y + 1, torso.x + torso.w * 0.5, torso.y + torso.h - 1, lighten(visual.primary, 0.3));
  line(ctx, torso.x + torso.w * 0.35, torso.y, torso.x + torso.w * 0.46, torso.y + 3, visual.secondary);
  line(ctx, torso.x + torso.w * 0.65, torso.y, torso.x + torso.w * 0.54, torso.y + 3, visual.secondary);

  // A small fin accent on the front boot -- a quiet nod to the rocket.
  ctx.fillStyle = visual.accent;
  ctx.beginPath();
  ctx.moveTo(shoeF.x + shoeF.w * 0.7, shoeF.y);
  ctx.lineTo(shoeF.x + shoeF.w * 0.95, shoeF.y);
  ctx.lineTo(shoeF.x + shoeF.w * 0.82, shoeF.y - 3);
  ctx.closePath();
  ctx.fill();
};

const drawMaulDetails: DetailPainter = (ctx, layout, visual, opts) => {
  const head = rectPx(layout.head);
  const torso = rectPx(layout.torso);

  // Crown of horns: short spikes around the top of the skull, the silhouette cue that survives
  // even when the whole figure is a dark shape a dozen pixels wide.
  ctx.fillStyle = lighten('#6f6047', 0.1);
  const crownY = head.y + 1;
  for (const [fx, h] of [[0.18, 3], [0.38, 4], [0.6, 4], [0.82, 3]] as const) {
    const hx = head.x + head.w * fx;
    ctx.beginPath();
    ctx.moveTo(hx - 1, crownY);
    ctx.lineTo(hx + 1, crownY);
    ctx.lineTo(hx, crownY - h);
    ctx.closePath();
    ctx.fill();
  }

  // Zabrak facial tattoo, reduced to the two shapes that still read at this size: a black band
  // across the brow and a wedge down the centre of the face.
  const ink = darken(visual.outline, 0.2);
  line(ctx, head.x + 1, head.y + head.h * 0.34, head.x + head.w - 2, head.y + head.h * 0.34, ink);
  line(ctx, head.x + head.w * 0.5, head.y + head.h * 0.38, head.x + head.w * 0.5, head.y + head.h - 2, ink);

  if (!opts.eyesClosed) {
    dot(ctx, head.x + head.w * 0.34, head.y + head.h * 0.46, 0.8, '#ffb300');
    dot(ctx, head.x + head.w * 0.66, head.y + head.h * 0.46, 0.8, '#ffb300');
  }

  // Hooded robe: a V of darker cloth over the chest, and the belt.
  line(ctx, torso.x + torso.w * 0.28, torso.y, torso.x + torso.w * 0.5, torso.y + torso.h * 0.45, visual.secondary);
  line(ctx, torso.x + torso.w * 0.72, torso.y, torso.x + torso.w * 0.5, torso.y + torso.h * 0.45, visual.secondary);
  ctx.fillStyle = darken(visual.secondary, 0.25);
  ctx.fillRect(torso.x, torso.y + torso.h - 3, torso.w, 2);
};

const PAINTERS: Record<FighterId, DetailPainter> = {
  hunter: drawHunterDetails,
  kevin: drawKevinDetails,
  al: drawAlDetails,
  priya: drawPriyaDetails,
  chad: drawChadDetails,
  maul: drawMaulDetails,
  elon: drawElonDetails,
};

export function detailPainterFor(id: FighterId): DetailPainter {
  return PAINTERS[id];
}

// Re-exported so callers of this module don't need a separate FighterRig import just for the type.
export type { DetailPainter, PoseLayout, Rect };
export type { CharacterVisual };
