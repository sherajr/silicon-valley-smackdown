// Owns the Three.js side of the "Three.js canvas behind a transparent Phaser overlay" integration
// (see docs/3d-conversion-checklist.md for why this approach was chosen over a shared WebGL
// context). Exactly one instance exists per FightScene session; it is never a second scheduler --
// render() is called once per Phaser render frame, from FightScene.renderFrame(), and never
// advances the simulation or reads input itself.
import * as THREE from 'three';
import { BASE_WIDTH, BASE_HEIGHT, GROUND_Y } from '../sim/constants';
import { WORLD_UNITS_PER_PX } from './coordinates';
import type { GraphicsSettings } from './GraphicsSettings';

export class GameRenderer3D {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  private renderer: THREE.WebGLRenderer;
  private canvas: HTMLCanvasElement;
  private phaserCanvas: HTMLCanvasElement;
  private resizeObserver: ResizeObserver;
  private keyLight: THREE.DirectionalLight;
  private settings: GraphicsSettings;

  constructor(phaserCanvas: HTMLCanvasElement, settings: GraphicsSettings) {
    this.phaserCanvas = phaserCanvas;
    this.settings = settings;
    this.canvas = document.createElement('canvas');
    // Never intercepts input -- this game's InputManager reads raw window keyboard events only
    // (see src/input/InputManager.ts), so there are no pointer coordinates to protect here, but
    // this still guarantees this overlay can never swallow a click/tap aimed at anything else.
    this.canvas.style.position = 'absolute';
    this.canvas.style.pointerEvents = 'none';
    // An absolutely-positioned element stacks above a statically-positioned one regardless of DOM
    // order -- inserting this canvas before Phaser's in the DOM is not enough on its own (this
    // was tried first and silently hid the entire HUD, caught from a screenshot: the 3D scene
    // rendered but no HUD text/health bars appeared anywhere). Explicit z-index on both fixes it.
    this.canvas.style.zIndex = '0';
    const parent = phaserCanvas.parentElement!;
    parent.style.position = parent.style.position || 'relative';
    phaserCanvas.style.position = 'relative';
    phaserCanvas.style.zIndex = '1';
    parent.insertBefore(this.canvas, phaserCanvas);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.shadowMap.enabled = settings.shadows;

    const frustumWidth = BASE_WIDTH * WORLD_UNITS_PER_PX;
    const frustumHeight = BASE_HEIGHT * WORLD_UNITS_PER_PX;
    // Ground (world y=0) lands at roughly the same fraction of screen height as GROUND_Y does in
    // the 2D canvas, so the always-2D HUD/effects and the 3D floor read as the same arena. A pure
    // zero-elevation side view was tried first and rejected: an orthographic camera looking
    // straight down -Z sees a horizontal (XZ) ground plane exactly edge-on, so the floor
    // disappears and fighters read as floating (caught from an actual screenshot, not assumed --
    // see docs/3d-conversion-checklist.md). A modest elevation + downward tilt keeps the floor
    // legible; this makes the world/HUD vertical alignment an approximation rather than exact,
    // which is an accepted, documented tradeoff (a full camera calibration pass is a follow-up).
    const groundFractionFromBottom = (BASE_HEIGHT - GROUND_Y) / BASE_HEIGHT;
    const bottom = -groundFractionFromBottom * frustumHeight;
    const top = bottom + frustumHeight;
    this.camera = new THREE.OrthographicCamera(-frustumWidth / 2, frustumWidth / 2, top, bottom, 0.1, 200);
    const elevation = frustumHeight * 1.0;
    this.camera.position.set(0, elevation, 30);
    this.camera.lookAt(0, 0, 0);

    const ambient = new THREE.HemisphereLight(0xbfd6ff, 0x30241a, 0.55);
    this.scene.add(ambient);
    this.keyLight = new THREE.DirectionalLight(0xfff2d8, 1.4);
    this.keyLight.position.set(-8, 14, 10);
    this.keyLight.castShadow = settings.shadows;
    if (settings.shadows) {
      this.keyLight.shadow.mapSize.set(1024, 1024);
      const d = 16;
      Object.assign(this.keyLight.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 1, far: 60 });
    }
    this.scene.add(this.keyLight);
    const fillLight = new THREE.DirectionalLight(0x88aaff, 0.25);
    fillLight.position.set(10, 6, -8);
    this.scene.add(fillLight);

    this.resizeObserver = new ResizeObserver(() => this.sync());
    this.resizeObserver.observe(phaserCanvas);
    this.sync();
  }

  /** Keeps the 3D canvas pixel-for-pixel aligned with Phaser's own canvas rect, through
   * letterboxing (Phaser Scale.FIT), resize, and fullscreen -- verified in
   * tests/e2e/render3d-compositing.spec.ts. */
  sync(): void {
    const rect = this.phaserCanvas.getBoundingClientRect();
    const parentRect = this.phaserCanvas.parentElement!.getBoundingClientRect();
    this.canvas.style.left = `${rect.left - parentRect.left}px`;
    this.canvas.style.top = `${rect.top - parentRect.top}px`;
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, this.settings.maxPixelRatio);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(rect.width, rect.height, true);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  get info(): THREE.WebGLInfo {
    return this.renderer.info;
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
