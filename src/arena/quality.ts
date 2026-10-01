/**
 * Graphics presets and the persisted Arena settings. Pure data and functions: no WebGL, no DOM beyond what the
 * caller passes in, so the migration rules and every preset can be tested in Node.
 *
 * The presets are starting budgets measured on the target laptop (see docs/arena-graphics.md), not guarantees. Quality
 * is only ever changed by the player: nothing here reacts to individual slow frames.
 */
export type QualityTier = 'high' | 'balanced' | 'performance';
export const QUALITY_TIERS: QualityTier[] = ['high', 'balanced', 'performance'];

export interface BloomSettings {
  strength: number;
  radius: number;
  /** Linear HDR luminance above which a pixel blooms. Only named emissives and effect cores exceed it. */
  threshold: number;
  /** Fraction of the render resolution the bloom chain starts from. */
  resolutionScale: number;
}

export interface QualityProfile {
  tier: QualityTier;
  label: string;
  blurb: string;
  /** Shadow map edge in texels; 0 disables real shadows (soft contact shadows remain). */
  shadowSize: number;
  /** Upper bound on devicePixelRatio. */
  maxPixelRatio: number;
  /** Requested MSAA samples for the offscreen HDR target; the actual count is clamped to what the GPU supports. */
  msaa: number;
  /** HDR offscreen pipeline (scene, bloom, one output transform). False renders straight to the canvas. */
  post: boolean;
  bloom: BloomSettings | null;
  /** Procedural reflection environment for tech props, glass and polished materials. */
  environment: boolean;
  /** Additive effect particles, soft dust sprites, and trail ribbons that may be alive at once. */
  particles: number;
  dust: number;
  trails: number;
  /** Strength of the soft contact shadow under each fighter (it is stronger when real shadows are off). */
  contactShadow: number;
  /** Animate ambient scenery (tree sway, drifting clouds) when motion is allowed. */
  ambient: boolean;
}

export const QUALITY: Record<QualityTier, QualityProfile> = {
  high: {
    tier: 'high', label: 'High', blurb: '2048 shadows, anti-aliased HDR, bloom, full effects',
    shadowSize: 2048, maxPixelRatio: 1.5, msaa: 4, post: true, bloom: { strength: 0.3, radius: 0.5, threshold: 1.15, resolutionScale: 1 },
    environment: true, particles: 420, dust: 160, trails: 8, contactShadow: 0.34, ambient: true,
  },
  balanced: {
    tier: 'balanced', label: 'Balanced', blurb: '1024 shadows, lighter bloom and effects',
    shadowSize: 1024, maxPixelRatio: 1.25, msaa: 2, post: true, bloom: { strength: 0.24, radius: 0.42, threshold: 1.2, resolutionScale: 0.5 },
    environment: true, particles: 240, dust: 96, trails: 4, contactShadow: 0.38, ambient: true,
  },
  performance: {
    tier: 'performance', label: 'Performance', blurb: 'No real shadows or post effects, soft contact shadows',
    shadowSize: 0, maxPixelRatio: 1, msaa: 0, post: false, bloom: null,
    environment: true, particles: 120, dust: 48, trails: 2, contactShadow: 0.5, ambient: false,
  },
};

export interface ArenaSettings {
  quality: QualityTier;
  /** Calms ambient scenery and the busiest effect motion. Defaults to the system's reduced-motion preference. */
  reducedMotion: boolean;
  /** Camera shake on heavy hits. An independent preference: reduced motion turns it off by default, not forever. */
  cameraShake: boolean;
  muted: boolean;
  music: boolean;
  difficulty: number;
  items: boolean;
}

export const SETTINGS_KEY = 'svs-arena-v1';

export function defaultSettings(prefersReducedMotion = false): ArenaSettings {
  return { quality: 'high', reducedMotion: prefersReducedMotion, cameraShake: !prefersReducedMotion, muted: false, music: true, difficulty: 1, items: true };
}

const isTier = (v: unknown): v is QualityTier => typeof v === 'string' && (QUALITY_TIERS as string[]).includes(v);

/**
 * Reads whatever was stored under `svs-arena-v1`. Older builds saved `high: boolean` ("High quality shadows"); `true`
 * maps to High and `false` (the player had turned the expensive path off) maps to Performance. Unknown or malformed
 * values fall back to the defaults, and a stored reduced-motion/shake choice always beats the system preference.
 */
export function migrateSettings(saved: unknown, prefersReducedMotion = false): ArenaSettings {
  const out = defaultSettings(prefersReducedMotion);
  if (!saved || typeof saved !== 'object') return out;
  const s = saved as Record<string, unknown>;
  if (isTier(s.quality)) out.quality = s.quality;
  else if (typeof s.high === 'boolean') out.quality = s.high ? 'high' : 'performance';
  if (typeof s.reducedMotion === 'boolean') { out.reducedMotion = s.reducedMotion; if (typeof s.cameraShake !== 'boolean') out.cameraShake = !s.reducedMotion; }
  if (typeof s.cameraShake === 'boolean') out.cameraShake = s.cameraShake;
  for (const key of ['muted', 'music', 'items'] as const) if (typeof s[key] === 'boolean') out[key] = s[key] as boolean;
  if (typeof s.difficulty === 'number' && [0, 1, 2].includes(s.difficulty)) out.difficulty = s.difficulty;
  return out;
}

/** What gets written back. `high` is kept so an older build opening the same storage still reads a sensible value. */
export const serializeSettings = (s: ArenaSettings) => JSON.stringify({ ...s, high: s.quality !== 'performance' });

/** True when a WebGL renderer string names a software rasterizer (SwiftShader, llvmpipe, the Windows basic driver ...). */
export const isSoftwareRendererName = (name: string) => /swiftshader|llvmpipe|softpipe|software|basic render driver|microsoft basic/i.test(name);

/** True when the saved settings already record a graphics choice (new `quality`, or the legacy `high` flag). */
export const hasSavedQuality = (saved: unknown) => !!saved && typeof saved === 'object' && (isTier((saved as Record<string, unknown>).quality) || typeof (saved as Record<string, unknown>).high === 'boolean');

/** Pixel ratio the renderer should use: the display's ratio, capped by the preset, never below 1 unless the display is. */
export const effectivePixelRatio = (devicePixelRatio: number, profile: QualityProfile) => Math.max(0.5, Math.min(devicePixelRatio || 1, profile.maxPixelRatio));

/** MSAA samples to request, clamped to the GPU's limit; 0 means "use the SMAA fallback instead". */
export const clampSamples = (requested: number, maxSamples: number) => (requested <= 0 || maxSamples < 2 ? 0 : Math.min(requested, maxSamples));
