/* Rig visual de rodas dos veículos: os GLBs vêm com as rodas fundidas na
   carroceria (agrupadas por material, sem nós próprios e sem animações).
   Este módulo recorta as 4 rodas por REGIÃO GEOMÉTRICA calibrada por ativo
   (cfg.wheelsVis, no espaço do chassi) em tempo de carregamento e devolve
   carroceria + geometria de cada roda no referencial do próprio pivô.
   Determinístico (zero Math.random), não toca nos GLBs originais e roda
   UMA vez por URL (o resultado é cacheado pelo js/car.js).

   Espaço do chassi: +X frente, +Y cima, +Z direita — o mesmo do
   RaycastVehicle (indexForwardAxis 0, indexUpAxis 1, indexRightAxis 2). */
import * as THREE from 'three';

const WELD = 1e4; // solda vértices por posição quantizada (0,1 mm)

/* Recorta um subconjunto de triângulos preservando TODOS os atributos
   (posição, normal, uv, cor, tangente) e o compartilhamento por índice. */
function subsetGeometry(src, tris) {
  const index = src.getIndex();
  const remap = new Map();
  const newIndex = [];
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      const vi = index ? index.getX(t * 3 + k) : t * 3 + k;
      let ni = remap.get(vi);
      if (ni === undefined) { ni = remap.size; remap.set(vi, ni); }
      newIndex.push(ni);
    }
  }
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(src.attributes)) {
    const a = src.attributes[name];
    const arr = new Float32Array(remap.size * a.itemSize);
    for (const [oi, ni] of remap)
      for (let c = 0; c < a.itemSize; c++) arr[ni * a.itemSize + c] = a.getComponent(oi, c);
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  out.setIndex(newIndex);
  return out;
}

/* Ilhas de geometria (componentes conexas por vértice soldado) de uma malha.
   Devolve, por ilha, a lista de triângulos e o bbox no espaço do chassi. */
function computeIslands(geo, baked /* Float32Array xyz por vértice, chassi */) {
  const index = geo.getIndex();
  const nVerts = geo.attributes.position.count;
  const nTris = (index ? index.count : nVerts) / 3;
  const canon = new Int32Array(nVerts);
  const seen = new Map();
  for (let i = 0; i < nVerts; i++) {
    const key = `${Math.round(baked[i * 3] * WELD)}_${Math.round(baked[i * 3 + 1] * WELD)}_${Math.round(baked[i * 3 + 2] * WELD)}`;
    const first = seen.get(key);
    if (first === undefined) { seen.set(key, i); canon[i] = i; } else canon[i] = first;
  }
  const parent = new Int32Array(nVerts);
  for (let i = 0; i < nVerts; i++) parent[i] = i;
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const vtx = (t, k) => index ? index.getX(t * 3 + k) : t * 3 + k;
  for (let t = 0; t < nTris; t++) {
    const a = find(canon[vtx(t, 0)]), b = find(canon[vtx(t, 1)]), c = find(canon[vtx(t, 2)]);
    if (a !== b) parent[a] = b;
    const b2 = find(b);
    if (b2 !== find(c)) parent[b2] = find(c);
  }
  const islands = new Map(); // raiz -> { tris:[], min:Vector3, max:Vector3 }
  for (let t = 0; t < nTris; t++) {
    const root = find(canon[vtx(t, 0)]);
    let isl = islands.get(root);
    if (!isl) {
      isl = { tris: [], min: new THREE.Vector3(Infinity, Infinity, Infinity), max: new THREE.Vector3(-Infinity, -Infinity, -Infinity) };
      islands.set(root, isl);
    }
    isl.tris.push(t);
    for (let k = 0; k < 3; k++) {
      const v = vtx(t, k) * 3;
      isl.min.x = Math.min(isl.min.x, baked[v]); isl.max.x = Math.max(isl.max.x, baked[v]);
      isl.min.y = Math.min(isl.min.y, baked[v + 1]); isl.max.y = Math.max(isl.max.y, baked[v + 1]);
      isl.min.z = Math.min(isl.min.z, baked[v + 2]); isl.max.z = Math.max(isl.max.z, baked[v + 2]);
    }
  }
  return { islands: [...islands.values()], vtx };
}

/* Maior distância de um vértice da ilha até um centro (exata, não bbox:
   um pneu esterçado de fábrica estoura o bbox mas não a distância real). */
function maxDistTo(isl, vtx, baked, center) {
  let best = 0;
  for (const t of isl.tris) for (let k = 0; k < 3; k++) {
    const v = vtx(t, k) * 3;
    const d = Math.hypot(baked[v] - center.x, baked[v + 1] - center.y, baked[v + 2] - center.z);
    if (d > best) best = d;
  }
  return best;
}

