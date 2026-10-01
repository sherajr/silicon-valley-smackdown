import * as T from 'three';
import type { StageTheme } from './stageThemes';

/**
 * A small procedural environment for reflections: the arena's sky gradient, a hot sun, a warm key softbox on the camera
 * side and a cool one opposite. It is rendered once per arena through PMREM (by the renderer, which owns the result and
 * its lifetime) so polished props, glass and metal pick up believable highlights without any image file or network
 * request. Values above 1 are intentional: the target is half-float, and the hot sun and softboxes are what make
 * highlights read.
 */
const VERT = `varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FRAG = `uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBottom; uniform vec3 uBelow; uniform vec3 uSunDir; uniform vec3 uSun; varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir); float h = d.y;
  vec3 col = mix(uBottom, uMid, smoothstep(-0.1, 0.1, h)); col = mix(col, uTop, smoothstep(0.05, 0.6, h)); col = mix(col, uBelow, smoothstep(-0.02, -0.4, h));
  float s = max(dot(d, normalize(uSunDir)), 0.0); col += uSun * (pow(s, 40.0) * 3.0 + pow(s, 6.0) * 0.35);
  gl_FragColor = vec4(col, 1.0);
}`;

export interface EnvironmentScene { scene: T.Scene; dispose(): void }

export function buildEnvironmentScene(theme: StageTheme): EnvironmentScene {
  const scene = new T.Scene(), owned: { dispose(): void }[] = [];
  const c = (hex: string) => new T.Color(hex), s = theme.sky;
  const dome = new T.SphereGeometry(50, 32, 20), domeMat = new T.ShaderMaterial({
    side: T.BackSide, vertexShader: VERT, fragmentShader: FRAG,
    uniforms: { uTop: { value: c(s.top) }, uMid: { value: c(s.mid) }, uBottom: { value: c(s.bottom) }, uBelow: { value: c(theme.hemi.ground) }, uSunDir: { value: new T.Vector3(...s.sunDir).normalize() }, uSun: { value: c(s.sunColor).multiplyScalar(2.2) } },
  });
  scene.add(new T.Mesh(dome, domeMat)); owned.push(dome, domeMat);
  const panel = (color: string, intensity: number, w: number, h: number, pos: [number, number, number]) => {
    const geo = new T.PlaneGeometry(w, h), mat = new T.MeshBasicMaterial({ color: c(color).multiplyScalar(intensity), side: T.DoubleSide });
    const mesh = new T.Mesh(geo, mat); mesh.position.set(...pos); mesh.lookAt(0, 1.5, 0); scene.add(mesh); owned.push(geo, mat);
  };
  panel(theme.key.color, 3.4, 24, 14, [-18, 22, 28]);                 // warm key, camera side
  panel(theme.rim.color, 1.8, 18, 20, [26, 12, 14]);                  // cool fill from the other side
  panel(theme.sunRim.color, 1.6, 14, 8, [-24, 6, -26]);               // the sun's warm edge from behind
  return { scene, dispose() { for (const o of owned) o.dispose(); } };
}
