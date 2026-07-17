/* grama instanciada com vento no vertex shader — extraído de game.js; deps explícitas */
import * as THREE from 'three';

export function createGrass(deps) {
  const { CFG, rand, TAU, heightAt, biomeAt, WATER_LEVEL, simplex, scene, sunDir, CITY, VOLCANO, clearings = [],
    cityGrassFactor = null, worldSeed = 424242, surfaceAt = null } = deps;
  /* RNG LOCAL por chunk: (seed, cx, cz) → mesmo conteúdo SEMPRE — preencher,
     reciclar, sair e voltar produz exatamente as mesmas matrizes/fases/cores,
     sem depender da ordem global do Math.random. */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const chunkRng = (cx, cz) =>
    mulberry32((worldSeed ^ Math.imul(cx + 31337, 0x9E3779B1) ^ Math.imul(cz + 7331, 0x85EBCA77)) >>> 0);
  const N = CFG.GRASS_CHUNKS;                       // grade NxN
  const SIZE = CFG.GRASS_CHUNK_SIZE;
  const PER_CHUNK = Math.floor(CFG.GRASS_TOTAL / (N * N));
  const PATCH_RADIUS = (N / 2) * SIZE;              // raio do tapete de grama

  // geometria da lâmina: quad afunilado com leve curvatura, raiz em y=0
  function bladeGeometry() {
    const g = new THREE.PlaneGeometry(0.1, 1, 1, 4);
    g.translate(0, 0.5, 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      p.setX(i, p.getX(i) * (1.0 - y * 0.82));      // afunila ate a ponta
      p.setZ(i, Math.pow(y, 2) * 0.18);             // curvinha pra frente
    }
    g.computeVertexNormals();
    return g;
  }
  const baseBlade = bladeGeometry();

  const uniforms = {
    uTime:        { value: 0 },
    uPlayerPos:   { value: new THREE.Vector3(0, -999, 0) },
    uCarPos:      { value: new THREE.Vector3(0, -999, 0) },
    uWind:        { value: CFG.WIND_STRENGTH },
    uWindDir:     { value: new THREE.Vector2(0.72, 0.45).normalize() }, // clima escreve aqui
    uSunDir:      { value: sunDir.clone().normalize() },
    uSunColor:    { value: new THREE.Color(0xfff0d4).multiplyScalar(1.12) },
    uSkyColor:    { value: new THREE.Color(0xbfd9ff) },
    uGroundColor: { value: new THREE.Color(0x4d6a36) },
    uBaseColor:   { value: new THREE.Color(0x3e7028) },
    uTipColor:    { value: new THREE.Color(0x9cc94f) },
    uPatchRadius: { value: PATCH_RADIUS },
    ...THREE.UniformsLib.fog,
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      #include <common>
      #include <fog_pars_vertex>
      uniform float uTime;
      uniform vec3  uPlayerPos;
      uniform vec3  uCarPos;
      uniform float uWind;
      uniform vec2  uWindDir;
      uniform float uPatchRadius;
      attribute float aPhase;
      attribute vec3  aTint;
      varying vec2 vUv;
      varying vec3 vTint;

      float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      float vnoise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash12(i), b = hash12(i + vec2(1.0, 0.0)), c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      // dobra a lamina para longe de um ponto (player ou carro)
      void bendAway(inout vec4 wpos, vec3 src, float radius, float strength, float h) {
        vec2 toBlade = wpos.xz - src.xz;
        float d = length(toBlade);
        float falloff = 1.0 - smoothstep(0.0, radius, d);
        falloff *= 1.0 - smoothstep(0.5, 3.0, abs(wpos.y - src.y));   // so age perto em altura
        vec2 pushDir = toBlade / max(d, 1e-4);
        wpos.x += pushDir.x * falloff * h * strength;
        wpos.z += pushDir.y * falloff * h * strength;
        wpos.y -= falloff * h * 0.3;
      }

      void main() {
        vUv = uv;
        vTint = aTint;
        vec3 transformed = position;
        float h = uv.y;          // peso pela altura: raiz fixa, ponta solta
        float hh = h * h;

        // some suavemente perto da borda do patch (esconde o recorte)
        float dCam = distance((modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz, cameraPosition);
        float edgeFade = 1.0 - smoothstep(uPatchRadius * 0.72, uPatchRadius * 0.97, dCam);
        transformed.y *= edgeFade;
        transformed.x *= edgeFade;

        vec4 wpos = modelMatrix * instanceMatrix * vec4(transformed, 1.0);

        // vento: ruido rolando + balanco senoidal com fase por instancia
        float w1 = vnoise(wpos.xz * 0.08 + vec2(uTime * 0.85, uTime * 0.55));
        float w2 = vnoise(wpos.xz * 0.33 - vec2(uTime * 1.6, uTime * 0.2));
        float wind = (w1 - 0.5) * 1.7 + (w2 - 0.5) * 0.55;
        float sway = sin(uTime * 2.3 + aPhase * 6.2831) * 0.055;
        vec2 windDir = normalize(uWindDir);
        wpos.x += windDir.x * (wind * uWind + sway) * hh;
        wpos.z += windDir.y * (wind * uWind + sway) * hh;
        wpos.y -= abs(wind) * uWind * hh * 0.16;

        bendAway(wpos, uPlayerPos, 1.5, 1.05, h);   // player amassa a grama
        bendAway(wpos, uCarPos,    3.1, 1.4,  h);   // carro amassa uma area maior

        vec4 mvPosition = viewMatrix * wpos;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      #include <common>
      #include <fog_pars_fragment>
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uSkyColor;
      uniform vec3 uGroundColor;
      uniform vec3 uBaseColor;
      uniform vec3 uTipColor;
      varying vec2 vUv;
      varying vec3 vTint;

      void main() {
        vec3 albedo = mix(uBaseColor, uTipColor, vUv.y) * vTint;
        // UMA luz direcional embutida + hemisferio fake (confiavel e barato)
        float ndl = clamp(uSunDir.y, 0.0, 1.0);
        float ao = mix(0.5, 1.0, vUv.y);                       // raiz mais escura
        vec3 hemi = mix(uGroundColor, uSkyColor, 0.35 + 0.65 * vUv.y);
        vec3 col = albedo * (hemi * 0.6 + uSunColor * ndl * 0.95) * ao;
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

  // chunks: cada um e um InstancedMesh com bounding sphere propria p/ frustum culling
  const chunks = [];
  const dummy = new THREE.Object3D();
  const tintCol = new THREE.Color();

  /* CONTRATO DO STREAM SEEDADO: a criação inicial da grade consumia o
     Math.random global numa ordem fixa — tudo que é gerado DEPOIS da grama
     (árvores, estruturas, inimigos) depende dessa contagem. Esta função
     replica o consumo antigo EXATAMENTE (mesmas chamadas, mesmos branches)
     descartando os resultados, para o layout do mundo não mudar por seed.
     O conteúdo REAL dos chunks vem do RNG local determinístico. */
  function legacyConsume(cx, cz) {
    const wx = cx * SIZE, wz = cz * SIZE;
    for (let i = 0; i < PER_CHUNK; i++) {
      const lx = rand(-SIZE / 2, SIZE / 2);
      const lz = rand(-SIZE / 2, SIZE / 2);
      const bio = biomeAt(wx + lx, wz + lz);
      const desert = THREE.MathUtils.smoothstep(-bio, 0.18, 0.45);
      rand(-0.13, 0.13); rand(TAU); rand(-0.13, 0.13); // rotação
      rand(0.65, 1.4);                                  // altura s
      if (desert > 0.05) Math.random();                 // colapso no deserto
      rand(0.8, 1.25);                                  // escala x
      Math.random();                                    // fase do vento
      rand(-0.06, 0.06);                                // luminosidade do tint
    }
  }

  function fillChunk(chunk, cx, cz) {
    chunk.cx = cx; chunk.cz = cz;
    const wx = cx * SIZE, wz = cz * SIZE;
    chunk.mesh.position.set(wx, 0, wz);
    const phase = chunk.mesh.geometry.attributes.aPhase;
    const tint = chunk.mesh.geometry.attributes.aTint;
    const rng = chunkRng(cx, cz);                      // determinístico por chunk
    const r = (a, b) => a + rng() * (b - a);
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < PER_CHUNK; i++) {
      const lx = r(-SIZE / 2, SIZE / 2);
      const lz = r(-SIZE / 2, SIZE / 2);
      // raiz na superfície CANÔNICA (a mesma da malha/física) + fatores centrais
      const su = surfaceAt ? surfaceAt(wx + lx, wz + lz) : null;
      const y = su ? su.height : heightAt(wx + lx, wz + lz);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      const desert = su ? (su.desertK || 0) : THREE.MathUtils.smoothstep(-biomeAt(wx + lx, wz + lz), 0.18, 0.45);
      const forest = su ? (su.forestK || 0) : 0;
      dummy.position.set(lx, y, lz);
      dummy.rotation.set(r(-0.13, 0.13), r(0, TAU), r(-0.13, 0.13));
      let s = r(0.65, 1.4) * CFG.GRASS_HEIGHT;
      // deserto: quase sem grama (lâminas colapsam) e mais baixa nas bordas
      if (desert > 0.05) s *= rng() < desert * 0.85 ? 0.02 : (1 - desert * 0.45);
      if (y < WATER_LEVEL + 0.25) s = 0.015; // nada de grama dentro dos lagos
      // distrito urbano: máscara espacial (ruas/calçadas/praça/footprints = sem
      // grama; canteiros verdes = cheia; borda volta suave). Barato: só retângulos.
      if (cityGrassFactor) {
        const gf = cityGrassFactor(wx + lx, wz + lz);
        if (gf < 0.999) s = gf < 0.02 ? 0.0001 : s * gf;
      } else if (CITY && Math.hypot(wx + lx - CITY.x, wz + lz - CITY.z) < 92) {
        s = 0.0001; // fallback antigo se a máscara não for injetada
      }
      // cone do vulcão é rocha nua: grama não brota na encosta
      if (VOLCANO && Math.hypot(wx + lx - VOLCANO.x, wz + lz - VOLCANO.z) < VOLCANO.r * 0.95) s = 0.0001;
      // clareiras (vagas de veículos): grama embaixo do carro fazia ele
      // parecer enterrado/flutuando — chão limpo onde carro estaciona
      for (const c of clearings) {
        if (Math.hypot(wx + lx - c.x, wz + lz - c.z) < (c.r || 4.5)) { s = 0.0001; break; }
      }
      dummy.scale.set(r(0.8, 1.25), s, 1);
      dummy.updateMatrix();
      chunk.mesh.setMatrixAt(i, dummy.matrix);
      phase.setX(i, rng());
      // variacao sutil de cor por lamina, casando com terreno e bioma
      const v = simplex.noise((wx + lx) * 0.03, (wz + lz) * 0.03) * 0.5 + 0.5;
      tintCol.setHSL(
        0.26 + v * 0.035 - 0.018 - desert * 0.09 + forest * 0.015,
        0.58 - desert * 0.2,
        0.5 + r(-0.06, 0.06) - forest * 0.07);
      tint.setXYZ(i, 0.7 + tintCol.r * 0.5, 0.7 + tintCol.g * 0.5, 0.7 + tintCol.b * 0.5);
    }
    phase.needsUpdate = true;
    tint.needsUpdate = true;
    chunk.mesh.instanceMatrix.needsUpdate = true;
    const midY = (minY + maxY) / 2;
    chunk.mesh.geometry.boundingSphere.center.set(0, midY, 0);
    chunk.mesh.geometry.boundingSphere.radius = SIZE * 0.75 + (maxY - minY) * 0.5 + 2;
  }

  function makeChunk(cx, cz) {
    const geo = baseBlade.clone();
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(new Float32Array(PER_CHUNK), 1));
    geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(PER_CHUNK * 3), 3));
    geo.boundingSphere = new THREE.Sphere();
    const mesh = new THREE.InstancedMesh(geo, material, PER_CHUNK);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = true;   // culling por chunk
    const chunk = { mesh, cx: 99999, cz: 99999 };
    legacyConsume(cx, cz); // preserva o consumo do stream seedado (ver comentário)
    fillChunk(chunk, cx, cz);
    scene.add(mesh);
    return chunk;
  }

  // grade inicial centrada na origem
  const halfN = Math.floor(N / 2);
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++)
      chunks.push(makeChunk(i - halfN, j - halfN));

  let centerX = 0, centerZ = 0; // celula central atual
  const REBUILD_BUDGET = 6;     // chunks re-preenchidos por frame, no maximo
  const pending = [];

  function update(playerPos, carPos, time) {
    uniforms.uTime.value = time;
    uniforms.uPlayerPos.value.copy(playerPos);
    uniforms.uCarPos.value.copy(carPos);

    const ncx = Math.round(playerPos.x / SIZE);
    const ncz = Math.round(playerPos.z / SIZE);
    if (ncx !== centerX || ncz !== centerZ) {
      centerX = ncx; centerZ = ncz;
      // recoloca chunks que sairam do raio da grade (wrap toroidal)
      for (const ch of chunks) {
        let tx = ch.cx, tz = ch.cz;
        while (tx < centerX - halfN) tx += N;
        while (tx > centerX + halfN) tx -= N;
        while (tz < centerZ - halfN) tz += N;
        while (tz > centerZ + halfN) tz -= N;
        if (tx !== ch.cx || tz !== ch.cz) pending.push([ch, tx, tz]);
      }
    }
    let budget = REBUILD_BUDGET;
    while (pending.length && budget-- > 0) {
      const [ch, tx, tz] = pending.shift();
      fillChunk(ch, tx, tz);
    }
  }

  /* refaz todos os chunks já preenchidos — usado quando as clareiras são
     registradas depois da grade inicial (vagas de veículos nascem com as
     Structures, que vêm depois da grama na ordem do rand seedado) */
  function refreshAll() {
    for (const ch of chunks) fillChunk(ch, ch.cx, ch.cz);
  }

  /* QA: decodifica as N primeiras lâminas do chunk que contém (x,z) —
     posição mundial da raiz + escala Y. Só leitura. */
  function debugSample(x = 0, z = 0, n = 200) {
    const cx = Math.round(x / SIZE), cz = Math.round(z / SIZE);
    const ch = chunks.find(c => c.cx === cx && c.cz === cz);
    if (!ch) return null;
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    const out = [];
    for (let i = 0; i < Math.min(n, PER_CHUNK); i++) {
      ch.mesh.getMatrixAt(i, m);
      m.decompose(p, q, s);
      out.push({ x: p.x + ch.mesh.position.x, y: p.y, z: p.z + ch.mesh.position.z, sy: s.y });
    }
    return out;
  }
  /* QA: bytes do chunk (matriz+fase+tint) p/ prova de determinismo */
  function debugChunkBytes(cx, cz) {
    const ch = chunks.find(c => c.cx === cx && c.cz === cz);
    if (!ch) return null;
    const g = ch.mesh.geometry;
    return {
      m: Array.from(ch.mesh.instanceMatrix.array.slice(0, 64)),
      ph: Array.from(g.attributes.aPhase.array.slice(0, 16)),
      ti: Array.from(g.attributes.aTint.array.slice(0, 16)),
    };
  }

  return { update, material, PATCH_RADIUS, refreshAll, debugSample, debugChunkBytes };
}
