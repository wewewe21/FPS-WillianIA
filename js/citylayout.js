/* ================================================================
   CITY_LAYOUT — fonte única do desenho urbano (dados + máscara espacial).
   PURO: sem THREE, sem DOM, sem Math.random. Determinístico e testável
   (node:test). Consumido por js/structures.js (gera ruas/prédios/props),
   por game.js (pintura do terreno) e pela grama (via cityGrassFactor).

   Coordenadas: LOCAIS = relativas ao centro da cidade (+x leste, +z sul).
   Funções expostas trabalham em coordenadas de MUNDO (subtraem o centro).

   CONTRATO MULTIPLAYER/EVENTO: os CENTROS dos 12 lotes (LOTS) espelham
   js/structures.js e city-destruction-protocol.js. Não mova centros de lote
   sem atualizar os três — o evento de destruição mira por eles.
   ================================================================ */

// centro fixo do distrito (espelho de CITY em js/terrain.js)
export const CITY_CENTER = { x: -340, z: 130 };
export const CITY_RADIUS = 95;

// núcleo pavimentado: dentro disso a grama só brota em canteiros/parques
export const CORE_RADIUS = 58;
// além disso a grama volta suavemente (borda verde ao redor da cidade)
export const GRASS_FADE0 = 56, GRASS_FADE1 = 82;

/* 12 lotes: centro (ox,oz) + largura + altura + arquétipo + fachada voltada.
   Os centros são o CONTRATO; largura/altura/arquétipo são livres.
   face: direção da entrada — 'N'|'S'|'E'|'O' (norte=-z, sul=+z, leste=+x). */
export const LOTS = [
  { ox: -34, oz: -28, w: 11, h: 22, arch: 'office',  face: 'E' },
  { ox: -16, oz: -34, w: 12, h: 16, arch: 'resid',   face: 'S' },
  { ox: 4,   oz: -30, w: 10, h: 26, arch: 'office',  face: 'S' },
  { ox: 38,  oz: -26, w: 13, h: 18, arch: 'commerc', face: 'S' },
  { ox: -40, oz: -2,  w: 10, h: 14, arch: 'service', face: 'E' },
  { ox: -38, oz: 44,  w: 12, h: 20, arch: 'resid',   face: 'N' },
  { ox: -14, oz: 42,  w: 11, h: 24, arch: 'office',  face: 'N' },
  { ox: 8,   oz: 44,  w: 12, h: 15, arch: 'commerc', face: 'N' },
  { ox: 40,  oz: 8,   w: 11, h: 19, arch: 'corner',  face: 'O' },
  { ox: 42,  oz: 42,  w: 13, h: 28, arch: 'office',  face: 'O' },
  { ox: -44, oz: 18,  w: 9,  h: 12, arch: 'service', face: 'E' },
  { ox: 16,  oz: -8,  w: 9,  h: 13, arch: 'commerc', face: 'O' },
];

/* profundidade fixa (determinística) por lote — antes vinha de rand(0.8,1.1).
   Mantida estável pra colisão/telhado/máscara casarem em todos os clientes. */
export function lotDepth(lot) { return +(lot.w * 0.95).toFixed(2); }

/* ruas em coordenadas LOCAIS {x0,x1,z0,z1}. Centros mantêm as linhas antigas
   (avenida em z=+26, transversal em x=+26): threads pelos vãos entre prédios. */
export const ROADS = [
  { id: 'avenida', x0: -34, x1: 52, z0: 20, z1: 31 },  // principal, leste-oeste (11 larg)
  { id: 'cross',   x0: 21,  x1: 31, z0: -34, z1: 52 }, // transversal, norte-sul (10 larg)
  { id: 'apron',   x0: -13, x1: 13, z0: 9,  z1: 31 },  // liga porta sul da torre à avenida
];
const SIDEWALK_W = 2.4;   // largura da calçada que borda cada rua
const CURB_H = 0.16;      // altura do meio-fio

