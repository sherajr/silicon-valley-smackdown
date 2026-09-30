import * as T from 'three';
import { FighterRig, makeProp } from './FighterRig';
import { ArenaStage } from './Stage';
import { FIGHTER_ACCENTS } from './data';
import { activeBoxes, hurtboxOf, newFighter } from './Simulation';
import type { ArenaSim, GameEvent } from './Simulation';

interface Particle { mesh: T.Mesh; vx: number; vy: number; vz: number; life: number; max: number; ring: boolean }
/** Burst look per simulation event: colour, particle count, whether a shock ring shows, camera shake and launch speed. */
const FX: Record<string, { color: string; count: number; ring: boolean; shake?: number; speed?: number }> = {
  hit: { color: '#fff5c8', count: 18, ring: true, shake: 0.12, speed: 8 }, ko: { color: '#fdbd70', count: 34, ring: true, shake: 0.34, speed: 8 },
  block: { color: '#66bcff', count: 6, ring: true }, pickup: { color: '#adffc2', count: 6, ring: false },
  jump: { color: '#fff5c8', count: 6, ring: false }, recovery: { color: '#fff5c8', count: 6, ring: false }, land: { color: '#fff5c8', count: 6, ring: false },
  catch: { color: '#ffd27a', count: 10, ring: true, shake: 0.05 }, tech: { color: '#7dffea', count: 14, ring: true },
  pummel: { color: '#ffe9a8', count: 5, ring: false }, throwBreak: { color: '#c9d6ff', count: 12, ring: true },
  counter: { color: '#ffd45c', count: 26, ring: true, shake: 0.2, speed: 9 }, armor: { color: '#8fb4e8', count: 8, ring: true },
  impact: { color: '#ffb468', count: 26, ring: true, shake: 0.26, speed: 9 }, bounce: { color: '#fff5c8', count: 4, ring: false },
  shotBreak: { color: '#ffb0a0', count: 8, ring: false }, fizzle: { color: '#9aa7ad', count: 4, ring: false },
};
export class ArenaRenderer {
  renderer: T.WebGLRenderer;
  scene = new T.Scene();
  camera = new T.PerspectiveCamera(41, 1, 0.1, 240);
  stage: ArenaStage;
  rigs: FighterRig[] = [];
  private key: T.DirectionalLight;
  private shadows: T.Mesh[] = [];
  private dynamic = new Map<number, T.Group>();
  private particles: Particle[] = [];
  private particleGeo = new T.BoxGeometry(0.09, 0.09, 0.09);
  private ringGeo = new T.RingGeometry(0.65, 0.72, 32);
  private shadowGeo = new T.CircleGeometry(0.7, 24);
  private cameraTarget = new T.Vector3(0, 2.7, 0);
  private shake = 0;
  private debugOn = false;
  private debug = new T.Group();
  private debugPool: T.LineSegments[] = [];
  private boxEdges = new T.EdgesGeometry(new T.BoxGeometry(1, 1, 1));
  private boxMats = { hurt: new T.LineBasicMaterial({ color: '#57ebd6' }), hurtSecond: new T.LineBasicMaterial({ color: '#ffa577' }), hit: new T.LineBasicMaterial({ color: '#ff5a5a' }), grab: new T.LineBasicMaterial({ color: '#ffd27a' }), shot: new T.LineBasicMaterial({ color: '#ff7bd5' }) };
  private width = 1;
  private height = 1;
  private high = true;
  constructor(container: HTMLElement) {
    this.renderer = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.domElement.id = 'arena-canvas'; container.append(this.renderer.domElement);
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.10;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = T.PCFShadowMap;
    this.scene.fog = new T.Fog('#667787', 38, 108);
    this.scene.add(new T.HemisphereLight('#d9eeff', '#5a6152', 2.5));
    this.key = new T.DirectionalLight('#ffe1b1', 3.1); this.key.position.set(-9, 15, 10);
    this.key.castShadow = true; this.key.shadow.mapSize.set(2048, 2048);
    Object.assign(this.key.shadow.camera, { left: -17, right: 17, top: 16, bottom: -12, near: 1, far: 60 });
    this.key.shadow.normalBias = 0.035; this.key.shadow.bias = -0.0004;
    this.scene.add(this.key);
    const rim = new T.DirectionalLight('#88bdff', 1.8); rim.position.set(5, 7, -7); this.scene.add(rim);
    this.stage = new ArenaStage(0); this.scene.add(this.stage.root);
    this.camera.position.set(9, 7, 21); this.camera.lookAt(0, 2.7, 0);
    this.debug.visible = false; this.scene.add(this.debug);
    this.resize();
  }
  resize() {
    this.width = window.innerWidth; this.height = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.high ? 1.75 : 1));
    this.renderer.setSize(this.width, this.height); this.camera.aspect = this.width / this.height; this.camera.updateProjectionMatrix();
  }
  setQuality(high: boolean) {
    this.high = high; this.renderer.shadowMap.enabled = high; this.resize();
  }
  setMatch(characters: number[], stage: number) {
    for (const rig of this.rigs) { this.scene.remove(rig.root); rig.dispose(); }
    for (const s of this.shadows) { this.scene.remove(s); (s.material as T.Material).dispose(); }
    this.rigs = characters.map(c => new FighterRig(c)); this.rigs.forEach(r => this.scene.add(r.root));
    this.shadows = characters.map(() => {
      const shadow = new T.Mesh(this.shadowGeo, new T.MeshBasicMaterial({ color: '#102632', transparent: true, opacity: 0.25, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2; this.scene.add(shadow); return shadow;
    });
    this.scene.remove(this.stage.root); this.stage.dispose(); this.stage = new ArenaStage(stage); this.scene.add(this.stage.root);
    for (const group of this.dynamic.values()) this.disposeDynamic(group); this.dynamic.clear();
    for (const p of this.particles) { this.scene.remove(p.mesh); (p.mesh.material as T.Material).dispose(); } this.particles = [];
  }
  portraits(): string[] {
    const portraits: string[] = [];
    const scene = new T.Scene(); scene.background = new T.Color('#172d39');
    scene.add(new T.HemisphereLight('#e0faff', '#374b50', 3));
    const light = new T.DirectionalLight('#ffe2bd', 3.5); light.position.set(-3, 5, 6); scene.add(light);
    const camera = new T.PerspectiveCamera(33, 1, 0.1, 20); camera.position.set(1.5, 2.25, 5); camera.lookAt(0, 1.65, 0);
    this.renderer.setPixelRatio(1); this.renderer.setSize(224, 224);
    for (let i = 0; i < 6; i++) {
      const rig = new FighterRig(i); const f = newFighter(0, i); f.x = f.prevX = 0; rig.pose(f, 0); rig.body.rotation.y = 0.20;
      scene.add(rig.root); this.renderer.render(scene, camera); portraits.push(this.renderer.domElement.toDataURL('image/png'));
      scene.remove(rig.root); rig.dispose();
    }
    this.resize(); return portraits;
  }
  event(e: GameEvent) {
    const fx = FX[e.type];
    if (!fx) return;
    const impact = !!fx.speed, x = T.MathUtils.clamp(e.x, -18, 18), y = T.MathUtils.clamp(e.y, -4, 13);
    if (fx.shake) this.shake = Math.max(this.shake, fx.shake);
    for (let i = 0; i < fx.count; i++) {
      if (this.particles.length > 140) break;
      const mat = new T.MeshBasicMaterial({ color: fx.color, transparent: true, depthWrite: false });
      const mesh = new T.Mesh(this.particleGeo, mat); mesh.position.set(x, y, 0.35); mesh.scale.set(1 + Math.random() * 2, 1, 1);
      const angle = Math.random() * Math.PI * 2, speed = 2 + Math.random() * (impact ? (fx.speed ?? 8) : 2);
      this.scene.add(mesh); this.particles.push({ mesh, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, vz: (Math.random() - 0.5) * 4, life: 0.4, max: 0.4, ring: false });
    }
    if (fx.ring) {
      const ring = new T.Mesh(this.ringGeo, new T.MeshBasicMaterial({ color: fx.color, transparent: true, side: T.DoubleSide, depthWrite: false }));
      ring.position.set(x, y, 0.5); this.scene.add(ring);
      this.particles.push({ mesh: ring, vx: 0, vy: 0, vz: 0, life: 0.25, max: 0.25, ring: true });
    }
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
    for (const f of sim.fighters) {
      if (f.respawn || f.stocks <= 0) continue;
      draw(hurtboxOf(f), f.slot ? this.boxMats.hurtSecond : this.boxMats.hurt);
      const a = f.attack;
      for (const r of activeBoxes(f)) draw(r, a?.def.grab ? this.boxMats.grab : this.boxMats.hit);
    }
    for (const s of sim.shots) draw({ x0: s.x - s.def.rx, x1: s.x + s.def.rx, y0: s.y - s.def.ry, y1: s.y + s.def.ry }, this.boxMats.shot);
    for (let i = used; i < this.debugPool.length; i++) this.debugPool[i].visible = false;
  }
  render(sim: ArenaSim, dt: number, time: number, menu: boolean, alpha: number, paused: boolean) {
    const active = sim.fighters.filter(f => !f.respawn && f.stocks > 0);
    if (menu) {
      const angle = Math.sin(time * 0.075) * 0.7;
      this.camera.position.lerp(new T.Vector3(8 + angle, 6.4, 18.5), Math.min(1, dt * 3));
      this.cameraTarget.lerp(new T.Vector3(-0.5, 2.1, 0), Math.min(1, dt * 3));
    } else {
      const xs = active.map(f => f.x), ys = active.map(f => f.y);
      const centerX = active.length ? T.MathUtils.clamp(xs.reduce((a, b) => a + b, 0) / active.length, -5, 5) : 0;
      const centerY = active.length ? T.MathUtils.clamp(ys.reduce((a, b) => a + b, 0) / active.length, 0, 8) : 0;
      const span = active.length > 1 ? Math.max(...xs) - Math.min(...xs) : 8;
      const tall = active.length > 1 ? Math.max(...ys) - Math.min(...ys) : 0;
      const distance = T.MathUtils.clamp(Math.max(19.8, (span + 8) / (0.64 * this.camera.aspect), (tall + 8) / 0.62), 19.8, 37);
      const blend = 1 - Math.exp(-dt * 3.2);
      this.camera.position.lerp(new T.Vector3(centerX, centerY * 0.7 + 7.5, distance), blend);
      this.cameraTarget.lerp(new T.Vector3(centerX, centerY * 0.7 + 2.65, 0), blend);
    }
    this.camera.lookAt(this.cameraTarget);
    if (this.shake && !paused) { this.camera.position.x += (Math.random() - 0.5) * this.shake; this.camera.position.y += (Math.random() - 0.5) * this.shake; this.shake *= Math.exp(-dt * 13); }
    this.stage.update(time);
    if (this.debugOn) this.drawBoxes(sim);
    for (let i = 0; i < this.rigs.length; i++) {
      const f = sim.fighters[i]; this.rigs[i].pose(f, time, alpha);
      let floor: number | null = null;
      for (const p of sim.platforms) if (Math.abs(f.x - p.x) < p.w / 2 && p.y <= f.y + 0.05 && (floor === null || p.y > floor)) floor = p.y;
      this.shadows[i].visible = floor !== null && !f.respawn && f.stocks > 0;
      if (floor !== null) {
        this.shadows[i].position.set(f.x, floor + 0.035, 0); const s = Math.max(0.45, 1 - (f.y - floor) * 0.06); this.shadows[i].scale.set(s, s * 0.68, 1);
      }
    }
    const live = new Set<number>();
    for (const s of sim.shots) {
      live.add(s.id);
      let group = this.dynamic.get(s.id);
      // A projectile prop is scaled to its hit volume, so a wide Cash Burn looks wide and a narrow iPad looks narrow.
      if (!group) { group = makeProp(s.kind); group.scale.setScalar(T.MathUtils.clamp(Math.max(s.def.rx, s.def.ry) / 0.4, 0.8, 1.8)); this.dynamic.set(s.id, group); this.scene.add(group); }
      group.position.set(s.x, s.y, 0.1); group.rotation.set(time * 4, time * 7, s.kind === 5 ? -Math.sign(s.vx) * Math.PI / 2 : time * 4);
    }
    for (const p of sim.pickups) {
      live.add(p.id);
      let group = this.dynamic.get(p.id);
      if (!group) {
        group = new T.Group();
        const color = p.type === 'coffee' ? '#f5d5a1' : '#5ae8a5';
        const geo = p.type === 'coffee' ? new T.CylinderGeometry(0.2, 0.14, 0.45, 12) : new T.BoxGeometry(0.6, 0.36, 0.12);
        const body = new T.Mesh(geo, new T.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35 })); body.userData.ownedGeometry = true;
        group.add(body);
        const ring = new T.Mesh(this.ringGeo, new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, side: T.DoubleSide }));
        ring.scale.setScalar(0.62); ring.rotation.x = -Math.PI / 2; ring.position.y = -0.25; group.add(ring);
        this.dynamic.set(p.id, group); this.scene.add(group);
      }
      group.position.set(p.x, p.y + Math.sin(time * 3) * 0.1, 0); group.rotation.y = time;
    }
    for (const [id, group] of this.dynamic) if (!live.has(id)) { this.disposeDynamic(group); this.dynamic.delete(id); }
    if (!paused) for (const p of this.particles) {
      p.life -= dt; p.mesh.position.x += p.vx * dt; p.mesh.position.y += p.vy * dt; p.mesh.position.z += p.vz * dt;
      if (!p.ring) { p.vy -= dt * 10; p.mesh.rotation.z += dt * 7; } else p.mesh.scale.setScalar(1 + (1 - p.life / p.max) * 2.4);
      (p.mesh.material as T.MeshBasicMaterial).opacity = Math.max(0, p.life / p.max);
    }
    this.particles = this.particles.filter(p => { if (p.life > 0) return true; this.scene.remove(p.mesh); (p.mesh.material as T.Material).dispose(); return false; });
    this.renderer.render(this.scene, this.camera);
  }
  project(x: number, y: number): { x: number; y: number } {
    const v = new T.Vector3(x, y, 0).project(this.camera); return { x: (v.x + 1) / 2 * this.width, y: (1 - v.y) / 2 * this.height };
  }
  private disposeDynamic(group: T.Group) {
    this.scene.remove(group); group.traverse(o => { if (o instanceof T.Mesh) { (o.material as T.Material).dispose(); if (o.userData.ownedGeometry) o.geometry.dispose(); } });
  }
  get stats() { return { draws: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, geometries: this.renderer.info.memory.geometries, textures: this.renderer.info.memory.textures }; }
}
