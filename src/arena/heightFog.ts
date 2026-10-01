import type { Material } from 'three';

/**
 * Adds a height-based haze to a scenery material: below `start` the surface blends toward the scene's fog colour, so the
 * tower the stage stands on dissolves into the canyon haze instead of ending in a hard line. Only scenery materials get
 * it; fighters, projectiles and effects keep their colour all the way down to the blast zone.
 *
 * The blend runs in the same fragment as three's own fog, so it behaves identically on the direct and post-processed
 * paths (both work in linear light before the single output transform).
 */
export function applyHeightFog(material: Material, start = -2.5, falloff = 0.06) {
  material.onBeforeCompile = shader => {
    shader.uniforms.uHazeStart = { value: start }; shader.uniforms.uHazeFall = { value: falloff };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vHazeY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHazeY = (modelMatrix * vec4(transformed, 1.0)).y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vHazeY;\nuniform float uHazeStart;\nuniform float uHazeFall;')
      .replace('#include <fog_fragment>', '#include <fog_fragment>\n#ifdef USE_FOG\n  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, clamp((uHazeStart - vHazeY) * uHazeFall, 0.0, 0.96));\n#endif');
  };
  material.customProgramCacheKey = () => `haze:${start}:${falloff}`;
  return material;
}
