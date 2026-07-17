/* ================================================================
   QA — clima determinístico compartilhado (js/climate.js) em Node.
   Um único DAY_LEN; tod/clima/vento como função pura de (seed, tempo);
   goldenHourK contínuo. Mata a divergência 420/480 e o sorteio local.
   ================================================================ */
'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

let C;
before(async () => { C = await import('../js/climate.js'); });

describe('Clima compartilhado', () => {
  it('dado DAY_LEN, então é 480 e é o ÚNICO (env/br não redefinem)', () => {
    assert.equal(C.DAY_LEN, 480);
    const env = fs.readFileSync(path.join(__dirname, '..', 'js', 'env.js'), 'utf8');
    const br = fs.readFileSync(path.join(__dirname, '..', 'br-game.js'), 'utf8');
    assert.ok(!/DAY_LEN\s*=\s*\d/.test(env), 'env.js redefine DAY_LEN');
    assert.ok(!/DAY_LEN\s*=\s*\d/.test(br), 'br-game.js redefine DAY_LEN (espelho proibido)');
  });

  it('dado todAt, então é contínuo, determinístico e parte de 0.33', () => {
    assert.ok(Math.abs(C.todAt(0) - 0.33) < 1e-9);
    for (let k = 0; k < 500; k++) {
      const t = k * 3.7; // cobre várias bordas 0.25/0.75
      const a = C.todAt(t), b = C.todAt(t + 0.01);
      assert.ok(Number.isFinite(a) && a >= 0 && a < 1, `tod inválido em t=${t}`);
      const d = Math.min(Math.abs(b - a), 1 - Math.abs(b - a)); // wrap
      assert.ok(d < 0.001, `salto de tod em t=${t}: ${a}→${b}`);
      assert.equal(C.todAt(t), a, 'todAt não é puro');
    }
  });

  it('dado weatherAt, então determinístico por (seed,época), proporções ~52/28/20 e rampa contínua', () => {
    const seen = { limpo: 0, chuva: 0, neve: 0 };
    let diverge = 0;
    for (let e = 0; e < 500; e++) {
      const t = e * C.WEATHER_EPOCH + 10;
      const w1 = C.weatherAt(424242, t), w2 = C.weatherAt(424242, t);
      assert.equal(w1.type, w2.type, 'weatherAt não é puro');
      seen[w1.type]++;
      if (C.weatherAt(99, t).type !== w1.type) diverge++;
      assert.ok(w1.k >= 0 && w1.k <= 1);
    }
    assert.ok(Math.abs(seen.limpo / 500 - 0.52) < 0.06, `limpo ${seen.limpo / 500}`);
    assert.ok(Math.abs(seen.chuva / 500 - 0.28) < 0.06, `chuva ${seen.chuva / 500}`);
    assert.ok(Math.abs(seen.neve / 500 - 0.20) < 0.06, `neve ${seen.neve / 500}`);
    assert.ok(diverge > 100, 'seeds diferentes deveriam divergir');
    // rampa: k cresce suave nos primeiros 8 s da época
    const e0 = 7 * C.WEATHER_EPOCH;
    assert.ok(C.weatherAt(424242, e0 + 0.1).k < 0.05);
    assert.ok(C.weatherAt(424242, e0 + 8.1).k > 0.95);
  });

  it('dado windAt, então unitário, contínuo e determinístico', () => {
    for (let k = 0; k < 300; k++) {
      const t = k * 1.7;
      const w = C.windAt(424242, t), w2 = C.windAt(424242, t + 0.05);
      assert.ok(Math.abs(Math.hypot(w.dirX, w.dirZ) - 1) < 1e-9, 'direção não-unitária');
      assert.ok(Number.isFinite(w.strength) && w.strength > 0.3 && w.strength < 1.4);
      const d = Math.hypot(w2.dirX - w.dirX, w2.dirZ - w.dirZ);
      assert.ok(d < 0.05, `vento saltou em t=${t}: ${d}`);
      assert.deepEqual(C.windAt(424242, t), w, 'windAt não é puro');
    }
  });

  it('dado goldenHourK, então 0 fora da tarde, ~1 no pico e contínuo', () => {
    assert.equal(C.goldenHourK(0.45), 0);
    assert.equal(C.goldenHourK(0.95), 0);
    assert.ok(C.goldenHourK(0.715) > 0.9, `pico fraco: ${C.goldenHourK(0.715)}`);
    let prev = null;
    for (let tod = 0.6; tod <= 0.85; tod += 0.001) {
      const v = C.goldenHourK(tod);
      assert.ok(v >= 0 && v <= 1);
      if (prev !== null) assert.ok(Math.abs(v - prev) < 0.04, `salto em tod=${tod}`);
      prev = v;
    }
  });

  it('dado phases, então dayK/nightK coerentes com a curva do Env', () => {
    const meioDia = C.phases(0.5), meiaNoite = C.phases(0.0);
    assert.equal(meioDia.dayK, 1);
    assert.equal(meiaNoite.dayK, 0);
    assert.ok(Math.abs(meioDia.nightK + meioDia.dayK - 1) < 1e-9);
  });
});
