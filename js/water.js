/* lagos nas bacias do terreno — extraído de game.js; deps explícitas */
import * as THREE from 'three';

export function createWater(deps) {
  const { CFG, WATER_LEVEL, scene, sunDir } = deps;
  const uniforms = {
    uTime:    { value: 0 },
    uSunDir:  { value: sunDir.clone().normalize() },
    uDeep:    { value: new THREE.Color(0x14424f) },
    uShallow: { value: new THREE.Color(0x2c7e88) },
    uSky:     { value: new THREE.Color(0xbcd8ee) },
    ...THREE.UniformsLib.fog,
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, fog: true, transparent: true,
    vertexShader: /* glsl */`
      #include <common>
      #include <fog_pars_vertex>
      uniform float uTime;
      varying vec3 vWPos;
      varying vec3 vNorm;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        float w1 = sin(wp.x * 0.12 + uTime * 1.1) * cos(wp.z * 0.1 + uTime * 0.8);
        float w2 = sin(wp.x * 0.31 + wp.z * 0.27 - uTime * 1.7);
        wp.y += w1 * 0.1 + w2 * 0.05;
        vNorm = normalize(vec3(-w2 * 0.22 - w1 * 0.1, 1.0, -w1 * 0.14));
        vWPos = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <fog_pars_fragment>
      uniform vec3 uSunDir, uDeep, uShallow, uSky;
      varying vec3 vWPos;
      varying vec3 vNorm;
      void main() {
        vec3 V = normalize(cameraPosition - vWPos);
        float fres = pow(1.0 - max(dot(V, vNorm), 0.0), 2.2);
        vec3 col = mix(uDeep, uShallow, 0.35 + 0.3 * sin(vWPos.x * 0.05 + vWPos.z * 0.06));
        col = mix(col, uSky, fres * 0.75);
        vec3 H = normalize(V + uSunDir);
        col += pow(max(dot(vNorm, H), 0.0), 90.0) * 0.85; // brilho do sol
        gl_FragColor = vec4(col, 0.86);
        #include <fog_fragment>
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const geo = new THREE.PlaneGeometry(CFG.WORLD_SIZE, CFG.WORLD_SIZE, 48, 48);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = WATER_LEVEL;
  scene.add(mesh);
  return { update(t) { uniforms.uTime.value = t; }, uniforms };
}
