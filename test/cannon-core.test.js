/* ================================================================
   QA — cannon-core.js (matemática pura do Canhão de Circo, sem THREE/DOM).
   Perfil de lançamento dentro do anti-cheat, arco "divertido", escolha
   determinística do ponto vazio e recorde. Roda em Node puro (sem porta,
   sem browser) — seguro em paralelo com qualquer bateria de browser.
   ================================================================ */
'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

let C;
before(async () => { C = await import('../js/cannon-core.js'); });

describe('Perfil de lançamento × anti-cheat do servidor', () => {
  it('cabe com folga nos tetos (hSpd<55 strike, <90 reject; vSpd<120)', () => {
    assert.ok(C.withinAntiCheat(), 'perfil default tem que passar');
    const vh = C.horizontalSpeed(), vy = C.verticalSpeed();
    assert.ok(vh < C.ANTICHEAT.hStrike, `vh ${vh.toFixed(1)} < 55 (nem strike)`);
    assert.ok(vh < C.ANTICHEAT.hReject, `vh ${vh.toFixed(1)} < 90`);
    assert.ok(vy < C.ANTICHEAT.vReject, `vy ${vy.toFixed(1)} < 120`);
    // folga real, não no limite
    assert.ok(vh < 45 && vy < 45, 'folga confortável dos tetos');
  });

  it('nenhum número do perfil é NaN e a gravidade casa com o player (22)', () => {
    for (const [k, v] of Object.entries(C.LAUNCH)) assert.ok(Number.isFinite(v), `LAUNCH.${k}`);
    assert.equal(C.LAUNCH.gravity, 22);
  });
});

describe('launchVelocity', () => {
  it('módulo == speed e componente vertical positiva (sobe)', () => {
    const v = C.launchVelocity(1, 0);
    assert.ok(Math.abs(Math.hypot(v.x, v.y, v.z) - C.LAUNCH.speed) < 1e-6, 'módulo = speed');
    assert.ok(v.y > 0, 'lança pra cima');
    assert.ok(Math.abs(v.z) < 1e-9, 'dir +X não vaza pra Z');
  });
  it('segue a direção horizontal passada e normaliza entrada não-unitária', () => {
    const v = C.launchVelocity(0, -3); // aponta -Z, magnitude 3 (não normalizado)
    assert.ok(v.z < 0 && Math.abs(v.x) < 1e-9, 'vai pra -Z');
    assert.ok(Math.abs(Math.hypot(v.x, v.y, v.z) - C.LAUNCH.speed) < 1e-6, 'renormalizou');
  });
  it('direção diagonal mantém o módulo (não acumula velocidade)', () => {
    const v = C.launchVelocity(1, 1);
    assert.ok(Math.abs(Math.hypot(v.x, v.y, v.z) - C.LAUNCH.speed) < 1e-6);
  });
});

describe('Arco divertido (contrato de design)', () => {
  it('voa longe o bastante pra ser espetáculo, mas cabe no mapa (~40–90 m)', () => {
    const r = C.ballisticRange();
    assert.ok(r >= 40 && r <= 90, `alcance ${r.toFixed(1)} m fora da faixa divertida`);
  });
  it('apogeu alto e visível (12–30 m) — dá tempo de ver o mundo lá de cima', () => {
    const a = C.ballisticApex();
    assert.ok(a >= 12 && a <= 30, `apogeu ${a.toFixed(1)} m fora da faixa`);
  });
});

describe('pickSpot — ponto mais vazio, determinístico e sem rand', () => {
  const flatDry = () => ({ h: 5, slope: 0.05 }); // terreno seco e plano em todo lugar
  const sites = [
    { x: 0, z: 0, r: 88 },    // cidade
    { x: 200, z: 40, r: 22 }, // base
    { x: -160, z: 180, r: 28 }, // forte
  ];

  it('devolve um ponto seco, plano e a ≥18 m de qualquer estrutura', () => {
    const spot = C.pickSpot({ sites, cx: 0, cz: 0, sampler: flatDry, waterLevel: 0 });
    assert.ok(spot, 'achou ponto');
    for (const st of sites) {
      const d = Math.hypot(spot.x - st.x, spot.z - st.z) - st.r;
      assert.ok(d >= 18 - 1e-6, `perto demais de estrutura (${d.toFixed(1)} m)`);
    }
    assert.ok(spot.clearance >= 18);
  });

  it('é 100% determinístico (mesma entrada → mesmo ponto)', () => {
    const a = C.pickSpot({ sites, cx: 0, cz: 0, sampler: flatDry, waterLevel: 0 });
    const b = C.pickSpot({ sites, cx: 0, cz: 0, sampler: flatDry, waterLevel: 0 });
    assert.deepEqual(a, b);
  });

  it('foge da água e de encostas íngremes', () => {
    // metade oeste é lago (h baixo), leste é serra (slope alto): sobra o resto
    const sampler = (x) => x < -30 ? { h: -2, slope: 0.05 } : x > 120 ? { h: 8, slope: 0.9 } : { h: 6, slope: 0.05 };
    const spot = C.pickSpot({ sites: [{ x: 0, z: 0, r: 40 }], cx: 0, cz: 0, sampler, waterLevel: 0 });
    assert.ok(spot, 'achou ponto seco/plano');
    assert.ok(spot.x >= -30 && spot.x <= 120, `caiu em zona ruim (x=${spot.x.toFixed(0)})`);
  });

  it('devolve null quando NADA no anel serve (chamador cai no fallback)', () => {
    const allWater = () => ({ h: -5, slope: 0.05 });
    assert.equal(C.pickSpot({ sites, cx: 0, cz: 0, sampler: allWater, waterLevel: 0 }), null);
  });
});

describe('betterRecord', () => {
  it('mantém o máximo e trata prev inválido como 0', () => {
    assert.equal(C.betterRecord(60, 80), 80);
    assert.equal(C.betterRecord(90, 40), 90);
    assert.equal(C.betterRecord(undefined, 33), 33);
    assert.equal(C.betterRecord(NaN, 12), 12);
  });
});
