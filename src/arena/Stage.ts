import * as T from 'three';
import { ACCENTS, STAGE_PLATFORMS } from './data';

export class ArenaStage {
  root = new T.Group();
  accent: string;
  private geometry = new T.BoxGeometry(1, 1, 1);
  private materials = new Map<string, T.MeshStandardMaterial>();
  private owned: { dispose(): void }[] = [this.geometry];
  spinners: T.Object3D[] = [];
  constructor(index: number) {
    this.accent = ACCENTS[index];
    const skyMat = new T.ShaderMaterial({ side: T.BackSide, depthWrite: false,
      uniforms: { top: { value: new T.Color(index === 0 ? '#274659' : index === 1 ? '#2b3c59' : '#142a4b') }, bottom: { value: new T.Color(index === 0 ? '#c99486' : index === 1 ? '#b99181' : '#8d7e9e') } },
      vertexShader: 'varying vec3 vPosition; void main(){vPosition=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform vec3 top;uniform vec3 bottom;varying vec3 vPosition;void main(){float h=normalize(vPosition).y;gl_FragColor=vec4(mix(bottom,top,smoothstep(-0.06,0.32,h)),1.0);\n#include <colorspace_fragment>\n}',
    });
    const skyGeo = new T.SphereGeometry(160, 24, 16); this.root.add(new T.Mesh(skyGeo, skyMat)); this.owned.push(skyGeo, skyMat);
    this.sphere(-26, 18, -79, 6.7, index === 2 ? '#e8d5b2' : '#ffca93', true);
    // Mountain silhouettes frame the Bay without competing with the combat plane.
    for (let layer = 0; layer < 3; layer++) {
      const points: T.Vector2[] = [];
      for (let i = 0; i <= 16; i++) points.push(new T.Vector2(-110 + i * 14, 1 + layer * 0.7 + Math.sin(i * 0.75 + layer) * 2.4 + Math.sin(i * 1.6) * 1.1));
      const ridge = new T.SplineCurve(points).getPoints(180), shape = new T.Shape();
      shape.moveTo(-110, -30); for (const p of ridge) shape.lineTo(p.x, p.y); shape.lineTo(114, -30); shape.closePath();
      const geo = new T.ShapeGeometry(shape), mat = new T.MeshBasicMaterial({ color: ['#738393', '#687b89', '#5a7382'][layer], fog: false });
      this.owned.push(geo, mat); const mountain = new T.Mesh(geo, mat); mountain.position.set(0, -layer * 1.5, -90 + layer * 10); this.root.add(mountain);
    }
    // City windows share one instanced draw call; skyline proportions are deterministic.
    const windowGeo = new T.PlaneGeometry(0.23, 0.33), windowMat = new T.MeshBasicMaterial({ color: '#ffc58e' });
    const windows = new T.InstancedMesh(windowGeo, windowMat, 950); const temp = new T.Object3D(); let windowCount = 0;
    this.owned.push(windowGeo, windowMat);
    for (let i = 0; i < 31; i++) {
      const x = (i - 15) * 3.4, z = -17 - (i % 4) * 6.5;
      const h = 4 + (i * 17 % 13), w = 2 + (i * 3 % 5) * 0.32;
      this.box(x, -10 + h / 2, z, w, h, 2.4, ['#253d52', '#2f4e61', '#345468'][i % 3]);
      this.box(x, -10 + h + 0.12, z, w + 0.15, 0.18, 2.55, '#435f70');
      for (let y = -8.8; y < -10 + h - 0.4; y += 0.95) for (let col = 0; col < 3; col++) {
        if ((i + Math.round(y * 10) + col) % 5 === 0 || windowCount >= 950) continue;
        temp.position.set(x - w * 0.31 + col * w * 0.30, y, z + 1.211); temp.updateMatrix(); windows.setMatrixAt(windowCount++, temp.matrix);
      }
    }
    windows.count = windowCount; this.root.add(windows);
    // Suspension bridge silhouette.
    for (const x of [-30, -17]) {
      this.box(x, 1, -32, 0.36, 13, 0.6, '#a57065'); this.box(x + 1.3, 1, -32, 0.36, 13, 0.6, '#a57065');
      for (const y of [0, 3, 6]) this.box(x + 0.65, y, -32, 1.5, 0.25, 0.6, '#a57065');
    }
    this.box(-23, -2, -32, 34, 0.25, 1.2, '#806776');
    const curve = new T.QuadraticBezierCurve3(new T.Vector3(-29.4, 7.5, -31.6), new T.Vector3(-22.8, -4, -31.6), new T.Vector3(-16.4, 7.5, -31.6));
    const cable = new T.TubeGeometry(curve, 30, 0.042, 5, false); this.owned.push(cable); this.root.add(new T.Mesh(cable, this.mat('#b18578')));
    for (let i = 1; i < 16; i++) { const p = curve.getPoint(i / 16); this.box(p.x, (p.y - 2) / 2, -31.6, 0.025, p.y + 2, 0.025, '#bb9381'); }
    // The same platform definitions drive collision and visible geometry. A solid platform is the lit slab, which is the
    // only gameplay body: its top, sides and underside all collide. The dark building core under it is scenery, set back
    // behind the fighters' plane so nothing looks like an invisible wall and fighters below the roof stay visible.
    for (const p of STAGE_PLATFORMS[index]) {
      if (p.solid) {
        this.box(p.x, p.y - p.thickness / 2, 0, p.w, p.thickness, 6.8, '#253641');
        this.box(p.x, p.y - 0.06, 0, p.w, 0.12, 6.8, '#547071');
        this.box(p.x, p.y - 0.15, 3.43, p.w, 0.09, 0.07, this.accent, true);
        this.box(p.x, p.y - 0.82, 3.43, p.w, 0.07, 0.07, '#f3ae73', true);
        this.box(p.x, p.y - 3.1, -4.3, p.w - 2, 4.3, 4.6, '#192e3c');
        for (let x = -7.5; x <= 7.5; x += 1.5) {
          this.box(x, p.y - 2.7, -1.98, 1.05, 2.6, 0.03, '#344e61');
          this.box(x, p.y - 2.7, -1.95, 0.02, 2.6, 0.02, this.accent, true);
        }
        // Ledge markers sit exactly on the grabbable corners the simulation uses.
        if (p.ledges) for (const side of [-1, 1]) this.box(p.x + side * p.w / 2, p.y - 0.02, 3.44, 0.22, 0.12, 0.08, '#ffe3a1', true);
        for (let x = -9; x < 10; x += 1.0) this.box(x, 0.005, 0, 0.017, 0.012, 6.75, '#74908b');
        for (let z = -3; z < 4; z++) this.box(0, 0.006, z, 18.9, 0.012, 0.016, '#74908b');
        for (const x of [-9.2, 9.2]) {
          this.box(x, 0.016, 0, 0.20, 0.021, 6.65, '#eec681');
          for (let z = -3; z <= 3; z += 0.7) { const stripe = this.box(x, 0.030, z, 0.25, 0.017, 0.14, '#293d45'); stripe.rotation.y = 0.45; }
        }
        const ring = new T.RingGeometry(1.20, 1.25, 48); this.owned.push(ring);
        const badge = new T.Mesh(ring, this.mat('#b6cdc0')); badge.rotation.x = -Math.PI / 2; badge.position.y = 0.024; this.root.add(badge);
        this.sign('SV / SMACKDOWN', 0, -0.48, 3.49, 6.2, 0.53, '#111f2c', '#b2c6ca', 34);
      } else {
        this.box(p.x, p.y - 0.17, 0, p.w, 0.34, 2.4, '#2a3c49');
        this.box(p.x, p.y - 0.018, 0, p.w, 0.036, 2.4, '#7e9794');
        this.box(p.x, p.y - 0.12, 1.22, p.w - 0.10, 0.07, 0.035, this.accent, true);
        this.box(p.x, p.y - 0.37, 0, p.w * 0.6, 0.15, 1.2, '#22303b');
        for (const dx of [-p.w / 2 + 0.17, p.w / 2 - 0.17]) this.box(p.x + dx, p.y + 0.012, 0, 0.14, 0.035, 2.4, '#f3ca85');
      }
    }
    if (index === 0) this.coffee(); else if (index === 1) this.venture(); else this.launch();
  }
  private mat(color: string, glow = false) {
    const key = color + glow;
    if (!this.materials.has(key)) this.materials.set(key, new T.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.12, emissive: glow ? color : '#000000', emissiveIntensity: glow ? 1.5 : 0 }));
    return this.materials.get(key)!;
  }
  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string, glow = false) {
    const m = new T.Mesh(this.geometry, this.mat(color, glow)); m.position.set(x, y, z); m.scale.set(sx, sy, sz);
    m.castShadow = !glow; m.receiveShadow = true; this.root.add(m); return m;
  }
  private sphere(x: number, y: number, z: number, size: number, color: string, glow = false) {
    const geo = new T.SphereGeometry(size, 16, 12); this.owned.push(geo);
    const mat = glow ? new T.MeshBasicMaterial({ color, fog: false }) : this.mat(color); if (glow) this.owned.push(mat);
    const m = new T.Mesh(geo, mat); m.position.set(x, y, z); this.root.add(m); return m;
  }
  sign(text: string, x: number, y: number, z: number, w: number, h: number, bg = '#182634', ink = '#a9f6e0', font = 56) {
    const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = Math.round(768 * h / w);
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = `800 ${font}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = ink; ctx.fillText(text, 384, canvas.height / 2, 718);
    const map = new T.CanvasTexture(canvas); map.colorSpace = T.SRGBColorSpace;
    const mat = new T.MeshBasicMaterial({ map }), geo = new T.PlaneGeometry(w, h); this.owned.push(map, mat, geo);
    const mesh = new T.Mesh(geo, mat); mesh.position.set(x, y, z); this.root.add(mesh); return mesh;
  }
  private tree(x: number, z: number, height = 5) {
    this.box(x, height / 2 - 1, z, 0.18, height, 0.18, '#8c7d69');
    for (let i = 0; i < 7; i++) {
      const geo = new T.ConeGeometry(0.45, 3.4, 4); this.owned.push(geo);
      const leaf = new T.Mesh(geo, this.mat(i % 2 ? '#438271' : '#355f57'));
      leaf.position.set(x + Math.cos(i) * 0.78, height - 1.2, z + Math.sin(i) * 0.78);
      leaf.rotation.set(Math.sin(i) * 1.05, 0, -Math.cos(i) * 1.05); this.root.add(leaf);
    }
  }
  private coffee() {
    for (const x of [-12, 12]) {
      this.box(x, 0, -8, 7.5, 5, 4.5, x < 0 ? '#425f61' : '#776a68');
      this.box(x, 2.65, -8, 8, 0.30, 4.8, '#293f4a');
      for (const dx of [-2.2, 0, 2.2]) this.box(x + dx, -0.4, -5.72, 1.55, 2.8, 0.05, '#d7af7f', true);
    }
    this.sign('UNICORN COFFEE', -12, 1.9, -5.69, 6.7, 0.63, '#213743', '#d3efe4');
    this.sign('NO PITCHES AFTER 5', 12, 1.9, -5.68, 6.5, 0.63, '#413446', '#ffcba4', 43);
    this.tree(-10.8, -4.4, 5.7); this.tree(10.8, -4.4, 5.7);
    this.box(-7.1, 0.75, -2.65, 1.75, 1.5, 0.50, '#263c44');
    this.sign('$9 POUR OVER', -7.1, 0.89, -2.385, 1.56, 0.6, '#20353e', '#f7d096', 68);
    for (let i = 0; i < 17; i++) {
      const x = -15 + i * 1.875, y = 8.5 - Math.sin(i / 16 * Math.PI) * 1.0;
      this.sphere(x, y, -8, 0.075, '#ffd298', true);
      if (i) this.box(x - 0.94, y + 0.12, -8, 1.91, 0.025, 0.025, '#374853');
    }
  }
  private venture() {
    for (const x of [-14, 14]) {
      this.box(x, 2.3, -10, 8, 12, 5, '#2e4558');
      for (let y = -2; y < 9; y += 1.4) this.box(x, y, -7.46, 7.7, 0.04, 0.025, '#bd986b');
      for (let dx = -3; dx < 4; dx += 1.5) this.box(x + dx, 2.4, -7.45, 0.04, 11.7, 0.025, '#789196');
    }
    this.sign('REVENUE OPTIONAL', -13.5, 6.5, -7.4, 7, 1, '#1c303c', '#f1c68d', 42);
    this.sign('WE FUND VISION', 13.5, 6.5, -7.4, 7, 1, '#1c303c', '#f1c68d', 44);
    const geo = new T.TorusKnotGeometry(1.0, 0.16, 60, 8); this.owned.push(geo);
    const sculpture = new T.Mesh(geo, this.mat('#d5ac6c')); sculpture.position.set(-7, 1.7, -2.7); this.root.add(sculpture); this.spinners.push(sculpture);
    this.box(-7, 0.3, -2.7, 1.4, 0.6, 1, '#32444e');
    this.sign('SAND HILL / CAPITAL', 7, 0.9, -2.7, 3.6, 1.2, '#23373e', '#e4c191', 47);
    this.tree(-10.6, -4.8); this.tree(10.6, -4.8);
  }
  private launch() {
    for (const x of [-13, 13]) {
      this.box(x, 2.8, -9, 0.22, 11, 0.25, '#465b76'); this.box(x + 2, 2.8, -9, 0.22, 11, 0.25, '#465b76');
      for (let y = -2; y < 9; y += 1.5) { const brace = this.box(x + 1, y, -9, 2.6, 0.13, 0.18, '#587186'); brace.rotation.z = 0.6; }
    }
    const geo = new T.CylinderGeometry(0.7, 0.7, 7, 16), noseGeo = new T.ConeGeometry(0.7, 2, 16);
    this.owned.push(geo, noseGeo);
    const rocket = new T.Mesh(geo, this.mat('#c1c9ce')); rocket.position.set(14, 2, -9); this.root.add(rocket);
    const nose = new T.Mesh(noseGeo, this.mat('#c385a5')); nose.position.set(14, 6.5, -9); this.root.add(nose);
    this.box(14, 0.1, -9, 2.5, 1, 0.18, '#6e8098');
    this.sign('DEMO DAY', -12, 7.5, -8.8, 6, 1.3, '#242c46', '#c9b3fa', 96);
    this.sign('LIVE DEMO: PROBABLY READY', 0, 8.5, -13, 13.5, 0.65, '#27334b', '#bdabc9', 36);
    for (const x of [-7.5, 7.5]) {
      this.box(x, 0.85, -2.7, 1.1, 1.7, 0.9, '#223247');
      for (let y = 0.2; y < 1.6; y += 0.22) { this.box(x, y, -2.23, 0.83, 0.05, 0.018, '#5b6d82'); this.box(x + 0.32, y, -2.21, 0.04, 0.04, 0.02, '#7eeec7', true); }
    }
  }
  update(time: number) { for (const m of this.spinners) { m.rotation.y = time * 0.25; m.rotation.z = time * 0.12; } }
  dispose() { this.owned.forEach(o => o.dispose()); this.materials.forEach(m => m.dispose()); }
}
