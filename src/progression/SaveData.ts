import { DEFAULT_P1_BINDINGS, DEFAULT_P2_BINDINGS, type PlayerBindings } from '../input/bindings';
import type { Difficulty } from '../sim/types';

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
    return parsed;
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
