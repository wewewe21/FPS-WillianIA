/* terreno: funcao de altura compartilhada (fBm de simplex), plataformas,
   grade de obstaculos e nivel da agua — a UNICA fonte de verdade do chao.
   Factory: a permutacao do SimplexNoise consome Math.random, que precisa
   estar SEEDADO (multiplayer) antes — por isso nao roda no import. */
import * as THREE from 'three';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';

export function createTerrain(deps) {
  const { lerp, clamp } = deps;
const simplex = new SimplexNoise();
function fbm(x, z, oct, freq, amp, lac = 2.0, gain = 0.5) {
  let s = 0, f = freq, a = amp;
  for (let i = 0; i < oct; i++) { s += simplex.noise(x * f, z * f) * a; f *= lac; a *= gain; }
  return s;
}
const CITY = { x: -340, z: 130 }; // distrito urbano (terreno aplainado)
/* VULCÃO no canto NE: montanha caminhável com poço de lava na cratera.
   O terreno segue um heightmap 2D rasterizado do próprio GLB (envelope
   superior dos triângulos por célula, pluma de erupção excluída) — o
   player sobe a encosta real do modelo em qualquer direção e pode cair
   na garganta da cratera, onde a lava queima. `lavaY` = teto do poço. */
const VOLCANO = { x: 420, z: -420, r: 114, baseY: 4, h: 0, lavaX: 422, lavaZ: -418.3, lavaR: 10, lavaY: 0 };
// bbox do modelo (unidades do GLB) — mesma referência usada no bake e no js/volcano.js
const VMODEL = { minX: -0.3601353, maxX: 0.4000860, minZ: -0.3202147, maxZ: 0.3189762, h: 0.2921 };
const VS = (VOLCANO.r * 2) / (VMODEL.maxX - VMODEL.minX); // escala mundo/modelo (~300x)
VOLCANO.h = VMODEL.h * VS;                                 // ~87.6 m de rocha
VOLCANO.lavaY = VOLCANO.baseY + VOLCANO.h * 0.5;           // abaixo disso, dentro da boca, é lava
const VN = 56, VBASE = 0.006; // grade NxN; fração de altura da saia do modelo
const VMAP = Uint8Array.from(atob('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'), ch => ch.charCodeAt(0));
const VOX = VOLCANO.x - VOLCANO.r;                         // origem da grade no mundo
const VOZ = VOLCANO.z - ((VMODEL.maxZ - VMODEL.minZ) / 2) * VS;
const VCX = (VMODEL.maxX - VMODEL.minX) * VS / (VN - 1);   // célula (m) em x/z
const VCZ = (VMODEL.maxZ - VMODEL.minZ) * VS / (VN - 1);
function volcanoHeightMap(x, z) {
  const fx = (x - VOX) / VCX, fz = (z - VOZ) / VCZ;
  if (fx < 0 || fz < 0 || fx > VN - 1 || fz > VN - 1) return VOLCANO.baseY;
  const i = Math.min(fx | 0, VN - 2), j = Math.min(fz | 0, VN - 2);
  const tx = fx - i, tz = fz - j, r0 = j * VN + i, r1 = r0 + VN;
  const a = VMAP[r0] + (VMAP[r0 + 1] - VMAP[r0]) * tx;
  const b = VMAP[r1] + (VMAP[r1 + 1] - VMAP[r1]) * tx;
  return VOLCANO.baseY + ((a + (b - a) * tz) / 255 - VBASE) * VOLCANO.h;
}
function heightAnalytic(x, z) {
  let h = fbm(x, z, 4, 0.0042, 9.5);          // colinas largas
  h += fbm(x + 310, z - 170, 3, 0.016, 2.1);  // detalhe médio
  h += Math.max(0, fbm(x - 800, z + 530, 2, 0.0021, 14)) * 1.25; // morros ocasionais
  // platô gramado na área de spawn (acampamento inicial / carro)
  const d0 = Math.hypot(x, z);
  const flat = THREE.MathUtils.smoothstep(d0, 12, 70);
  h = lerp(2.4, h, 0.1 + 0.9 * flat);
  // platô da cidade
  const dc = Math.hypot(x - CITY.x, z - CITY.z);
  if (dc < 130) {
    const cf = THREE.MathUtils.smoothstep(dc, 62, 125);
    h = lerp(3.2, h, 0.05 + 0.95 * cf);
  }
  // vulcão domina o terreno; a saia mistura de volta nas colinas
  const dv = Math.hypot(x - VOLCANO.x, z - VOLCANO.z);
  if (dv < VOLCANO.r * 1.2) {
    const vf = THREE.MathUtils.smoothstep(dv, VOLCANO.r * 0.9, VOLCANO.r * 1.2);
    h = lerp(Math.max(h, volcanoHeightMap(x, z)), h, vf);
  }
  return h;
}
/* Grade CANÔNICA do terreno: as MESMAS (SEGS+1)² amostras alimentam a malha
   visual, o CANNON.Heightfield e heightAt() — que interpola o TRIÂNGULO REAL
   da célula (diagonal b–d do PlaneGeometry, a mesma do Cannon). É construída
   UMA vez, ANTES de qualquer consumidor, e nunca troca de semântica: física,
   render e consultas descrevem exatamente a mesma superfície.
   (Também é ~20x mais rápida que a analítica; a GERAÇÃO do mundo continua
   usando a analítica na ordem original — determinismo multiplayer intacto.) */
let S = null; // { n, half, cell, data: Float32Array }
function buildHeightGrid(worldSize, segs = Math.round(worldSize / 5)) {
  if (S) return; // imutável: reconstruir mudaria a semântica no meio do jogo
  const n = segs + 1, half = worldSize / 2, cell = worldSize / segs;
  const data = new Float32Array(n * n);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++)
      data[j * n + i] = heightAnalytic(-half + i * cell, -half + j * cell);
  S = { n, half, cell, data };
}
function sampleAt(i, j) { return S.data[j * S.n + i]; }
/* localiza a célula e devolve os 4 cantos + coords locais (tx,tz) */
function cellAt(x, z) {
  const fx = (x + S.half) / S.cell, fz = (z + S.half) / S.cell;
  const i = Math.min(fx | 0, S.n - 2), j = Math.min(fz | 0, S.n - 2);
  const r0 = j * S.n + i;
  return { tx: fx - i, tz: fz - j, ha: S.data[r0], hd: S.data[r0 + 1], hb: S.data[r0 + S.n], hc: S.data[r0 + S.n + 1] };
}
function heightAt(x, z) {
  if (!S || x < -S.half || x >= S.half || z < -S.half || z >= S.half)
    return heightAnalytic(x, z);
  const c = cellAt(x, z);
  // diagonal b–d (mesma do PlaneGeometry): tri(a,b,d) se tx+tz≤1, senão tri(b,c,d)
  return (c.tx + c.tz <= 1)
    ? c.ha + (c.hd - c.ha) * c.tx + (c.hb - c.ha) * c.tz
    : c.hc + (c.hb - c.hc) * (1 - c.tx) + (c.hd - c.hc) * (1 - c.tz);
}
/* normal GEOMÉTRICA do triângulo real (física/dirigibilidade). A visual
   suavizada continua em terrainNormal() — são propositalmente diferentes. */
