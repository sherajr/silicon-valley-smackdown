// Builds a real modular 3D environment per stage -- ground, sidewalk, buildings with depth, and
// selective signage/props -- using the existing StageDef palette/signs as the reference the brief
// asks for, instead of a single background image on a plane. Castro Street is the only stage built
// so far (Maul is the only 3D fighter this session); Sand Hill Road and Palo Alto are follow-ups
// tracked in docs/3d-conversion-checklist.md, and FightScene falls back to the 2D StageView for
// any stage without an entry here.
import * as THREE from 'three';
import type { StageDef } from '../data/stages';
import type { StageId } from '../sim/types';
import { WORLD_UNITS_PER_PX } from './coordinates';
import { BASE_WIDTH } from '../sim/constants';

const ARENA_WIDTH = BASE_WIDTH * WORLD_UNITS_PER_PX; // world units

function windowTexture(base: string, lit: string, cols: number, rows: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 64, 64);
  const cellW = 64 / cols;
  const cellH = 64 / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if ((r * cols + c) % 3 === 0) continue; // a few unlit windows for variety
      ctx.fillStyle = lit;
      ctx.fillRect(c * cellW + 2, r * cellH + 2, cellW - 4, cellH - 4);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function signTexture(text: string, color: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 512, 128);
  ctx.font = 'bold 56px monospace';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = 18;
  ctx.fillText(text, 256, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function skyTexture(top: string, bottom: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 4, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface Disposable {
  geometry?: THREE.BufferGeometry;
  material?: THREE.Material | THREE.Material[];
}

export class Stage3D {
  readonly group = new THREE.Group();
  private disposables: Disposable[] = [];
  private textures: THREE.Texture[] = [];

  constructor(scene: THREE.Scene, stage: StageDef) {
    scene.add(this.group);
    this.buildSky(stage);
    this.buildGround(stage);
    this.buildBuildings(stage);
    this.buildSigns(stage);
    this.buildProps(stage);
  }

  private track(mesh: THREE.Mesh): THREE.Mesh {
    this.group.add(mesh);
    this.disposables.push(mesh);
    return mesh;
  }

  private buildSky(stage: StageDef): void {
    const tex = skyTexture(stage.palette.sky[0], stage.palette.sky[1]);
    this.textures.push(tex);
    const geo = new THREE.PlaneGeometry(ARENA_WIDTH * 2.4, 22);
    const mat = new THREE.MeshBasicMaterial({ map: tex, fog: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, 6, -14);
    this.track(mesh);
  }

  private buildGround(stage: StageDef): void {
    const floorGeo = new THREE.PlaneGeometry(ARENA_WIDTH * 1.6, 12);
    const floorMat = new THREE.MeshStandardMaterial({ color: stage.palette.floor, roughness: 0.95 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, 1);
    floor.receiveShadow = true;
    this.track(floor);

    // Sidewalk contact line, matching StageView's floorLine accent read.
    const lineGeo = new THREE.PlaneGeometry(ARENA_WIDTH * 1.6, 0.06);
    const lineMat = new THREE.MeshBasicMaterial({ color: stage.palette.accent });
    const line = new THREE.Mesh(lineGeo, lineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, 0.01, -1.6);
    this.track(line);
  }

  private buildBuildings(stage: StageDef): void {
    const layers: { color: string; z: number; count: number; hMin: number; hMax: number; wMin: number; wMax: number; lit: boolean }[] = [
      { color: stage.palette.far, z: -11, count: 6, hMin: 5, hMax: 9, wMin: 2.2, wMax: 3.4, lit: false },
      { color: stage.palette.mid, z: -7.5, count: 5, hMin: 3.5, hMax: 6.5, wMin: 2.4, wMax: 3.6, lit: true },
      { color: stage.palette.near, z: -4.5, count: 4, hMin: 2, hMax: 4, wMin: 2.8, wMax: 4, lit: true },
    ];
    for (const layer of layers) {
      const spacing = (ARENA_WIDTH * 1.5) / layer.count;
      for (let i = 0; i < layer.count; i++) {
        const w = layer.wMin + ((i * 37) % 10) / 10 * (layer.wMax - layer.wMin);
        const h = layer.hMin + ((i * 53) % 10) / 10 * (layer.hMax - layer.hMin);
        const x = -ARENA_WIDTH * 0.75 + spacing * i + spacing / 2;
        const geo = new THREE.BoxGeometry(w, h, 2);
        let mat: THREE.Material;
        if (layer.lit) {
          const tex = windowTexture(layer.color, stage.palette.neon, 4, Math.max(2, Math.round(h)));
          this.textures.push(tex);
          mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
        } else {
          mat = new THREE.MeshStandardMaterial({ color: layer.color, roughness: 0.9 });
        }
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, h / 2, layer.z);
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        this.track(mesh);
      }
    }
  }

  private buildSigns(stage: StageDef): void {
    const positions = [-ARENA_WIDTH * 0.32, 0, ARENA_WIDTH * 0.32];
    stage.signs.forEach((text, i) => {
      const tex = signTexture(text, stage.palette.neon);
      this.textures.push(tex);
      const geo = new THREE.PlaneGeometry(4.2, 1.05);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(positions[i % positions.length], 6 + (i % 2) * 1.2, -4.3);
      this.track(mesh);
    });
  }

  /** Castro Street's own selective props: a bike rack and a couple of café tables, matching
   * StageView.buildCastroStreet's reference composition at a much lower prop count than the 2D
   * ambient scatter (kept modest per the triangle/material budget in the checklist). */
  private buildProps(stage: StageDef): void {
    const propMat = new THREE.MeshStandardMaterial({ color: stage.palette.near, roughness: 0.7 });
    for (let i = 0; i < 3; i++) {
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.02, 6, 12), propMat);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(ARENA_WIDTH * 0.42 + i * 0.4, 0.22, 0.3);
      this.track(wheel);
    }
    const tableTop = new THREE.CylinderGeometry(0.35, 0.35, 0.05, 12);
    const tableLeg = new THREE.CylinderGeometry(0.04, 0.04, 0.55, 6);
    for (const x of [-ARENA_WIDTH * 0.4, -ARENA_WIDTH * 0.46]) {
      const top = new THREE.Mesh(tableTop, propMat);
      top.position.set(x, 0.55, 0.6);
      this.track(top);
      const leg = new THREE.Mesh(tableLeg, propMat);
      leg.position.set(x, 0.275, 0.6);
      this.track(leg);
    }
  }

  setCrunchLighting(active: boolean): void {
    // Subtle red key-light boost during Crunch Mode, matching StageView's overlay intent without
    // a full-screen 2D rectangle (which would sit awkwardly in front of 3D geometry).
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshStandardMaterial) {
        obj.material.emissive = new THREE.Color(active ? 0x330000 : 0x000000);
      }
    });
  }

  dispose(): void {
    this.group.parent?.remove(this.group);
    for (const d of this.disposables) {
      d.geometry?.dispose();
      const mats = Array.isArray(d.material) ? d.material : d.material ? [d.material] : [];
      for (const m of mats) m.dispose();
    }
    for (const t of this.textures) t.dispose();
  }
}

export const STAGE3D_IDS: StageId[] = ['castro_street'];
export function has3DStage(id: StageId): boolean {
  return STAGE3D_IDS.includes(id);
}