/* Esterço "de fábrica" (RX-7 vem com as rodas dianteiras viradas): acha o
   yaw que minimiza a EXTENSÃO em Z da roda — pra um cilindro deitado no
   eixo Z o mínimo é exato no ângulo neutro (mais estável que min-área,
   que os aros/pinças assimétricos enviesavam). */
function detectBakedSteer(positions /* [{x,z}] relativos ao pivô */) {
  let bestTheta = 0, bestSpan = Infinity, spanAtZero = 0;
  for (let deg = -40; deg <= 40; deg += 0.5) {
    const th = deg * Math.PI / 180;
    const c = Math.cos(th), s = Math.sin(th);
    let z0 = Infinity, z1 = -Infinity;
    for (const p of positions) {
      // mesma convenção do Object3D.rotateY(th) — o melhor th neutraliza o esterço
      const z = -s * p.x + c * p.z;
      if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    const span = z1 - z0;
    if (deg === 0) spanAtZero = span;
    if (span < bestSpan) { bestSpan = span; bestTheta = th; }
  }
  // só corrige se o ganho é claro E o ângulo é relevante (roda reta fica reta)
  if (Math.abs(bestTheta) < 0.06 || bestSpan > spanAtZero * 0.97) return 0;
  return -bestTheta; // yaw que estava aplicado na geometria
}

/* Inventário das ilhas de geometria no espaço do chassi — usado pela
   calibração de cfg.wheelsVis e pelos testes (ex.: provar que a carroceria
   não ficou com uma roda estática duplicada). Só ilhas com minTris+. */
export function analyzeCarModel(scaledRoot, minTris = 30) {
  const out = [];
  const _p = new THREE.Vector3();
  scaledRoot.updateMatrixWorld(true);
  scaledRoot.traverse(mesh => {
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.attributes.position;
    const baked = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      _p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      baked[i * 3] = _p.x; baked[i * 3 + 1] = _p.y; baked[i * 3 + 2] = _p.z;
    }
    const { islands } = computeIslands(mesh.geometry, baked);
    for (const isl of islands) {
      if (isl.tris.length < minTris) continue;
      out.push({
        mesh: mesh.name,
        tris: isl.tris.length,
        center: [(isl.min.x + isl.max.x) / 2, (isl.min.y + isl.max.y) / 2, (isl.min.z + isl.max.z) / 2],
        size: [isl.max.x - isl.min.x, isl.max.y - isl.min.y, isl.max.z - isl.min.z],
      });
    }
  });
  return out;
}

/* Constrói o rig a partir da raiz JÁ normalizada (espaço do chassi,
   updateMatrixWorld aplicado). Lança Error com diagnóstico se a extração
   não validar — o chamador decide o fallback. */
