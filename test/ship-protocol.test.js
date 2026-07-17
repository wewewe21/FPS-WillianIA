/* ================================================================
   QA — ship-protocol.js (matemática pura da nave, sem DOM/three).
   Dimensões, pose no tempo, conversões local<->mundo, slots e
   validação de shipLocal — o MESMO código roda no servidor e no
   navegador; aqui garantimos que ele é determinístico e finito.
   ================================================================ */
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../ship-protocol.js');

const SHIP = { from: [620, 0], to: [-580, 90], alt: 250, flyTime: 55 };

describe('Dimensões da nave (contrato)', () => {
  it('diâmetro externo 34–38 m, cabine ≥25 m, pé-direito 4.2–4.8 m', () => {
    assert.ok(P.DIMS.outerRadius * 2 >= 34 && P.DIMS.outerRadius * 2 <= 38);
    assert.ok(P.DIMS.cabinRadius * 2 >= 25);
    const h = P.DIMS.ceilingY - P.DIMS.floorY;
    assert.ok(h >= 4.2 && h <= 4.8, `pé-direito ${h}`);
    assert.ok(P.DIMS.windowRadius >= 4 && P.DIMS.windowRadius <= 5);
    assert.ok(P.DIMS.walkSpeed >= 3.6 && P.DIMS.walkSpeed <= 4.4);
  });
  it('nenhuma dimensão é NaN e o walkRadius é semântico', () => {
    for (const [k, v] of Object.entries(P.DIMS)) assert.ok(Number.isFinite(v), `DIMS.${k}`);
    assert.equal(P.walkRadius(), P.DIMS.cabinRadius - P.DIMS.playerRadius - P.DIMS.wallMargin);
    assert.ok(P.walkRadius() > P.DIMS.windowRadius, 'janela precisa ser caminhável');
  });
  it('velocidade máxima validada dá folga de rede mas barra speedhack', () => {
    assert.ok(P.DIMS.maxLocalSpeed > P.DIMS.walkSpeed * 1.5);
    assert.ok(P.DIMS.maxLocalSpeed <= 15);
  });
});

describe('Pose da nave no tempo', () => {
  it('t=0 parte do from, t=flyTime chega no to, k clampa em [0, 1.18]', () => {
    const p0 = P.poseAt(SHIP, 0);
    assert.ok(Math.abs(p0.x - 620) < 1e-9 && Math.abs(p0.z - 0) < 1e-9);
    assert.equal(p0.k, 0);
    const p1 = P.poseAt(SHIP, SHIP.flyTime);
    assert.ok(Math.abs(p1.x - -580) < 1e-9 && Math.abs(p1.z - 90) < 1e-9);
    assert.equal(P.poseAt(SHIP, -10).k, 0);
    assert.equal(P.poseAt(SHIP, 1e6).k, 1.18);
  });
  it('bob vertical pequeno (nave pesada) e determinístico', () => {
    for (const t of [0, 3.7, 12, 54.9, 200]) {
      const p = P.poseAt(SHIP, t);
      assert.ok(Math.abs(p.y - SHIP.alt) <= P.DIMS.bobAmp + 1e-9, `bob estourou em t=${t}`);
      const q = P.poseAt(SHIP, t);
      assert.deepEqual([p.x, p.y, p.z, p.yaw], [q.x, q.y, q.z, q.yaw]);
    }
    assert.ok(P.DIMS.bobAmp <= 0.8, 'nave grande não pode balançar como a antiga (1.2)');
  });
  it('yaw segue a rota (mesma convenção do cliente atual)', () => {
    const p = P.poseAt(SHIP, 10);
    assert.equal(p.yaw, Math.atan2(SHIP.to[0] - SHIP.from[0], SHIP.to[1] - SHIP.from[1]));
    assert.ok(Number.isFinite(P.poseAt({ from: [0, 0], to: [0, 0], alt: 250, flyTime: 55 }, 5).yaw));
  });
});

