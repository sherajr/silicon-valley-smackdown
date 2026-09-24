import { DEFAULT_P1_BINDINGS, DEFAULT_P2_BINDINGS, type PlayerBindings } from '../input/bindings';
import type { Difficulty } from '../sim/types';
import type { GraphicsQuality } from '../render3d/GraphicsSettings';

export interface VolumeSettings {
  master: number;
  music: number;
  sfx: number;
}

export interface SaveData {
  version: number;
  elonUnlocked: boolean;
  bindings: { p1: PlayerBindings; p2: PlayerBindings };
  volumes: VolumeSettings;
  screenShake: boolean;
  reducedEffects: boolean;
  lastDifficulty: Difficulty;
  /** Explicitly selectable: 3D presentation is the default, with the original 2D renderer kept
   * as an opt-out compatibility mode (see docs/3d-conversion-checklist.md). Added after v1
   * shipped, so it is intentionally left out of isValidSave's required-field checks below --
   * an older save missing this key must still load, not be silently wiped. loadSaveData()
   * backfills it (and graphicsQuality) from defaultSaveData() when absent. */
  render3D: boolean;
  graphicsQuality: GraphicsQuality;
}

const STORAGE_KEY = 'svs.save.v1';
const CURRENT_VERSION = 1;

export function defaultSaveData(): SaveData {
  return {
    version: CURRENT_VERSION,
    elonUnlocked: false,
    bindings: { p1: { ...DEFAULT_P1_BINDINGS }, p2: { ...DEFAULT_P2_BINDINGS } },
    volumes: { master: 0.8, music: 0.7, sfx: 0.85 },
    screenShake: true,
    reducedEffects: false,
    lastDifficulty: 'normal',
    render3D: true,
    graphicsQuality: 'medium',
  };
}

function isPlayerBindings(v: unknown): v is PlayerBindings {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  const required = ['moveLeft', 'moveRight', 'up', 'down', 'basic', 'special', 'block', 'grab'];
  return required.every((k) => Array.isArray(obj[k]) && (obj[k] as unknown[]).every((c) => typeof c === 'string'));
}

function isValidSave(v: unknown): v is SaveData {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  if (typeof obj.version !== 'number') return false;
  if (typeof obj.elonUnlocked !== 'boolean') return false;
  const bindings = obj.bindings as Record<string, unknown> | undefined;
  if (!bindings || !isPlayerBindings(bindings.p1) || !isPlayerBindings(bindings.p2)) return false;
  const volumes = obj.volumes as Record<string, unknown> | undefined;
  if (!volumes || typeof volumes.master !== 'number' || typeof volumes.music !== 'number' || typeof volumes.sfx !== 'number') return false;
  if (typeof obj.screenShake !== 'boolean') return false;
  if (typeof obj.reducedEffects !== 'boolean') return false;
  if (obj.lastDifficulty !== 'easy' && obj.lastDifficulty !== 'normal' && obj.lastDifficulty !== 'hard') return false;
  return true;
}

/** Loads saved settings/progress, falling back to safe defaults if storage is unavailable, missing, or malformed. */
export function loadSaveData(): SaveData {
  try {
    if (typeof localStorage === 'undefined') return defaultSaveData();
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSaveData();
    const parsed: unknown = JSON.parse(raw);
    if (!isValidSave(parsed)) return defaultSaveData();
    // Spread parsed over the defaults (not the reverse) so any field a newer save genuinely sets
    // still wins, while a field an older save never had (e.g. render3D, added after v1 shipped)
    // is backfilled instead of left undefined.
    return { ...defaultSaveData(), ...parsed };
  } catch {
    return defaultSaveData();
  }
}

export function saveSaveData(data: SaveData): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage unavailable (private mode, quota, etc.) - silently skip persistence.
  }
}
