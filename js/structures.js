/* ================================================================
   CONSTRUÇÕES — torres de vigia, cabanas, ruínas e o forte do boss
   Tudo mesclado em UMA malha com vertex colors (1 draw call) +
   AABBs para bala/visão/colisão e corpos estáticos no cannon.
   ================================================================ */
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import * as CityLayout from './citylayout.js';

export function createStructures(deps) {
  const { clamp, rand, TAU, heightAt, slopeAt, platforms, WATER_LEVEL, CITY, scene, csmMat, paintGeometry } = deps;
  const sites = [];      // {x, z, r, type}
  const walls = [];      // AABBs sólidas {x0,x1,y0,y1,z0,z1}
  const geos = [];
  const smokeSpots = []; // topos de chaminé (fumaça ambiente)
  const flags = [];      // bandeiras que tremulam
  const flagGeo = new THREE.PlaneGeometry(1.15, 0.55);
  flagGeo.translate(0.6, 0, 0); // articulada no mastro
  const flagMat = new THREE.MeshStandardMaterial({ color: 0xe8562a, side: THREE.DoubleSide, roughness: 0.7 });
  const _sc = new THREE.Color();

  function sbox(w, h, d, x, y, z, color, solid = true) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    paintGeometry(g, _sc.setHex(color));
    geos.push(g);
    if (solid) {
      // corpo físico NÃO é criado aqui: o game.js cria um por parede a partir
      // de walls[] (com updateAABB) — criar aqui duplicava ~400 corpos mortos
      walls.push({ x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2, z0: z - d / 2, z1: z + d / 2 });
    }
  }
  function scone(r, h, x, y, z, color) {
    const g = new THREE.ConeGeometry(r, h, 4);
    g.rotateY(Math.PI / 4);
    g.translate(x, y, z);
    paintGeometry(g, _sc.setHex(color));
    geos.push(g);
  }

  function tower(cx, cz) {
    const y = heightAt(cx, cz);
    sites.push({ x: cx, z: cz, r: 5, type: 'torre' });
    const H = 6.2;
    for (const [ox, oz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]])
      sbox(0.34, H + 2, 0.34, cx + ox, y + H / 2 - 1, cz + oz, 0x6b4a2e);
    sbox(3.4, 0.2, 0.2, cx, y + 2.3, cz - 1.4, 0x8a6238, false);
    sbox(3.4, 0.2, 0.2, cx, y + 2.3, cz + 1.4, 0x8a6238, false);
    sbox(0.2, 0.2, 3.4, cx - 1.4, y + 3.6, cz, 0x8a6238, false);
    sbox(0.2, 0.2, 3.4, cx + 1.4, y + 3.6, cz, 0x8a6238, false);
    sbox(3.7, 0.28, 3.7, cx, y + H, cz, 0x8a6238);
    sbox(3.7, 0.5, 0.14, cx, y + H + 0.5, cz - 1.78, 0x6b4a2e, false);
    sbox(3.7, 0.5, 0.14, cx, y + H + 0.5, cz + 1.78, 0x6b4a2e, false);
    sbox(0.14, 0.5, 3.7, cx - 1.78, y + H + 0.5, cz, 0x6b4a2e, false);
    sbox(0.14, 0.5, 3.7, cx + 1.78, y + H + 0.5, cz, 0x6b4a2e, false);
    scone(3, 1.7, cx, y + H + 1.8, cz, 0xa84f35);
  }

  function cabin(cx, cz, flip) {
    const y = heightAt(cx, cz);
    sites.push({ x: cx, z: cz, r: 6.5, type: 'cabana' });
    const W = flip ? 4.4 : 5.4, D = flip ? 5.4 : 4.4, H = 2.7;
    sbox(W + 0.7, 0.34, D + 0.7, cx, y + 0.05, cz, 0x6e6a63, false);          // base (decorativa)
    sbox(W, H, 0.26, cx, y + H / 2 + 0.15, cz - D / 2, 0x8a6238);             // fundo
    sbox(0.26, H, D, cx - W / 2, y + H / 2 + 0.15, cz, 0x8a6238);             // lateral esq
    sbox(0.26, H, D, cx + W / 2, y + H / 2 + 0.15, cz, 0x8a6238);             // lateral dir
    const doorW = 1.2, segW = (W - doorW) / 2;                                 // frente com porta
    sbox(segW, H, 0.26, cx - (doorW + segW) / 2, y + H / 2 + 0.15, cz + D / 2, 0x8a6238);
    sbox(segW, H, 0.26, cx + (doorW + segW) / 2, y + H / 2 + 0.15, cz + D / 2, 0x8a6238);
    sbox(doorW + 0.3, 0.45, 0.3, cx, y + H + 0.05, cz + D / 2, 0x6b4a2e, false);
    sbox(W + 0.8, 0.18, D + 0.8, cx, y + H + 0.35, cz, 0x6b4a2e);             // forro
    const r1 = new THREE.BoxGeometry(W + 1.1, 0.15, D * 0.64);
    r1.rotateX(0.48); r1.translate(cx, y + H + 0.92, cz - D * 0.26);
    paintGeometry(r1, _sc.setHex(0xa84f35)); geos.push(r1);
    const r2 = new THREE.BoxGeometry(W + 1.1, 0.15, D * 0.64);
    r2.rotateX(-0.48); r2.translate(cx, y + H + 0.92, cz + D * 0.26);
    paintGeometry(r2, _sc.setHex(0xa84f35)); geos.push(r2);
    sbox(0.5, 1.5, 0.5, cx + W * 0.28, y + H + 1.1, cz - D * 0.18, 0x6e6a63, false); // chaminé
    smokeSpots.push({ x: cx + W * 0.28, y: y + H + 1.95, z: cz - D * 0.18 });
  }

  function ruin(cx, cz) {
    const y = heightAt(cx, cz);
    sites.push({ x: cx, z: cz, r: 5.5, type: 'ruína' });
    sbox(4.6, rand(1.1, 2.4), 0.42, cx, y + 0.7, cz - 2, 0x9a958c);
    sbox(0.42, rand(0.9, 2.6), 4.2, cx - 2.2, y + 0.7, cz, 0x9a958c);
    sbox(2, rand(0.6, 1.1), 0.42, cx + 1, y + 0.4, cz + 1.8, 0x6e6a63);
    sbox(0.7, 3, 0.7, cx + 2.1, y + 1.5, cz + 1.9, 0x9a958c);
    sbox(0.7, rand(0.8, 1.6), 0.7, cx - 2.1, y + 0.6, cz + 1.9, 0x6e6a63);
  }

  const flames = [];
  function fort(cx, cz) {
    sites.push({ x: cx, z: cz, r: 28, type: 'forte' });
    const y = heightAt(cx, cz);
    const S = 17, H = 4.6, T = 0.9;
    sbox(S * 2 + T, H + 2.5, T, cx, y + H / 2 - 0.6, cz - S, 0x9a958c);
    sbox(T, H + 2.5, S * 2, cx - S, y + H / 2 - 0.6, cz, 0x9a958c);
    sbox(T, H + 2.5, S * 2, cx + S, y + H / 2 - 0.6, cz, 0x9a958c);
    const gate = 4.6, seg = (S * 2 - gate) / 2;
    sbox(seg, H + 2.5, T, cx - (gate + seg) / 2, y + H / 2 - 0.6, cz + S, 0x9a958c);
    sbox(seg, H + 2.5, T, cx + (gate + seg) / 2, y + H / 2 - 0.6, cz + S, 0x9a958c);
    sbox(gate + 1.4, 1.1, T + 0.5, cx, y + H + 0.4, cz + S, 0x6e6a63, false);  // arco do portão
    for (const [ox, oz] of [[-S, -S], [S, -S], [-S, S], [S, S]]) {
      sbox(2.8, H + 4, 2.8, cx + ox, y + (H + 4) / 2 - 0.6, cz + oz, 0x6e6a63);
      // telhado pagode em 2 camadas (estilo oriental)
      scone(2.6, 1.3, cx + ox, y + H + 4.1, cz + oz, 0xb8342a);
      sbox(1.5, 0.5, 1.5, cx + ox, y + H + 4.9, cz + oz, 0x6e2620, false);
      scone(1.6, 1.1, cx + ox, y + H + 5.6, cz + oz, 0xb8342a);
      // mastro + bandeira tremulante
      sbox(0.09, 1.7, 0.09, cx + ox, y + H + 7.0, cz + oz, 0x6b4a2e, false);
      const fl = new THREE.Mesh(flagGeo, flagMat);
      fl.position.set(cx + ox, y + H + 7.4, cz + oz);
      fl.userData.ry = rand(TAU);
      scene.add(fl);
      flags.push(fl);
    }
    // portão torii vermelho + lanternas
    sbox(0.7, 7, 0.7, cx - 3.4, y + 3.2, cz + S + 1.6, 0xb8342a);
    sbox(0.7, 7, 0.7, cx + 3.4, y + 3.2, cz + S + 1.6, 0xb8342a);
    sbox(9.5, 0.55, 1.1, cx, y + 6.6, cz + S + 1.6, 0xb8342a, false);
    sbox(8, 0.45, 0.9, cx, y + 5.7, cz + S + 1.6, 0x6e2620, false);
    const lanternMat = new THREE.MeshStandardMaterial({ color: 0x401505, emissive: 0xff9a40, emissiveIntensity: 2.4, roughness: 0.5 });
    for (const lx of [-3.4, 3.4]) {
      const lt = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), lanternMat);
      lt.scale.y = 1.25;
      lt.position.set(cx + lx, y + 5.1, cz + S + 1.6);
      scene.add(lt);
      flames.push(lt);
    }
    // santuário central de teto curvo sobre o estrado
    sbox(0.45, 3.2, 0.45, cx - 2.4, y + 1.7, cz - 2.4, 0xb8342a);
    sbox(0.45, 3.2, 0.45, cx + 2.4, y + 1.7, cz - 2.4, 0xb8342a);
    sbox(0.45, 3.2, 0.45, cx - 2.4, y + 1.7, cz + 2.4, 0xb8342a);
    sbox(0.45, 3.2, 0.45, cx + 2.4, y + 1.7, cz + 2.4, 0xb8342a);
    scone(4.6, 1.6, cx, y + 3.9, cz, 0xb8342a);
    sbox(2.6, 0.5, 2.6, cx, y + 4.8, cz, 0x6e2620, false);
    scone(2.6, 1.3, cx, y + 5.7, cz, 0xb8342a);
    for (let i = -3; i <= 3; i++) sbox(1, 0.7, 0.5, cx + i * 4.2, y + H + 0.55, cz - S, 0x9a958c, false);
    sbox(7, 0.34, 7, cx, y + 0.05, cz, 0x6e6a63, false);                       // estrado central
    // braseiros com chama emissiva (brilham no bloom)
    const flameMat = new THREE.MeshStandardMaterial({ color: 0x331303, emissive: 0xff8a2e, emissiveIntensity: 3.2, roughness: 0.4 });
    for (const [ox, oz] of [[-4, 4], [4, 4], [-4, -4], [4, -4]]) {
      sbox(0.3, 1.3, 0.3, cx + ox, y + 0.75, cz + oz, 0x4b4843);
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), flameMat);
      f.position.set(cx + ox, y + 1.6, cz + oz);
      scene.add(f);
      flames.push(f);
    }
  }

  /* ---- posicionamento: acha pontos planos e sem sobreposição ---- */
  function flatSpot(rMin, rMax, tries = 70) {
    let best = null, bestS = 1e9;
    for (let i = 0; i < tries; i++) {
      const a = rand(TAU), r = rand(rMin, rMax);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!clearOf(x, z)) continue;
      const s = slopeAt(x, z) + slopeAt(x + 6, z) + slopeAt(x, z + 6) + slopeAt(x - 6, z) + slopeAt(x, z - 6);
      if (s < bestS) { bestS = s; best = { x, z }; }
    }
    return best;
  }
  function clearOf(x, z, need = 16) {
    if (Math.hypot(x, z) < 42) return false;
    if (Math.hypot(x - CITY.x, z - CITY.z) < 100) return false; // zona urbana reservada
    if (heightAt(x, z) < WATER_LEVEL + 1.5) return false; // nada construído dentro de lago
    for (const s of sites) if (Math.hypot(x - s.x, z - s.z) < s.r + need) return false;
    return true;
  }

  const FORT_POS = flatSpot(290, 410) || { x: 330, z: -280 };
  fort(FORT_POS.x, FORT_POS.z);
  for (let i = 0; i < 6; i++) { const p = flatSpot(90, 470); if (p) tower(p.x, p.z); }
  for (let i = 0; i < 6; i++) { const p = flatSpot(70, 440); if (p) cabin(p.x, p.z, i % 2 === 0); }
  for (let i = 0; i < 5; i++) { const p = flatSpot(80, 460); if (p) ruin(p.x, p.z); }

  /* ================= CIDADE + TORRE NEXUS ================= */
  const carSpots = [];      // vagas de veículos {x,z,ry,type}
  const enemyCamps = [];    // spawns planejados {x,z,suit,army,floorY}
  const chestSpots = [];    // baús
  let heliSpot, bazookaSpot, towerTopY, NEXUS_INTERIOR;

  // fachada: parede + janelas com moldura/peitoril geradas por canvas. Só o VIDRO
  // vai pro emissiveMap (janelas acendem à noite; a parede fica apagada).
  // A grade e o consumo de Math.random (janela acesa/cor) são os MESMOS de antes
  // — preserva a ordem do rand seedado (invariante do worldgen).
  function facadeTex() {
    const c1 = document.createElement('canvas'); c1.width = 64; c1.height = 128;
    const c2 = document.createElement('canvas'); c2.width = 64; c2.height = 128;
    const a = c1.getContext('2d'), b = c2.getContext('2d');
    a.fillStyle = '#5b626d'; a.fillRect(0, 0, 64, 128);      // concreto claro
    b.fillStyle = '#000'; b.fillRect(0, 0, 64, 128);
    const warm = ['#ffd27a', '#ffe9b0', '#bcd8ff', '#ffc2a0'];
    for (let wy = 5; wy < 122; wy += 13) {
      a.fillStyle = '#6b727d'; a.fillRect(0, wy - 3, 64, 2); // faixa de laje entre andares
      for (let wx = 5; wx < 58; wx += 13) {
        const lit = Math.random() < 0.4;
        a.fillStyle = '#39404a'; a.fillRect(wx - 1, wy - 1, 11, 10);        // moldura recuada
        a.fillStyle = lit ? '#2f3a48' : '#161b22'; a.fillRect(wx, wy, 9, 8); // vidro
        a.fillStyle = '#7a828d'; a.fillRect(wx - 1, wy + 8, 11, 1.5);       // peitoril
        if (lit) { b.fillStyle = warm[(Math.random() * warm.length) | 0]; b.fillRect(wx, wy, 9, 8); }
      }
    }
    const t1 = new THREE.CanvasTexture(c1); t1.colorSpace = THREE.SRGBColorSpace;
    const t2 = new THREE.CanvasTexture(c2); t2.colorSpace = THREE.SRGBColorSpace;
    t1.wrapS = t1.wrapT = t2.wrapS = t2.wrapT = THREE.RepeatWrapping;
    t1.anisotropy = 4;
    return [t1, t2];
  }
  const [fMap, fEmis] = facadeTex();
  // vertexColors: tint por prédio multiplica o map (variação de cor, 1 draw call).
  const cityMat = csmMat(new THREE.MeshStandardMaterial({
    map: fMap, emissiveMap: fEmis, emissive: 0xffffff, emissiveIntensity: 0.25,
    roughness: 0.75, metalness: 0.12, vertexColors: true }));
  const cityGeos = [];
  const cityTrimGeos = [];        // detalhes urbanos vertex-color (some no evento)
  const cityInteriorGeos = [];    // INTERIOR da Torre Nexus (lajes/escada/corrimãos/pilares):
  const cityInteriorLampGeos = []; // luminárias emissivas do interior (mesh própria)
  const cityInteriorSignGeos = []; // numeração dos andares (atlas em CanvasTexture)
  let cityInteriorSignTex;         // textura-atlas dos números (setada na geração da torre)
  // NEUTRALIZAÇÃO DO RNG: THREE.generateUUID() consome Math.random 4× por objeto,
  // e Math.random É o PRNG SEEDADO do worldgen (contrato do CLAUDE.md). Criar a
  // geometria do interior da torre (centenas de objetos) deslocaria tudo gerado
  // depois (bases, baús, grama). noSeed() troca Math.random por um PRNG privado
  // enquanto a geometria é criada — os UUIDs saem daqui e o stream seedado fica intacto.
  let _us = 0x9E3779B9 >>> 0;
  const noSeed = (fn) => {
    const _R = Math.random;
    Math.random = () => (_us = (_us * 1664525 + 1013904223) >>> 0) / 4294967296;
    try { return fn(); } finally { Math.random = _R; }
  };
  const cityProps = new THREE.Group(); cityProps.name = 'cityProps';
  // PRNG independente pro detalhe arquitetônico: determinístico em todos os
  // clientes (seed constante) e NÃO consome o rand seedado do worldgen.
  let _bs = 0xB111D5;
  const bp = () => (_bs = (_bs * 1664525 + 1013904223) >>> 0) / 4294967296;
  const brand = (a = 1, b) => (b === undefined ? bp() * a : a + bp() * (b - a));
  const _white = new THREE.Color(1, 1, 1);
  function cityBox(w, h, d, x, y, z, tint, solid = true) { // caixa texturizada (UV ~ por andar)
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(w, d) / 9, uv.getY(i) * h / 7);
    g.translate(x, y, z);
    paintGeometry(g, tint || _white); // tint por prédio (vertexColors * map)
    cityGeos.push(g);
    if (solid) {
      walls.push({ x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2, z0: z - d / 2, z1: z + d / 2, city: true });
      // telhado pisável: pousar de paraquedas/pular em prédio da cidade funciona
      platforms.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, y: y + h / 2, city: true });
    }
  }
  // trim urbano vertex-color: some no evento (vai pro cityTrimMesh). Decorativo
  // por padrão (sem colisão) — não cria parede invisível.
  function trimBox(w, h, d, x, y, z, hex, solid = false) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    paintGeometry(g, _sc.setHex(hex));
    cityTrimGeos.push(g);
    if (solid) walls.push({ x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2, z0: z - d / 2, z1: z + d / 2, city: true });
  }
  function trimCyl(r, h, x, y, z, hex, seg = 10) {
    const g = new THREE.CylinderGeometry(r, r, h, seg);
    g.translate(x, y, z);
    paintGeometry(g, _sc.setHex(hex));
    cityTrimGeos.push(g);
  }
  {
    const cx = CITY.x, cz = CITY.z, gy = heightAt(cx, cz);
    sites.push({ x: cx, z: cz, r: 88, type: 'cidade' });
    /* ---------- PAVIMENTO: praça, ruas, calçadas, meio-fio, faixas ----------
       Geometria plana vertex-color no cityTrimMesh (some no evento de destruição,
       revelando o solo escurecido das ruínas). Camadas em alturas ligeiramente
       diferentes (0.03→0.10) evitam z-fighting. */
    const SW = CityLayout.CITY_CONST.SIDEWALK_W;
    const paveRect = (lx0, lx1, lz0, lz1, dy, hex) =>
      trimBox(lx1 - lx0, 0.12, lz1 - lz0, cx + (lx0 + lx1) / 2, gy + dy, cz + (lz0 + lz1) / 2, hex);
    { // praça pavimentada (disco) ao redor da torre — acesso desobstruído
      const pg = new THREE.CylinderGeometry(CityLayout.PLAZA.r, CityLayout.PLAZA.r, 0.1, 40);
      pg.translate(cx, gy + 0.03, cz);
      paintGeometry(pg, _sc.setHex(0x565b63));
      cityTrimGeos.push(pg);
    }
    for (const r of CityLayout.ROADS) {
      paveRect(r.x0 - SW, r.x1 + SW, r.z0 - SW, r.z1 + SW, 0.05, 0x6b7079); // calçada
      paveRect(r.x0, r.x1, r.z0, r.z1, 0.08, 0x23252a);                     // asfalto
      // meio-fio (lip decorativo baixo nas bordas longas; sem física)
      if (r.x1 - r.x0 > r.z1 - r.z0) {
        trimBox(r.x1 - r.x0 + SW * 2, 0.18, 0.22, cx + (r.x0 + r.x1) / 2, gy + 0.15, cz + r.z0 - 0.11, 0x585d65);
        trimBox(r.x1 - r.x0 + SW * 2, 0.18, 0.22, cx + (r.x0 + r.x1) / 2, gy + 0.15, cz + r.z1 + 0.11, 0x585d65);
      } else {
        trimBox(0.22, 0.18, r.z1 - r.z0 + SW * 2, cx + r.x0 - 0.11, gy + 0.15, cz + (r.z0 + r.z1) / 2, 0x585d65);
        trimBox(0.22, 0.18, r.z1 - r.z0 + SW * 2, cx + r.x1 + 0.11, gy + 0.15, cz + (r.z0 + r.z1) / 2, 0x585d65);
      }
    }
    const av = CityLayout.ROADS[0], cr = CityLayout.ROADS[1];
    const avz = (av.z0 + av.z1) / 2, crx = (cr.x0 + cr.x1) / 2;
    for (let x = av.x0 + 3; x < av.x1 - 2; x += 6) paveRect(x, x + 2.6, avz - 0.22, avz + 0.22, 0.1, 0xcfd3d8);
    for (let z = cr.z0 + 3; z < cr.z1 - 2; z += 6) paveRect(crx - 0.22, crx + 0.22, z, z + 2.6, 0.1, 0xcfd3d8);
    // faixas de pedestres junto do cruzamento
    for (let i = 0; i < 5; i++) { const x = cr.x0 - 5 + i; paveRect(x, x + 0.55, av.z0 + 0.4, av.z1 - 0.4, 0.1, 0xdfe3e8); }
    for (let i = 0; i < 5; i++) { const z = av.z0 - 5 + i; paveRect(cr.x0 + 0.4, cr.x1 - 0.4, z, z + 0.55, 0.1, 0xdfe3e8); }

    /* ---------- PRÉDIOS: arquétipos com térreo, entrada, cobertura ---------- */
    function faceOffset(face, w, d) {
      if (face === 'S') return { ox: 0, oz: d / 2, nx: 0, nz: 1, axis: 'x' };
      if (face === 'N') return { ox: 0, oz: -d / 2, nx: 0, nz: -1, axis: 'x' };
      if (face === 'E') return { ox: w / 2, oz: 0, nx: 1, nz: 0, axis: 'z' };
      return { ox: -w / 2, oz: 0, nx: -1, nz: 0, axis: 'z' };
    }
    function roofUnits(bx, bz, w, d, py, arch) {
      const mh = brand(1.5, 2.4), mw = w * brand(0.32, 0.44), md = d * brand(0.32, 0.44);
      trimBox(mw, mh, md, bx + brand(-w * 0.12, w * 0.12), py + mh / 2, bz + brand(-d * 0.12, d * 0.12), 0x2e323a); // casa de máquinas
      if (brand() < 0.65) { const tr = brand(0.7, 1.05), th = brand(1.4, 2.1);
        trimCyl(tr, th, bx + brand(-w * 0.22, w * 0.22), py + th / 2, bz + brand(-d * 0.22, d * 0.22), 0x8f9aa2, 12); } // caixa d'água
      for (let i = 0; i < 2; i++) // caixas de ar-condicionado
        trimBox(brand(0.6, 1.1), brand(0.4, 0.8), brand(0.6, 1.1), bx + brand(-w * 0.3, w * 0.3), py + 0.4, bz + brand(-d * 0.3, d * 0.3), 0x474c55);
      if (arch === 'office' || arch === 'corner') { const ah = brand(2.6, 4.2); // antena
        trimBox(0.13, ah, 0.13, bx + brand(-w * 0.2, w * 0.2), py + ah / 2, bz + brand(-d * 0.2, d * 0.2), 0x20242a); }
    }
    function building(lot) {
      const { w, h, arch, face } = lot;
      const bx = cx + lot.ox, bz = cz + lot.oz, d = CityLayout.lotDepth(lot);
      const _s = rand(0.8, 1.1); void _s;              // PRESERVA o rand seedado (1 call/lote)
      const hue = arch === 'resid' ? 0.07 : arch === 'commerc' ? 0.55 : 0.6;
      const tint = new THREE.Color().setHSL(hue + brand(-0.02, 0.02), 0.06 + brand(0, 0.05), 0.6 + brand(-0.05, 0.12));
      cityBox(w, h, d, bx, gy + h / 2, bz, tint);       // volume principal (fachada + colisor + telhado)
      const gfH = Math.min(3.4, h * 0.33);
      trimBox(w + 0.5, gfH, d + 0.5, bx, gy + gfH / 2, bz, arch === 'commerc' ? 0x2b2f36 : 0x4a4f58); // térreo/podium
      trimBox(w + 0.7, 0.28, d + 0.7, bx, gy + gfH, bz, 0x6c727b);                                    // cornija do térreo
      const fo = faceOffset(face, w, d);
      const doorW = Math.min(2.8, w * 0.42), doorH = 2.3;
      const fx = bx + fo.ox, fz = bz + fo.oz;
      if (fo.axis === 'x') {
        trimBox(doorW + 0.7, doorH + 0.4, 0.22, fx, gy + (doorH + 0.4) / 2, fz + fo.nz * 0.02, 0x8a909a);  // moldura
        trimBox(doorW, doorH, 0.16, fx, gy + doorH / 2, fz + fo.nz * 0.1, 0x14161a);                       // vão recuado
        if (arch === 'commerc' || arch === 'corner')
          trimBox(doorW + 1.6, 0.16, 1.2, fx, gy + doorH + 0.35, fz + fo.nz * 0.55, 0x2c3038);             // marquise
      } else {
        trimBox(0.22, doorH + 0.4, doorW + 0.7, fx + fo.nx * 0.02, gy + (doorH + 0.4) / 2, fz, 0x8a909a);
        trimBox(0.16, doorH, doorW, fx + fo.nx * 0.1, gy + doorH / 2, fz, 0x14161a);
        if (arch === 'commerc' || arch === 'corner')
          trimBox(1.2, 0.16, doorW + 1.6, fx + fo.nx * 0.55, gy + doorH + 0.35, fz, 0x2c3038);
      }
      // pilastras de canto (quebram as janelas nos cantos)
      for (const sx of [-1, 1]) for (const sz of [-1, 1])
        trimBox(0.5, h - gfH, 0.5, bx + sx * (w / 2 - 0.05), gy + gfH + (h - gfH) / 2, bz + sz * (d / 2 - 0.05), 0x565c66);
      // parapeito: 4 murinhos na borda do telhado (o telhado segue pisável)
      const py = gy + h;
      trimBox(w + 0.4, 0.7, 0.3, bx, py + 0.35, bz - d / 2, 0x3a3f48);
      trimBox(w + 0.4, 0.7, 0.3, bx, py + 0.35, bz + d / 2, 0x3a3f48);
      trimBox(0.3, 0.7, d + 0.4, bx - w / 2, py + 0.35, bz, 0x3a3f48);
      trimBox(0.3, 0.7, d + 0.4, bx + w / 2, py + 0.35, bz, 0x3a3f48);
      roofUnits(bx, bz, w, d, py, arch);
    }
    for (const lot of CityLayout.LOTS) building(lot);

    // vagas de carros esportivos na rua
    carSpots.push({ x: cx + 14, z: cz + 26, ry: 0, type: 'sport' });          // de frente pra avenida
    carSpots.push({ x: cx - 8, z: cz + 26, ry: Math.PI, type: 'sport2' });
    carSpots.push({ x: cx + 26, z: cz - 16, ry: -Math.PI / 2, type: 'sport' });
    chestSpots.push({ x: cx + 21.5, z: cz + 18 });

    /* ---------- PROPS urbanos (postes instanciados + mobiliário) ---------- */
    const lampPos = [], eo = SW + 0.5;
    const addLamps = (r) => {
      if (r.x1 - r.x0 > r.z1 - r.z0) {
        for (let x = r.x0 + 4; x < r.x1 - 2; x += 13) {
          lampPos.push({ x, z: r.z0 - eo, hz: 0.7, hx: 0 });
          lampPos.push({ x, z: r.z1 + eo, hz: -0.7, hx: 0 });
        }
      } else {
        for (let z = r.z0 + 4; z < r.z1 - 2; z += 13) {
          lampPos.push({ x: r.x0 - eo, z, hx: 0.7, hz: 0 });
          lampPos.push({ x: r.x1 + eo, z, hx: -0.7, hz: 0 });
        }
      }
    };
    addLamps(av); addLamps(cr);
    const NL = lampPos.length;
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.13, 4.2, 6),
      csmMat(new THREE.MeshStandardMaterial({ color: 0x3a3e44, roughness: 0.7, metalness: 0.5 })), NL);
    const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.22, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x2a2d33, emissive: 0xffd98a, emissiveIntensity: 1.0, roughness: 0.5 }), NL);
    const _o = new THREE.Object3D();
    for (let i = 0; i < NL; i++) {
      const L = lampPos[i], wx = cx + L.x, wz = cz + L.z;
      _o.position.set(wx, gy + 2.1, wz); _o.rotation.set(0, 0, 0); _o.scale.set(1, 1, 1); _o.updateMatrix();
      poles.setMatrixAt(i, _o.matrix);
      _o.position.set(wx + L.hx, gy + 4.15, wz + L.hz); _o.updateMatrix();
      heads.setMatrixAt(i, _o.matrix);
    }
    poles.castShadow = heads.castShadow = false;
    cityProps.add(poles, heads);
    // mobiliário da praça (trim: some no evento junto com os prédios)
    trimBox(2.4, 0.45, 0.6, cx - 6, gy + 0.32, cz + 12, 0x6b5a3a);   // banco
    trimBox(2.4, 0.45, 0.6, cx + 6, gy + 0.32, cz + 12, 0x6b5a3a);
    trimBox(1.0, 0.5, 1.0, cx - 11, gy + 0.3, cz + 7, 0x2f6b3a);     // floreira (verde)
    trimCyl(0.26, 1.0, cx + 10, gy + 0.5, cz - 8, 0xb23a2a);          // hidrante
    trimBox(0.6, 0.9, 0.6, cx + 14, gy + 0.45, cz + 6, 0x33383f);    // lixeira

    /* ---- TORRE NEXUS: 10 andares + escadaria + heliponto ---- */
    const W = 18, fh = 3.4, NF = 10;
    towerTopY = gy + NF * fh + 0.25;
    // casca externa texturizada (porta ao sul)
    cityBox(W, NF * fh + 1, 0.5, cx, gy + (NF * fh + 1) / 2, cz - W / 2);              // norte
    cityBox(0.5, NF * fh + 1, W, cx - W / 2, gy + (NF * fh + 1) / 2, cz);              // oeste
    cityBox(0.5, NF * fh + 1, W, cx + W / 2, gy + (NF * fh + 1) / 2, cz);              // leste
    cityBox(W / 2 - 2, NF * fh + 1, 0.5, cx - W / 4 - 1, gy + (NF * fh + 1) / 2, cz + W / 2); // sul-esq
    cityBox(W / 2 - 2, NF * fh + 1, 0.5, cx + W / 4 + 1, gy + (NF * fh + 1) / 2, cz + W / 2); // sul-dir
    cityBox(4.2, NF * fh + 1 - 3, 0.5, cx, gy + 3 + (NF * fh - 2) / 2, cz + W / 2);    // acima da porta
    // ---- trim externo da torre (decorativo, sem colisão): pilares de canto,
    //      moldura de entrada e marquise. Não bloqueia porta nem navegação. ----
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      trimBox(0.8, NF * fh + 1, 0.8, cx + sx * W / 2, gy + (NF * fh + 1) / 2, cz + sz * W / 2, 0x474d57); // pilar de canto
    trimBox(0.4, 3.4, 0.4, cx - 2, gy + 1.7, cz + W / 2 + 0.05, 0x8a909a);  // jamba esq da porta
    trimBox(0.4, 3.4, 0.4, cx + 2, gy + 1.7, cz + W / 2 + 0.05, 0x8a909a);  // jamba dir
    trimBox(5, 0.4, 0.5, cx, gy + 3.3, cz + W / 2 + 0.05, 0x8a909a);        // verga
    trimBox(6.4, 0.2, 1.8, cx, gy + 3.7, cz + W / 2 + 0.85, 0x2c3038);      // marquise de entrada
    // faixa/cornija do térreo (só o perímetro, não fecha o interior)
    trimBox(W + 0.6, 0.5, 0.4, cx, gy + 3.0, cz - W / 2, 0x5a616b);
    trimBox(0.4, 0.5, W + 0.6, cx - W / 2, gy + 3.0, cz, 0x5a616b);
    trimBox(0.4, 0.5, W + 0.6, cx + W / 2, gy + 3.0, cz, 0x5a616b);
    /* ---------- INTERIOR: escada dog-leg (dois lances em U) + poço + lobby ----------
       Contrato geométrico (relativo ao centro cx,cz; y absoluto). Reusado pela
       geometria E pelos testes (test/tower-interior.test.js). Todo o VISUAL vai
       pro cityInteriorMesh (some no evento de destruição, ver cityVisual). */
    const HALF = W / 2 - 0.25;               // 8.75: meia-largura interna (casca 0.5)
    const WELL = { x0: -HALF, x1: -4.9, z0: -HALF, z1: -4.1 }; // poço fixo (NO): a escada mora inteira aqui
    const GAP = 0.2, SLABT = 0.24, RAILH = 0.98, STEPS = 10;
    const FLW = (WELL.x1 - WELL.x0 - GAP) / 2; // largura de cada lance (~1.825)
    const xA0 = WELL.x0, xA1 = WELL.x0 + FLW;  // lance A (oeste)
    const xB0 = WELL.x1 - FLW, xB1 = WELL.x1;  // lance B (leste)
    const zMid = WELL.z0 + 1.75;               // topo dos lances / borda sul do patamar
    const zBot = WELL.z1;                       // base dos lances (borda norte do apron)
    NEXUS_INTERIOR = { W, fh: fh, floors: NF, well: WELL, flightWidth: FLW, flightRun: zBot - zMid,
      gap: GAP, midDepth: 1.75, riserCount: STEPS, railHeight: RAILH, slabT: SLABT,
      xA0, xA1, xB0, xB1, zMid, zBot, half: HALF, gy, towerTopY };
    const _ic = new THREE.Color();
    const iBox = (w, h, d, x, y, z, hex) => { // caixa vertex-color no mesh interior
      const g = new THREE.BoxGeometry(w, h, d); g.translate(cx + x, y, cz + z);
      paintGeometry(g, _ic.setHex(hex)); cityInteriorGeos.push(g);
    };
    const iLamp = (w, d, x, y, z) => { // luminária emissiva (mesh separada)
      const g = new THREE.BoxGeometry(w, 0.1, d); g.translate(cx + x, y, cz + z);
      cityInteriorLampGeos.push(g);
    };
    // laje/patamar: visual + plataforma pisável + parede noCollide (barra bala, não empurra)
    const iSlab = (x0, x1, z0, z1, y, hex = 0x9297a0) => {
      iBox(x1 - x0, SLABT, z1 - z0, (x0 + x1) / 2, y - SLABT / 2, (z0 + z1) / 2, hex);
      walls.push({ x0: cx + x0, x1: cx + x1, y0: y - SLABT, y1: y, z0: cz + z0, z1: cz + z1, noCollide: true, city: true });
      platforms.push({ x0: cx + x0, x1: cx + x1, z0: cz + z0, z1: cz + z1, y, city: true });
    };
    // corrimão horizontal (barra sup+méd + prumos); colisor fino contínuo opcional
    const railRun = (x0, x1, z0, z1, yb, collide) => {
      const horiz = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
      const len = horiz ? (x1 - x0) : (z1 - z0), mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, hex = 0x9aa1ab;
      if (horiz) { iBox(len, 0.06, 0.06, mx, yb + RAILH, mz, hex); iBox(len, 0.05, 0.05, mx, yb + RAILH * 0.5, mz, hex); }
      else { iBox(0.06, 0.06, len, mx, yb + RAILH, mz, hex); iBox(0.05, 0.05, len, mx, yb + RAILH * 0.5, mz, hex); }
      const n = Math.max(2, Math.round(Math.abs(len) / 1.1));
      for (let i = 0; i <= n; i++) { const f = i / n;
        iBox(0.06, RAILH, 0.06, horiz ? x0 + (x1 - x0) * f : mx, yb + RAILH / 2, horiz ? mz : z0 + (z1 - z0) * f, hex); }
      if (collide) { const t = 0.12;
        walls.push({ x0: cx + (horiz ? x0 : mx - t / 2), x1: cx + (horiz ? x1 : mx + t / 2),
          y0: yb, y1: yb + RAILH, z0: cz + (horiz ? mz - t / 2 : z0), z1: cz + (horiz ? mz + t / 2 : z1), city: true }); }
    };
    // corrimão inclinado acompanhando um lance (x fixo; norte->sul: yN->yS)
    const railSlope = (x, yN, yS) => {
      const dz = zBot - zMid, dy = yS - yN, len = Math.hypot(dz, dy), hex = 0x9aa1ab;
      const g = new THREE.BoxGeometry(0.06, 0.06, len);
      g.rotateX(-Math.atan2(dy, dz)); g.translate(cx + x, (yN + yS) / 2 + RAILH, cz + (zMid + zBot) / 2);
      paintGeometry(g, _ic.setHex(hex)); cityInteriorGeos.push(g);
      for (let i = 0; i <= 5; i++) { const t = i / 5; iBox(0.06, RAILH, 0.06, x, yN + dy * t + RAILH / 2, zMid + dz * t, hex); }
    };
    // um lance: rampa lógica contínua (colisão SUAVE) + degraus SÓ visuais por cima
    const flight = (xL, xR, yN, yS) => {
      platforms.push({ ramp: true, axis: 'z', x0: cx + xL, x1: cx + xR, z0: cz + zMid, z1: cz + zBot, y0: yN, y1: yS, city: true });
      const dz = (zBot - zMid) / STEPS;
      for (let i = 0; i < STEPS; i++) { const t = (i + 0.5) / STEPS;
        iBox(xR - xL, 0.34, dz + 0.02, (xL + xR) / 2, (yN + (yS - yN) * t) - 0.17, zMid + t * (zBot - zMid), 0x83888f); }
    };
    // guarda-corpo do poço por pavimento: borda leste + vão central do apron
    const stairGuards = (y) => {
      railRun(WELL.x1, WELL.x1, WELL.z0, zBot, y, true);   // borda leste do poço (protege o piso)
      railRun(xA1, xB0, zBot, zBot, y, true);              // vão central (0.2) na borda do apron
    };
    // escada k: sobe de yBottom (piso de baixo) a yTop (piso de cima ou telhado)
    const buildStaircase = (yBottom, yTop) => {
      const ym = (yBottom + yTop) / 2;
      iSlab(xA0, xB1, WELL.z0, zMid, ym);                  // patamar intermediário (norte), plano em ym
      flight(xA0, xA1, ym, yBottom);                       // lance A: patamar(N) -> piso baixo(S)
      flight(xB0, xB1, ym, yTop);                          // lance B: patamar(N) -> piso alto(S)
      railSlope(xA1, ym, yBottom); railSlope(xB0, ym, yTop); // corrimãos internos (no vão central)
      railRun(WELL.x1, WELL.x1, WELL.z0, zMid, ym, true);  // borda leste do patamar
    };
    // pavimento 1..NF-1: laje = bloco leste + apron SO (tudo menos o poço)
    const buildFloor = (y) => { iSlab(WELL.x1, HALF, -HALF, HALF, y); iSlab(-HALF, WELL.x1, zBot, HALF, y); };

    heliSpot = { x: cx, y: towerTopY, z: cz };
    bazookaSpot = { x: cx + 6.5, y: towerTopY, z: cz + 6.5 };
    // === GEOMETRIA DO INTERIOR: criada com Math.random NEUTRALIZADO (noSeed) ===
    // Nada aqui pode consumir o RNG seedado; walls/platforms são objetos puros.
    noSeed(() => {
      // painéis internos (escondem a fachada externa vista por dentro) — sem colisão
      const panelH = NF * fh, panelY = gy + panelH / 2, panelC = 0x565b64;
      iBox(2 * HALF, panelH, 0.08, 0, panelY, -HALF + 0.08, panelC);   // norte
      iBox(0.08, panelH, 2 * HALF, -HALF + 0.08, panelY, 0, panelC);   // oeste
      iBox(0.08, panelH, 2 * HALF, HALF - 0.08, panelY, 0, panelC);    // leste
      iBox(HALF - 2.4, panelH, 0.08, -(HALF + 2.4) / 2, panelY, HALF - 0.08, panelC); // sul-esq (evita porta)
      iBox(HALF - 2.4, panelH, 0.08, (HALF + 2.4) / 2, panelY, HALF - 0.08, panelC);  // sul-dir
      // lobby: piso interno diferenciado (decorativo) + 4 pilares estruturais (colisor)
      iBox(2 * HALF, 0.06, 2 * HALF, 0, gy + 0.05, 0, 0x3d434c);       // placa do lobby (leitura visual)
      for (const [px, pz] of [[-2.5, -5.5], [-2.5, 5.5], [6, -5.5], [6, 5.5]]) {
        iBox(0.5, panelH, 0.5, px, panelY, pz, 0x6b7079);              // pilar visual (full-height)
        walls.push({ x0: cx + px - 0.25, x1: cx + px + 0.25, y0: gy, y1: gy + panelH, z0: cz + pz - 0.25, z1: cz + pz + 0.25, city: true });
      }
      // numeração dos andares: 1 atlas em CanvasTexture (planos mesclados = 1 draw call)
      const signCv = document.createElement('canvas'); signCv.width = 64 * NF; signCv.height = 64;
      const sctx = signCv.getContext('2d');
      sctx.fillStyle = '#0b0e13'; sctx.fillRect(0, 0, signCv.width, signCv.height);
      sctx.fillStyle = '#8fd8ff'; sctx.font = 'bold 40px sans-serif'; sctx.textAlign = 'center'; sctx.textBaseline = 'middle';
      for (let f = 1; f <= NF; f++) sctx.fillText(String(f), (f - 0.5) * 64, 36);
      cityInteriorSignTex = new THREE.CanvasTexture(signCv); cityInteriorSignTex.colorSpace = THREE.SRGBColorSpace;
      const floorSign = (f, x, y, z) => {                              // placa do andar f, olhando pro leste (+x)
        const g = new THREE.PlaneGeometry(0.9, 0.9);
        const u = g.attributes.uv, c0 = (f - 1) / NF, c1 = f / NF;
        for (let i = 0; i < u.count; i++) u.setX(i, c0 + u.getX(i) * (c1 - c0));
        g.rotateY(Math.PI / 2); g.translate(cx + x, y, cz + z);
        cityInteriorSignGeos.push(g);
      };
      // andares e escada + numeração
      for (let k = 1; k <= NF; k++) {
        const yTop = k === NF ? towerTopY : gy + k * fh;
        if (k < NF) { buildFloor(gy + k * fh); stairGuards(gy + k * fh); }
        buildStaircase(gy + (k - 1) * fh, yTop);
        iLamp(1.4, 0.4, 3.5, gy + k * fh - 0.35, 0);                   // luminária central do teto
        iLamp(0.5, 1.2, -6.5, gy + k * fh - 0.35, -5.5);               // luminária sobre a escada
        floorSign(k, -4.7, gy + (k - 1) * fh + 2.3, -4.0);            // número do andar junto à saída
      }
      // ---- TELHADO: deck (footprint menos o poço) + heliponto + parapeitos ----
      buildFloor(towerTopY);                                          // deck com saída da escada (poço aberto)
      stairGuards(towerTopY);                                         // guarda-corpo do poço no telhado
      iBox(W, 0.6, 0.4, 0, towerTopY + 0.3, -W / 2 + 0.2, 0x3a3f48);  // parapeitos
      iBox(W, 0.6, 0.4, 0, towerTopY + 0.3, W / 2 - 0.2, 0x3a3f48);
      iBox(0.4, 0.6, W, -W / 2 + 0.2, towerTopY + 0.3, 0, 0x3a3f48);
      iBox(0.4, 0.6, W, W / 2 - 0.2, towerTopY + 0.3, 0, 0x3a3f48);
      const padGeo = new THREE.CylinderGeometry(5.2, 5.2, 0.1, 24); padGeo.translate(cx, towerTopY + 0.06, cz);
      paintGeometry(padGeo, _ic.setHex(0x32363d)); cityInteriorGeos.push(padGeo);
      iBox(3.4, 0.06, 0.7, 0, towerTopY + 0.12, 0, 0xe8eef4);         // "H"
      iBox(0.7, 0.06, 2.6, -1.35, towerTopY + 0.12, 0, 0xe8eef4);
      iBox(0.7, 0.06, 2.6, 1.35, towerTopY + 0.12, 0, 0xe8eef4);
      trimBox(0.16, 5.5, 0.16, cx - W / 2 + 1.6, towerTopY + 2.75, cz - W / 2 + 1.6, 0x20242a); // antena
      trimBox(1.6, 0.5, 1.6, cx - W / 2 + 1.6, towerTopY + 0.25, cz - W / 2 + 1.6, 0x2e323a);   // casa de máquinas
      iBox(1.2, 0.7, 0.7, 6.5, towerTopY + 0.35, 6.5, 0x4a5240);      // caixa da bazuca
    });
    // === CONSUMO SEEDADO DO WORLDGEN (fora do noSeed) — contrato do Math.random ===
    // inimigos de terno em andares alternados (rand seedado: variedade por seed)
    for (let k = 1; k <= NF; k++) if (k % 2 === 0 && k < NF) {
      enemyCamps.push({ x: cx + 3, z: cz + rand(-4, 4), suit: true, floorY: gy + k * fh });
      enemyCamps.push({ x: cx + rand(0, 5), z: cz + rand(-5, 5), suit: true, floorY: gy + k * fh });
    }
    // a escadaria/telhado ANTIGOS (42 geometrias) consumiam 168 chamadas de Math.random
    // via UUIDs do THREE; reproduz esse consumo p/ manter bases/baús/grama a jusante
    // IDÊNTICOS ao layout do seed (preserva o contrato do worldgen sem prender a
    // riqueza da geometria nova ao stream). 42×4 = 168.
    for (let i = 0; i < 168; i++) Math.random();
  }

  /* ================= BASES MILITARES ================= */
  const baseSites = [];
  function mbase(cx, cz) {
    const y = heightAt(cx, cz);
    sites.push({ x: cx, z: cz, r: 22, type: 'base' });
    baseSites.push({ x: cx, z: cz, cleared: false });
    const W2 = 21, D2 = 15, H2 = 2.4;
    sbox(W2 * 2, H2, 0.7, cx, y + H2 / 2 - 0.3, cz - D2, 0x4a5240);
    sbox(0.7, H2, D2 * 2, cx - W2, y + H2 / 2 - 0.3, cz, 0x4a5240);
    sbox(0.7, H2, D2 * 2, cx + W2, y + H2 / 2 - 0.3, cz, 0x4a5240);
    const g2 = 6;
    sbox(W2 - g2 / 2, H2, 0.7, cx - (g2 / 2 + (W2 - g2 / 2) / 2), y + H2 / 2 - 0.3, cz + D2, 0x4a5240);
    sbox(W2 - g2 / 2, H2, 0.7, cx + (g2 / 2 + (W2 - g2 / 2) / 2), y + H2 / 2 - 0.3, cz + D2, 0x4a5240);
    // tendas militares (prismas)
    for (const [ox, oz] of [[-12, -6], [-12, 4], [12, -5]]) {
      const t1 = new THREE.BoxGeometry(5.5, 0.16, 4.4); t1.rotateZ(0.7); t1.translate(cx + ox - 1.25, y + 1.25, cz + oz);
      paintGeometry(t1, _sc.setHex(0x55603f)); geos.push(t1);
      const t2 = new THREE.BoxGeometry(5.5, 0.16, 4.4); t2.rotateZ(-0.7); t2.translate(cx + ox + 1.25, y + 1.25, cz + oz);
      paintGeometry(t2, _sc.setHex(0x55603f)); geos.push(t2);
    }
    // sacos de areia + caixotes
    for (let i = 0; i < 5; i++) sbox(2.2, 0.8, 0.6, cx - 4 + i * 2.4, y + 0.4, cz + D2 - 3, 0x8a7a58);
    sbox(1.4, 1.4, 1.4, cx + 6, y + 0.7, cz - 8, 0x6b5a38);
    sbox(1.2, 1.2, 1.2, cx + 7.6, y + 0.6, cz - 7.2, 0x6b5a38);
    // guardas + caminhão
    for (let i = 0; i < 4; i++) enemyCamps.push({ x: cx + rand(-12, 12), z: cz + rand(-8, 8), army: true });
    carSpots.push({ x: cx, z: cz - 4, ry: rand(TAU), type: 'truck' });
    chestSpots.push({ x: cx - 5, z: cz - 8 });
  }
  for (let i = 0; i < 2; i++) { const p = flatSpot(130, 380); if (p) mbase(p.x, p.z); }
  chestSpots.push({ x: 5, z: 0.5 });

  const merged = BufferGeometryUtils.mergeGeometries(geos);
  const mesh = new THREE.Mesh(merged, csmMat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.02 })));
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  const cityMesh = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(cityGeos), cityMat);
  cityMesh.castShadow = cityMesh.receiveShadow = true;
  scene.add(cityMesh);
  // trim urbano (térreos, entradas, parapeitos, coberturas, mobiliário): mesh
  // vertex-color própria pra sumir junto no evento de destruição.
  const cityTrimMat = csmMat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05 }));
  const cityTrimMesh = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(cityTrimGeos), cityTrimMat);
  cityTrimMesh.castShadow = cityTrimMesh.receiveShadow = true;
  scene.add(cityTrimMesh);
  scene.add(cityProps);
  // INTERIOR intacto da Torre Nexus (lajes, degraus, patamares, corrimãos, pilares,
  // painéis, heliponto): meshes próprias pra sumir junto no evento de destruição
  // (antes o visual ia pro `mesh` global e ficava FLUTUANDO após city.destroy()).
  // noSeed: mesclagem/mesh/material geram UUIDs — não podem consumir o RNG do worldgen
  // (a grama roda depois). São ADITIVOS (o antigo não os tinha) → sem compensação.
  // emissive baixo de auto-iluminação: o interior fechado quase não recebe luz à
  // noite; sem isto ficava preto. Sutil de dia, legível à noite.
  const [cityInteriorMesh, cityInteriorLampMesh, cityInteriorSignMesh] = noSeed(() => {
    const im = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(cityInteriorGeos),
      csmMat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.04,
        emissive: 0x3b4552, emissiveIntensity: 1.5 })));
    im.name = 'cityInteriorMesh'; im.castShadow = im.receiveShadow = true;
    const lm = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(cityInteriorLampGeos),
      new THREE.MeshStandardMaterial({ color: 0x0e1218, emissive: 0xcfe9ff, emissiveIntensity: 2.4, roughness: 0.5 }));
    lm.name = 'cityInteriorLampMesh';
    const sm = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(cityInteriorSignGeos),
      new THREE.MeshBasicMaterial({ map: cityInteriorSignTex, transparent: false }));
    sm.name = 'cityInteriorSignMesh';
    return [im, lm, sm];
  });
  scene.add(cityInteriorMesh, cityInteriorLampMesh, cityInteriorSignMesh);
  // visuais urbanos escondidos/mostrados atomicamente no evento
  const cityVisual = [cityMesh, cityTrimMesh, cityProps,
    cityInteriorMesh, cityInteriorLampMesh, cityInteriorSignMesh];

  /* ---- raio vs AABBs (slab test, sem alocação) ---- */
  function rayHit(o, d, maxDist) {
    let best = maxDist;
    for (const b of walls) {
      let t0 = 0, t1 = best, ta, tb;
      if (Math.abs(d.x) < 1e-8) { if (o.x < b.x0 || o.x > b.x1) continue; }
      else { ta = (b.x0 - o.x) / d.x; tb = (b.x1 - o.x) / d.x; if (ta > tb) { const m = ta; ta = tb; tb = m; } t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) continue; }
      if (Math.abs(d.y) < 1e-8) { if (o.y < b.y0 || o.y > b.y1) continue; }
      else { ta = (b.y0 - o.y) / d.y; tb = (b.y1 - o.y) / d.y; if (ta > tb) { const m = ta; ta = tb; tb = m; } t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) continue; }
      if (Math.abs(d.z) < 1e-8) { if (o.z < b.z0 || o.z > b.z1) continue; }
      else { ta = (b.z0 - o.z) / d.z; tb = (b.z1 - o.z) / d.z; if (ta > tb) { const m = ta; ta = tb; tb = m; } t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) continue; }
      if (t0 > 0 && t0 < best) best = t0;
    }
    return best === maxDist ? Infinity : best;
  }
  const _sd = new THREE.Vector3();
  function segBlocked(from, to) {
    _sd.copy(to).sub(from);
    const len = _sd.length();
    if (len < 1e-4) return false;
    _sd.multiplyScalar(1 / len);
    return rayHit(from, _sd, len) < len;
  }

  /* ---- empurra círculo (player/inimigo) para fora das paredes ---- */
  function collide(pos, radius, height) {
    for (const b of walls) {
      if (b.noCollide) continue; // lajes: pisáveis, não empurram
      // pés no nível do topo = está PISANDO no bloco (telhado) — não expulsa
      if (pos.y + height < b.y0 || pos.y >= b.y1 - 0.12) continue;
      const nx = clamp(pos.x, b.x0, b.x1), nz = clamp(pos.z, b.z0, b.z1);
      const dx = pos.x - nx, dz = pos.z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        pos.x = nx + dx / d * radius;
        pos.z = nz + dz / d * radius;
      } else {
        const px = Math.min(pos.x - b.x0, b.x1 - pos.x);
        const pz = Math.min(pos.z - b.z0, b.z1 - pos.z);
        if (px < pz) pos.x = (pos.x - b.x0 < b.x1 - pos.x) ? b.x0 - radius : b.x1 + radius;
        else pos.z = (pos.z - b.z0 < b.z1 - pos.z) ? b.z0 - radius : b.z1 + radius;
      }
    }
  }

  /* ============ DESTRUIÇÃO DA CIDADE — módulo fundo, interface pequena ============
     Registro de tudo que é urbano (walls/platforms marcados city:true, corpos
     CANNON registrados pelo game.js) + versão destruída construída JÁ NO BOOT
     (invisível). destroy()/restore() trocam visual e colisão do mundo inteiro
     de forma atômica: jogador, bala (rayHit), telhados e física dos veículos. */
  const cityRuins = new THREE.Group();
  cityRuins.name = 'cidadeDestruida';
  cityRuins.visible = false;
  const ruinWalls = [];   // colisores simplificados dos escombros (poucos)
  {
    // PRNG PRÓPRIO: as ruínas nascem no boot e NÃO podem consumir o RNG
    // seedado do mundo — senão tudo gerado depois delas muda de lugar
    // (mundos de versões antigas/novas divergiriam e o QA quebra)
    let _rs = 0xC1DADE;
    const _rr = () => (_rs = (_rs * 1664525 + 1013904223) >>> 0) / 4294967296;
    const rand = (a = 1, b) => (b === undefined ? _rr() * a : a + _rr() * (b - a));
    const cx = CITY.x, cz = CITY.z, gy = heightAt(cx, cz);
    const mRuina = csmMat(new THREE.MeshStandardMaterial({ color: 0x2e2c2a, roughness: 0.95 }));
    const mQueim = csmMat(new THREE.MeshStandardMaterial({ color: 0x191715, roughness: 1 }));
    const mViga = new THREE.MeshStandardMaterial({ color: 0x4a3f34, roughness: 0.7, metalness: 0.5 });
    const mFogo = new THREE.MeshStandardMaterial({ color: 0x200800, emissive: 0xff7a2e, emissiveIntensity: 3 });
    // chão urbano escurecido + "rachaduras" (faixas escuras finas)
    const chao = new THREE.Mesh(new THREE.CircleGeometry(88, 40),
      new THREE.MeshStandardMaterial({ color: 0x14120f, roughness: 1, transparent: true, opacity: 0.85 }));
    chao.rotation.x = -Math.PI / 2;
    chao.position.set(cx, gy + 0.05, cz);
    cityRuins.add(chao);
    for (let i = 0; i < 10; i++) {
      const r = new THREE.Mesh(new THREE.PlaneGeometry(rand(14, 40), rand(0.5, 1.2)),
        new THREE.MeshBasicMaterial({ color: 0x050505 }));
      r.rotation.x = -Math.PI / 2;
      r.rotation.z = rand(TAU);
      r.position.set(cx + rand(-70, 70), gy + 0.07, cz + rand(-70, 70));
      cityRuins.add(r);
    }
    // stubs dos prédios: metade inferior, inclinados e chamuscados + vigas
    const lots = [[-34, -28, 11, 22], [-16, -34, 12, 16], [4, -30, 10, 26], [38, -26, 13, 18],
      [-40, -2, 10, 14], [-38, 44, 12, 20], [-14, 42, 11, 24], [8, 44, 12, 15],
      [40, 8, 11, 19], [42, 42, 13, 28], [-44, 18, 9, 12], [16, -8, 9, 13]];
    let li = 0;
    for (const [ox, oz, w, hOrig] of lots) {
      const h = hOrig * rand(0.28, 0.45);
      const stub = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * 0.95), li % 2 ? mRuina : mQueim);
      stub.position.set(cx + ox, gy + h / 2 - 0.4, cz + oz);
      stub.rotation.z = rand(-0.09, 0.09);
      stub.rotation.x = rand(-0.07, 0.07);
      stub.castShadow = true;
      cityRuins.add(stub);
      for (let v = 0; v < 2; v++) {
        const viga = new THREE.Mesh(new THREE.BoxGeometry(0.28, hOrig * rand(0.4, 0.7), 0.28), mViga);
        viga.position.set(cx + ox + rand(-w / 2, w / 2), gy + viga.geometry.parameters.height / 2 - 0.3,
          cz + oz + rand(-w / 2, w / 2));
        viga.rotation.z = rand(-0.35, 0.35);
        cityRuins.add(viga);
      }
      // colisor simplificado só nos 6 primeiros stubs: BAIXO (1,6m) — dá pra
      // pular por cima; balas passam por cima; só barra quem anda reto nele
      if (li < 6) ruinWalls.push({ x0: cx + ox - w / 2, x1: cx + ox + w / 2,
        y0: gy - 0.4, y1: gy + 1.6, z0: cz + oz - w / 2, z1: cz + oz + w / 2, cityRuin: true });
      li++;
    }
    // Torre Nexus severamente danificada: toco alto e torto
    const toco = new THREE.Mesh(new THREE.BoxGeometry(13, 14, 13), mQueim);
    toco.position.set(cx, gy + 6.6, cz);
    toco.rotation.z = 0.12;
    cityRuins.add(toco);
    ruinWalls.push({ x0: cx - 6.5, x1: cx + 6.5, y0: gy - 0.4, y1: gy + 13, z0: cz - 6.5, z1: cz + 6.5, cityRuin: true });
    // entulho instanciado (decorativo, sem física — barato)
    const debGeo = new THREE.BoxGeometry(1, 0.7, 1);
    const deb = new THREE.InstancedMesh(debGeo, mRuina, 120);
    const dm = new THREE.Object3D();
    for (let i = 0; i < 120; i++) {
      const a = rand(TAU), r = rand(4, 84);
      dm.position.set(cx + Math.cos(a) * r, gy + rand(0, 0.5), cz + Math.sin(a) * r);
      dm.rotation.set(rand(TAU), rand(TAU), rand(TAU));
      dm.scale.setScalar(rand(0.4, 1.8));
      dm.updateMatrix();
      deb.setMatrixAt(i, dm.matrix);
    }
    deb.castShadow = true;
    cityRuins.add(deb);
    // focos de fogo (cones emissive) + 2 luzes dinâmicas SÓ quando visível
    for (const [fx, fz] of [[-30, -24], [18, 30], [40, 6]]) {
      const fogo = new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.6, 6), mFogo);
      fogo.position.set(cx + fx, gy + 0.8, cz + fz);
      cityRuins.add(fogo);
    }
    cityRuins.add(new THREE.PointLight(0xff7a2e, 1.6, 40, 1.4).translateX(cx - 30).translateY(gy + 3).translateZ(cz - 24));
    cityRuins.add(new THREE.PointLight(0xff9a4e, 1.2, 34, 1.4).translateX(cx + 40).translateY(gy + 3).translateZ(cz + 6));
    scene.add(cityRuins);
  }

  const city = {
    center: { x: CITY.x, z: CITY.z },
    radius: 95,
    _state: 'intact',
    _bodies: [],          // corpos CANNON das paredes urbanas (registrados pelo game.js)
    _world: null,
    _savedWalls: [], _savedPlatforms: [],
    containsPoint(x, z) { return Math.hypot(x - CITY.x, z - CITY.z) <= this.radius; },
    getState() { return this._state; },
    setState(st) { if (st === 'destroyed') this.destroy(); else if (st === 'intact') this.restore(); },
    registerBody(b) { this._bodies.push(b); },
    bindPhysics(world) { this._world = world; },
    destroy() {
      if (this._state === 'destroyed') return;
      this._state = 'destroyed';
      if (this.onStateChange) this.onStateChange('destroyed'); // ex.: cobertura de chuva cai junto
      for (const m of cityVisual) m.visible = false;
      cityRuins.visible = true;
      // colisão: paredes/plataformas urbanas saem dos arrays COMPARTILHADOS
      this._savedWalls = walls.filter(w => w.city);
      this._savedPlatforms = platforms.filter(p => p.city);
      for (let i = walls.length - 1; i >= 0; i--) if (walls[i].city) walls.splice(i, 1);
      for (let i = platforms.length - 1; i >= 0; i--) if (platforms[i].city) platforms.splice(i, 1);
      for (const rw of ruinWalls) walls.push(rw); // escombros: poucos colisores baixos
      if (this._world) for (const b of this._bodies) this._world.removeBody(b);
    },
    restore() {
      if (this._state === 'intact') return;
      this._state = 'intact';
      if (this.onStateChange) this.onStateChange('intact');
      for (const m of cityVisual) m.visible = true;
      cityRuins.visible = false;
      for (let i = walls.length - 1; i >= 0; i--) if (walls[i].cityRuin) walls.splice(i, 1);
      for (const w of this._savedWalls) walls.push(w);
      for (const p of this._savedPlatforms) platforms.push(p);
      this._savedWalls = []; this._savedPlatforms = [];
      if (this._world) for (const b of this._bodies) this._world.addBody(b);
    },
  };

  return { sites, walls, rayHit, segBlocked, collide, FORT_POS, flames, smokeSpots, flags, city,
    cityMat, carSpots, enemyCamps, chestSpots, baseSites, heliSpot, bazookaSpot, towerTopY, NEXUS_INTERIOR };
}
