/* ================================================================
   QA — as 5 atrações do mapa no jogo real (browser + BR ativo).
   Cama elástica, campo de tiro, fogos, aros e xilofone. Porta 3261.
   ================================================================ */
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { bootGame } = require('./helpers/harness.js');

const PORT = 3261;

describe('Atrações do mapa 🎪', () => {
  let h;
  before(async () => { h = await bootGame({ port: PORT }); });
  after(async () => { if (h) await h.close(); });

  it('as 5 nascem no mapa, espalhadas e sem se empilhar', async () => {
    const r = await h.play(() => {
      const G = window.__game, M = G.MapToys;
      if (!M) return { ok: false, why: 'sem __game.MapToys' };
      const s = M.spots;
      const list = [s.tramp, s.gallery, s.fireworks, s.rings, s.xylo];
      let minPair = Infinity;
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++)
        minPair = Math.min(minPair, Math.hypot(list[i].x - list[j].x, list[i].z - list[j].z));
      const cannon = G.Cannon.spot;
      let minCannon = Infinity;
      for (const p of list) minCannon = Math.min(minCannon, Math.hypot(p.x - cannon.x, p.z - cannon.z));
      const allDry = list.every(p => G.heightAt(p.x, p.z) > -3);
      return { ok: true, minPair, minCannon, allDry, count: list.length };
    });
    assert.ok(r.ok, r.why);
    assert.equal(r.count, 5);
    assert.ok(r.minPair > 30, `atrações empilhadas (${r.minPair.toFixed(1)} m)`);
    assert.ok(r.minCannon > 20, `atração colada no canhão (${r.minCannon.toFixed(1)} m)`);
    assert.ok(r.allDry, 'alguma nasceu na água');
  });

  it('🤸 Cama Elástica: cair na placa quica pra cima', async () => {
    const r = await h.play(() => {
      const G = window.__game, QA = window.QA, M = G.MapToys;
      const sp = M.spots.tramp;
      QA.reset(sp.x - 2.4, sp.z + 2.4);            // sobre uma placa
      const P = QA.MP.player;
      P.pos.y += 6; P.vel.set(0, -9, 0); P.onGround = false;
      let maxUp = -99, bounced = false;
      for (let i = 0; i < 40; i++) { QA.tick(1); if (P.vel.y > maxUp) maxUp = P.vel.y; if (P.vel.y > 6) bounced = true; }
      return { maxUp, bounced };
    });
    assert.ok(r.bounced, `não quicou (vel.y máx ${r.maxUp.toFixed(1)})`);
  });

  it('🎯 Campo de Tiro: alavanca abre sessão, alvo pipoca e pontua', async () => {
    const r = await h.play(async () => {
      const G = window.__game, QA = window.QA, M = G.MapToys;
      M.startGallery();
      const active = M.gallery.active;
      for (let i = 0; i < 90; i++) QA.tick(1);     // ~1.5s: alvos sobem
      const before = M.gallery.score;
      let hit = false;
      for (const a of G.extraTargets) {
        if (a && a.alive && typeof a.homeY === 'number') { a.damage(20, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, false); hit = true; break; }
      }
      return { active, targets: M.gallery.targets, hit, scored: M.gallery.score > before };
    });
    assert.ok(r.active, 'sessão não abriu');
    assert.equal(r.targets, 6, 'esperava 6 alvos');
    assert.ok(r.hit, 'nenhum alvo ficou vivo pra acertar');
    assert.ok(r.scored, 'acerto não pontuou');
  });

  it('🎆 Totem de Fogos: dispara, entra em recarga e não repete no cooldown', async () => {
    const r = await h.play(() => {
      const G = window.__game, M = G.MapToys;
      const cd0 = M.fireworks.cd;
      M.fireFireworks();
      const cd1 = M.fireworks.cd;
      M.fireFireworks();                            // no cooldown: no-op
      const cd2 = M.fireworks.cd;
      return { cd0, cd1, cd2 };
    });
    assert.equal(r.cd0, 0, 'começa pronto');
    assert.ok(r.cd1 > 0, 'entrou em recarga');
    assert.ok(r.cd2 <= r.cd1 + 1e-6, 'não recarregou de novo no cooldown');
  });

  it('💫 Aros de Acrobacia: atravessar o próximo aro avança o curso', async () => {
    const r = await h.play(() => {
      const G = window.__game, QA = window.QA, M = G.MapToys;
      const P = QA.MP.player;
      G.state.cinematic = true;                     // congela o playerUpdate (posiciono à mão)
      const r0 = M.rings.list[0];
      P.pos.set(r0.x - r0.nx * 1.5, r0.y, r0.z - r0.nz * 1.5); QA.tick(1); // salto grande: só ancora o prev
      P.pos.set(r0.x - r0.nx * 0.6, r0.y, r0.z - r0.nz * 0.6); QA.tick(1); // antes do aro
      P.pos.set(r0.x + r0.nx * 0.9, r0.y, r0.z + r0.nz * 0.9); QA.tick(1); // atravessa
      const st = M.rings;
      G.state.cinematic = false;
      return { next: st.next, running: st.running, total: st.total };
    });
    assert.equal(r.total, 6);
    assert.ok(r.next >= 1, `curso não avançou (next=${r.next})`);
    assert.ok(r.running, 'cronômetro do curso não começou');
  });

  it('🎹 Xilofone: pisar numa placa registra a nota', async () => {
    const r = await h.play(() => {
      const G = window.__game, QA = window.QA, M = G.MapToys;
      const P = QA.MP.player;
      G.state.cinematic = true;
      const pl = M.plates[2];
      P.onGround = true; P.pos.x = pl.x; P.pos.z = pl.z; QA.tick(1);
      const step = M.lastPlate;
      G.state.cinematic = false;
      return { step, plates: M.plates.length };
    });
    assert.equal(r.plates, 8);
    assert.equal(r.step, 2, 'não detectou a placa pisada');
  });

  it('não gerou erros de página (window.onerror)', async () => {
    const errs = await h.play(() => window.__game.errors.slice());
    assert.deepEqual(errs, [], `erros: ${errs.join(' | ')}`);
  });
});
