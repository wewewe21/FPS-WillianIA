/* ================================================================
   QA — maptoys-core.js (matemática pura das 5 atrações do mapa).
   Roda em Node puro (sem porta, sem browser).
   ================================================================ */
'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

let M;
before(async () => { M = await import('../js/maptoys-core.js'); });

describe('Cama Elástica', () => {
  it('quica pra cima e nunca estoura o teto vertical do anti-cheat (120)', () => {
    assert.ok(M.bounceVelocity(1) > 0);
    assert.ok(M.bounceVelocity(1) < 120);
    assert.equal(M.bounceVelocity(99), 28, 'trava dura de segurança');
  });
});

describe('Aros de Acrobacia — passedRing', () => {
  const C = { x: 0, y: 5, z: 0 }, N = { x: 0, y: 0, z: 1 }, R = 2;
  it('detecta atravessar o buraco do aro', () => {
    assert.ok(M.passedRing({ x: 0, y: 5, z: -1 }, { x: 0, y: 5, z: 1 }, C, N, R));
  });
  it('não conta quando passa longe do centro (fora do buraco)', () => {
    assert.ok(!M.passedRing({ x: 5, y: 5, z: -1 }, { x: 5, y: 5, z: 1 }, C, N, R));
  });
  it('não conta quando o passo não cruza o plano', () => {
    assert.ok(!M.passedRing({ x: 0, y: 5, z: -3 }, { x: 0, y: 5, z: -1 }, C, N, R));
  });
  it('não conta movimento paralelo ao aro', () => {
    assert.ok(!M.passedRing({ x: -1, y: 5, z: 0 }, { x: 1, y: 5, z: 0 }, C, N, R));
  });
  it('ringAt sobe no meio e desce nas pontas do curso', () => {
    const o = { x: 0, y: 10, z: 0 }, d = { x: 1, z: 0 };
    const mid = M.ringAt(o, d, 3, 7).y, end = M.ringAt(o, d, 6, 7).y, start = M.ringAt(o, d, 0, 7).y;
    assert.ok(mid > start && mid > end, 'arco: meio mais alto');
  });
});

describe('Xilofone Gigante — plateAt', () => {
  const plates = [{ x: 0, z: 0, w: 2, d: 4 }, { x: 3, z: 0, w: 2, d: 4 }];
  it('acha a placa sob o jogador', () => {
    assert.equal(M.plateAt(0.3, 1, plates), 0);
    assert.equal(M.plateAt(3, -1, plates), 1);
  });
  it('devolve -1 fora de qualquer placa', () => {
    assert.equal(M.plateAt(10, 10, plates), -1);
    assert.equal(M.plateAt(1.6, 0, plates), -1); // no vão entre placas
  });
  it('escala é alegre (8 notas ascendentes, sem NaN)', () => {
    assert.equal(M.XYLO_NOTES.length, 8);
    for (let i = 1; i < M.XYLO_NOTES.length; i++) assert.ok(M.XYLO_NOTES[i] > M.XYLO_NOTES[i - 1]);
  });
});

describe('Recordes', () => {
  it('betterMax mantém o maior', () => {
    assert.equal(M.betterMax(10, 25), 25);
    assert.equal(M.betterMax(30, 5), 30);
    assert.equal(M.betterMax(undefined, 7), 7);
  });
  it('betterTime mantém o MENOR tempo positivo', () => {
    assert.equal(M.betterTime(0, 12), 12);      // sem recorde ainda
    assert.equal(M.betterTime(12, 9), 9);       // mais rápido
    assert.equal(M.betterTime(9, 15), 9);       // mais lento não bate
    assert.equal(M.betterTime(9, 0), 9);        // corrida inválida preserva
  });
});

describe('pickSpot re-exportado com avoid', () => {
  const flatDry = () => ({ h: 5, slope: 0.05 });
  it('respeita o avoid (não empilha atrações)', () => {
    const sites = [{ x: 0, z: 0, r: 40 }];
    const a = M.pickSpot({ sites, cx: 0, cz: 0, sampler: flatDry, waterLevel: 0 });
    const b = M.pickSpot({ sites, avoid: [{ x: a.x, z: a.z, r: 60 }], cx: 0, cz: 0, sampler: flatDry, waterLevel: 0 });
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 60 - 1e-6, 'segundo ponto longe do primeiro');
  });
});
