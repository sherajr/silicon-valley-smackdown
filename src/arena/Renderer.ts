import * as T from 'three';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FighterRig, makeProp } from './FighterRig';
import { ArenaStage } from './Stage';
import { FIGHTER_ACCENTS, STAGE_PLATFORMS } from './data';
import { activeBoxes, hurtboxOf, newFighter } from './Simulation';
import type { ArenaSim, GameEvent } from './Simulation';
import { CameraRig } from './cameraRig';
import type { Focus } from './cameraRig';
import { VisualInterpolator, newRenderedFighter } from './interpolation';
import type { RenderedFighter, RenderedShot } from './interpolation';
import { PostPipeline, detectPostCaps } from './post';
import type { PostInfo } from './post';
import { QUALITY, clampSamples, effectivePixelRatio, isSoftwareRendererName } from './quality';
import type { QualityProfile, QualityTier } from './quality';
import { STAGE_THEMES } from './stageThemes';
import type { StageTheme } from './stageThemes';
import { EffectLayer, makeParticle } from './effects';
import type { EventContext } from './effects';
import { TrailSet } from './trails';
import { buildEnvironmentScene } from './environment';
import { floorBelow, shadowSpan } from './stageLayout';
import { contactShadowTexture } from './textures';
import { context2d, makeCanvas } from './canvasUtil';
import { disposeRigParts, setPropEnvironment } from './rigParts';

/** What the app tells the renderer about this display frame. */
export interface RenderFrame {
  /** Display delta in seconds (not the 60 Hz tick). */
  dt: number;
  /** Visual clock: advances while the app is not paused. */
  time: number;
  menu: boolean;
  /** Fraction of the next simulation tick already elapsed, for interpolation. 1 shows the exact simulation state. */
  alpha: number;
  paused: boolean;
  /** Training frame-step: the simulation only moves when asked. */
  stepping: boolean;
}
export interface RendererOptions {
  quality: QualityTier; reducedMotion: boolean; cameraShake: boolean;
  /** The player has never chosen a preset: a software rasterizer then starts on Performance (a one-time default, never a reaction to slow frames). */
  initialQuality?: boolean;
}

const lin = (hex: string, k = 1) => { const c = new T.Color(hex); return [c.r * k, c.g * k, c.b * k] as const; };
/** Trail and extra effects for each fighter's signature projectile (indexed by the shooter's character). */
const SHOT_FX = [
  { color: lin('#bff6ff', 2.4), width: 0.16, life: 0.22 },   // Hunter: a tablet with a cool glint
  { color: lin('#e0b25e', 2.2), width: 0.3, life: 0.26 },    // Kevin: a briefcase streaks past
  { color: lin('#7dffb4', 1.8), width: 0.18, life: 0.24 },   // Al: bottle, with droplets
  { color: lin('#d8c8ff', 2.0), width: 0.2, life: 0.26 },    // Priya: resumes flutter
  { color: lin('#9cf59a', 2.0), width: 0.28, life: 0.28 },   // Chad: cash
  { color: lin('#ffb469', 3.0), width: 0.46, life: 0.34 },   // Elon: rocket exhaust
];
const KEY_BIAS = -0.0004, KEY_NORMAL_BIAS = 0.035;
const TRAIL_SPEED = 0.5;

interface DrawnPos { x: number; y: number; valid: boolean }

export class ArenaRenderer {
  renderer: T.WebGLRenderer;
  scene = new T.Scene();
  camera = new T.PerspectiveCamera(41, 1, 2.5, 260);
  stage!: ArenaStage;
  rigs: FighterRig[] = [];
  readonly cameraRig = new CameraRig();
  readonly interp = new VisualInterpolator();
  /** Where each fighter was drawn this frame, shared by the model, camera, shadow, label and effects. */
  readonly rendered: RenderedFighter[] = [newRenderedFighter(), newRenderedFighter()];
  profile: QualityProfile;
  options: RendererOptions;
  post: PostPipeline | null = null;
  effects: EffectLayer;
  trails: TrailSet;
  private container: HTMLElement;
  private hemi = new T.HemisphereLight('#ffffff', '#444444', 1);
  private key = new T.DirectionalLight('#ffffff', 3);
  private rim = new T.DirectionalLight('#ffffff', 1.5);
  private sunRim = new T.DirectionalLight('#ffffff', 1.5);
  private stages = new Map<number, ArenaStage>();
  private envs = new Map<number, T.WebGLRenderTarget>();
  private pmrem: T.PMREMGenerator | null = null;
  private theme: StageTheme = STAGE_THEMES[0];
  private shadows: T.Mesh[] = [];
  private shadowGeo = new T.PlaneGeometry(1, 1);
  private shadowTex: T.Texture;
  private shotProps = new Map<number, { group: T.Group; acc: number }>();
  private pickupProps = new Map<number, T.Group>();
  private debugOn = false;
  private debug = new T.Group();
  private debugPool: T.LineSegments[] = [];
  private boxEdges = new T.EdgesGeometry(new T.BoxGeometry(1, 1, 1));
  private boxMats = { hurt: new T.LineBasicMaterial({ color: '#57ebd6' }), hurtSecond: new T.LineBasicMaterial({ color: '#ffa577' }), hit: new T.LineBasicMaterial({ color: '#ff5a5a' }), grab: new T.LineBasicMaterial({ color: '#ffd27a' }), shot: new T.LineBasicMaterial({ color: '#ff7bd5' }) };
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private sizeDirty = true;
  private appliedShift = NaN;
  private observers: (() => void)[] = [];
  private animClock = 0;
  private drawn: DrawnPos[] = [{ x: 0, y: 0, valid: false }, { x: 0, y: 0, valid: false }];
  private focusPool: Focus[] = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
  private focus: Focus[] = [];
  private shotPos: RenderedShot = { x: 0, y: 0, fresh: true };
  private last: { sim: ArenaSim; frame: RenderFrame } | null = null;
  private frameStats = { draws: 0, triangles: 0 };
  private tmpA = new T.Vector3();
  private tmpB = new T.Vector3();
  private envTexture: T.Texture | null = null;
  private envIntensity = 0.6;
  private maxAnisotropy = 1;
  private disposed = false;
  /** Test hook: draw with the real shadow map off to compare it with the same scene on. Never set by the game. */
  debugShadowsOff = false;

