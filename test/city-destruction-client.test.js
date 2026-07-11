/* ================================================================
   QA — Destruição da cidade no CLIENTE (harness Chrome headless).
   Parte A: Structures.city (mundo troca de verdade — visual+colisão).
   Parte B: cinemática + morte por míssil em partida BR real.
   Plano: docs/plans/city-destruction-event.md
   ================================================================ */
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { CHROME, bootGame, startBRMatch } = require('./helpers/harness');

describe('Structures.city — troca do mundo', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h;
  before(async () => { h = await bootGame({ port: 3179 }); });
  after(async () => { if (h) await h.close(); });
  const play = (fn, ...args) => h.play(fn, ...args);

  it('dada a interface, então expõe centro/raio/containsPoint e estado inicial intacto', async t => {
    const r = await play(() => {
      const c = window.QA.G.Structures.city;
      if (!c) return null;
      return {
        temTudo: !!(c.center && c.radius && c.containsPoint && c.destroy && c.restore && c.getState),
        estado: c.getState(),
        dentro: c.containsPoint(-340, 130),
        fora: c.containsPoint(0, 0),
      };
    });
    assert.ok(r, 'Structures.city não existe');
    assert.ok(r.temTudo, 'interface incompleta');
    assert.equal(r.estado, 'intact');
    assert.ok(r.dentro && !r.fora);
  });

  it('dado destroy(), então a parede original some (colisão em altura + bala) e o telhado deixa de ser pisável', async t => {
    const r = await play(() => {
      const QA = window.QA, G = QA.G, MP = QA.MP, P = MP.player;
      const city = G.Structures.city;
      if (!city) return null;
      const b = G.Structures.walls.find(w => w.city && (w.x1 - w.x0) > 8 && (w.y1 - w.y0) > 8);
      if (!b) return { semParede: true };
      const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
      // ANTES: dentro do prédio a 4m de altura, o push-out cospe o jogador
      QA.reset(b.x0 - 4, cz);
      P.pos.set(cx, b.y0 + 4, cz); P.onGround = false; P.vel.set(0, 0, 0);
      QA.tick(2);
      const cuspidoAntes = Math.abs(P.pos.x - cx) > 1 || Math.abs(P.pos.z - cz) > 1;
      city.destroy();
      const estado = city.getState();
      // DEPOIS: mesma posição — nada empurra (escombro tem só 1,6m)
      P.pos.set(cx, b.y0 + 4, cz); P.onGround = false; P.vel.set(0, 0, 0);
      QA.tick(2);
      const livreDepois = Math.abs(P.pos.x - cx) < 1 && Math.abs(P.pos.z - cz) < 1;
      // bala a 3m de altura atravessa o footprint inteiro
      const THREE = MP.THREE;
      const hit = G.Structures.rayHit(new THREE.Vector3(b.x0 - 3, b.y0 + 3, cz),
        new THREE.Vector3(1, 0, 0), (b.x1 - b.x0) + 6);
      const balaPassa = hit === Infinity;
      // telhado deixou de ser plataforma
      const telhadoSumiu = MP.groundAt(cx, cz, b.y1 + 2) < b.y1 - 2;
      return { estado, cuspidoAntes, livreDepois, balaPassa, telhadoSumiu };
    });
    assert.ok(r && !r.semParede, 'sem prédio city testável');
    assert.equal(r.estado, 'destroyed');
    assert.ok(r.cuspidoAntes, 'pré-condição falhou: prédio intacto não empurrava (teste vazio)');
    assert.ok(r.livreDepois, 'parede fantasma ainda empurra após destroy');
    assert.ok(r.balaPassa, 'bala ainda bate na parede fantasma');
    assert.ok(r.telhadoSumiu, 'telhado destruído continua pisável');
  });

  it('dado destroy(), então os corpos CANNON da cidade saem do mundo físico (sem órfãos)', async t => {
    const r = await play(() => {
      const QA = window.QA, W = QA.MP.world, city = QA.G.Structures.city;
      city.restore(); // garante estado base
      const antes = W.bodies.length;
      city.destroy();
      const depois = W.bodies.length;
      city.restore();
      const devolta = W.bodies.length;
      return { antes, depois, devolta };
    });
    assert.ok(r.depois < r.antes - 5, `corpos não saíram (${r.antes} -> ${r.depois})`);
    assert.equal(r.devolta, r.antes, 'restore não devolveu os corpos');
  });

  it('dado destroy(), então o FORTE (fora da cidade) continua sólido', async t => {
    const r = await play(() => {
      const QA = window.QA, G = QA.G, P = QA.MP.player;
      const city = G.Structures.city;
      city.destroy();
      // parede NÃO-city testável (mesmo critério do findWall)
      const b = G.Structures.walls.find(w => {
        if (w.city || w.noCollide) return false;
        if ((w.x1 - w.x0) < 3 || (w.y1 - w.y0) < 2.2) return false;
        const cz2 = (w.z0 + w.z1) / 2;
        const ter = QA.MP.heightAt(w.x0 - 3, cz2);
        return Math.abs(ter - w.y0) < 0.8 && w.y1 > ter + 1.9 &&
          Math.abs(QA.MP.groundAt(w.x0 - 3, cz2, 999) - ter) < 0.5;
      });
      if (!b) return null;
      const cz2 = (w => (w.z0 + w.z1) / 2)(b);
      QA.reset(b.x0 - 3, cz2);
      QA.aimAt((b.x0 + b.x1) / 2, P.pos.y + 1.5, cz2);
      G.keys.KeyW = true;
      QA.tick(100);
      G.keys.KeyW = false;
      const barrado = P.pos.x <= b.x0 - P.radius + 0.2;
      city.restore();
      return { barrado };
    });
    if (!r) { t.skip('sem parede não-city testável'); return; }
    assert.ok(r.barrado, 'forte/estruturas fora da cidade perderam colisão junto');
  });

  it('dada a versão destruída, então ela existe desde o boot (invisível) e aparece no destroy', async t => {
    const r = await play(() => {
      const QA = window.QA, city = QA.G.Structures.city;
      city.restore();
      const ruinas = QA.MP.scene.getObjectByName('cidadeDestruida');
      if (!ruinas) return null;
      const antes = ruinas.visible;
      city.destroy();
      const durante = ruinas.visible;
      city.restore();
      return { antes, durante, depois: ruinas.visible, pecas: ruinas.children.length };
    });
    assert.ok(r, 'grupo cidadeDestruida não existe no boot');
    assert.equal(r.antes, false, 'ruínas visíveis antes do impacto');
    assert.equal(r.durante, true, 'ruínas não aparecem no destroy');
    assert.equal(r.depois, false);
    assert.ok(r.pecas >= 10, `versão destruída rala demais (${r.pecas} peças)`);
  });
});
