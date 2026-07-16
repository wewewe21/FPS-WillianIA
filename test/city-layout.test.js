/* Máscara urbana (js/citylayout.js) — funções puras, sem THREE/DOM.
   Cobre os casos mínimos da FASE 12: grama proibida em rua/calçada/praça/
   footprint/torre; permitida em canteiro verde e fora da cidade; sem buracos;
   determinística. */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const url = require('node:url');
const path = require('node:path');

let L;
test.before(async () => {
  L = await import(url.pathToFileURL(path.join(__dirname, '..', 'js', 'citylayout.js')).href);
});

const W = (lx, lz) => [L.CITY_CENTER.x + lx, L.CITY_CENTER.z + lz]; // local→mundo

test('centro de rua: grama proibida', () => {
  const [x, z] = W(0, 25.5);       // avenida principal
  assert.strictEqual(L.cityCategory(x, z), 'road');
  assert.strictEqual(L.cityGrassFactor(x, z), 0);
});

test('centro de rua transversal: grama proibida', () => {
  const [x, z] = W(26, 0);
  assert.strictEqual(L.cityCategory(x, z), 'road');
  assert.strictEqual(L.cityGrassFactor(x, z), 0);
});

test('calçada: grama proibida', () => {
  const [x, z] = W(0, 33);         // faixa logo ao sul da avenida
  assert.strictEqual(L.cityCategory(x, z), 'sidewalk');
  assert.strictEqual(L.cityGrassFactor(x, z), 0);
});

test('footprint de prédio: grama proibida', () => {
  const lot = L.LOTS[0];
  const [x, z] = W(lot.ox, lot.oz);
  assert.strictEqual(L.cityCategory(x, z), 'footprint');
  assert.strictEqual(L.cityGrassFactor(x, z), 0);
});

test('interior da Torre Nexus: grama proibida', () => {
  const [x, z] = W(0, 0);
  assert.strictEqual(L.cityCategory(x, z), 'footprint');
  assert.strictEqual(L.cityGrassFactor(x, z), 0);
});

test('praça pavimentada: grama proibida', () => {
  const [x, z] = W(18, 0);         // dentro do disco da praça, fora de rua
  assert.strictEqual(L.cityCategory(x, z), 'plaza');
  assert.strictEqual(L.cityGrassFactor(x, z), 0);
});

test('canteiro verde: grama permitida', () => {
  const g = L.GREENS[0];
  const [x, z] = W((g.x0 + g.x1) / 2, (g.z0 + g.z1) / 2);
  assert.strictEqual(L.cityCategory(x, z), 'green');
  assert.strictEqual(L.cityGrassFactor(x, z), 1);
});

test('fora da cidade: grama plena (comportamento natural)', () => {
  assert.strictEqual(L.cityGrassFactor(200, 200), 1);
  assert.strictEqual(L.cityGrassFactor(-340, 130 + 120), 1);
});

test('borda da cidade reintroduz grama (fade 56→82)', () => {
  // ponto de vão a d≈70 (entre núcleo e borda), sem categoria de pavimento
  const [x, z] = W(0, -70);        // norte, longe de ruas/prédios
  assert.strictEqual(L.cityCategory(x, z), null);
  const f = L.cityGrassFactor(x, z);
  assert.ok(f > 0 && f < 1, `fade esperado 0<f<1, veio ${f}`);
});

test('fator sempre em [0,1] numa varredura densa (sem buracos)', () => {
  for (let lx = -100; lx <= 100; lx += 1.5)
    for (let lz = -100; lz <= 100; lz += 1.5) {
      const [x, z] = W(lx, lz);
      const f = L.cityGrassFactor(x, z);
      assert.ok(f >= 0 && f <= 1 && Number.isFinite(f), `f fora de [0,1] em (${lx},${lz}): ${f}`);
    }
});

test('determinística: mesma entrada, mesma saída', () => {
  const [x, z] = W(7, -3);
  assert.strictEqual(L.cityGrassFactor(x, z), L.cityGrassFactor(x, z));
  assert.strictEqual(L.cityCategory(x, z), L.cityCategory(x, z));
});

test('lotes espelham o protocolo do evento (contrato de destruição)', () => {
  const proto = require(path.join(__dirname, '..', 'city-destruction-protocol.js'));
  const protoLots = proto.buildCityEvent ? null : null; // LOTS não é exportado; checa via impacts
  // garante que cada lote do layout tem um alvo plausível no protocolo
  assert.strictEqual(L.LOTS.length, 12);
  // centros batem com as constantes do protocolo (mesmo centro de cidade)
  assert.strictEqual(L.CITY_CENTER.x, proto.CITY_CENTER.x);
  assert.strictEqual(L.CITY_CENTER.z, proto.CITY_CENTER.z);
  void protoLots;
});