export function buildCarRig(scaledRoot, cfg) {
  const wheelCfg = cfg.wheelsVis.map((c, i) => ({
    center: new THREE.Vector3(c[0], c[1], c[2]),
    r: Array.isArray(cfg.wheelRVis) ? cfg.wheelRVis[i] : cfg.wheelRVis,
    w: cfg.wheelWVis,
  }));
  const bodyParts = [];
  const wheelParts = [[], [], [], []]; // por roda: {geometry, material}
  const captured = [[], [], [], []];   // diagnóstico: ilhas capturadas por roda

  const meshes = [];
  scaledRoot.updateMatrixWorld(true);
  scaledRoot.traverse(obj => { if (obj.isMesh) meshes.push(obj); });
  if (!meshes.length) throw new Error('modelo sem malhas');

  const _p = new THREE.Vector3();
  for (const mesh of meshes) {
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    // posições no espaço do chassi (bake temporário só pra classificar)
    const baked = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      _p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      baked[i * 3] = _p.x; baked[i * 3 + 1] = _p.y; baked[i * 3 + 2] = _p.z;
    }
    const { islands, vtx } = computeIslands(geo, baked);

    // classifica cada ilha: roda k ou carroceria. (Vértices ÓRFÃOS — sem
    // triângulo, tipo a lasca fantasma 0,65 m abaixo dos pneus do caminhão —
    // somem de graça: o subset só copia vértice referenciado por índice.)
    const triWheel = new Map(); // triângulo -> roda
    for (const isl of islands) {
      const cx = (isl.min.x + isl.max.x) / 2, cy = (isl.min.y + isl.max.y) / 2, cz = (isl.min.z + isl.max.z) / 2;
      for (let k = 0; k < 4; k++) {
        const w = wheelCfg[k];
        const d3 = Math.hypot(cx - w.center.x, cy - w.center.y, cz - w.center.z);
        if (d3 > 0.5 * w.r + 0.06) continue;                       // centro longe do cubo da roda
        if (Math.abs(cz - w.center.z) > Math.max(0.09, w.w * 0.55)) continue; // peça interna (eixo/tambor)
        // paralama/porta ficam de fora: a peça precisa CABER no envelope da roda
        if (maxDistTo(isl, vtx, baked, w.center) > Math.hypot(w.r, w.w / 2) * 1.2 + 0.06) continue;
        for (const t of isl.tris) triWheel.set(t, k);
        captured[k].push({
          mesh: mesh.name, tris: isl.tris.length,
          center: [+cx.toFixed(3), +cy.toFixed(3), +cz.toFixed(3)],
          size: [+(isl.max.x - isl.min.x).toFixed(3), +(isl.max.y - isl.min.y).toFixed(3), +(isl.max.z - isl.min.z).toFixed(3)],
        });
        break;
      }
    }

    // unidades por material (as malhas multi-material dividem por grupo)
    const units = Array.isArray(mesh.material)
      ? geo.groups.map(g => ({ start: g.start / 3, end: (g.start + g.count) / 3, material: mesh.material[g.materialIndex] }))
      : [{ start: 0, end: (geo.getIndex() ? geo.getIndex().count : pos.count) / 3, material: mesh.material }];

    /* IMPORTANTE: sempre materializa em Float32 via subset — clone()+
       applyMatrix4 direto CORROMPE malhas KHR_mesh_quantization (o three
       regrava metros num Int16 normalizado e clampa tudo em ±1). */
    for (const u of units) {
      const body = [], wheel = [[], [], [], []];
      for (let t = u.start; t < u.end; t++) {
        const k = triWheel.get(t);
        if (k === undefined) body.push(t); else wheel[k].push(t);
      }
      if (body.length)
        bodyParts.push({ geometry: subsetGeometry(geo, body).applyMatrix4(mesh.matrixWorld), material: u.material });
      for (let k = 0; k < 4; k++) if (wheel[k].length)
        wheelParts[k].push({ geometry: subsetGeometry(geo, wheel[k]).applyMatrix4(mesh.matrixWorld), material: u.material });
    }
  }

  /* pós-processa cada roda: pivô no centro real, desfaz esterço de fábrica,
     valida raio/largura/centro contra a calibração */
  const wheels = [];
  const all = new THREE.Box3(), _size = new THREE.Vector3();
  for (let k = 0; k < 4; k++) {
    const parts = wheelParts[k];
    const w = wheelCfg[k];
    let tris = 0;
    all.makeEmpty();
    for (const p of parts) {
      tris += (p.geometry.getIndex() ? p.geometry.getIndex().count : p.geometry.attributes.position.count) / 3;
      p.geometry.computeBoundingBox();
      all.union(p.geometry.boundingBox);
    }
    if (tris < 60) throw new Error(`roda ${k}: só ${tris} triângulos capturados em ${cfg.modelUrl}`);
    const center = all.getCenter(new THREE.Vector3());

    // geometria pro referencial do pivô + esterço de fábrica desfeito
    const rel = [];
    for (const p of parts) {
      p.geometry.translate(-center.x, -center.y, -center.z);
      const pa = p.geometry.attributes.position;
      for (let i = 0; i < pa.count; i++) rel.push({ x: pa.getX(i), z: pa.getZ(i) });
    }
    const bakedSteer = detectBakedSteer(rel);
    if (bakedSteer) for (const p of parts) p.geometry.rotateY(-bakedSteer);

    // resíduo de centragem pós-rotação (o bbox da roda virada superestimava)
    all.makeEmpty();
    for (const p of parts) { p.geometry.computeBoundingBox(); all.union(p.geometry.boundingBox); }
    const delta = all.getCenter(new THREE.Vector3());
    for (const p of parts) {
      p.geometry.translate(-delta.x, -delta.y, -delta.z);
      p.geometry.computeBoundingBox();
      p.geometry.computeBoundingSphere();
    }
    center.add(delta);
    const size = all.getSize(_size); // translação não muda o tamanho
    const radius = Math.max(size.x, size.y) / 2;
    const width = size.z;

    if (center.distanceTo(w.center) > 0.12)
      throw new Error(`roda ${k}: centro medido (${center.x.toFixed(2)},${center.y.toFixed(2)},${center.z.toFixed(2)}) longe da calibração em ${cfg.modelUrl}`);
    if (radius < w.r * 0.72 || radius > w.r * 1.35)
      throw new Error(`roda ${k}: raio medido ${radius.toFixed(3)} fora da faixa de ${w.r} em ${cfg.modelUrl}`);
    if (width > w.w * 1.6 + 0.05)
      throw new Error(`roda ${k}: largura medida ${width.toFixed(3)} acima de ${w.w} em ${cfg.modelUrl}`);
    if (Math.abs(bakedSteer) > 0.7)
      throw new Error(`roda ${k}: esterço de fábrica improvável ${bakedSteer.toFixed(2)} rad em ${cfg.modelUrl}`);
    wheels.push({ center, radius, width, bakedSteer, tris, parts, islands: captured[k] });
  }
  if (!bodyParts.length) throw new Error(`carroceria vazia após extração em ${cfg.modelUrl}`);
  return { bodyParts, wheels };
}