  constructor(container: HTMLElement, options: RendererOptions) {
    this.container = container; this.options = { ...options }; this.profile = QUALITY[options.quality];
    this.renderer = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    if (options.initialQuality && this.isSoftware) { this.options.quality = 'performance'; this.profile = QUALITY.performance; }
    this.renderer.domElement.id = 'arena-canvas'; container.append(this.renderer.domElement);
    this.renderer.outputColorSpace = T.SRGBColorSpace; this.renderer.toneMapping = T.ACESFilmicToneMapping;
    // The shadow map stays enabled; real shadows are switched with the key light's castShadow so programs rebuild cleanly.
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = T.PCFShadowMap;
    // Passes call render() several times per frame; stats are collected for the whole frame, not the last pass.
    this.renderer.info.autoReset = false;
    this.maxAnisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.scene.fog = new T.Fog('#667787', 40, 120);
    this.scene.add(this.hemi, this.key, this.rim, this.sunRim);
    this.key.shadow.bias = KEY_BIAS; this.key.shadow.normalBias = KEY_NORMAL_BIAS; this.key.shadow.radius = 1.2;
    this.shadowTex = contactShadowTexture({ anisotropy: 1 });
    this.effects = new EffectLayer(this.profile.particles, this.profile.dust); this.scene.add(this.effects.group);
    this.trails = new TrailSet(this.profile.trails); this.scene.add(this.trails.mesh);
    this.debug.visible = false; this.scene.add(this.debug);
    this.camera.position.set(9, 7, 21); this.camera.lookAt(0, 2.7, 0);
    this.cameraRig.shakeEnabled = options.cameraShake;
    this.observe();
    this.setStage(0); this.rebuildForProfile(); this.applySize(true);
  }

