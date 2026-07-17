/* Fontes do telhado climático são INDEPENDENTES: o evento de destruição da
   cidade remove 'city' e NÃO pode levar junto a cobertura do campo. */
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('cover.js — fontes campo × city', () => {
  it('campo sobrevive ao removeBySource(city); semântica de roofY vale', async () => {
    const { createCover } = await import('../js/cover.js');
    const C = createCover();
    C.addRoofRect({ x0: 0, x1: 4, z0: 0, z1: 4, roofY: 3, sourceId: 'campo' });
    C.addRoofRect({ x0: 10, x1: 14, z0: 0, z1: 4, roofY: 9, sourceId: 'city' });
    assert.equal(C.coverAt(2, 1, 2).covered, true, 'dentro da cabana');
    assert.equal(C.coverAt(2, 1, 2).sourceId, 'campo');
    assert.equal(C.coverAt(2, 5, 2).covered, false, 'EM CIMA do telhado = céu aberto');
    assert.equal(C.coverAt(12, 1, 2).covered, true, 'dentro do prédio');
    C.removeBySource('city');                        // evento da cidade
    assert.equal(C.coverAt(12, 1, 2).covered, false, 'prédio destruído descobre');
    assert.equal(C.coverAt(2, 1, 2).covered, true, 'campo intacto após o evento');
  });

  it('provider dinâmico tem precedência e recebe (x,y,z)', async () => {
    const { createCover } = await import('../js/cover.js');
    const C = createCover();
    const seen = [];
    C.setDynamicProvider((x, y, z) => { seen.push([x, y, z]); return { covered: true, sourceId: 'ship' }; });
    assert.equal(C.coverAt(7, 8, 9).sourceId, 'ship');
    assert.deepEqual(seen, [[7, 8, 9]]);
    C.setDynamicProvider(null);
    assert.equal(C.coverAt(7, 8, 9).covered, false);
  });
});
