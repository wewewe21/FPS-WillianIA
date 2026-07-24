/* ================================================================
   QA — Canhão de Circo no jogo real (browser + BR ativo).
   Boota a página, confirma que o canhão nasce num ponto vazio, dispara
   o jogador num arco e o traz de volta ao chão SEM estourar os tetos do
   anti-cheat. Porta fixa 3260 (própria — não colide com a suíte).
   ================================================================ */
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { bootGame } = require('./helpers/harness.js');

const PORT = 3260;

describe('Canhão de Circo 🎪', () => {
  let h;
  before(async () => { h = await bootGame({ port: PORT }); });
  after(async () => { if (h) await h.close(); });

  it('nasce no mapa, longe das estruturas e em terreno seco', async () => {
    const r = await h.play(() => {
      const G = window.__game;
      const cn = G.Cannon;
      if (!cn) return { ok: false, why: 'sem __game.Cannon' };
      const spot = cn.spot;
      let minClr = Infinity;
      for (const s of G.Structures.sites) {
        const d = Math.hypot(spot.x - s.x, spot.z - s.z) - (s.r || 0);
        if (d < minClr) minClr = d;
      }
      return { ok: true, spot, minClr, groundY: G.heightAt(spot.x, spot.z), state: cn.state };
    });
    assert.ok(r.ok, r.why);
    assert.ok(Number.isFinite(r.spot.x) && Number.isFinite(r.spot.z), 'ponto finito');
    assert.ok(Math.abs(r.spot.x) < 540 && Math.abs(r.spot.z) < 540, 'dentro do mapa');
    assert.ok(r.minClr > 10, `perto demais de estrutura (folga ${r.minClr.toFixed(1)} m)`);
    assert.ok(Number.isFinite(r.groundY), 'altura do chão finita');
    assert.equal(r.state, 'idle');
  });

  it('dispara o jogador num arco e o traz de volta ao chão', async () => {
    const r = await h.play(() => {
      const G = window.__game, QA = window.QA;
      const cn = G.Cannon;
      const spot = cn.spot;
      QA.reset(spot.x, spot.z);                    // jogador em cima do canhão
      QA.MP.camera.lookAt(0, QA.MP.player.pos.y + 1.4, 0); // encara o centro do mapa
      QA.tick(2);
      const before = [QA.MP.player.pos.x, QA.MP.player.pos.z];
      const y0 = QA.MP.player.pos.y;
      const fired = cn.fire();
      let maxH = 0, maxV = 0, peakY = y0, launched = false;
      for (let i = 0; i < 280; i++) {
        QA.tick(1);
        const P = QA.MP.player;
        if (P.launchT > 0) launched = true;
        const hh = Math.hypot(P.vel.x, P.vel.z), vv = Math.abs(P.vel.y);
        if (hh > maxH) maxH = hh;
        if (vv > maxV) maxV = vv;
        if (P.pos.y > peakY) peakY = P.pos.y;
      }
      const P = QA.MP.player;
      return {
        fired, launched,
        dist: Math.hypot(P.pos.x - before[0], P.pos.z - before[1]),
        apex: peakY - y0, maxH, maxV,
        onGround: P.onGround, launchT: P.launchT, state: cn.state,
        best: cn.best, flightDist: cn.lastFlightDist,
      };
    });
    assert.ok(r.fired, 'fire() aceitou o disparo em cima do canhão');
    assert.ok(r.launched, 'jogador entrou em voo balístico (launchT>0)');
    assert.ok(r.flightDist > 25, `voou pouco (${r.flightDist.toFixed(1)} m)`);
    assert.ok(r.flightDist < 120, `voou pra fora do razoável (${r.flightDist.toFixed(1)} m)`);
    assert.ok(r.apex > 8, `mal subiu (apogeu ${r.apex.toFixed(1)} m)`);
    assert.ok(r.onGround, 'voltou ao chão');
    assert.equal(r.launchT, 0, 'estado de voo foi zerado no pouso');
    assert.equal(r.state, 'idle', 'canhão pronto pro próximo');
    assert.ok(r.best >= Math.round(r.flightDist) - 1,
      `recorde ${r.best} não bateu com o voo ${r.flightDist.toFixed(1)} m`);
  });

  it('NUNCA estoura os tetos do anti-cheat do servidor (hSpd<55, vSpd<120)', async () => {
    const r = await h.play(() => {
      const G = window.__game, QA = window.QA;
      const cn = G.Cannon;
      const spot = cn.spot;
      QA.reset(spot.x, spot.z);
      QA.MP.camera.lookAt(0, QA.MP.player.pos.y + 1.4, 0);
      QA.tick(2);
      cn.fire();
      let maxH = 0, maxV = 0;
      for (let i = 0; i < 280; i++) {
        QA.tick(1);
        const P = QA.MP.player;
        const hh = Math.hypot(P.vel.x, P.vel.z), vv = Math.abs(P.vel.y);
        if (hh > maxH) maxH = hh;
        if (vv > maxV) maxV = vv;
      }
      return { maxH, maxV };
    });
    // 55 = limite de "strike" suspeito; 90 = rejeição; 120 = rejeição vertical
    assert.ok(r.maxH < 55, `pico horizontal ${r.maxH.toFixed(1)} m/s geraria strike`);
    assert.ok(r.maxV < 120, `pico vertical ${r.maxV.toFixed(1)} m/s seria rejeitado`);
  });

  it('não gerou erros de página (window.onerror)', async () => {
    const errs = await h.play(() => window.__game.errors.slice());
    assert.deepEqual(errs, [], `erros: ${errs.join(' | ')}`);
  });
});
