/* ================================================================
   QA — superfície CANÔNICA do terreno (js/terrain.js) em Node puro.
   Uma única grade de amostras (a mesma da malha e do Cannon) e um
   heightAt() que interpola o TRIÂNGULO REAL da célula (diagonal b–d
   do PlaneGeometry). A semântica não pode trocar durante a execução.
   ================================================================ */
'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert');

function seedRandom(seed) {
  let s = seed >>> 0;
  const orig = Math.random;
  Math.random = function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => { Math.random = orig; };
}
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const SIZE = 1100, SEGS = 220, CELL = SIZE / SEGS, HALF = SIZE / 2;

let createTerrain, createBiomes;
before(async () => {
  ({ createTerrain } = await import('../js/terrain.js'));
  ({ createBiomes } = await import('../js/biomes.js'));
});
const smoothstep = (x, a, b) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// máscara de cidade fake p/ node: núcleo 20 m = rua, resto null
const fakeCityCategory = (x, z) => (Math.hypot(x - (-340), z - 130) < 20 ? 'road' : null);
function makeSurface(seed = 424242) {
  const t = makeTerrain(seed);
  t.buildHeightGrid(SIZE);
  const b = createBiomes({ simplex: t.simplex, heightAt: t.heightAt, slopeAt: t.slopeAt,
    WATER_LEVEL: t.WATER_LEVEL, CITY: t.CITY, VOLCANO: t.VOLCANO,
    cityCategory: fakeCityCategory, smoothstep });
  t.setBiomes(b.classifyAt);
  return t;
}

function makeTerrain(seed = 424242) {
  const restore = seedRandom(seed);
  const t = createTerrain({ lerp, clamp });
  restore();
  return t;
}

