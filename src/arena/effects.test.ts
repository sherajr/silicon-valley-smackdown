import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { EffectLayer, describeEvent, hitSignificance, makeParticle } from './effects';
import type { EventContext } from './effects';
import { FIGHTER_ACCENTS } from './data';
import { mulberry32 } from './canvasUtil';

const rnd = () => mulberry32(1234);
const victim = (vx = 0.9, vy = 0.5, character = 1) => ({ x: 2, y: 0, vx, vy, character, facing: -1 });
const ctx = (extra: Partial<EventContext> = {}): EventContext => ({ victim: victim(), other: { x: 1, y: 0 }, ...extra });
const ev = (type: string, extra: Partial<{ x: number; y: number; value: number; text: string }> = {}) => ({ type, x: 2, y: 1, slot: 1, ...extra });

describe('hit strength', () => {
  it('rises with damage and launch speed and stays within 0..1', () => {
    expect(hitSignificance(0, 0)).toBe(0);
    expect(hitSignificance(5, 0.2)).toBeLessThan(hitSignificance(14, 0.8));
    expect(hitSignificance(14, 0.8)).toBeLessThan(hitSignificance(30, 1.4));
    expect(hitSignificance(500, 50)).toBe(1);
    expect(hitSignificance(10, 0.1)).toBeLessThan(hitSignificance(10, 1));
  });
});

describe('event effects', () => {
  it('scale a hit with its strength: more particles, bigger rings, more shake', () => {
    const light = describeEvent(ev('hit', { value: 3 }), ctx({ victim: victim(0.1, 0.05) }), rnd());
    const heavy = describeEvent(ev('hit', { value: 20 }), ctx({ victim: victim(1.2, 0.9) }), rnd());
    expect(heavy.particles.length).toBeGreaterThan(light.particles.length);
    expect(heavy.shake).toBeGreaterThan(light.shake);
    const ringSize = (e: { particles: ReturnType<typeof makeParticle>[] }) => Math.max(0, ...e.particles.filter(p => p.kind === 'ring').map(p => p.size1));
    expect(ringSize(heavy)).toBeGreaterThan(ringSize(light));
    // Only a heavy hit gets the long directional streak and the second ring.
    expect(heavy.particles.filter(p => p.kind === 'ring').length).toBeGreaterThan(light.particles.filter(p => p.kind === 'ring').length);
  });

  it('throws sparks along the launch direction, not at random', () => {
    const e = describeEvent(ev('hit', { value: 14 }), ctx({ victim: victim(1, 0) }), rnd());
    const sparks = e.particles.filter(p => p.kind === 'streak' && p.size1 < 0.1 && Math.hypot(p.vx, p.vy) < 30);
    expect(sparks.length).toBeGreaterThan(8);
    const forward = sparks.filter(p => p.vx > 0).length;
    expect(forward / sparks.length).toBeGreaterThan(0.8);
    const up = describeEvent(ev('hit', { value: 14 }), ctx({ victim: victim(0, 1) }), rnd()).particles.filter(p => p.kind === 'streak' && p.size1 < 0.1);
    expect(up.filter(p => p.vy > 0).length / up.length).toBeGreaterThan(0.8);
  });

  it('gives a throw release its own cue, distinct from a strike', () => {
    const strike = describeEvent(ev('hit', { value: 12, text: 'heavy' }), ctx(), rnd()), release = describeEvent(ev('hit', { value: 12, text: 'throw' }), ctx(), rnd());
    expect(release.particles.filter(p => p.kind === 'ring').length).toBeGreaterThan(strike.particles.filter(p => p.kind === 'ring').length);
  });

  it('is deterministic for a given random stream and different for another', () => {
    const a = describeEvent(ev('hit', { value: 12 }), ctx(), mulberry32(7)), b = describeEvent(ev('hit', { value: 12 }), ctx(), mulberry32(7)), c = describeEvent(ev('hit', { value: 12 }), ctx(), mulberry32(8));
    expect(a).toEqual(b); expect(a).not.toEqual(c);
  });

  it('puts the KO burst inside the visible area, in the fighter\'s colour, thrown back toward the stage', () => {
    const e = describeEvent(ev('ko', { x: 40, y: -30, value: 120 }), ctx({ victim: { ...victim(), character: 3 } }), rnd());
    const spark = e.particles.find(p => p.kind === 'streak')!, accent = new T.Color(FIGHTER_ACCENTS[3]);
    expect(Math.abs(spark.x)).toBeLessThanOrEqual(18); expect(spark.y).toBeGreaterThanOrEqual(-4); expect(spark.y).toBeLessThanOrEqual(13);
    expect(spark.vx).toBeLessThan(0);                      // started at the far right edge, so it flies back left
    expect(spark.r / accent.r).toBeGreaterThan(1.5);       // HDR-brightened version of the accent, so it blooms
    expect(e.shake).toBeCloseTo(0.34);
  });

  it('gives movement a soft dust layer and everything else the additive glow layer', () => {
    for (const type of ['jump', 'land', 'roll']) { const e = describeEvent(ev(type), ctx(), rnd()); expect(e.particles.length).toBeGreaterThan(0); expect(e.particles.every(p => p.layer === 'dust')).toBe(true); }
    for (const type of ['hit', 'ko', 'block', 'counter', 'catch', 'tech', 'pummel', 'throwBreak', 'armor', 'recovery']) expect(describeEvent(ev(type, { value: 10 }), ctx(), rnd()).particles.some(p => p.layer === 'glow')).toBe(true);
    // A slam gets both: a dust ring along the ground and a bright impact.
    const slam = describeEvent(ev('impact'), ctx(), rnd()); expect(slam.particles.some(p => p.layer === 'dust')).toBe(true); expect(slam.particles.some(p => p.layer === 'glow')).toBe(true);
  });

  it('never floods the buffers, whatever the event', () => {
    const types = ['hit', 'ko', 'block', 'jump', 'land', 'roll', 'recovery', 'catch', 'tech', 'pummel', 'throwBreak', 'counter', 'armor', 'impact', 'bounce', 'shotBreak', 'fizzle', 'pickup', 'ledge'];
    for (const type of types) { const e = describeEvent(ev(type, { value: 99 }), ctx({ victim: victim(2, 2) }), rnd()); expect(e.particles.length).toBeLessThan(70); for (const p of e.particles) { expect(Number.isFinite(p.x + p.y + p.vx + p.vy + p.life + p.size0 + p.size1)).toBe(true); expect(p.life).toBeGreaterThan(0); expect(p.life).toBeLessThan(1); } }
  });

  it('has nothing to draw for bookkeeping events', () => {
    for (const type of ['combo', 'comboEnd', 'break', 'finish', 'sudden', 'shot', 'unknown']) { const e = describeEvent(ev(type), ctx(), rnd()); expect(e.particles).toEqual([]); expect(e.shake).toBe(0); }
  });

  it('halves counts and shake with reduced motion', () => {
    const full = describeEvent(ev('counter'), ctx(), rnd()), calm = describeEvent(ev('counter'), ctx({ reducedMotion: true }), rnd());
    expect(calm.particles.length).toBeLessThan(full.particles.length); expect(calm.shake).toBeCloseTo(full.shake * 0.5);
  });

  it('tints a coffee pickup differently from a GPU', () => {
    const coffee = describeEvent(ev('pickup', { text: 'COFFEE −22%' }), ctx(), rnd()).particles[0], gpu = describeEvent(ev('pickup', { text: 'GPU OVERCLOCK' }), ctx(), rnd()).particles[0];
    expect([coffee.r, coffee.g, coffee.b]).not.toEqual([gpu.r, gpu.g, gpu.b]);
  });
});

