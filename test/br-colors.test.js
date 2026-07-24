/* ================================================================
   QA — brcolors.js (fonte única das cores do personagem, pura).
   Trava o bug crítico "avatar branco por hex inválido" + a base R1
   (mesma constante nos 3 consumidores: cliente, avatar remoto, servidor).
   Node puro — sem porta, sem browser.
   ================================================================ */
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../brcolors.js');

describe('DEFAULT_COLORS', () => {
  it('são 4 hex válidos', () => {
    assert.equal(B.DEFAULT_COLORS.length, 4);
    for (const c of B.DEFAULT_COLORS) assert.ok(B.HEX.test(c), `default inválido: ${c}`);
  });
});

describe('sanitizeColors', () => {
  it('sempre devolve 4 cores', () => {
    for (const inp of [null, undefined, [], ['#fff'], new Array(9).fill('#000'), 'nope', 42]) {
      assert.equal(B.sanitizeColors(inp).length, 4, `entrada ${JSON.stringify(inp)}`);
    }
  });

  it('lixo em qualquer slot cai no default DAQUELE índice (nunca vira branco)', () => {
    const out = B.sanitizeColors(['garbage', '#ZZZ', '#12ab', 'rgb(1,2)']);
    assert.deepEqual(out, B.DEFAULT_COLORS);
    // e o resultado é sempre hex válido
    for (const c of out) assert.ok(B.HEX.test(c));
  });

  it('preserva hex válido (normaliza pra minúsculo) e completa o resto com default', () => {
    const out = B.sanitizeColors(['#ABCDEF', '#Fff']);
    assert.equal(out[0], '#abcdef');
    assert.equal(out[1], '#fff');
    assert.equal(out[2], B.DEFAULT_COLORS[2]);
    assert.equal(out[3], B.DEFAULT_COLORS[3]);
  });

  it('rejeita formatos que o THREE.Color engoliria virando branco', () => {
    // 'red', 'white', '#12345678' (rgba), '' — todos caem no default
    const out = B.sanitizeColors(['red', 'white', '#12345678', '']);
    assert.deepEqual(out, B.DEFAULT_COLORS);
  });

  it('é seguro pra atributo HTML (só # e hex, sem aspas/tags)', () => {
    const out = B.sanitizeColors(['"><script>', '#abc']);
    assert.ok(!/[<>"'&]/.test(out.join('')), 'vazou caractere perigoso');
    assert.equal(out[1], '#abc');
  });
});
