/* Fonte única do terreno: o CANNON.Heightfield precisa descrever EXATAMENTE
   a mesma superfície do PlaneGeometry visual — mesma grade (5 m), mesmos
   vértices e mesma diagonal de triangulação. Antes, física (grade de 4 m) e
   visual (5 m) divergiam dezenas de centímetros dentro das células e os
   carros flutuavam/afundavam. */
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { CHROME, bootGame } = require('./helpers/harness');

describe('Heightfield físico = malha visual do terreno', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h;
  before(async () => { h = await bootGame({ port: 3169 }); });
  after(async () => { if (h) await h.close(); });

  it('dado o heightfield, então elementSize é a MESMA célula do PlaneGeometry', async () => {
    const r = await h.play(() => {
      const MP = window.QA.MP;
      const hf = MP.world.bodies.find(b => b.shapes[0] && b.shapes[0].elementSize !== undefined);
      const g = window.QA.G.terrainMesh.geometry;
      return {
        elementSize: hf && hf.shapes[0].elementSize,
        esperado: MP.CFG.WORLD_SIZE / MP.CFG.TERRAIN_SEGS,
        pontosFisica: hf && hf.shapes[0].data.length,
        pontosVisual: Math.sqrt(g.attributes.position.count),
      };
    });
    assert.equal(r.elementSize, r.esperado, 'célula do heightfield ≠ célula do PlaneGeometry');
    assert.equal(r.pontosFisica, r.pontosVisual, 'quantidade de amostras difere');
  });

  it('dada qualquer posição (vértice, interior e AMBOS os lados da diagonal), então física e visual coincidem', async () => {
    const r = await h.play(() => {
      const MP = window.QA.MP, G = window.QA.G;
      const CANNON_WORLD = MP.world;
      const geo = G.terrainMesh.geometry;
      const pos = geo.attributes.position, idx = geo.getIndex();
      const segs = MP.CFG.TERRAIN_SEGS, size = MP.CFG.WORLD_SIZE, half = size / 2, cell = size / segs;

      /* altura EXATA da malha visual em (x,z): acha o quad, testa os 2
         triângulos reais do índice com coordenadas baricêntricas */
      function visualY(x, z) {
        const ix = Math.min(segs - 1, Math.floor((x + half) / cell));
        const iz = Math.min(segs - 1, Math.floor((z + half) / cell));
        const quad = (iz * segs + ix) * 6;
        for (let t = 0; t < 2; t++) {
          const a = idx.getX(quad + t * 3), b = idx.getX(quad + t * 3 + 1), c = idx.getX(quad + t * 3 + 2);
          const ax = pos.getX(a), az = pos.getZ(a);
          const bx = pos.getX(b), bz = pos.getZ(b);
          const cx = pos.getX(c), cz = pos.getZ(c);
          const det = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
          if (Math.abs(det) < 1e-9) continue;
          const w1 = ((x - ax) * (cz - az) - (cx - ax) * (z - az)) / det;
          const w2 = ((bx - ax) * (z - az) - (x - ax) * (bz - az)) / det;
          if (w1 < -1e-6 || w2 < -1e-6 || w1 + w2 > 1 + 1e-6) continue;
          return pos.getY(a) + w1 * (pos.getY(b) - pos.getY(a)) + w2 * (pos.getY(c) - pos.getY(a));
        }
        return null;
      }
      const hfBody = CANNON_WORLD.bodies.find(b => b.shapes[0] && b.shapes[0].elementSize !== undefined);
      const CANNON = Object.getPrototypeOf(hfBody.position).constructor; // Vec3
      const from = new CANNON(), to = new CANNON();
      function physicsY(x, z) {
        from.set(x, 150, z); to.set(x, -40, z); // acima do vulcão (~92 m)
        let best = null;
        CANNON_WORLD.raycastAll(from, to, {}, res => {
          if (res.body === hfBody && (best === null || res.hitPointWorld.y > best)) best = res.hitPointWorld.y;
        });
        return best;
      }
      /* amostra determinística: perto do vértice + interiores nos DOIS lados
         da diagonal (fx+fz<1 e >1). Nada EXATO sobre a aresta compartilhada:
         o raycast do cannon pode falhar no caso degenerado de borda. */
      const offsets = [[0.001, 0.001], [0.25, 0.25], [0.75, 0.75], [0.2, 0.65], [0.65, 0.2], [0.45, 0.45], [0.55, 0.62]];
      let worst = 0, testados = 0, semHit = 0;
      const piores = [], semHitEx = [];
      for (let i = 3; i < segs - 3; i += 17) {
        for (let j = 5; j < segs - 3; j += 19) {
          for (const [ox, oz] of offsets) {
            const x = -half + (i + ox) * cell, z = -half + (j + oz) * cell;
            const vy = visualY(x, z);
            const py = physicsY(x, z);
            if (vy === null) continue;
            if (py === null) {
              semHit++;
              if (semHitEx.length < 8) semHitEx.push({ x: +x.toFixed(2), z: +z.toFixed(2), i, j, ox, oz, vy: +vy.toFixed(2) });
              continue;
            }
            const d = Math.abs(vy - py);
            testados++;
            if (d > worst) { worst = d; }
            if (d > 0.02 && piores.length < 5) piores.push({ x: +x.toFixed(1), z: +z.toFixed(1), vy: +vy.toFixed(3), py: +py.toFixed(3) });
          }
        }
      }
      return { testados, semHit, worst, piores, semHitEx };
    });
    assert.ok(r.testados > 400, `amostragem insuficiente (${r.testados})`);
    assert.equal(r.semHit, 0, `${r.semHit} raios sem hit no heightfield — ex.: ${JSON.stringify(r.semHitEx)}`);
    assert.ok(r.worst <= 0.02,
      `física diverge do visual em até ${(r.worst * 100).toFixed(1)}cm — ex.: ${JSON.stringify(r.piores)}`);
  });

  it('dado heightAt() PÚBLICO (pós-init), então coincide com a malha visual em ambos os lados da diagonal', async () => {
    // no código antigo o buildHeightGrid tardio trocava heightAt pra bilinear
    // de 2,5 m — divergia da malha/física trianguladas de 5 m DENTRO das células
    const r = await h.play(() => {
      const MP = window.QA.MP, G = window.QA.G;
      const geo = G.terrainMesh.geometry;
      const pos = geo.attributes.position, idx = geo.getIndex();
      const segs = MP.CFG.TERRAIN_SEGS, size = MP.CFG.WORLD_SIZE, half = size / 2, cell = size / segs;
      function visualY(x, z) {
        const ix = Math.min(segs - 1, Math.floor((x + half) / cell));
        const iz = Math.min(segs - 1, Math.floor((z + half) / cell));
        const quad = (iz * segs + ix) * 6;
        for (let t = 0; t < 2; t++) {
          const a = idx.getX(quad + t * 3), b = idx.getX(quad + t * 3 + 1), c = idx.getX(quad + t * 3 + 2);
          const ax = pos.getX(a), az = pos.getZ(a);
          const bx = pos.getX(b), bz = pos.getZ(b);
          const cx = pos.getX(c), cz = pos.getZ(c);
          const det = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
          if (Math.abs(det) < 1e-9) continue;
          const w1 = ((x - ax) * (cz - az) - (cx - ax) * (z - az)) / det;
          const w2 = ((bx - ax) * (z - az) - (x - ax) * (bz - az)) / det;
          if (w1 < -1e-6 || w2 < -1e-6 || w1 + w2 > 1 + 1e-6) continue;
          return pos.getY(a) + w1 * (pos.getY(b) - pos.getY(a)) + w2 * (pos.getY(c) - pos.getY(a));
        }
        return null;
      }
      const offsets = [[0.2, 0.2], [0.7, 0.7], [0.15, 0.6], [0.6, 0.15], [0.45, 0.45]];
      let worst = 0, testados = 0;
      const piores = [];
      for (let i = 3; i < segs - 3; i += 13) {
        for (let j = 5; j < segs - 3; j += 11) {
          for (const [ox, oz] of offsets) {
            const x = -half + (i + ox) * cell, z = -half + (j + oz) * cell;
            const vy = visualY(x, z);
            if (vy === null) continue;
            const d = Math.abs(vy - G.heightAt(x, z));
            testados++;
            if (d > worst) worst = d;
            if (d > 0.02 && piores.length < 5) piores.push({ x: +x.toFixed(1), z: +z.toFixed(1), d: +d.toFixed(3) });
          }
        }
      }
      return { testados, worst, piores };
    });
    assert.ok(r.testados > 800, `amostragem insuficiente (${r.testados})`);
    assert.ok(r.worst <= 0.02,
      `heightAt público diverge da malha em até ${(r.worst * 100).toFixed(1)}cm — ex.: ${JSON.stringify(r.piores)}`);
  });
});