// praça: disco pavimentado ao redor da Torre Nexus (entrada desobstruída)
export const PLAZA = { r: 23 };
// canteiros verdes (grama permitida) — locais e pequenos
export const GREENS = [
  { x0: -19, x1: -11, z0: -17, z1: -9 },  // canteiro NO da praça
  { x0: 10,  x1: 18,  z0: -17, z1: -9 },  // canteiro NE da praça
  { x0: -31, x1: -18, z0: -15, z1: 1 },   // pracinha verde a oeste (lote livre)
];

/* ---------- helpers de geometria (locais) ---------- */
function inRect(lx, lz, r) { return lx >= r.x0 && lx <= r.x1 && lz >= r.z0 && lz <= r.z1; }
function inRectPad(lx, lz, r, p) { return lx >= r.x0 - p && lx <= r.x1 + p && lz >= r.z0 - p && lz <= r.z1 + p; }

export function footprintRect(lot, pad = 0) {
  const d = lotDepth(lot);
  return { x0: lot.ox - lot.w / 2 - pad, x1: lot.ox + lot.w / 2 + pad,
    z0: lot.oz - d / 2 - pad, z1: lot.oz + d / 2 + pad };
}

// torre no centro (footprint 18×18)
const TOWER_HALF = 9;

/* categorias em coordenadas LOCAIS (barato: só retângulos/discos) */
function localCategory(lx, lz) {
  // torre e prédios: footprint (sem grama, chão sob prédio)
  if (Math.abs(lx) <= TOWER_HALF + 0.5 && Math.abs(lz) <= TOWER_HALF + 0.5) return 'footprint';
  for (const lot of LOTS) if (inRect(lx, lz, footprintRect(lot, 0.6))) return 'footprint';
  // canteiros verdes têm prioridade sobre a praça/asfalto
  for (const g of GREENS) if (inRect(lx, lz, g)) return 'green';
  // ruas (asfalto)
  for (const r of ROADS) if (inRect(lx, lz, r)) return 'road';
  // calçadas: faixa ao redor das ruas
  for (const r of ROADS) if (inRectPad(lx, lz, r, SIDEWALK_W)) return 'sidewalk';
  // praça pavimentada ao redor da torre
  if (Math.hypot(lx, lz) <= PLAZA.r) return 'plaza';
  return null; // solo urbano comum (nem pavimento nem verde definido)
}

/* ================= API de MUNDO ================= */
export function cityCategory(x, z) { return localCategory(x - CITY_CENTER.x, z - CITY_CENTER.z); }

export function isCityPaved(x, z) {
  const c = cityCategory(x, z);
  return c === 'road' || c === 'sidewalk' || c === 'plaza';
}
export function isCityRoad(x, z) { return cityCategory(x, z) === 'road'; }
export function isCitySidewalk(x, z) { return cityCategory(x, z) === 'sidewalk'; }
export function isCityFootprint(x, z) { return cityCategory(x, z) === 'footprint'; }

/* fator de grama [0..1] consultado pela grama por lâmina.
   0 = colapsa (asfalto/calçada/praça/footprint); 1 = grama cheia.
   Núcleo urbano é pelado; canteiros verdes = 1; borda 56→82 volta ao verde. */
export function cityGrassFactor(x, z) {
  const lx = x - CITY_CENTER.x, lz = z - CITY_CENTER.z;
  const d = Math.hypot(lx, lz);
  if (d > GRASS_FADE1 + 8) return 1;              // fora da influência urbana
  const cat = localCategory(lx, lz);
  if (cat === 'green') return 1;                  // canteiro/parque: grama permitida
  if (cat) return 0;                              // pavimento ou footprint: sem grama
  // vão urbano sem categoria: pelado no núcleo, volta suave na borda
  if (d <= GRASS_FADE0) return 0;
  return Math.min(1, (d - GRASS_FADE0) / (GRASS_FADE1 - GRASS_FADE0));
}

export const CITY_CONST = { SIDEWALK_W, CURB_H, TOWER_HALF };
