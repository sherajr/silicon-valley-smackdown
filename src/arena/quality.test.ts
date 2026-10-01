import { describe, expect, it } from 'vitest';
import { QUALITY, QUALITY_TIERS, clampSamples, defaultSettings, effectivePixelRatio, hasSavedQuality, isSoftwareRendererName, migrateSettings, serializeSettings } from './quality';

describe('quality presets', () => {
  it('have a strictly ordered cost: High > Balanced > Performance', () => {
    const [high, balanced, performance] = QUALITY_TIERS.map(t => QUALITY[t]);
    expect(high.shadowSize).toBeGreaterThan(balanced.shadowSize);
    expect(balanced.shadowSize).toBeGreaterThan(performance.shadowSize);
    expect(high.maxPixelRatio).toBeGreaterThan(balanced.maxPixelRatio);
    expect(balanced.maxPixelRatio).toBeGreaterThanOrEqual(performance.maxPixelRatio);
    expect(high.particles).toBeGreaterThan(balanced.particles);
    expect(balanced.particles).toBeGreaterThan(performance.particles);
    expect(high.trails).toBeGreaterThanOrEqual(balanced.trails);
  });

  it('keep the documented budgets', () => {
    expect(QUALITY.high).toMatchObject({ shadowSize: 2048, maxPixelRatio: 1.5, post: true });
    expect(QUALITY.balanced.maxPixelRatio).toBe(1.25);
    expect(QUALITY.performance).toMatchObject({ maxPixelRatio: 1, post: false, shadowSize: 0, bloom: null });
  });

  it('only the Performance preset renders straight to the canvas, and every preset keeps reflections and contact shadows', () => {
    expect(QUALITY_TIERS.filter(t => !QUALITY[t].post)).toEqual(['performance']);
    for (const t of QUALITY_TIERS) { expect(QUALITY[t].environment).toBe(true); expect(QUALITY[t].contactShadow).toBeGreaterThan(0.2); }
    // Without real shadows the contact shadow is the only grounding, so it is the strongest there.
    expect(QUALITY.performance.contactShadow).toBeGreaterThan(QUALITY.high.contactShadow);
  });

  it('bloom only reacts to values above plain lit surfaces', () => {
    for (const t of QUALITY_TIERS) { const b = QUALITY[t].bloom; if (b) { expect(b.threshold).toBeGreaterThan(1); expect(b.strength).toBeLessThan(0.6); } }
  });
});

describe('settings migration', () => {
  it('uses defaults for nothing, garbage and the wrong type', () => {
    for (const bad of [undefined, null, 5, 'x', [], {}]) expect(migrateSettings(bad)).toEqual(defaultSettings());
    expect(defaultSettings().quality).toBe('high');
  });

  it('maps the legacy high-quality checkbox to a preset and keeps the other preferences', () => {
    expect(migrateSettings({ high: true, muted: true, music: false, difficulty: 2, items: false })).toEqual({ ...defaultSettings(), quality: 'high', muted: true, music: false, difficulty: 2, items: false });
    expect(migrateSettings({ high: false }).quality).toBe('performance');
  });

  it('prefers a stored preset over the legacy flag and ignores invalid values', () => {
    expect(migrateSettings({ quality: 'balanced', high: false }).quality).toBe('balanced');
    expect(migrateSettings({ quality: 'ultra' }).quality).toBe('high');
    expect(migrateSettings({ quality: 'ultra', high: false }).quality).toBe('performance');
    expect(migrateSettings({ difficulty: 7 }).difficulty).toBe(1);
    expect(migrateSettings({ muted: 'yes' }).muted).toBe(false);
  });

  it('follows the system reduced-motion preference until the player chooses, and shake is independent', () => {
    expect(migrateSettings({}, true)).toMatchObject({ reducedMotion: true, cameraShake: false });
    expect(migrateSettings({}, false)).toMatchObject({ reducedMotion: false, cameraShake: true });
    // An explicit choice beats the system preference in both directions.
    expect(migrateSettings({ reducedMotion: false, cameraShake: true }, true)).toMatchObject({ reducedMotion: false, cameraShake: true });
    expect(migrateSettings({ reducedMotion: true }, false)).toMatchObject({ reducedMotion: true, cameraShake: false });
    // Reduced motion on, but the player turned shake back on: respected.
    expect(migrateSettings({ reducedMotion: true, cameraShake: true }).cameraShake).toBe(true);
    // Shake off with full motion: also respected.
    expect(migrateSettings({ reducedMotion: false, cameraShake: false }).cameraShake).toBe(false);
  });

  it('round-trips through serialisation and still writes the legacy flag for older builds', () => {
    const settings = { ...defaultSettings(), quality: 'balanced' as const, muted: true };
    const text = serializeSettings(settings);
    expect(migrateSettings(JSON.parse(text))).toEqual(settings);
    expect(JSON.parse(text).high).toBe(true);
    expect(JSON.parse(serializeSettings({ ...settings, quality: 'performance' })).high).toBe(false);
  });
});

describe('software rasterizers and first-run defaults', () => {
  it('recognises software renderer names and not real GPUs', () => {
    for (const name of ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', 'llvmpipe (LLVM 15.0.7, 256 bits)', 'Microsoft Basic Render Driver', 'Software Rasterizer']) expect(isSoftwareRendererName(name)).toBe(true);
    for (const name of ['ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Laptop GPU (0x00002820) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x0000A7A0) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Apple M2', 'AMD Radeon RX 7800 XT']) expect(isSoftwareRendererName(name)).toBe(false);
  });
  it('knows whether the player has ever chosen a preset', () => {
    expect(hasSavedQuality({})).toBe(false); expect(hasSavedQuality(null)).toBe(false); expect(hasSavedQuality({ muted: true })).toBe(false); expect(hasSavedQuality({ quality: 'ultra' })).toBe(false);
    expect(hasSavedQuality({ quality: 'balanced' })).toBe(true); expect(hasSavedQuality({ high: false })).toBe(true);
  });
});

describe('pixel ratio and MSAA clamping', () => {
  it('caps the pixel ratio by preset and never goes non-positive', () => {
    expect(effectivePixelRatio(2, QUALITY.high)).toBe(1.5);
    expect(effectivePixelRatio(1, QUALITY.high)).toBe(1);
    expect(effectivePixelRatio(3, QUALITY.balanced)).toBe(1.25);
    expect(effectivePixelRatio(2, QUALITY.performance)).toBe(1);
    expect(effectivePixelRatio(0, QUALITY.high)).toBe(1);
    expect(effectivePixelRatio(0.25, QUALITY.performance)).toBe(0.5);
  });

  it('clamps MSAA to the GPU limit and falls back to SMAA when it cannot multisample', () => {
    expect(clampSamples(4, 8)).toBe(4);
    expect(clampSamples(4, 2)).toBe(2);
    expect(clampSamples(4, 0)).toBe(0);
    expect(clampSamples(4, 1)).toBe(0);
    expect(clampSamples(0, 8)).toBe(0);
  });
});
