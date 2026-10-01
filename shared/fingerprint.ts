/**
 * Gameplay compatibility fingerprint. It covers the rules two clients must share
 * and ignores build time, paths, and graphics preferences.
 */
import { FIGHTERS } from '../src/arena/fighterDefinitions.ts';
import { STAGE_PLATFORMS } from '../src/arena/data.ts';
import { hashData } from './hash.ts';
import { INPUT_DELAY, PREDICTION_LIMIT, PROTOCOL_VERSION } from './onlineProtocol.ts';

let cached: string | null = null;

export function gameplayFingerprint(): string {
  if (cached) return cached;
  cached = hashData({
    protocol: PROTOCOL_VERSION,
    delay: INPUT_DELAY,
    prediction: PREDICTION_LIMIT,
    fighters: FIGHTERS,
    stages: STAGE_PLATFORMS,
  });
  return cached;
}