  // ------------------------------------------------------------------------------------------------------------
  // Size, pixel ratio and observers
  // ------------------------------------------------------------------------------------------------------------
  private observe() {
    const mark = () => { this.sizeDirty = true; };
    window.addEventListener('resize', mark); this.observers.push(() => window.removeEventListener('resize', mark));
    if (typeof ResizeObserver !== 'undefined') {
      // The container is what the canvas fills, which can differ from the window (embedded, fullscreen transitions).
      const ro = new ResizeObserver(() => { mark(); if (!this.disposed) { this.applySize(); this.redraw(); } }); ro.observe(this.container); this.observers.push(() => ro.disconnect());
    }
    // A change of display scaling (moving between monitors, browser zoom) changes the ratio without always resizing the box.
    const watchRatio = () => {
      const query = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`), on = () => { mark(); this.applySize(); this.redraw(); off(); watchRatio(); };
      const off = () => query.removeEventListener('change', on); query.addEventListener('change', on, { once: true }); this.observers.push(off);
    };
    try { watchRatio(); } catch { /* matchMedia may be unavailable in embedded contexts */ }
  }

  /** Resizes the renderer, camera and post targets together. Skips work when nothing changed. */
  private applySize(force = false) {
    this.sizeDirty = false;
    const w = Math.max(1, this.container.clientWidth || window.innerWidth), h = Math.max(1, this.container.clientHeight || window.innerHeight);
    const ratio = effectivePixelRatio(window.devicePixelRatio, this.profile);
    if (!force && w === this.width && h === this.height && ratio === this.pixelRatio) return;
    this.width = w; this.height = h; this.pixelRatio = ratio;
    this.renderer.setPixelRatio(ratio); this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.post?.setSize(w, h, ratio);
    this.appliedShift = NaN;
  }
  /** True when WebGL is being rasterized on the CPU (no hardware acceleration), judged from the renderer's own name. */
  get isSoftware() { const gl = this.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info'); return ext ? isSoftwareRendererName(String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))) : false; }
  /** Draws the last frame again straight away, so a resize never leaves a cleared or stretched canvas for a frame. */
  private redraw() { if (this.last && !this.disposed) this.render(this.last.sim, { ...this.last.frame, dt: 0 }); }
  /** Public so the app can force a re-measure (for example after a fullscreen change). */
  resize() { this.applySize(true); }
  get size() { return { width: this.width, height: this.height, pixelRatio: this.pixelRatio }; }

  // ------------------------------------------------------------------------------------------------------------
  // Quality, preferences
  // ------------------------------------------------------------------------------------------------------------
  setQuality(tier: QualityTier) { this.options.quality = tier; this.profile = QUALITY[tier]; this.rebuildForProfile(); this.applySize(true); }
  setReducedMotion(on: boolean) { this.options.reducedMotion = on; this.effects.reducedMotion = on; if (on) this.trails.clear(); }
  setCameraShake(on: boolean) { this.options.cameraShake = on; this.cameraRig.shakeEnabled = on; if (!on) this.cameraRig.clearShake(); }

  /** Applies everything a preset controls: shadows, post pipeline, effect capacities, grounding strength, reflections. */
  private rebuildForProfile() {
    const p = this.profile, shadow = this.key.shadow;
    this.key.castShadow = p.shadowSize > 0;
    if (p.shadowSize > 0 && shadow.mapSize.x !== p.shadowSize) { shadow.mapSize.set(p.shadowSize, p.shadowSize); }
    if (shadow.map) { shadow.map.dispose(); shadow.map = null; }
    this.post?.dispose(); this.post = null;
    if (p.post) {
      const caps = detectPostCaps(this.renderer);
      this.post = new PostPipeline(this.renderer, this.scene, this.camera, p, caps);
      this.post.setSize(this.width, this.height, this.pixelRatio);
    }
    this.scene.remove(this.effects.group); this.effects.dispose(); this.effects = new EffectLayer(p.particles, p.dust); this.effects.reducedMotion = this.options.reducedMotion; this.scene.add(this.effects.group);
    this.scene.remove(this.trails.mesh); this.trails.dispose(); this.trails = new TrailSet(p.trails); this.scene.add(this.trails.mesh);
    for (const s of this.shadows) (s.material as T.MeshBasicMaterial).opacity = p.contactShadow;
    this.applyEnvironment();
    this.refreshMaterials(); this.warmUp();
  }
  /** Programs depend on the light and shadow setup, so ask every material to re-evaluate after a preset change. */
  private refreshMaterials() {
    this.scene.traverse(o => { const m = (o as T.Mesh).material as T.Material | T.Material[] | undefined; if (m) for (const x of Array.isArray(m) ? m : [m]) x.needsUpdate = true; });
  }

  // ------------------------------------------------------------------------------------------------------------
  // Stages, lighting, reflections
  // ------------------------------------------------------------------------------------------------------------
  /**
   * Reflections are given to the surfaces that show them (fighters, props, gold, glass, polished metal) instead of the whole
   * scene. A global environment makes every standard material, including the huge distant skyline, sample the map for each
   * pixel; that was half the frame cost in a software rasterizer and is wasted work for rough, faraway surfaces anywhere.
   */
  private applyEnvironment() {
    const texture = this.profile.environment ? this.environmentFor(this.stage.index) : null, k = this.theme.environmentIntensity;
    this.scene.environment = null; this.envTexture = texture; this.envIntensity = k;
    this.stage.setEnvironment(texture, k); for (const rig of this.rigs) rig.setEnvironment(texture, k); setPropEnvironment(texture, k);
  }

  private environmentFor(index: number): T.Texture {
    let rt = this.envs.get(index);
    if (!rt) {
      this.pmrem ??= new T.PMREMGenerator(this.renderer);
      const env = buildEnvironmentScene(STAGE_THEMES[index]); rt = this.pmrem.fromScene(env.scene, 0.02, 1, 100); env.dispose(); this.envs.set(index, rt);
    }
    return rt.texture;
  }

  setStage(index: number) {
    let stage = this.stages.get(index);
    if (!stage) { stage = new ArenaStage(index, { anisotropy: this.maxAnisotropy }); this.stages.set(index, stage); }
    if (this.stage) this.scene.remove(this.stage.root);
    this.stage = stage; this.scene.add(stage.root); this.theme = stage.theme;
    const t = this.theme;
    this.hemi.color.set(t.hemi.sky); this.hemi.groundColor.set(t.hemi.ground); this.hemi.intensity = t.hemi.intensity;
    this.key.color.set(t.key.color); this.key.intensity = t.key.intensity; this.key.position.set(...t.key.position);
    this.rim.color.set(t.rim.color); this.rim.intensity = t.rim.intensity; this.rim.position.set(...t.rim.position);
    this.sunRim.color.set(t.sunRim.color); this.sunRim.intensity = t.sunRim.intensity; this.sunRim.position.set(...t.sunRim.position);
    (this.scene.fog as T.Fog).color.set(t.fog.color); (this.scene.fog as T.Fog).near = t.fog.near; (this.scene.fog as T.Fog).far = t.fog.far;
    this.renderer.setClearColor(t.fog.color); this.renderer.toneMappingExposure = t.exposure;
    this.applyEnvironment();
    for (const s of this.shadows) (s.material as T.MeshBasicMaterial).color.set(t.shadow);
    this.fitShadowFrustum(index);
  }

  /**
   * One stable shadow volume per arena: the platforms plus room for fighters in the air, expressed in the light's own
   * space and computed once. It never follows the camera or the fighters, so shadow edges cannot swim.
   */
  private fitShadowFrustum(index: number) {
    const cam = this.key.shadow.camera;
    this.key.updateMatrixWorld(); this.key.target.updateMatrixWorld();
    cam.position.copy(this.key.position); cam.lookAt(this.key.target.position); cam.updateMatrixWorld(); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    const box = new T.Box3(), v = new T.Vector3();
    const add = (x: number, y: number, z: number) => box.expandByPoint(v.set(x, y, z).applyMatrix4(cam.matrixWorldInverse));
    for (const p of STAGE_PLATFORMS[index]) for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [p.y, p.y - p.thickness]) add(p.x + sx * p.w / 2, y, sz * (p.solid ? 3.4 : 1.2));
    for (const x of [-13, 13]) for (const y of [-2.5, 11]) for (const z of [-1.5, 1.5]) add(x, y, z);       // fighters and projectiles in play
    const m = 1.5;
    cam.left = box.min.x - m; cam.right = box.max.x + m; cam.bottom = box.min.y - m; cam.top = box.max.y + m;
    cam.near = Math.max(0.5, -box.max.z - m); cam.far = -box.min.z + m; cam.updateProjectionMatrix();
    const shadow = this.key.shadow; if (shadow.map) { shadow.map.dispose(); shadow.map = null; }
  }

  // ------------------------------------------------------------------------------------------------------------
  // Match setup
  // ------------------------------------------------------------------------------------------------------------
  setMatch(characters: number[], stage: number) {
    for (const rig of this.rigs) { this.scene.remove(rig.root); rig.dispose(); }
    for (const s of this.shadows) { this.scene.remove(s); (s.material as T.Material).dispose(); }
    this.rigs = characters.map(c => new FighterRig(c)); this.rigs.forEach(r => this.scene.add(r.root));
    this.shadows = characters.map(() => {
      const mat = new T.MeshBasicMaterial({ map: this.shadowTex, color: this.theme.shadow, transparent: true, opacity: this.profile.contactShadow, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const mesh = new T.Mesh(this.shadowGeo, mat); mesh.rotation.x = -Math.PI / 2; mesh.renderOrder = 2; mesh.visible = false; this.scene.add(mesh); return mesh;
    });
    this.setStage(stage);
    for (const d of this.shotProps.values()) this.scene.remove(d.group); this.shotProps.clear();
    for (const g of this.pickupProps.values()) { this.scene.remove(g); this.disposePickup(g); } this.pickupProps.clear();
    this.effects.clear(); this.trails.clear();
    this.interp.reset(); this.drawn[0].valid = this.drawn[1].valid = false; for (const r of this.rendered) r.snapped = true;
    this.animClock = 0; this.warmUp();
  }

  /**
   * Compiles every shader the scene can use before it is needed. Programs are otherwise built the first time a material is
   * drawn, which is how the first jump, hit or shield used to cost a stall of a second or more in the middle of a fight.
   * compile() visits hidden objects too, so the shield, halo, effect and trail materials are covered, and one pass through
   * the post pipeline builds its bloom and output programs.
   */
  private warmUp() {
    try { this.renderer.compile(this.scene, this.camera); this.post?.render(0); } catch (error) { console.warn('Shader warm-up skipped:', error); }
  }

  /**
   * A rollback restored an earlier simulation state. Drop predicted motion trails and draw the
   * restored fighters on the next frame. Effects that already played for confirmed frames stay.
   */
  correct() {
    this.interp.reset();
    this.interp.markSnap(0);
    this.interp.markSnap(1);
    this.trails.clear();
    this.drawn[0].valid = false;
    this.drawn[1].valid = false;
    for (const rendered of this.rendered) rendered.snapped = true;
  }

  /** Call right before every `sim.step()` so move ages and projectile paths can be drawn between ticks. */
  captureTick(sim: ArenaSim) { this.interp.capture(sim); }
  /** The simulation moved this fighter discontinuously (a ledge grab); draw it there without a sweep. */
  snapFighter(slot: number) { this.interp.markSnap(slot); }

  // ------------------------------------------------------------------------------------------------------------
  // Portraits: drawn offscreen, with the same tone mapping and colour transform as the game
  // ------------------------------------------------------------------------------------------------------------
  portraits(): string[] {
    const size = 360, out: string[] = [], r = this.renderer;
    const caps = detectPostCaps(r), samples = clampSamples(4, caps.maxSamples);
    const sceneRT = new T.WebGLRenderTarget(size, size, { type: caps.hdr ? T.HalfFloatType : T.UnsignedByteType, samples, depthBuffer: true });
    const outRT = new T.WebGLRenderTarget(size, size, { type: T.UnsignedByteType, depthBuffer: false });
    const output = new OutputPass(), pixels = new Uint8Array(size * size * 4), canvas = makeCanvas(size, size), ctx = context2d(canvas), image = ctx.createImageData(size, size);
    const prevTarget = r.getRenderTarget(), prevAuto = r.autoClear, prevExposure = r.toneMappingExposure;
    r.toneMappingExposure = 1.0;
    const scene = new T.Scene(); scene.background = new T.Color('#101d28');
    const camera = new T.PerspectiveCamera(30, 1, 0.5, 30); camera.position.set(1.3, 1.9, 5.1); camera.lookAt(0.12, 1.55, 0);
    const hemi = new T.HemisphereLight('#e8f4ff', '#3b4650', 1.6), key = new T.DirectionalLight('#ffe2bd', 3.2), fill = new T.DirectionalLight('#8fb8ff', 1.2), rim = new T.DirectionalLight('#ffffff', 2.0);
    key.position.set(-3, 5, 6); fill.position.set(5, 2, 3); rim.position.set(2, 4, -5); scene.add(hemi, key, fill, rim);
    const backdrop = makeCanvas(256, 256), bctx = context2d(backdrop);
    const backGeo = new T.PlaneGeometry(9, 9), backMat = new T.MeshBasicMaterial({ transparent: false, toneMapped: false, fog: false });
    const back = new T.Mesh(backGeo, backMat); back.position.set(0.4, 1.8, -3.2); scene.add(back);
    const portraitEnv = this.profile.environment ? this.environmentFor(this.stage.index) : null;
    const backTex = new T.CanvasTexture(backdrop); backTex.colorSpace = T.SRGBColorSpace; backMat.map = backTex;
    try {
      for (let i = 0; i < 6; i++) {
        // A soft backdrop tinted with the fighter's own colour.
        const g = bctx.createRadialGradient(128, 118, 8, 128, 128, 180); g.addColorStop(0, `${FIGHTER_ACCENTS[i]}aa`); g.addColorStop(1, '#0c1822'); bctx.fillStyle = '#0c1822'; bctx.fillRect(0, 0, 256, 256); bctx.fillStyle = g; bctx.fillRect(0, 0, 256, 256); backTex.needsUpdate = true;
        rim.color.set(FIGHTER_ACCENTS[i]);
        const rig = new FighterRig(i), f = newFighter(0, i); f.x = f.prevX = 0; rig.setEnvironment(portraitEnv, 0.7);
        rig.pose(f, { x: 0, y: 0, moved: 0, attackAge: null, time: 0, dt: 0, snap: true }); rig.body.rotation.y = 0.32; rig.torso.rotation.y = -0.1; rig.arms[0].upper.rotation.x = -0.3; rig.arms[1].upper.rotation.x = -0.55; rig.head.rotation.y = -0.14;
        scene.add(rig.root); scene.updateMatrixWorld(true);
        r.setRenderTarget(sceneRT); r.autoClear = true; r.clear(); r.render(scene, camera);
        output.renderToScreen = false; output.render(r, outRT, sceneRT, 0, false);
        r.readRenderTargetPixels(outRT, 0, 0, size, size, pixels);
        for (let y = 0; y < size; y++) image.data.set(pixels.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
        ctx.putImageData(image, 0, 0); out.push(canvas.toDataURL('image/png'));
        scene.remove(rig.root); rig.dispose();
      }
    } finally {
      r.setRenderTarget(prevTarget); r.autoClear = prevAuto; r.toneMappingExposure = prevExposure;
      sceneRT.dispose(); outRT.dispose(); backTex.dispose(); backGeo.dispose(); backMat.dispose();
      const p = output as unknown as { material: T.Material; _fsQuad: { dispose(): void } }; p.material.dispose(); p._fsQuad.dispose();
    }
    return out;
  }

  // ------------------------------------------------------------------------------------------------------------
  // Events
  // ------------------------------------------------------------------------------------------------------------
  event(e: GameEvent, sim?: ArenaSim) {
    const v = sim?.fighters[e.slot], o = sim?.fighters[1 - e.slot], r = this.rendered[e.slot];
    // Effects about a fighter appear where that fighter is drawn, which can lag the simulation by up to a tick.
    const attached = v && r && !r.snapped && e.type !== 'shotBreak' && e.type !== 'ko';
    const at: GameEvent = attached ? { ...e, x: e.x + (r.x - v.x), y: e.y + (r.y - v.y) } : e;
    const ctx: EventContext = { victim: v && { x: v.x, y: v.y, vx: v.vx, vy: v.vy, character: v.character, facing: v.facing }, other: o && { x: o.x, y: o.y }, reducedMotion: this.options.reducedMotion };
    this.cameraRig.addShake(this.effects.event(at, ctx));
    if (e.type === 'block' && v && o) this.rigs[e.slot]?.shieldHit(Math.sign(o.x - v.x));
  }

  /** Training aid: outline hurtboxes (aqua/orange), active hit volumes (red), catch volumes (yellow) and shots (magenta). */
  setDebug(on: boolean) { this.debugOn = on; this.debug.visible = on; }
  private drawBoxes(sim: ArenaSim) {
    let used = 0;
    const draw = (r: { x0: number; x1: number; y0: number; y1: number }, mat: T.LineBasicMaterial) => {
      let line = this.debugPool[used];
      if (!line) { line = new T.LineSegments(this.boxEdges, mat); this.debug.add(line); this.debugPool.push(line); }
      used++; line.material = mat; line.visible = true;
      line.position.set((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, 0.7); line.scale.set(Math.max(0.02, r.x1 - r.x0), Math.max(0.02, r.y1 - r.y0), 0.06);
    };
    // These are the simulation's own volumes at the current tick, deliberately not interpolated.
    for (const f of sim.fighters) {
      if (f.respawn || f.stocks <= 0) continue;
      draw(hurtboxOf(f), f.slot ? this.boxMats.hurtSecond : this.boxMats.hurt);
      const a = f.attack;
      for (const r of activeBoxes(f)) draw(r, a?.def.grab ? this.boxMats.grab : this.boxMats.hit);
    }
    for (const s of sim.shots) draw({ x0: s.x - s.def.rx, x1: s.x + s.def.rx, y0: s.y - s.def.ry, y1: s.y + s.def.ry }, this.boxMats.shot);
    for (let i = used; i < this.debugPool.length; i++) this.debugPool[i].visible = false;
  }

  // ------------------------------------------------------------------------------------------------------------
  // The frame
  // ------------------------------------------------------------------------------------------------------------
  render(sim: ArenaSim, f: RenderFrame) {
    if (this.disposed) return;
    this.last = { sim, frame: f };
    if (this.sizeDirty) this.applySize();
    const { dt, alpha, paused, stepping, menu } = f;
    // Idle animation, strides and spin hold still in hitstop, pause and frame-step; effects and ambient scenery do not.
    const hold = paused || stepping || sim.freeze > 0;
    if (!hold) this.animClock += dt;
    const motion = !this.options.reducedMotion && this.profile.ambient;
    this.stage.update(f.time, motion);

    // 1. Draw every fighter once, at one interpolated position that everything attached to them shares.
    this.focus.length = 0;
    for (let i = 0; i < this.rigs.length; i++) {
      const fighter = sim.fighters[i], r = this.rendered[i], d = this.drawn[i];
      this.interp.fighter(sim, i, alpha, r);
      const moved = d.valid && !r.snapped ? Math.hypot(r.x - d.x, r.y - d.y) : 0; d.x = r.x; d.y = r.y; d.valid = true;
      this.rigs[i].pose(fighter, { x: r.x, y: r.y, moved, attackAge: r.attackAge, time: this.animClock, dt: paused ? 0 : dt, snap: r.snapped });
      if (fighter.respawn === 0 && fighter.stocks > 0) { const p = this.focusPool[this.focus.length]; p.x = r.x; p.y = r.y; this.focus.push(p); }
      this.groundShadow(i, fighter.respawn === 0 && fighter.stocks > 0, r, sim);
      this.launchTrail(i, fighter, r);
    }
    this.attachHeld(sim);

    // 2. Camera: a smoothed base pose plus a separate shake offset, then the framing shift on the menu.
    this.cameraRig.update({ dt: paused ? 0 : dt, menu, time: f.time, focus: this.focus, aspect: this.camera.aspect, paused });
    this.applyViewShift(this.cameraRig.shift, this.cameraRig.shiftY);
    this.cameraRig.apply(this.camera);

    // 3. Projectiles and pickups.
    if (this.debugOn) this.drawBoxes(sim);
    this.updateShots(sim, alpha, dt, hold);
    this.updatePickups(sim);

    // 4. Effects and trails. Trails hold still in hitstop so a frozen fighter does not appear to keep moving.
    this.effects.update(dt, paused); this.trails.update(hold ? 0 : dt);

    // 5. One draw path: the post pipeline, or straight to the canvas.
    const shadowsWereOn = this.key.castShadow;
    if (this.debugShadowsOff && shadowsWereOn) this.key.castShadow = false;
    this.renderer.info.reset();
    if (this.post) this.post.render(dt); else this.renderer.render(this.scene, this.camera);
    this.frameStats = { draws: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles };
    if (this.debugShadowsOff && shadowsWereOn) this.key.castShadow = true;
  }

  private applyViewShift(shift: number, shiftY: number) {
    const key = shift * 1000 + shiftY;
    if (key === this.appliedShift) return;
    this.appliedShift = key;
    if (shift > 1e-4 || shiftY > 1e-4) this.camera.setViewOffset(this.width, this.height, -shift * this.width, -shiftY * this.height, this.width, this.height); else this.camera.clearViewOffset();
  }

  /** Soft contact shadow, cropped to the surface the fighter is actually over, and faded with height. */
  private groundShadow(i: number, alive: boolean, r: RenderedFighter, sim: ArenaSim) {
    const mesh = this.shadows[i]; if (!mesh) return;
    const platform = alive ? floorBelow(sim.platforms, r.x, r.y) : null, span = platform ? shadowSpan(r.x, 0.62, platform) : null;
    mesh.visible = !!platform && !!span;
    if (!platform || !span) return;
    const lift = Math.max(0, r.y - platform.y), grow = Math.max(0.5, 1 - lift * 0.05), fade = 1 - Math.min(0.75, lift / 10);
    mesh.position.set(span.cx, platform.y + 0.03, 0);
    mesh.scale.set(Math.max(0.1, span.half * 2 * 1.2 * grow), 1.0 * grow, 1);
    (mesh.material as T.MeshBasicMaterial).opacity = this.profile.contactShadow * fade * (this.key.castShadow ? 0.8 : 1);
  }

  /** A short trail behind a launched fighter, following their actual drawn path. */
  private launchTrail(i: number, fighter: ArenaSim['fighters'][number], r: RenderedFighter) {
    if (this.options.reducedMotion || fighter.respawn || fighter.stocks <= 0) return;
    const speed = Math.hypot(fighter.vx, fighter.vy);
    if (fighter.stun > 0 && speed > TRAIL_SPEED && !r.snapped) {
      const k = Math.min(1, (speed - TRAIL_SPEED) / 0.9);
      this.trails.follow(`f${i}`, r.x, r.y + 1.15, 0.12, lin(FIGHTER_ACCENTS[fighter.character] ?? '#ffffff', 1.8 + k), 0.4 + 0.5 * k, 0.26);
    }
  }

  /** Holds an opponent in the captor's hands: nudges the held model so it meets the hands, without touching the simulation. */
  private attachHeld(sim: ArenaSim) {
    for (let c = 0; c < 2; c++) {
      const captor = sim.fighters[c], held = captor.hold ? sim.fighters[captor.hold.target] : null;
      if (!held || held.heldBy !== c || held.respawn || held.stocks <= 0 || !this.rigs[c] || !this.rigs[held.slot]) continue;
      const a = this.rigs[c], b = this.rigs[held.slot];
      a.root.updateMatrixWorld(true); b.root.updateMatrixWorld(true);
      a.handMidpoint(this.tmpA); b.chestWorld(this.tmpB); this.tmpA.sub(this.tmpB);
      b.root.position.x += T.MathUtils.clamp(this.tmpA.x, -0.5, 0.5); b.root.position.y += T.MathUtils.clamp(this.tmpA.y, -0.45, 0.45); b.root.position.z += T.MathUtils.clamp(this.tmpA.z, -0.3, 0.3);
    }
  }

  private updateShots(sim: ArenaSim, alpha: number, dt: number, hold: boolean) {
    const live = new Set<number>();
    for (const s of sim.shots) {
      live.add(s.id);
      let entry = this.shotProps.get(s.id);
      // A projectile prop is scaled to its hit volume, so a wide Cash Burn looks wide and a narrow tablet looks narrow.
      if (!entry) { const group = makeProp(s.kind); group.scale.setScalar(T.MathUtils.clamp(Math.max(s.def.rx, s.def.ry) / 0.4, 0.8, 1.8)); entry = { group, acc: 0 }; this.shotProps.set(s.id, entry); this.scene.add(group); }
      const p = this.interp.shot(s, alpha, this.shotPos), spin = this.animClock;
      entry.group.position.set(p.x, p.y, 0.1); entry.group.rotation.set(spin * 4, spin * 7, s.kind === 5 ? -Math.sign(s.vx) * Math.PI / 2 : spin * 4);
      const fx = SHOT_FX[s.kind] ?? SHOT_FX[0];
      if (!this.options.reducedMotion) this.trails.follow(`s${s.id}`, p.x, p.y, 0.08, fx.color, fx.width, fx.life);
      if (!hold && !p.fresh) this.shotParticles(s.kind, s.vx, p.x, p.y, dt, entry);
    }
    for (const [id, entry] of this.shotProps) if (!live.has(id)) { this.scene.remove(entry.group); this.shotProps.delete(id); }
  }

  /** Per-prop extras: tablet glints, briefcase sparkle, bottle drops, fluttering resumes and bills, rocket exhaust and smoke. */
  private shotParticles(kind: number, vx: number, x: number, y: number, dt: number, entry: { acc: number }) {
    const rate = [7, 14, 10, 12, 12, 46][kind] * (this.profile.particles / 420), back = -Math.sign(vx || 1);
    entry.acc += dt * rate;
    while (entry.acc >= 1) {
      entry.acc -= 1;
      const j = (n: number) => (((x * 12.9898 + y * 78.233 + entry.acc * 37.719 + n * 5.31) * 43758.5453) % 1 + 1) % 1 - 0.5;
      const color = SHOT_FX[kind].color;
      if (kind === 0) this.effects.spawn(makeParticle({ kind: 'flare', x: x + j(1) * 0.4, y: y + j(2) * 0.5, z: 0.4, life: 0.16, size0: 0.4, size1: 0.8, r: color[0], g: color[1], b: color[2], spin: 3 }));
      else if (kind === 5) {
        this.effects.spawn(makeParticle({ kind: 'disc', x: x + back * 0.5, y: y + j(2) * 0.15, z: 0.2, vx: back * 2.5, vy: j(3), life: 0.28, size0: 0.55, size1: 0.2, r: 3.4, g: 1.7, b: 0.5, a: 0.9 }));
        this.effects.spawn(makeParticle({ layer: 'dust', kind: 'disc', x: x + back * 0.7, y: y + j(4) * 0.2, z: 0.1, vx: back * 1.2, vy: 0.3 + j(5) * 0.5, life: 0.7, size0: 0.4, size1: 1.2, r: 0.55, g: 0.55, b: 0.58, a: 0.28, drag: 1.6 }));
      } else if (kind === 2) this.effects.spawn(makeParticle({ kind: 'disc', x: x + j(1) * 0.2, y: y + 0.2, z: 0.3, vx: back * 0.8, vy: 0.5 + j(2), life: 0.3, size0: 0.14, size1: 0.06, r: color[0], g: color[1], b: color[2], gravity: 7 }));
      else this.effects.spawn(makeParticle({ kind: 'disc', x: x + j(1) * 0.3, y: y + j(2) * 0.3, z: 0.3, vx: back * 1.0, vy: j(3) * 1.2, life: 0.4, size0: kind === 1 ? 0.12 : 0.2, size1: 0.08, r: color[0], g: color[1], b: color[2], spin: 6 + j(4) * 6, gravity: kind === 1 ? 0 : 2.2 }));
    }
  }

  private updatePickups(sim: ArenaSim) {
    const live = new Set<number>();
    for (const p of sim.pickups) {
      live.add(p.id);
      let group = this.pickupProps.get(p.id);
      if (!group) { group = this.makePickup(p.type); this.pickupProps.set(p.id, group); this.scene.add(group); }
      group.position.set(p.x, p.y + Math.sin(this.animClock * 3) * 0.1, 0); group.rotation.y = this.animClock;
    }
    for (const [id, group] of this.pickupProps) if (!live.has(id)) { this.scene.remove(group); this.disposePickup(group); this.pickupProps.delete(id); }
  }
  private makePickup(type: 'coffee' | 'gpu'): T.Group {
    const group = new T.Group(), color = type === 'coffee' ? '#f5d5a1' : '#5ae8a5';
    const body = new T.Mesh(type === 'coffee' ? new T.CylinderGeometry(0.2, 0.14, 0.45, 18) : new T.BoxGeometry(0.6, 0.36, 0.12), new T.MeshStandardMaterial({ color, roughness: 0.4, metalness: type === 'gpu' ? 0.6 : 0.05, emissive: color, emissiveIntensity: 0.9, envMap: this.envTexture, envMapIntensity: this.envIntensity }));
    const ring = new T.Mesh(this.shadowGeo, new T.MeshBasicMaterial({ color: new T.Color(color).multiplyScalar(2), transparent: true, opacity: 0.55, depthWrite: false, blending: T.AdditiveBlending, map: this.shadowTex }));
    ring.scale.setScalar(1.1); ring.rotation.x = -Math.PI / 2; ring.position.y = -0.25; body.castShadow = true; group.add(body, ring);
    body.userData.owned = true; ring.userData.owned = true;
    return group;
  }
  private disposePickup(group: T.Group) { group.traverse(o => { const m = o as T.Mesh; if (m.isMesh && m.userData.owned) { m.material instanceof T.Material && m.material.dispose(); if (m.geometry !== this.shadowGeo) m.geometry.dispose(); } }); }

  // ------------------------------------------------------------------------------------------------------------
  // Queries and statistics
  // ------------------------------------------------------------------------------------------------------------
  /** Projects a point on the fighters' plane to container coordinates (CSS pixels). */
  project(x: number, y: number): { x: number; y: number } {
    const v = this.tmpA.set(x, y, 0).project(this.camera); return { x: (v.x + 1) / 2 * this.width, y: (1 - v.y) / 2 * this.height };
  }
  /** Where a fighter is drawn this frame, `height` above their feet, in container pixels: for floating labels. */
  anchor(slot: number, height: number): { x: number; y: number } { const r = this.rendered[slot]; return this.project(r.x, r.y + height); }

  /** Whole-frame statistics: draw calls and triangles across every pass, plus resource counts. */
  get stats() {
    const m = this.renderer.info.memory;
    return { draws: this.frameStats.draws, triangles: this.frameStats.triangles, geometries: m.geometries, textures: m.textures, programs: this.renderer.info.programs?.length ?? 0 };
  }
  get graphics() {
    const gl = this.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    const post: PostInfo | null = this.post ? this.post.info : null;
    return { tier: this.options.quality, shadowSize: this.key.castShadow ? this.key.shadow.mapSize.x : 0, pixelRatio: this.pixelRatio, post, gpu: ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown', drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight] };
  }

  /** Test hook: place the camera exactly (or pass null to release it). */
  setCameraOverride(position: number[] | null, target?: number[]) {
    this.cameraRig.override = position && target ? { position: new T.Vector3(...position), target: new T.Vector3(...target) } : null;
  }

  dispose() {
    this.disposed = true;
    for (const off of this.observers) off(); this.observers.length = 0;
    for (const rig of this.rigs) { this.scene.remove(rig.root); rig.dispose(); }
    for (const s of this.shadows) (s.material as T.Material).dispose();
    for (const g of this.pickupProps.values()) this.disposePickup(g); this.pickupProps.clear(); this.shotProps.clear();
    this.post?.dispose(); this.effects.dispose(); this.trails.dispose();
    for (const stage of this.stages.values()) stage.dispose(); this.stages.clear();
    for (const rt of this.envs.values()) rt.dispose(); this.envs.clear(); this.pmrem?.dispose();
    this.shadowGeo.dispose(); this.shadowTex.dispose(); this.boxEdges.dispose(); for (const m of Object.values(this.boxMats)) m.dispose();
    disposeRigParts(); this.renderer.dispose();
  }
}
