/* Tempo da partida (preset da sala) — escala o cronograma da zona no buildPlan.
   Presets: relampago < curta < normal < longa < maratona. 'normal' = ritmo atual. */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildPlan } = require('../server.js');

// fim do encolhimento da última fase (offset inicial é constante entre presets,
// então esse valor ordena as durações)
const zoneEnd = (tempo) => {
  const p = buildPlan(777, 'classica', tempo);
  return p.zone[p.zone.length - 1].tShrinkEnd;
};

test('plan.tempo reflete o preset pedido', () => {
  for (const t of ['relampago', 'curta', 'normal', 'longa', 'maratona']) {
    assert.strictEqual(buildPlan(1, 'classica', t).tempo, t);
    assert.strictEqual(buildPlan(1, 'inversa', t).tempo, t);
    assert.strictEqual(buildPlan(1, 'off', t).tempo, t);
  }
});

test('presets ordenam a duração: relâmpago < curta < normal < longa < maratona', () => {
  const r = zoneEnd('relampago'), c = zoneEnd('curta'), n = zoneEnd('normal'),
    l = zoneEnd('longa'), m = zoneEnd('maratona');
  assert.ok(r < c && c < n && n < l && l < m, `ordem: ${r} ${c} ${n} ${l} ${m}`);
});

test("'normal' preserva o ritmo atual (soma waits+shrinks = 483s)", () => {
  const p = buildPlan(777, 'classica', 'normal');
  const z = p.zone;
  const span = z[z.length - 1].tShrinkEnd - (z[0].tWaitEnd - 110); // 110 = 1º wait não-escalado
  assert.strictEqual(span, 483, `span normal = ${span}s (esperado 483)`);
});

test('relâmpago ~ metade e maratona ~ dobro do normal', () => {
  const base = 483;
  const spanOf = (t) => { const z = buildPlan(777, 'classica', t).zone; return z[z.length - 1].tShrinkEnd - (z[0].tWaitEnd - Math.round(110 * ({ relampago: 0.38, maratona: 2.25 }[t] || 1))); };
  const rel = spanOf('relampago'), mar = spanOf('maratona');
  assert.ok(rel < base * 0.5 && rel > base * 0.3, `relâmpago span ${rel}`);
  assert.ok(mar > base * 2 && mar < base * 2.4, `maratona span ${mar}`);
});

test('tempo inválido cai no ritmo normal (escala 1)', () => {
  assert.strictEqual(zoneEnd('xpto'), zoneEnd('normal'));
  assert.strictEqual(zoneEnd(undefined), zoneEnd('normal'));
});

test('determinístico: mesma seed+gás+tempo → mesmo plano', () => {
  assert.deepStrictEqual(buildPlan(999, 'classica', 'longa').zone, buildPlan(999, 'classica', 'longa').zone);
});

test("gás 'off' com tempo: zona vazia mas tempo preservado", () => {
  const p = buildPlan(5, 'off', 'maratona');
  assert.strictEqual(p.zone.length, 0);
  assert.strictEqual(p.tempo, 'maratona');
});