describe('Transformações local <-> mundo', () => {
  const routes = [
    SHIP,
    { from: [0, 620], to: [10, -600], alt: 250, flyTime: 55 },
    { from: [-620, -620], to: [600, 610], alt: 250, flyTime: 30 },
    { from: [500, -100], to: [500, 700], alt: 250, flyTime: 90 },
  ];
  it('round-trip devolve o ponto original em vários yaw/tempos/pontos', () => {
    for (const route of routes) for (const t of [0, 7.3, 28, 55]) {
      const pose = P.poseAt(route, t);
      for (const l of [[0, -1.45, 0], [3.3, -1.45, -7.1], [-12, 0, 4], [11.9, 2.2, -0.4]]) {
        const w = P.localToWorld(pose, l);
        const back = P.worldToLocal(pose, w);
        for (let i = 0; i < 3; i++) {
          assert.ok(Math.abs(back[i] - l[i]) < 1e-9, `round-trip ${route.from} t=${t} eixo ${i}`);
          assert.ok(Number.isFinite(w[i]));
        }
      }
    }
  });
  it('conversão in-place (out === entrada) dá o mesmo resultado', () => {
    // os chamadores reutilizam o MESMO array como entrada e saída (zero
    // alocação por frame) — a conversão não pode ler valor já sobrescrito
    const pose = P.poseAt(SHIP, 13.7);
    const l = [5.8, -1.45, -3.2];
    const separado = P.localToWorld(pose, l.slice());
    const inplace = l.slice();
    P.localToWorld(pose, inplace, inplace);
    assert.deepEqual(inplace, separado, 'localToWorld in-place corrompeu o resultado');
    const w = separado.slice();
    const volta = P.worldToLocal(pose, w.slice());
    P.worldToLocal(pose, w, w);
    assert.deepEqual(w, volta, 'worldToLocal in-place corrompeu o resultado');
  });

  it('origem local cai no centro da nave (piso incluso)', () => {
    const pose = P.poseAt(SHIP, 20);
    const w = P.localToWorld(pose, [0, P.DIMS.floorY, 0]);
    assert.ok(Math.abs(w[0] - pose.x) < 1e-9);
    assert.ok(Math.abs(w[1] - (pose.y + P.DIMS.floorY)) < 1e-9);
    assert.ok(Math.abs(w[2] - pose.z) < 1e-9);
  });
});

describe('Slots de spawn na cabine', () => {
  it('64 ids: únicos (≥1.1 m entre centros), todos dentro do walkRadius', () => {
    const slots = [];
    for (let i = 0; i < 64; i++) slots.push(P.slotLocal(i));
    for (let i = 0; i < 64; i++) {
      const [x, z] = slots[i];
      assert.ok(Math.hypot(x, z) <= P.walkRadius() + 1e-9, `slot ${i} fora`);
      assert.ok(Math.hypot(x, z) >= P.DIMS.windowRadius - 1e-9, `slot ${i} amontoado na janela`);
      for (let j = i + 1; j < 64; j++) {
        const d = Math.hypot(x - slots[j][0], z - slots[j][1]);
        assert.ok(d >= 1.1, `slots ${i}/${j} a ${d.toFixed(2)} m`);
      }
    }
  });
  it('determinístico e independente dos outros (desconexão não mexe em slot)', () => {
    assert.deepEqual(P.slotLocal(7), P.slotLocal(7));
    const antes = P.slotLocal(3);
    P.slotLocal(4); P.slotLocal(63);
    assert.deepEqual(P.slotLocal(3), antes);
  });
  it('slot nunca nasce dentro de console (clamp é no-op em cima do slot)', () => {
    for (let i = 0; i < 64; i++) {
      const [x, z] = P.slotLocal(i);
      const p = { x, z };
      P.clampToCabin(p, P.DIMS.playerRadius);
      assert.ok(Math.hypot(p.x - x, p.z - z) < 1e-9, `slot ${i} colidia parado`);
    }
  });
  it('lotação acima da capacidade continua determinística e dentro da cabine', () => {
    for (const i of [64, 200, 500, 1000]) {
      const [x, z] = P.slotLocal(i);
      assert.ok(Number.isFinite(x) && Number.isFinite(z));
      assert.ok(Math.hypot(x, z) <= P.walkRadius() + 1e-9);
      assert.deepEqual(P.slotLocal(i), P.slotLocal(i));
    }
  });
});

