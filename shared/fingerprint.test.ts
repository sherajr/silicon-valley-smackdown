import { describe, expect, it } from 'vitest';
import { gameplayFingerprint } from './fingerprint.ts';

describe('gameplay fingerprint', () => {
  it('is a stable checksum of the shared rules', () => {
    const hash = gameplayFingerprint();
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(gameplayFingerprint()).toBe(hash);
  });
});