describe('Superfície canônica do terreno', () => {
  it('dada a mesma seed, então a superfície é idêntica; seeds diferentes divergem', () => {
    const t1 = makeTerrain(424242), t2 = makeTerrain(424242), t3 = makeTerrain(99);
    t1.buildHeightGrid(SIZE); t2.buildHeightGrid(SIZE); t3.buildHeightGrid(SIZE);
    let diff99 = 0;
    for (let k = 0; k < 200; k++) {
      const x = ((k * 137.51) % 1000) - 500, z = ((k * 91.17) % 1000) - 500;
      assert.equal(t1.heightAt(x, z), t2.heightAt(x, z), `seed igual divergiu em ${x},${z}`);
      if (Math.abs(t1.heightAt(x, z) - t3.heightAt(x, z)) > 0.01) diff99++;
    }
    assert.ok(diff99 > 100, 'seed diferente deveria mudar o terreno');
  });

  it('dado buildHeightGrid, então heightAt NÃO troca de semântica (vértices exatos, 2ª chamada no-op)', () => {
    const t = makeTerrain();
    // amostra os valores analíticos nos vértices ANTES da grade
    const verts = [];
    for (let k = 0; k < 60; k++) {
      const i = (k * 37) % (SEGS + 1), j = (k * 61) % (SEGS + 1);
      verts.push([-HALF + i * CELL, -HALF + j * CELL]);
    }
    const before = verts.map(([x, z]) => t.heightAt(x, z));
    t.buildHeightGrid(SIZE);
    const after = verts.map(([x, z]) => t.heightAt(x, z));
    for (let k = 0; k < verts.length; k++)
      assert.ok(Math.abs(before[k] - after[k]) < 1e-6,
        `vértice ${verts[k]} mudou com a grade: ${before[k]} → ${after[k]}`);
    // pontos NÃO-vértice: capturar agora e garantir que a 2ª chamada não muda nada
    const mids = verts.map(([x, z]) => t.heightAt(x + CELL * 0.31, z + CELL * 0.47));
    t.buildHeightGrid(SIZE, 440); // tentativa de reconstruir em outra resolução: no-op
    for (let k = 0; k < verts.length; k++) {
      assert.equal(t.heightAt(verts[k][0] + CELL * 0.31, verts[k][1] + CELL * 0.47), mids[k],
        'buildHeightGrid trocou a semântica numa 2ª chamada');
    }
  });

  it('dado qualquer ponto, então heightAt == interpolação do TRIÂNGULO real (diagonal b–d), nos 2 lados', () => {
    const t = makeTerrain();
    t.buildHeightGrid(SIZE);
    let checked = 0;
    for (let k = 0; k < 300; k++) {
      const i = 1 + ((k * 37) % (SEGS - 2)), j = 1 + ((k * 61) % (SEGS - 2));
      const x0 = -HALF + i * CELL, z0 = -HALF + j * CELL;
      const ha = t.heightAt(x0, z0), hd = t.heightAt(x0 + CELL, z0);
      const hb = t.heightAt(x0, z0 + CELL), hc = t.heightAt(x0 + CELL, z0 + CELL);
      // 2 pontos no tri(a,b,d) [tx+tz<1] e 2 no tri(b,c,d) [tx+tz>1]
      for (const [tx, tz] of [[0.2, 0.2], [0.55, 0.1], [0.8, 0.8], [0.4, 0.9]]) {
        const want = (tx + tz <= 1)
          ? ha + (hd - ha) * tx + (hb - ha) * tz
          : hc + (hb - hc) * (1 - tx) + (hd - hc) * (1 - tz);
        const got = t.heightAt(x0 + tx * CELL, z0 + tz * CELL);
        assert.ok(Math.abs(got - want) < 1e-6,
          `célula ${i},${j} (tx=${tx},tz=${tz}): heightAt=${got} ≠ triângulo=${want}`);
        checked++;
      }
    }
    assert.ok(checked >= 1200);
  });

  it('dadas bordas/cidade/vulcão/spawn/fora do mapa, então tudo é finito', () => {
    const t = makeTerrain();
    t.buildHeightGrid(SIZE);
    const pts = [[0, 0], [-340, 130], [420, -420], [422, -418], [-549.9, -549.9], [549.9, 549.9],
      [-550, 0], [0, 549.99], [-700, 300], [1200, -1200]];
    for (const [x, z] of pts) {
      const s = t.surfaceAt(x, z);
      assert.ok(Number.isFinite(s.height), `height NaN em ${x},${z}`);
      assert.ok(Number.isFinite(s.slopeDegrees) && s.slopeDegrees >= 0 && s.slopeDegrees < 90);
      assert.ok(Number.isFinite(s.waterDepth) && s.waterDepth >= 0);
    }
  });

  it('dada geometricNormalAt, então é unitária, aponta pra cima e é ortogonal ao triângulo', () => {
    const t = makeTerrain();
    t.buildHeightGrid(SIZE);
    for (let k = 0; k < 100; k++) {
      // ponto ANCORADO na célula, dentro do tri(a,b,d): (0.2,0.2)+e nunca cruza a diagonal
      const i = 1 + ((k * 37) % (SEGS - 2)), j = 1 + ((k * 61) % (SEGS - 2));
      const x = -HALF + (i + 0.2) * CELL, z = -HALF + (j + 0.2) * CELL;
      const n = t.geometricNormalAt(x, z, { x: 0, y: 0, z: 0, set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; } });
      const len = Math.hypot(n.x, n.y, n.z);
      assert.ok(Math.abs(len - 1) < 1e-6, 'normal não-unitária');
      assert.ok(n.y > 0, 'normal apontando pra baixo');
      // ortogonalidade: dois vetores DENTRO do plano do MESMO triângulo
      const e = 0.2 * CELL; // (0.2,0.2)→(0.4,0.2)/(0.2,0.4): soma ≤0.6 < 1 ✓
      const h0 = t.heightAt(x, z), hx = t.heightAt(x + e, z), hz = t.heightAt(x, z + e);
      const d1 = { x: e, y: hx - h0, z: 0 }, d2 = { x: 0, y: hz - h0, z: e };
      const dot1 = Math.abs(n.x * d1.x + n.y * d1.y + n.z * d1.z) / e;
      const dot2 = Math.abs(n.x * d2.x + n.y * d2.y + n.z * d2.z) / e;
      assert.ok(dot1 < 1e-6 && dot2 < 1e-6, `normal não-ortogonal em ${x},${z}: ${dot1}, ${dot2}`);
    }
  });

  it('dados os biomas centrais, então pesos válidos, prioridade certa e transições suaves', () => {
    const t = makeSurface();
    // pesos: finitos, [0,1], soma 1
    for (let k = 0; k < 150; k++) {
      const x = ((k * 137.51) % 1000) - 500, z = ((k * 91.17) % 1000) - 500;
      const s = t.surfaceAt(x, z);
      let sum = 0;
      for (const key in s.biomeWeights) {
        const v = s.biomeWeights[key];
        assert.ok(Number.isFinite(v) && v >= 0 && v <= 1, `peso ${key}=${v} em ${x},${z}`);
        sum += v;
      }
      assert.ok(Math.abs(sum - 1) < 1e-5, `pesos somam ${sum} em ${x},${z}`);
      assert.ok(Number.isFinite(s.vegetationFactor) && s.vegetationFactor >= 0 && s.vegetationFactor <= 1);
    }
    // prioridades
    const cratera = t.surfaceAt(420, -420);
    assert.ok(cratera.biomeWeights.volcanic > 0.9, 'cratera não é volcanic');
    assert.equal(cratera.vegetationFactor, 0, 'grama no cone do vulcão');
    const rua = t.surfaceAt(-340, 130);
    assert.ok(rua.biomeWeights.urban > 0.9, 'centro da cidade não é urban');
    assert.equal(rua.surfaceType, 'street');
    assert.equal(rua.vegetationFactor, 0, 'grama na rua');
    // água: acha um ponto submerso
    let wet = null;
    for (let k = 0; k < 4000 && !wet; k++) {
      const x = ((k * 137.51) % 1000) - 500, z = ((k * 91.17) % 1000) - 500;
      if (t.heightAt(x, z) < t.WATER_LEVEL - 0.5) wet = [x, z];
    }
    assert.ok(wet, 'nenhum lago achado na seed 424242');
    const agua = t.surfaceAt(wet[0], wet[1]);
    assert.ok(agua.biomeWeights.water > 0.9, 'submerso não é water');
    assert.equal(agua.driveable, false, 'água dirigível');
    assert.equal(agua.vegetationFactor, 0, 'grama na água');
    assert.ok(agua.waterDepth > 0);
    // CONTINUIDADE (sem linha dura): passo de 0.5 m — um degrau discreto
    // apareceria como salto grande num passo pequeno; morro íngreme legítimo
    // muda rápido por METRO, mas continua contínuo por AMOSTRA
    for (const key of ['desert', 'forest', 'prairie', 'alpine']) {
      let prev = null;
      for (let d = 0; d <= 200; d += 0.5) {
        const s = t.surfaceAt(-500 + d, 250);
        const v = s.biomeWeights[key];
        if (prev !== null) assert.ok(Math.abs(v - prev) < 0.12, `salto de ${key} em d=${d}: ${prev}→${v}`);
        prev = v;
      }
    }
  });

  it('dado slopeDegreesAt, então coerente com o gradiente do triângulo', () => {
    const t = makeTerrain();
    t.buildHeightGrid(SIZE);
    for (let k = 0; k < 60; k++) {
      const x = ((k * 197.3) % 900) - 450, z = ((k * 53.7) % 900) - 450;
      const deg = t.slopeDegreesAt(x, z);
      const n = t.geometricNormalAt(x, z, { set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; } });
      const want = Math.acos(Math.min(1, n.y)) * 180 / Math.PI;
      assert.ok(Math.abs(deg - want) < 1e-6, `slopeDegrees ${deg} ≠ acos(n.y) ${want}`);
    }
  });
});
