// Restrained presets for the laptop this was built for (see docs/3d-conversion-checklist.md for
// the measured budget): capped pixel ratio and optional shadows, nothing more elaborate. Timing
// is identical across every preset -- these only ever affect presentation, never simulation.
export type GraphicsQuality = 'low' | 'medium' | 'high';

export interface GraphicsSettings {
  quality: GraphicsQuality;
  maxPixelRatio: number;
  shadows: boolean;
}

const PRESETS: Record<GraphicsQuality, GraphicsSettings> = {
  low: { quality: 'low', maxPixelRatio: 1, shadows: false },
  medium: { quality: 'medium', maxPixelRatio: 1.5, shadows: true },
  high: { quality: 'high', maxPixelRatio: 2, shadows: true },
};

export function graphicsSettingsFor(quality: GraphicsQuality): GraphicsSettings {
  return PRESETS[quality];
}
