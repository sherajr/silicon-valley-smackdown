import * as T from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { clampSamples } from './quality';
import type { QualityProfile } from './quality';

/**
 * The HDR post pipeline: scene -> (restrained bloom) -> one OutputPass -> canvas, with anti-aliasing.
 *
 * - The scene renders into a half-float target, so lights and emissives above 1.0 survive for the bloom to find.
 * - The OutputPass is the only place tone mapping and the sRGB transform happen on this path (it reads the renderer's own
 *   settings, so the direct path and this one match). Bloom runs before it, in linear light.
 * - `antialias: true` on the renderer only smooths the default framebuffer, never an offscreen target. So the target is
 *   multisampled when the GPU supports it, and otherwise an SMAA pass runs after the OutputPass, where it needs its
 *   sRGB-encoded input.
 * - If half-float targets are not renderable the target falls back to 8 bits. Bloom still works but cannot see highlights
 *   above 1.0, so it is skipped rather than washing out the picture.
 */
export interface PostCaps { hdr: boolean; maxSamples: number }

export function detectPostCaps(renderer: T.WebGLRenderer): PostCaps {
  const ext = renderer.extensions;
  return { hdr: ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float'), maxSamples: renderer.capabilities.maxSamples ?? 0 };
}

export interface PostInfo { hdr: boolean; samples: number; smaa: boolean; bloom: boolean; passes: string[] }

export class PostPipeline {
  readonly info: PostInfo;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass | null = null;
  private smaa: SMAAPass | null = null;
  private resolutionScale: number;

  constructor(renderer: T.WebGLRenderer, scene: T.Scene, camera: T.Camera, profile: QualityProfile, caps: PostCaps) {
    const samples = clampSamples(profile.msaa, caps.maxSamples);
    const target = new T.WebGLRenderTarget(1, 1, { type: caps.hdr ? T.HalfFloatType : T.UnsignedByteType, samples, depthBuffer: true, stencilBuffer: false });
    target.texture.name = 'Arena.scene';
    this.composer = new EffectComposer(renderer, target);
    this.resolutionScale = profile.bloom?.resolutionScale ?? 1;
    const passes = ['render'];
    this.composer.addPass(new RenderPass(scene, camera));
    if (profile.bloom && caps.hdr) {
      const b = profile.bloom;
      this.bloom = new UnrealBloomPass(new T.Vector2(1, 1), b.strength, b.radius, b.threshold); this.composer.addPass(this.bloom); passes.push('bloom');
    }
    this.composer.addPass(new OutputPass()); passes.push('output');
    if (samples === 0) { this.smaa = new SMAAPass(); this.composer.addPass(this.smaa); passes.push('smaa'); }
    this.info = { hdr: caps.hdr, samples, smaa: samples === 0, bloom: !!this.bloom, passes };
  }

  /** Resizes the targets and every pass together. `width`/`height` are CSS pixels; the targets use `pixelRatio` on top. */
  setSize(width: number, height: number, pixelRatio: number) {
    this.composer.setPixelRatio(pixelRatio); this.composer.setSize(width, height);
    if (this.bloom && this.resolutionScale !== 1) this.bloom.setSize(Math.max(2, Math.round(width * pixelRatio * this.resolutionScale)), Math.max(2, Math.round(height * pixelRatio * this.resolutionScale)));
  }

  render(deltaTime: number) { this.composer.render(deltaTime); }

  /** EffectComposer.dispose only frees its two targets, and OutputPass has no dispose, so free every pass explicitly. */
  dispose() {
    for (const pass of this.composer.passes) {
      pass.dispose();
      if (pass instanceof OutputPass) { const p = pass as unknown as { material: T.Material; _fsQuad: { dispose(): void } }; p.material.dispose(); p._fsQuad.dispose(); }
    }
    this.composer.dispose();
  }
}
