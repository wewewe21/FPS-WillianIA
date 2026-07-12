/* ================================================================
   QA — MODOS DA ZONA DE GÁS (unidade, via exports do server.js).
   BDD dos pedidos de playtest:
   - dado gás desligado pela sala, então não existe zona nem dano
   - dado modo clássico, então fecha de fora pra dentro (como era)
   - dado modo inverso, então o gás nasce no centro e cresce — as
     bordas (e o vulcão do canto) viram o endgame
   - dado modo auto, então a partida sorteia um dos dois (variedade)
   - dado qualquer modo, então o ritmo dá tempo de explorar o mapa
   ================================================================ */
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildPlan, zoneAt, LIM } = require('../server.js');

describe('Zona de gás — modos e flag (unidade)', () => {
  it('dado gas="off", então o plano vem sem fases e zoneAt não ameaça ninguém', () => {
    const plan = buildPlan(777, 'off');
    assert.equal(plan.gas, 'off');
    assert.equal(plan.zone.length, 0, 'gás desligado não pode ter fases');
    assert.equal(zoneAt(500, plan), null, 'zoneAt devia ser nulo com gás off');
  });

  it('dado gas="classica", então fecha de fora pra dentro como sempre', () => {
    const plan = buildPlan(777, 'classica');
    assert.equal(plan.gas, 'classica');
    const ph = plan.zone;
    assert.ok(ph.length >= 4, 'poucas fases');
    for (const p of ph) assert.ok(p.r1 < p.r0, `fase não encolhe: ${p.r0} → ${p.r1}`);
    assert.ok(ph[0].r0 > 500, 'primeiro círculo devia cobrir quase o mapa todo');
    assert.ok(ph[ph.length - 1].r1 < 40, 'círculo final devia ser apertado');
  });

  it('dado gas="inversa", então o gás nasce pequeno no centro e engole o mapa', () => {
    const plan = buildPlan(777, 'inversa');
    assert.equal(plan.gas, 'inversa');
    const ph = plan.zone;
    assert.ok(ph.length >= 4, 'poucas fases');
    for (const p of ph) assert.ok(p.r1 > p.r0, `fase não cresce: ${p.r0} → ${p.r1}`);
    assert.ok(ph[0].r0 < 60, 'gás inverso devia nascer pequeno');
    const rFim = ph[ph.length - 1].r1;
    assert.ok(rFim > 400 && rFim <= 500,
      `gás final devia quase cobrir o mapa deixando as bordas jogáveis: r=${rFim}`);
    // o vulcão (420,-420) fica fora do gás final: endgame nos cantos
    const last = ph[ph.length - 1];
    assert.ok(Math.hypot(420 - last.nx, -420 - last.nz) > rFim,
      'o canto do vulcão devia sobrar como área segura no final');
  });

  it('dado gas="auto", então cada seed sorteia um modo válido — e os dois aparecem', () => {
    const vistos = new Set();
    for (let i = 0; i < 40; i++) {
      const plan = buildPlan((i * 2654435761) >>> 0, 'auto');
      assert.ok(['classica', 'inversa'].includes(plan.gas), `modo estranho: ${plan.gas}`);
      vistos.add(plan.gas);
      // mesmo seed → mesmo sorteio (todos os clientes concordam)
      assert.equal(buildPlan((i * 2654435761) >>> 0, 'auto').gas, plan.gas);
    }
    assert.equal(vistos.size, 2, `auto só sorteou ${[...vistos]}`);
  });

  it('dado o ritmo novo, então dá tempo de explorar: 1ª fase longa e partida ~7min+', () => {
    const plan = buildPlan(777, 'classica');
    const ph = plan.zone;
    // primeira espera: só começa a fechar bem depois da queda
    assert.ok(ph[0].tWaitEnd >= 100, `1ª fase espera pouco: ${ph[0].tWaitEnd}s`);
    const fim = ph[ph.length - 1].tShrinkEnd;
    assert.ok(fim >= 420, `zona acaba rápido demais pra explorar: ${fim}s`);
  });

  it('dado o modo inverso, então zoneAt marca o modo e o círculo cresce com o tempo', () => {
    const plan = buildPlan(777, 'inversa');
    let rAnt = -1;
    for (let t = 0; t < 700; t += 12) {
      const z = zoneAt(t, plan);
      assert.ok(z.inversa === true, 'zoneAt devia marcar inversa');
      assert.ok(z.r >= rAnt - 0.01, `gás inverso encolheu: ${rAnt} → ${z.r} em t=${t}`);
      assert.ok(Math.abs(z.x) <= LIM && Math.abs(z.z) <= LIM, 'centro fora do mapa');
      rAnt = z.r;
    }
  });

  it('dado o modo clássico, então zoneAt não marca inversa (dano continua fora do círculo)', () => {
    const plan = buildPlan(777, 'classica');
    const z = zoneAt(200, plan);
    assert.ok(!z.inversa, 'clássica não é inversa');
  });
});
