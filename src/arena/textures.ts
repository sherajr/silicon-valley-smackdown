import * as T from 'three';
import { context2d, makeCanvas, mulberry32 } from './canvasUtil';

/**
 * Procedural textures: surface paint, building facades, sky clouds, soft sprites and signs. All drawn on 2D canvases
 * at load time from fixed seeds. Colour maps are sRGB, data maps are not, every colour map gets mipmaps and the
 * anisotropy the caller asks for, so painted lines stay stable instead of shimmering as the camera moves.
 */
export interface TexOpts { anisotropy: number }
interface FinishOptions { srgb?: boolean; repeat?: boolean }

function finish(canvas: HTMLCanvasElement, opts: TexOpts, o: FinishOptions = {}) {
  const tex = new T.CanvasTexture(canvas);
  tex.colorSpace = o.srgb === false ? T.NoColorSpace : T.SRGBColorSpace;
  tex.anisotropy = Math.max(1, opts.anisotropy);
  if (o.repeat) tex.wrapS = tex.wrapT = T.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** Bilinear value noise as a translucent black/white layer, drawn small and scaled up so it stays soft and cheap. */
function noiseLayer(w: number, h: number, cell: number, seed: number, amp: number) {
  const canvas = makeCanvas(w, h), ctx = context2d(canvas), img = ctx.createImageData(w, h), rnd = mulberry32(seed);
  const gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2, grid = new Float32Array(gw * gh);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();
  const smooth = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / cell, v = y / cell, i = Math.floor(u), j = Math.floor(v), su = smooth(u - i), sv = smooth(v - j);
    const a = grid[j * gw + i], b = grid[j * gw + i + 1], c = grid[(j + 1) * gw + i], d = grid[(j + 1) * gw + i + 1];
    const n = (a + (b - a) * su) * (1 - sv) + (c + (d - c) * su) * sv, delta = (n - 0.5) * 2 * amp, o = (y * w + x) * 4;
    const level = delta > 0 ? 255 : 0;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = level; img.data[o + 3] = Math.min(255, Math.abs(delta) * 255);
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function grain(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number, layers: [number, number][]) {
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  layers.forEach(([cell, amp], i) => ctx.drawImage(noiseLayer(Math.ceil(w / 4), Math.ceil(h / 4), Math.max(2, cell / 4), seed + i * 977, amp), 0, 0, w, h));
}

// ---------------------------------------------------------------------------------------------------------------
// Platform surfaces
// ---------------------------------------------------------------------------------------------------------------
export interface RoofSpec {
  /** Platform width and visual depth in world units. */
  w: number; d: number;
  kind: 'main' | 'upper';
  base: string; seam: string; edge: string; edgeDark: string; mark: string;
  /** Guide paint that also goes into an emissive map (launch pad lines). Null for none. */
  glow: string | null;
  seed: number;
}

/**
 * The walkable top of a platform, painted once. Row 0 is the back edge (z = -d/2), the last row the front edge, and
 * x runs left to right, which is exactly how a box's +y face is mapped. Seams are broad and low contrast and live in
 * the texture, so there is exactly one exposed surface and nothing for the depth buffer to fight over.
 */
export function roofTextures(spec: RoofSpec, opts: TexOpts): { map: T.CanvasTexture; glow: T.CanvasTexture | null } {
  const ppu = spec.kind === 'main' ? 56 : 96, W = Math.round(spec.w * ppu), H = Math.round(spec.d * ppu);
  const canvas = makeCanvas(W, H), ctx = context2d(canvas);
  const X = (x: number) => (x + spec.w / 2) * ppu, Z = (z: number) => (z + spec.d / 2) * ppu, S = (len: number) => len * ppu;
  const line = (x0: number, z0: number, x1: number, z1: number, width: number, color: string, alpha: number, dash?: number[]) => {
    ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash ?? []);
    ctx.beginPath(); ctx.moveTo(x0, z0); ctx.lineTo(x1, z1); ctx.stroke(); ctx.restore();
  };
  ctx.fillStyle = spec.base; ctx.fillRect(0, 0, W, H);
  grain(ctx, W, H, spec.seed, [[W / 5, 0.07], [10, 0.05]]);

  // Broad deck seams with a faint highlight beside each one.
  const stepX = spec.kind === 'main' ? 1.5 : 1.0, stepZ = spec.kind === 'main' ? 1.7 : spec.d;
  for (let x = -spec.w / 2 + stepX; x < spec.w / 2 - 0.01; x += stepX) { line(X(x), 0, X(x), H, 3.2, spec.seam, 0.26); line(X(x) + 2.5, 0, X(x) + 2.5, H, 1.2, '#ffffff', 0.06); }
  if (spec.kind === 'main') for (let z = -spec.d / 2 + stepZ; z < spec.d / 2 - 0.01; z += stepZ) { line(0, Z(z), W, Z(z), 3.2, spec.seam, 0.26); line(0, Z(z) + 2.5, W, Z(z) + 2.5, 1.2, '#ffffff', 0.06); }

  // Hazard bands along the two ends, striped, with the platform's gold edge colour.
  const band = S(spec.kind === 'main' ? 0.46 : 0.30);
  for (const x0 of [0, W - band]) {
    ctx.save(); ctx.beginPath(); ctx.rect(x0, 0, band, H); ctx.clip();
    ctx.globalAlpha = 0.94; ctx.fillStyle = spec.edge; ctx.fillRect(x0, 0, band, H);
    ctx.globalAlpha = 0.55; ctx.fillStyle = spec.edgeDark;
    const pitch = S(0.7), thick = S(0.26);
    for (let z = -band; z < H + band; z += pitch) { ctx.beginPath(); ctx.moveTo(x0, z + thick); ctx.lineTo(x0 + band, z + thick - band); ctx.lineTo(x0 + band, z - band); ctx.lineTo(x0, z); ctx.closePath(); ctx.fill(); }
    ctx.restore();
    line(x0 === 0 ? band : x0, 0, x0 === 0 ? band : x0, H, 2, '#000000', 0.28);
  }

  // Edge lines painted along the front and back.
  line(band, Z(spec.d / 2 - 0.2), W - band, Z(spec.d / 2 - 0.2), S(0.07), spec.mark, spec.kind === 'main' ? 0.78 : 0.0);
  line(band, Z(-spec.d / 2 + 0.2), W - band, Z(-spec.d / 2 + 0.2), S(0.05), spec.mark, spec.kind === 'main' ? 0.45 : 0.0);
  if (spec.kind === 'upper') {
    // A dashed front edge reads as "this one you can pass through".
    line(band + 2, Z(spec.d / 2 - 0.13), W - band - 2, Z(spec.d / 2 - 0.13), S(0.07), spec.mark, 0.62, [S(0.26), S(0.16)]);
    line(band + 2, Z(-spec.d / 2 + 0.12), W - band - 2, Z(-spec.d / 2 + 0.12), S(0.04), spec.mark, 0.3);
  }

  const glowCanvas = spec.glow ? makeCanvas(W, H) : null, gctx = glowCanvas ? context2d(glowCanvas) : null;
  if (gctx) { gctx.fillStyle = '#000'; gctx.fillRect(0, 0, W, H); }
  const both = (fn: (c: CanvasRenderingContext2D, color: string, alpha: number) => void, color: string, alpha: number) => { fn(ctx, color, alpha); if (gctx && spec.glow) fn(gctx, spec.glow, 1); };

  if (spec.kind === 'main') {
    // Centre badge: two rings and a monogram, plus quiet spawn marks.
    both((c, color, alpha) => {
      c.save(); c.globalAlpha = alpha; c.strokeStyle = color; c.lineWidth = S(0.075); c.beginPath(); c.arc(X(0), Z(0), S(1.2), 0, Math.PI * 2); c.stroke();
      c.lineWidth = S(0.035); c.beginPath(); c.arc(X(0), Z(0), S(0.93), 0, Math.PI * 2); c.stroke();
      c.font = `italic 900 ${S(0.72)}px "Arial Black", Arial, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = color; c.globalAlpha = alpha * 0.8; c.fillText('SV', X(0), Z(0) + 2); c.restore();
    }, spec.mark, 0.86);
    for (const sx of [-4, 4]) both((c, color, alpha) => { c.save(); c.globalAlpha = alpha; c.strokeStyle = color; c.lineWidth = S(0.05); c.beginPath(); c.moveTo(X(sx) - S(0.28), Z(0)); c.lineTo(X(sx) + S(0.28), Z(0)); c.moveTo(X(sx), Z(0) - S(0.28)); c.lineTo(X(sx), Z(0) + S(0.28)); c.stroke(); c.restore(); }, spec.mark, 0.36);
    if (gctx && spec.glow) {
      // Launch-pad guide paint: border rectangle and chevrons, in the emissive map only.
      gctx.strokeStyle = spec.glow; gctx.lineWidth = S(0.06); gctx.strokeRect(band + S(0.35), S(0.35), W - 2 * band - S(0.7), H - S(0.7));
      for (const dir of [-1, 1]) for (let i = 0; i < 3; i++) { const cx = X(dir * (3.2 + i * 0.55)); gctx.beginPath(); gctx.moveTo(cx - dir * S(0.16), Z(-0.4)); gctx.lineTo(cx + dir * S(0.16), Z(0)); gctx.lineTo(cx - dir * S(0.16), Z(0.4)); gctx.lineWidth = S(0.07); gctx.stroke(); }
    }
    // A soft pool of light under the centre badge, and a little darkening toward the front and back edges.
    const pool = ctx.createRadialGradient(X(0), Z(0), 0, X(0), Z(0), S(5.5)); pool.addColorStop(0, 'rgba(255,238,215,0.10)'); pool.addColorStop(1, 'rgba(255,238,215,0)');
    ctx.fillStyle = pool; ctx.fillRect(0, 0, W, H);
  }
  const edgeShade = ctx.createLinearGradient(0, 0, 0, H); edgeShade.addColorStop(0, 'rgba(0,0,0,0.10)'); edgeShade.addColorStop(0.18, 'rgba(0,0,0,0)'); edgeShade.addColorStop(0.86, 'rgba(0,0,0,0)'); edgeShade.addColorStop(1, 'rgba(0,0,0,0.08)');
  ctx.fillStyle = edgeShade; ctx.fillRect(0, 0, W, H);
  return { map: finish(canvas, opts), glow: glowCanvas ? finish(glowCanvas, opts) : null };
}

// ---------------------------------------------------------------------------------------------------------------
// Building facades
// ---------------------------------------------------------------------------------------------------------------
export interface FacadeSpec {
  cols: number; rows: number;
  wall: string; spandrel: string; glass: string; mullion: string;
  /** Colours a lit window can take, and the share of windows that are lit. */
  lit: string[]; litRatio: number;
  /** Glass reflection sheen (0 for plain windows). */
  sheen: number;
  seed: number;
}
export const FACADE_CELL = { w: 0.95, h: 1.25 };

/** One repeating tile of windows. The emissive map holds only the lit windows, so they glow without lighting the wall. */
export function facadeTextures(spec: FacadeSpec, opts: TexOpts): { map: T.CanvasTexture; glow: T.CanvasTexture; tileW: number; tileH: number } {
  const cw = 64, ch = 84, W = spec.cols * cw, H = spec.rows * ch, rnd = mulberry32(spec.seed);
  const canvas = makeCanvas(W, H), ctx = context2d(canvas), glowCanvas = makeCanvas(W, H), gctx = context2d(glowCanvas);
  ctx.fillStyle = spec.wall; ctx.fillRect(0, 0, W, H); gctx.fillStyle = '#000'; gctx.fillRect(0, 0, W, H);
  grain(ctx, W, H, spec.seed, [[40, 0.05]]);
  for (let r = 0; r < spec.rows; r++) {
    // Whole floors tend to be lit or dark together, which reads as offices instead of a random grid.
    const floorBias = 0.25 + rnd() * 1.5;
    // Floor slab (spandrel) between window rows.
    ctx.fillStyle = spec.spandrel; ctx.globalAlpha = 0.9; ctx.fillRect(0, r * ch + ch - 11, W, 11); ctx.globalAlpha = 1;
    for (let c = 0; c < spec.cols; c++) {
      const x = c * cw + 9, y = r * ch + 10, w = cw - 18, h = ch - 32, lit = rnd() < spec.litRatio * floorBias, color = spec.lit[Math.floor(rnd() * spec.lit.length)], level = 0.45 + rnd() * 0.45;
      const glass = ctx.createLinearGradient(0, y, 0, y + h);
      if (lit) { glass.addColorStop(0, color); glass.addColorStop(1, color); ctx.globalAlpha = 0.28 + level * 0.2; } else { glass.addColorStop(0, spec.glass); glass.addColorStop(1, '#0a131b'); ctx.globalAlpha = 1; }
      ctx.fillStyle = glass; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1;
      if (!lit && spec.sheen > 0) { ctx.fillStyle = `rgba(255,255,255,${0.10 * spec.sheen})`; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w * 0.55, y); ctx.lineTo(x, y + h * 0.5); ctx.closePath(); ctx.fill(); }
      if (lit) { const g = gctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, color); g.addColorStop(1, color); gctx.globalAlpha = level; gctx.fillStyle = g; gctx.fillRect(x, y, w, h); gctx.globalAlpha = 1; }
      ctx.strokeStyle = spec.mullion; ctx.lineWidth = 2; ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
    }
  }
  return { map: finish(canvas, opts, { repeat: true }), glow: finish(glowCanvas, opts, { repeat: true }), tileW: spec.cols * FACADE_CELL.w, tileH: spec.rows * FACADE_CELL.h };
}

// ---------------------------------------------------------------------------------------------------------------
// Sky, sprites and signs
// ---------------------------------------------------------------------------------------------------------------
/** Soft elongated cloud streaks, warm on the left (sun side) and cool on the right. Static, tiled horizontally. */
export function cloudTexture(seed: number, warm: string, cool: string, opts: TexOpts) {
  const W = 1024, H = 192, canvas = makeCanvas(W, H), ctx = context2d(canvas), rnd = mulberry32(seed);
  for (let i = 0; i < 34; i++) {
    const x = rnd() * W, y = H * (0.18 + rnd() * 0.64), rx = 70 + rnd() * 190, ry = 8 + rnd() * 20, alpha = 0.10 + rnd() * 0.16;
    for (const dx of [-W, 0, W]) {
      ctx.save(); ctx.translate(x + dx, y); ctx.scale(1, ry / rx);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx), color = x < W * 0.5 ? warm : cool;
      g.addColorStop(0, hexAlpha(color, alpha)); g.addColorStop(0.6, hexAlpha(color, alpha * 0.45)); g.addColorStop(1, hexAlpha(color, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
  }
  return finish(canvas, opts, { repeat: true });
}

function hexAlpha(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** White radial falloff: tint it with the material colour. Used for sun halo, lamp glow, effect flashes. */
export function glowSpriteTexture(opts: TexOpts) {
  const canvas = makeCanvas(128, 128), ctx = context2d(canvas), g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.18, 'rgba(255,255,255,0.62)'); g.addColorStop(0.45, 'rgba(255,255,255,0.18)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  return finish(canvas, opts);
}

/** Dark, soft-edged blob for the contact shadow under a fighter. */
export function contactShadowTexture(opts: TexOpts) {
  const canvas = makeCanvas(128, 128), ctx = context2d(canvas), g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.3, 'rgba(0,0,0,0.62)'); g.addColorStop(0.65, 'rgba(0,0,0,0.16)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  return finish(canvas, opts);
}

export interface SignSpec { text: string; w: number; h: number; bg: string; ink: string; font?: number; glow?: string | null; border?: string | null }
/** A sign texture. Neon signs (glow set) get a bright rim and a halo so they bloom in the HDR pipeline. */
export function signTexture(s: SignSpec, opts: TexOpts) {
  const W = 768, H = Math.round(768 * s.h / s.w), canvas = makeCanvas(W, H), ctx = context2d(canvas);
  ctx.fillStyle = s.bg; ctx.fillRect(0, 0, W, H);
  if (s.border) { ctx.strokeStyle = s.border; ctx.lineWidth = 6; ctx.strokeRect(10, 10, W - 20, H - 20); }
  ctx.font = `800 ${s.font ?? 56}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (s.glow) { ctx.save(); ctx.shadowColor = s.glow; ctx.shadowBlur = 22; ctx.fillStyle = s.ink; ctx.fillText(s.text, W / 2, H / 2 + 2, W - 50); ctx.restore(); }
  ctx.fillStyle = s.ink; ctx.fillText(s.text, W / 2, H / 2 + 2, W - 50);
  return finish(canvas, opts);
}
