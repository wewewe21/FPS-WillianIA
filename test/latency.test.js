/* ================================================================
   QA — sentinela de LATÊNCIA: o jogo inteiro atrás de um proxy TCP
   com +120ms por sentido (~240ms de RTT). Asserts frouxos de
   propósito: o objetivo é caracterizar e garantir ZERO exceptions
   sob lag — não medir números finos (lag compensation é futuro).
   ================================================================ */
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { CHROME, bootGame, startBRMatch } = require('./helpers/harness');
const { createLagProxy } = require('./helpers/lagproxy');

const SRV = 3186, PROXY = 3187, DELAY = 120;

describe('Latência (proxy +120ms por sentido)', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h, bot, proxy;
  before(async () => {
    proxy = await createLagProxy({ targetPort: SRV, listenPort: PROXY, delayMs: DELAY });
    // página fala com o PROXY; o servidor real fica atrás dele
    h = await bootGame({ port: PROXY, serverPort: SRV, extraEnv: { COUNTDOWN_S: '1', NEXT_IN_S: '120' } });
    bot = await startBRMatch(h, { serverPort: SRV }); // bot direto, sem lag
  });
  after(async () => {
    if (bot) bot.close();
    if (h) await h.close();
    if (proxy) proxy.close();
  });

  it('dado o relógio sincronizado via rede lenta, então o offset fica na ordem do atraso', async () => {
    const r = await h.play(() => ({ off: Math.abs(window.__BR_debug.S.clockOffset) }));
    assert.ok(r.off < 600, `clockOffset explodiu: ${r.off}ms`);
  });

  it('dado um tiro vindo de outro jogador, então o dano chega mesmo com lag', async () => {
    // descobre o id da página pelo roster do bot
    const pageId = await new Promise(res => {
      bot.once('roster', d => res((d.players.find(p => p.nick !== 'BotHost') || {}).id));
      bot.emit('hello', { nick: 'BotHost' }); // força um broadcast de roster
    });
    assert.ok(pageId, 'não achei o jogador da página no roster');
    await h.play(() => { const P = window.QA.MP.player; P.invulnUntil = 0; P.health = 100; P.armor = 0; });
    for (let i = 0; i < 4; i++) bot.emit('shotHit', { targetId: pageId, dmg: 20, weapon: 'LAGGUN', fromPos: [0, 5, 0] });
    const r = await h.play(async () => {
      const P = window.QA.MP.player;
      const t0 = performance.now();
      while (P.health >= 100 && performance.now() - t0 < 5000)
        await new Promise(rr => setTimeout(rr, 100));
      return { health: P.health };
    });
    assert.ok(r.health < 100, 'dano nunca chegou com 240ms de RTT');
  });

  it('dado um jogador remoto que congela e volta, então o cliente não lança exceptions', async () => {
    const iv = setInterval(() => bot.volatile.emit('state', { pos: [40, 5, 40], rotY: 0, car: -1 }), 100);
    await new Promise(r => setTimeout(r, 800));
    clearInterval(iv);                    // congela 1.2s (perda de pacotes)
    await new Promise(r => setTimeout(r, 1200));
    const iv2 = setInterval(() => bot.volatile.emit('state', { pos: [60, 5, 60], rotY: 1, car: -1 }), 100);
    await new Promise(r => setTimeout(r, 1500));
    clearInterval(iv2);
    const errs = await h.play(() => window.__game.errors.length);
    assert.equal(errs, 0, 'exceptions no cliente sob lag');
    assert.equal(h.pageErrors.length, 0, 'pageerrors: ' + h.pageErrors.join(' | '));
  });
});