describe('effect layer buffers', () => {
  it('starts with no live particles, and nothing is ever drawn at a negative or absurd size', () => {
    // Regression: unused instances once had a negative lifetime and were drawn as huge invisible quads (420 full-screen
    // blends per frame, about 12 ms of GPU time at 1080p). Every unused instance must be culled by the vertex shader.
    const layer = new EffectLayer(420, 160);
    expect(layer.alive).toEqual({ glow: 0, dust: 0 });
    for (const batch of layer.group.children) {
      const t = ((batch as T.Mesh).geometry as T.InstancedBufferGeometry).getAttribute('aTiming').array as Float32Array;
      for (let i = 0; i < t.length; i += 4) { expect(t[i + 1]).toBeGreaterThan(0); expect(t[i + 2]).toBe(0); expect(t[i + 3]).toBe(0); expect(t[i]).toBeLessThan(-1000); }
    }
    for (const dt of [0, 1 / 60, 10, 5000]) { layer.update(dt, false); expect(layer.alive).toEqual({ glow: 0, dust: 0 }); }
    layer.event(ev('ko', { value: 99 }), ctx()); expect(layer.alive.glow).toBeGreaterThan(10);
    for (let i = 0; i < 90; i++) layer.update(1 / 60, false);
    expect(layer.alive).toEqual({ glow: 0, dust: 0 });             // fully faded: nothing left to draw
    layer.clear(); expect(layer.alive).toEqual({ glow: 0, dust: 0 });
    layer.dispose();
  });

  it('is a fixed ring buffer: it takes any number of events without growing', () => {
    const layer = new EffectLayer(40, 16), mesh = layer.group.children[1] as T.Mesh, geo = mesh.geometry as T.InstancedBufferGeometry;
    const sizeBefore = (geo.getAttribute('aOrigin') as T.BufferAttribute).array.length;
    for (let i = 0; i < 400; i++) layer.event(ev(i % 2 ? 'hit' : 'ko', { value: 12 }), ctx());
    expect((geo.getAttribute('aOrigin') as T.BufferAttribute).array.length).toBe(sizeBefore); expect(geo.instanceCount).toBe(40);
    expect(layer.group.children.length).toBe(2);                    // one glow batch and one dust batch: two draw calls
    layer.dispose();
  });

  it('spawns with a delay, reports when it is busy, and goes idle once everything has faded', () => {
    const layer = new EffectLayer(40, 16); expect(layer.busy).toBe(false);
    layer.event(ev('hit', { value: 12 }), ctx()); expect(layer.busy).toBe(true);
    for (let i = 0; i < 120; i++) layer.update(1 / 60, false);
    expect(layer.busy).toBe(false);
    layer.dispose();
  });

  it('holds still when paused', () => {
    const layer = new EffectLayer(40, 16); layer.event(ev('hit', { value: 12 }), ctx());
    const t = layer.clock; for (let i = 0; i < 60; i++) layer.update(1 / 60, true);
    expect(layer.clock).toBe(t); expect(layer.busy).toBe(true);
    layer.dispose();
  });

  it('rebases its clock when idle so GPU float precision never degrades in a long session', () => {
    const layer = new EffectLayer(40, 16);
    layer.update(1000, false); expect(layer.clock).toBe(0);                                  // idle and past 900 s: back to zero
    // With a long-lived particle in flight it must wait, or the particle would reappear or vanish.
    layer.update(899, false); layer.spawn(makeParticle({ kind: 'disc', life: 5 })); layer.update(2, false);
    expect(layer.clock).toBeCloseTo(901, 5); expect(layer.busy).toBe(true);
    layer.update(10, false); expect(layer.clock).toBe(0);                                    // everything has faded: now it rebases
    layer.dispose();
  });
});