function geometricNormalAt(x, z, out) {
  if (!S || x < -S.half || x >= S.half || z < -S.half || z >= S.half) {
    // fora da grade: gradiente analítico central (borda do mundo)
    const e = 0.6;
    const dx = heightAnalytic(x + e, z) - heightAnalytic(x - e, z);
    const dz = heightAnalytic(x, z + e) - heightAnalytic(x, z - e);
    const l = Math.hypot(dx / (2 * e), 1, dz / (2 * e));
    return out.set(-dx / (2 * e) / l, 1 / l, -dz / (2 * e) / l);
  }
  const c = cellAt(x, z);
  // gradiente constante por triângulo: dh/dx e dh/dz do plano
  let gx, gz;
  if (c.tx + c.tz <= 1) { gx = (c.hd - c.ha) / S.cell; gz = (c.hb - c.ha) / S.cell; }
  else { gx = (c.hc - c.hb) / S.cell; gz = (c.hc - c.hd) / S.cell; }
  const l = Math.hypot(gx, 1, gz);
  return out.set(-gx / l, 1 / l, -gz / l);
}
const _gn = { x: 0, y: 1, z: 0, set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; } };
function slopeDegreesAt(x, z) {
  geometricNormalAt(x, z, _gn);
  return Math.acos(Math.min(1, _gn.y)) * 180 / Math.PI;
}
/* contrato único de consulta da superfície (biomas entram via setBiomes) */
let biomesClassify = null;
function setBiomes(fn) { biomesClassify = fn; }
function surfaceAt(x, z) {
  const height = heightAt(x, z);
  const slopeDegrees = slopeDegreesAt(x, z);
  const out = {
    height, slopeDegrees,
    waterDepth: Math.max(0, WATER_LEVEL - height),
    biomeId: 'prairie', biomeWeights: null, surfaceType: 'terrain',
    driveable: height > WATER_LEVEL && slopeDegrees <= 20,
    vegetationFactor: height > WATER_LEVEL + 0.25 ? 1 : 0,
  };
  if (biomesClassify) {
    const b = biomesClassify(x, z, out);
    out.biomeId = b.id; out.biomeWeights = b.weights;
    out.surfaceType = b.surfaceType; out.vegetationFactor = b.vegetationFactor;
    out.driveable = out.driveable && b.driveable;
    out.desertK = b.desertK; out.forestK = b.forestK; // curvas cruas p/ grama/cores
  }
  return out;
}
/* plataformas pisáveis (andares e rampas de prédios) além do terreno */
const platforms = []; // {x0,x1,z0,z1, y} | rampa: {ramp:true, axis:'x'|'z', y0, y1}
function groundAt(x, z, curY) {
  let g = heightAt(x, z);
  for (const p of platforms) {
    if (x < p.x0 || x > p.x1 || z < p.z0 || z > p.z1) continue;
    let top = p.y;
    if (p.ramp) {
      const k = p.axis === 'x' ? (x - p.x0) / (p.x1 - p.x0) : (z - p.z0) / (p.z1 - p.z0);
      top = lerp(p.y0, p.y1, clamp(k, 0, 1));
    }
    if (top > g && top <= curY + 0.65) g = top;
  }
  return g;
}
function slopeAt(x, z) {
  const e = 0.6;
  const dx = heightAt(x + e, z) - heightAt(x - e, z);
  const dz = heightAt(x, z + e) - heightAt(x, z - e);
  return Math.hypot(dx, dz) / (2 * e);
}
function terrainNormal(x, z, out) {
  const e = 0.6;
  const dx = heightAt(x + e, z) - heightAt(x - e, z);
  const dz = heightAt(x, z + e) - heightAt(x, z - e);
  return out.set(-dx / (2 * e), 1, -dz / (2 * e)).normalize();
}
/* biomas: < -0.2 deserto | > 0.34 floresta | meio: pradaria */
function biomeAt(x, z) {
  return simplex.noise(x * 0.0016 + 41.7, z * 0.0016 - 12.3);
}

  const WATER_LEVEL = -5;


/* colisores círculo (árvores/pedras/cactos) num hash espacial */
const obstacleGrid = new Map(); // hash espacial p/ colisão do player
const OBST_CELL = 16;
function addObstacle(x, z, r, meta) {
  const k = `${Math.floor(x / OBST_CELL)}_${Math.floor(z / OBST_CELL)}`;
  if (!obstacleGrid.has(k)) obstacleGrid.set(k, []);
  // meta opcional: { category, sourceId } — diagnóstico da matriz de colisão
  obstacleGrid.get(k).push(meta ? { x, z, r, ...meta } : { x, z, r });
}
function obstaclesNear(x, z) {
  const gx = Math.floor(x / OBST_CELL), gz = Math.floor(z / OBST_CELL);
  const out = [];
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const c = obstacleGrid.get(`${gx + i}_${gz + j}`);
    if (c) out.push(...c);
  }
  return out;
}
  return { simplex, fbm, heightAt, heightAnalytic, buildHeightGrid, groundAt,
    slopeAt, terrainNormal, biomeAt,
    sampleAt, geometricNormalAt, slopeDegreesAt, surfaceAt, setBiomes,
    platforms, WATER_LEVEL, addObstacle, obstaclesNear, CITY, VOLCANO };
}
