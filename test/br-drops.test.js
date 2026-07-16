/* ================================================================
   QA — fluxo BR real no harness: drops de morte respeitam andares.
   (Partida de verdade: bot-host inicia, página joga em fase PLAY.)
   ================================================================ */
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { CHROME, bootGame, startBRMatch } = require('./helpers/harness');

describe('BR — drops de morte autoritativos', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h, bot;
  before(async () => {
    h = await bootGame({ port: 3189, extraEnv: { COUNTDOWN_S: '1', NEXT_IN_S: '120' } });
    bot = await startBRMatch(h);
  });
  after(async () => {
    if (bot) bot.close();
    if (h) await h.close();
  });

  it('dado um deathDrop forjado pelo cliente, então nenhum loot fantasma aparece', async () => {
    bot.emit('deathDrop', { pos: [-340, 99, 130], items: [{ type: 'weapon', weapon: 4, ammo: 999 }] });
    await new Promise(resolve => setTimeout(resolve, 600));
    const dropCount = await h.play(() => window.__BR_debug.drops.size);
    assert.equal(dropCount, 0);
  });
});

describe('BR — bonecos remotos, zona e nave', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h, bot;
  before(async () => {
    h = await bootGame({ port: 3182, extraEnv: { COUNTDOWN_S: '1', NEXT_IN_S: '120' } });
    bot = await startBRMatch(h);
  });
  after(async () => {
    if (bot) bot.close();
    if (h) await h.close();
  });

  it('dado um snapshot remoto válido na nave, então o avatar usa a posição autorizada', async () => {
    const ship = bot.matchStart.plan.ship;
    const iv = setInterval(() => {
      const elapsed = (Date.now() - bot.matchStart.t0) / 1000;
      const progress = Math.min(Math.max(elapsed / ship.flyTime, 0), 1.18);
      const pos = [
        ship.from[0] + (ship.to[0] - ship.from[0]) * progress,
        ship.alt,
        ship.from[1] + (ship.to[1] - ship.from[1]) * progress,
      ];
      bot.volatile.emit('state', { pos, rotY: 0, ship: true });
    }, 60);
    try {
      const r = await h.play(async expectedAltitude => {
        const dbg = window.__BR_debug;
        const t0 = performance.now();
        while (dbg.remotes.size === 0 && performance.now() - t0 < 8000)
          await new Promise(rr => setTimeout(rr, 150));
        if (dbg.remotes.size === 0) return null;
        await new Promise(rr => setTimeout(rr, 1000));
        const rp = [...dbg.remotes.values()][0];
        return { position: rp.group.position.toArray(), visible: rp.group.visible, expectedAltitude };
      }, ship.alt);
      assert.ok(r, 'remoto não apareceu a tempo');
      assert.ok(r.visible, 'avatar remoto válido ficou invisível');
      assert.ok(Math.abs(r.position[1] - r.expectedAltitude) < 3,
        'avatar remoto divergiu da altitude autorizada');
    } finally { clearInterval(iv); }
  });

  it('dado um jogador remoto que morre, então o boneco tomba e some — não vira estátua', async t => {
    const r0 = await h.play(() => window.__BR_debug.remotes.size);
    if (r0 === 0) { t.skip('sem remoto na sala'); return; }
    bot.emit('reportDeath', { cause: 'QA' }); // o servidor decide e publica a morte
    const r = await h.play(async () => {
      const dbg = window.__BR_debug;
      const rp = [...dbg.remotes.values()][0];
      const t0 = performance.now();
      while (rp.group.visible && performance.now() - t0 < 6000)
        await new Promise(rr => setTimeout(rr, 150));
      return { sumiu: !rp.group.visible, vivo: rp.alive };
    });
    assert.ok(!r.vivo, 'roster não marcou o remoto como morto');
    assert.ok(r.sumiu, 'boneco morto continuou de pé (estátua)');
  });
});

describe('BR — indicadores da zona e cabine da nave', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h, bot;
  before(async () => {
    h = await bootGame({ port: 3181, extraEnv: { COUNTDOWN_S: '1', NEXT_IN_S: '120' } });
    bot = await startBRMatch(h);
  });
  after(async () => {
    if (bot) bot.close();
    if (h) await h.close();
  });

  it('dado o jogador FORA da safe, então a tela avermelha — e limpa ao voltar', async t => {
    const r = await h.play(async () => {
      const QA = window.QA, dbg = window.__BR_debug, P = QA.MP.player;
      const zc = dbg.zc;
      // fora da zona (bem além do raio atual)
      const ang = 0.7;
      P.pos.set(zc.x + Math.cos(ang) * (zc.r + 80), 5, zc.z + Math.sin(ang) * (zc.r + 80));
      P.invulnUntil = QA.MP.state.gameTime + 999; // não morrer durante a medição
      await new Promise(rr => setTimeout(rr, 1400)); // brTick atualiza a cada 0.5s
      const foraOpacity = document.getElementById('gasTint').style.opacity;
      P.pos.set(zc.x, QA.MP.groundAt(zc.x, zc.z, 999), zc.z); // centro da safe
      await new Promise(rr => setTimeout(rr, 1400));
      const dentroOpacity = document.getElementById('gasTint').style.opacity;
      P.invulnUntil = 0;
      return { foraOpacity, dentroOpacity };
    });
    assert.equal(r.foraOpacity, '1', 'tela não avermelhou fora da safe');
    assert.equal(r.dentroOpacity, '0', 'tinta vermelha não limpou dentro da safe');
  });

  it('dada a nave, então ela tem cabine com janela de vidro no chão', async t => {
    const r = await h.play(() => {
      const ship = window.__BR_debug.ship;
      if (!ship) return null;
      const janela = ship.g.getObjectByName('cabineJanela');
      return { temJanela: !!janela, filhos: ship.g.children.length };
    });
    if (!r) { t.skip('nave ainda não construída'); return; }
    assert.ok(r.temJanela, 'janela do chão da cabine sumiu');
    assert.ok(r.filhos >= 15, `cabine incompleta (${r.filhos} peças)`);
  });
});
