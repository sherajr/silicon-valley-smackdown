import * as T from 'three';
import { cloudTexture } from './textures';
import type { TexOpts } from './textures';
import { mulberry32 } from './canvasUtil';
import type { StageTheme } from './stageThemes';

/**
 * Sky dome, sun, clouds and (at night) stars for one arena.
 *
 * Colour handling: the dome writes linear HDR and includes the standard tone-mapping and colour-space chunks. When the
 * post pipeline is on, the scene is drawn into a half-float target where those chunks do nothing and the single
 * OutputPass applies tone mapping and the sRGB transform once; on the direct path the same chunks do it in this
 * shader. Either way the sky gets exactly one display transform, the same one as every other material.
 *
 * Everything is static or drifts extremely slowly: no animated noise and no brightness change over time.
 */
const VERTEX = `varying vec3 vDir;
void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FRAGMENT = `uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBottom; uniform vec3 uBelow;
uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uHalo; uniform float uSunSize; uniform float uSunBoost;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uBottom, uMid, smoothstep(-0.10, 0.10, h));
  col = mix(col, uTop, smoothstep(0.06, 0.58, h));
  col = mix(col, uBelow, smoothstep(-0.02, -0.30, h));
  float hz = 1.0 - min(abs(h) * 4.0, 1.0);
  col += uHalo * (hz * hz * hz * 0.16);
  float s = clamp(dot(d, normalize(uSunDir)), 0.0, 1.0);
  float s2 = s * s, s4 = s2 * s2, s8 = s4 * s4;
  col += uHalo * (s8 * s2 * 0.5 + s4 * 0.16);
  col += uSunColor * (s8 * s8 * s8 * s4 * 0.9);
  float edge = cos(uSunSize);
  float disc = smoothstep(edge, edge + (1.0 - edge) * 0.16, s);
  col = mix(col, uSunColor * uSunBoost, disc);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface SkyRig {
  group: T.Group;
  /** Drifts the clouds. Does nothing when motion is off. */
  update(time: number, motion: boolean): void;
  dispose(): void;
}

export function createSky(theme: StageTheme, tex: TexOpts): SkyRig {
  const group = new T.Group(), owned: { dispose(): void }[] = [];
  const s = theme.sky, color = (hex: string) => new T.Color(hex);
  const material = new T.ShaderMaterial({
    side: T.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uTop: { value: color(s.top) }, uMid: { value: color(s.mid) }, uBottom: { value: color(s.bottom) }, uBelow: { value: color(theme.fog.color) },
      uSunDir: { value: new T.Vector3(...s.sunDir).normalize() }, uSunColor: { value: color(s.sunColor) }, uHalo: { value: color(s.halo) }, uSunSize: { value: s.sunSize }, uSunBoost: { value: s.sunBoost },
    },
    vertexShader: VERTEX, fragmentShader: FRAGMENT,
  });
  const dome = new T.SphereGeometry(170, 32, 20), domeMesh = new T.Mesh(dome, material);
  domeMesh.renderOrder = -10; domeMesh.frustumCulled = false; group.add(domeMesh); owned.push(dome, material);

  // Two soft cloud layers behind the mountain ridges; the texture offset drifts very slowly.
  const clouds = cloudTexture(theme.id.length * 977 + 3, s.cloudWarm, s.cloudCool, tex); owned.push(clouds);
  const layers: { mesh: T.Mesh; speed: number; map: T.Texture }[] = [];
  for (const [y, z, scale, opacity, speed] of [[26, -118, 1, theme.night ? 0.5 : 0.85, 0.0016], [17, -104, 0.8, theme.night ? 0.35 : 0.6, -0.0011]] as const) {
    const map = clouds.clone(); map.needsUpdate = true; map.repeat.set(1.6 * scale, 1); owned.push(map);
    const geo = new T.PlaneGeometry(330, 62 * scale), mat = new T.MeshBasicMaterial({ map, transparent: true, depthWrite: false, fog: false, opacity });
    const mesh = new T.Mesh(geo, mat); mesh.position.set(0, y, z); mesh.renderOrder = -9; mesh.frustumCulled = false; group.add(mesh); owned.push(geo, mat);
    layers.push({ mesh, speed, map });
  }

  if (theme.night) {
    // Sparse, fixed stars on the upper dome. Constant brightness: nothing twinkles.
    const rnd = mulberry32(1337), count = 260, positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const az = rnd() * Math.PI * 2, el = 0.12 + Math.pow(rnd(), 0.7) * 1.2, r = 160;
      positions[i * 3] = Math.cos(az) * Math.cos(el) * r; positions[i * 3 + 1] = Math.sin(el) * r; positions[i * 3 + 2] = -Math.abs(Math.sin(az)) * Math.cos(el) * r - 20;
    }
    const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(positions, 3));
    const mat = new T.PointsMaterial({ color: '#dfe6ff', size: 1.7, sizeAttenuation: false, transparent: true, opacity: 0.85, depthWrite: false, fog: false });
    const stars = new T.Points(geo, mat); stars.renderOrder = -8; stars.frustumCulled = false; group.add(stars); owned.push(geo, mat);
  }

  return {
    group,
    update(time, motion) { if (motion) for (const l of layers) l.map.offset.x = (time * l.speed) % 1; },
    dispose() { for (const o of owned) o.dispose(); },
  };
}
