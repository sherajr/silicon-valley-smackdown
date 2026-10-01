/**
 * The look of each arena as plain data: sky, fog, the three-light rig, exposure and the paint palette. The stage
 * builder reads it to make geometry and textures, and the renderer reads it to set the lights, so the two always agree.
 *
 * Direction of the light: the visible sun sits low behind the stage, while the shadow-casting key comes from the camera
 * side so fighters stay readable. A warm rim from the sun side and a cool rim from the other side give each fighter a
 * controlled edge light.
 */
export type Vec3 = [number, number, number];
export interface StageTheme {
  id: 'castro' | 'sandhill' | 'launch';
  name: string;
  night: boolean;
  sky: { top: string; mid: string; bottom: string; sunDir: Vec3; sunColor: string; halo: string; sunSize: number; sunBoost: number; cloudWarm: string; cloudCool: string };
  fog: { color: string; near: number; far: number };
  hemi: { sky: string; ground: string; intensity: number };
  key: { color: string; intensity: number; position: Vec3 };
  rim: { color: string; intensity: number; position: Vec3 };
  sunRim: { color: string; intensity: number; position: Vec3 };
  exposure: number;
  environmentIntensity: number;
  /** Contact-shadow tint. */
  shadow: string;
  roof: { base: string; seam: string; edge: string; edgeDark: string; mark: string; glow: string | null; upperBase: string };
  walls: string[];
  spandrel: string;
  lit: string[];
  litRatio: number;
  glass: boolean;
  /** Mountain ridge colours (back to front): [top, bottom]. */
  ridges: [string, string][];
  fascia: string;
  trim: string;
}

export const STAGE_THEMES: StageTheme[] = [
  {
    id: 'castro', name: 'Castro Street', night: false,
    sky: { top: '#1d3b58', mid: '#8a6d8b', bottom: '#f4a67c', sunDir: [-0.4, 0.045, -0.91], sunColor: '#ffd8a6', halo: '#ff9c6e', sunSize: 0.09, sunBoost: 5.5, cloudWarm: '#ffc19a', cloudCool: '#b69ac8' },
    fog: { color: '#9b8392', near: 42, far: 128 },
    hemi: { sky: '#c4e4ff', ground: '#6a5a5c', intensity: 1.15 },
    key: { color: '#ffd9ac', intensity: 2.9, position: [-9, 15, 10] },
    rim: { color: '#78c4ff', intensity: 1.5, position: [7, 6, -8] },
    sunRim: { color: '#ff9a68', intensity: 1.5, position: [-9, 5, -9] },
    exposure: 1.0, environmentIntensity: 0.55, shadow: '#16283a',
    roof: { base: '#557a80', seam: '#2b4a52', edge: '#dcb764', edgeDark: '#26353b', mark: '#eaf5ee', glow: null, upperBase: '#7e9d9a' },
    walls: ['#35546a', '#3e5e70', '#2c485c', '#46606f'], spandrel: '#233a4c', lit: ['#ffc58e', '#ffd9a8', '#ffb27a'], litRatio: 0.3, glass: false,
    ridges: [['#9a89a4', '#b88f94'], ['#7b7e9a', '#9f8794'], ['#5b6f88', '#8a8190']],
    fascia: '#1c2c36', trim: '#e9ddc0',
  },
  {
    id: 'sandhill', name: 'Sand Hill Road', night: false,
    sky: { top: '#192d55', mid: '#6d6c9a', bottom: '#f6b46a', sunDir: [-0.36, 0.035, -0.93], sunColor: '#ffe2a8', halo: '#ffb060', sunSize: 0.105, sunBoost: 6.0, cloudWarm: '#ffd09a', cloudCool: '#9aa4d4' },
    fog: { color: '#a28b82', near: 44, far: 130 },
    hemi: { sky: '#c9dcff', ground: '#6d5c48', intensity: 1.1 },
    key: { color: '#ffd08c', intensity: 3.1, position: [-9, 15, 10] },
    rim: { color: '#6fa8ff', intensity: 1.7, position: [7, 6, -8] },
    sunRim: { color: '#ffae5e', intensity: 1.7, position: [-9, 5, -9] },
    exposure: 1.0, environmentIntensity: 0.7, shadow: '#1d2638',
    roof: { base: '#6c6b66', seam: '#3b3a37', edge: '#e4b65a', edgeDark: '#2b2a28', mark: '#f3dca4', glow: null, upperBase: '#8d8a80' },
    walls: ['#223d62', '#1c3556', '#2a4770', '#173050'], spandrel: '#14263f', lit: ['#ffcf94', '#ffe0b0', '#ffb878'], litRatio: 0.2, glass: true,
    ridges: [['#a8938f', '#c19a84'], ['#8a7f95', '#aa8f88'], ['#6a7690', '#917f8a']],
    fascia: '#20262c', trim: '#f0d9a2',
  },
  {
    id: 'launch', name: 'Palo Alto', night: true,
    sky: { top: '#0d1534', mid: '#352c6a', bottom: '#b46a98', sunDir: [-0.33, 0.07, -0.94], sunColor: '#ece8ff', halo: '#8f80ff', sunSize: 0.06, sunBoost: 3.2, cloudWarm: '#d49ac4', cloudCool: '#6f6cc0' },
    fog: { color: '#4b3f7c', near: 34, far: 112 },
    hemi: { sky: '#90a6ff', ground: '#34284f', intensity: 1.0 },
    key: { color: '#e4d6ff', intensity: 2.3, position: [-9, 15, 10] },
    rim: { color: '#52e6ff', intensity: 2.3, position: [7, 6, -8] },
    sunRim: { color: '#ff9a5e', intensity: 1.2, position: [-9, 5, -9] },
    exposure: 1.05, environmentIntensity: 0.6, shadow: '#0b0f2a',
    roof: { base: '#27324f', seam: '#111a30', edge: '#d9a85a', edgeDark: '#1a1f33', mark: '#a6f0ff', glow: '#3fe0ff', upperBase: '#3c4a6a' },
    walls: ['#1b2646', '#232f55', '#161f3d', '#2a2f5a'], spandrel: '#10172e', lit: ['#6fe9ff', '#a9f3ff', '#ffc58e', '#c9a8ff'], litRatio: 0.34, glass: false,
    ridges: [['#6a5aa6', '#8a5f9c'], ['#4d4590', '#6f528c'], ['#33316e', '#52427c']],
    fascia: '#12182c', trim: '#9fb4e8',
  },
];