describe('Colisão analítica da cabine', () => {
  const pr = P.DIMS.playerRadius;
  it('dentro fica onde está; fora volta pro raio máximo preservando o ângulo', () => {
    const dentro = { x: 3, z: -4 };
    P.clampToCabin(dentro, pr);
    assert.deepEqual([dentro.x, dentro.z], [3, -4]);
    // direção 0.1 rad: fora de qualquer arco de console (o mais perto começa em ~0.36 rad)
    const fora = { x: 40 * Math.cos(0.1), z: 40 * Math.sin(0.1) };
    const ang = 0.1;
    P.clampToCabin(fora, pr);
    const maxR = P.DIMS.cabinRadius - pr - P.DIMS.wallMargin;
    assert.ok(Math.abs(Math.hypot(fora.x, fora.z) - maxR) < 1e-9, 'não clampou no raio');
    assert.ok(Math.abs(Math.atan2(fora.z, fora.x) - ang) < 1e-9, 'ângulo mudou (teleporte)');
  });
  it('distância zero é segura (sem NaN, sem teleporte)', () => {
    const zero = { x: 0, z: 0 };
    P.clampToCabin(zero, pr);
    assert.deepEqual([zero.x, zero.z], [0, 0]);
  });
  it('console periférico empurra pra dentro só dentro do arco dele', () => {
    const c = P.CONSOLES[0];
    const rAlvo = c.innerR - pr;
    const noArco = { x: Math.cos(c.ang) * (c.innerR + 0.5), z: Math.sin(c.ang) * (c.innerR + 0.5) };
    P.clampToCabin(noArco, pr);
    assert.ok(Math.hypot(noArco.x, noArco.z) <= rAlvo + 1e-9, 'entrou no console');
    const foraDoArco = {
      x: Math.cos(c.ang + c.halfArc + 0.3) * (c.innerR + 0.1),
      z: Math.sin(c.ang + c.halfArc + 0.3) * (c.innerR + 0.1),
    };
    const antes = { ...foraDoArco };
    P.clampToCabin(foraDoArco, pr);
    assert.ok(Math.abs(foraDoArco.x - antes.x) < 1e-9 && Math.abs(foraDoArco.z - antes.z) < 1e-9,
      'clampou fora do arco do console');
  });
  it('deslizamento: input diagonal contra a parede continua avançando tangencialmente', () => {
    const maxR = P.DIMS.cabinRadius - pr - P.DIMS.wallMargin;
    const p = { x: maxR, z: 0 };
    let angAnterior = 0;
    for (let i = 0; i < 30; i++) {
      p.x += (P.DIMS.walkSpeed * 0.7071) * (1 / 60); // empurra pra fora
      p.z += (P.DIMS.walkSpeed * 0.7071) * (1 / 60); // e tangencial
      P.clampToCabin(p, pr);
      const a = Math.atan2(p.z, p.x);
      assert.ok(a >= angAnterior - 1e-9, 'andou pra trás no deslize');
      assert.ok(Math.hypot(p.x, p.z) <= maxR + 1e-9, 'atravessou a parede');
      angAnterior = a;
    }
    assert.ok(angAnterior > 0.05, 'grudou na parede (não deslizou)');
  });
});

describe('Validação de shipLocal (pacotes do cliente)', () => {
  it('aceita array [x,y,z] finito e devolve cópia', () => {
    const v = [1.5, P.DIMS.floorY, -2];
    const s = P.sanitizeLocal(v);
    assert.deepEqual(s, v);
    assert.notEqual(s, v); // cópia, não referência
  });
  it('rejeita NaN, Infinity, curto, enorme, string, objeto e não-array', () => {
    for (const lixo of [
      [NaN, 0, 0], [0, Infinity, 0], [0, 0, -Infinity],
      [1, 2], [1, 2, 3, 4], new Array(100000).fill(1),
      ['1', 2, 3], [{}, 2, 3], 'shipLocal', { 0: 1, 1: 2, 2: 3, length: 3 }, null, undefined, 42,
    ]) assert.equal(P.sanitizeLocal(lixo), null, `passou lixo: ${JSON.stringify(lixo)?.slice(0, 40)}`);
  });
  it('localInCabin: raio e altura do piso dentro da tolerância documentada', () => {
    assert.ok(P.localInCabin([0, P.DIMS.floorY, 0]));
    assert.ok(P.localInCabin([P.walkRadius() - 0.01, P.DIMS.floorY + P.DIMS.floorTol * 0.9, 0]));
    assert.ok(!P.localInCabin([P.walkRadius() + 0.2, P.DIMS.floorY, 0]), 'fora da parede passou');
    assert.ok(!P.localInCabin([0, P.DIMS.floorY - P.DIMS.floorTol - 0.1, 0]), 'embaixo do piso passou');
    assert.ok(!P.localInCabin([0, P.DIMS.ceilingY, 0]), 'no teto passou');
  });
});
