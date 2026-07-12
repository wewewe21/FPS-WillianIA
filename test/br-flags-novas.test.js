/* ================================================================
   QA — FLAGS NOVAS DA SALA (BDD dos pedidos de playtest).
   - dado gás "off" pela sala, então a partida vem sem zona e ninguém
     toma dano de gás em lugar nenhum do mapa
   - dado gás "inversa", então o dano é DENTRO do círculo (o gás
     cresce do centro) e as bordas ficam seguras
   - dado o Visitante ligado (padrão), então o alien da nave volta a
     aparecer nas partidas BR; desligado pela sala, dorme
   ================================================================ */
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { CHROME, bootGame } = require('./helpers/harness');

/* host de verdade: entra, dá o código, ajusta flags e inicia */
async function startWithFlags(h, flags, port) {
  const bot = io(`http://localhost:${port}`, { transports: ['websocket'] });
  await new Promise(r => bot.once('init', r));
  bot.emit('hello', { nick: 'BotHost' });
  await new Promise((res, rej) => bot.timeout(4000).emit('claimHost', { code: 'QUEDALIVRE' },
    (e, d) => (e || !d || !d.ok) ? rej(new Error('claimHost falhou')) : res()));
  bot.emit('setFlags', flags);
  await new Promise(r => setTimeout(r, 150)); // flags assentam antes do start
  bot.emit('requestStart');
  await h.page.waitForFunction('window.__BR_debug && !!window.__BR_debug.S.plan', { timeout: 30000 });
  await h.play(() => {
    window.__BR_debug.S.phase = 'PLAY';
    window.__BR_freeze = false;
    window.QA.reset(30, 30);
  });
  return bot;
}

describe('Sala — gás desligado', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h, bot;
  const PORT = 3166;
  before(async () => {
    h = await bootGame({ port: PORT, extraEnv: { COUNTDOWN_S: '1', NEXT_IN_S: '300' } });
    bot = await startWithFlags(h, { gas: 'off' }, PORT);
  });
  after(async () => { if (bot) bot.close(); if (h) await h.close(); });

  it('dado gas=off, então o plano chega sem fases e sem dano em canto nenhum', async () => {
    // o gás roda no rAF real: espera de relógio num canto que o gás
    // clássico morderia (fora do 1º círculo) prova que off desliga tudo
    const r = await h.play(async () => {
      const QA = window.QA, S = window.__BR_debug.S;
      QA.reset(-450, -450); // canto do mapa
      const antes = QA.MP.player.health;
      await new Promise(res => setTimeout(res, 5000)); // rAFs reais passam
      return { gas: S.plan.gas, fases: S.plan.zone.length, antes, depois: QA.MP.player.health };
    });
    assert.equal(r.gas, 'off');
    assert.equal(r.fases, 0, 'gás off não pode ter fases');
    assert.equal(r.depois, r.antes, `tomou dano no canto com gás off: ${r.antes} → ${r.depois}`);
  });
});

describe('Sala — gás inverso', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h, bot;
  const PORT = 3165;
  before(async () => {
    h = await bootGame({ port: PORT, extraEnv: { COUNTDOWN_S: '1', NEXT_IN_S: '300' } });
    bot = await startWithFlags(h, { gas: 'inversa' }, PORT);
  });
  after(async () => { if (bot) bot.close(); if (h) await h.close(); });

  it('dado gas=inversa, então queima DENTRO do círculo e a borda fica segura', async () => {
    // o laço da zona roda no rAF real da página (não no tick manual):
    // força a fase final e espera o gás morder em tempo de relógio
    const gas = await h.play(() => {
      const QA = window.QA, S = window.__BR_debug.S;
      for (const p of S.plan.zone) { p.tWaitEnd = -100; p.tShrinkEnd = -50; }
      const last = S.plan.zone[S.plan.zone.length - 1];
      QA.reset(last.nx, last.nz); // centro do gás crescido
      return S.plan.gas;
    });
    assert.equal(gas, 'inversa');
    await h.page.waitForFunction('window.QA.MP.player.health < 94',
      { timeout: 30000, polling: 250 }); // queimou no centro
    const r = await h.play(async () => {
      const QA = window.QA;
      QA.reset(-500, -500); // borda do mapa: fora do círculo final (r≤480)
      const antes = QA.MP.player.health;
      await new Promise(res => setTimeout(res, 5000)); // rAFs reais passam
      return { antes, depois: QA.MP.player.health };
    });
    assert.ok(r.depois >= r.antes - 0.1,
      `borda devia ser segura: ${r.antes} → ${r.depois}`);
  });
});

describe('Sala — Visitante alienígena no BR', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h, bot;
  const PORT = 3164;
  before(async () => {
    h = await bootGame({ port: PORT, extraEnv: { COUNTDOWN_S: '1', NEXT_IN_S: '300' } });
    bot = await startWithFlags(h, { gas: 'off' }, PORT); // sem gás: só o alien mexe na vida
  });
  after(async () => { if (bot) bot.close(); if (h) await h.close(); });

  it('dado o flag desligado, então o Visitante dorme mesmo com o player na cara', async () => {
    const r = await h.play(() => {
      const QA = window.QA, A = window.__game.Alien;
      window.__BR_alien = false;
      QA.reset(A.SITE.x + 8, A.SITE.z + 8);
      QA.tick(120); // 2 s na frente da nave
      return { ativo: A.state.active };
    });
    assert.equal(r.ativo, false, 'alien acordou com o flag desligado');
  });

  it('dado o flag ligado (padrão da sala), então o Visitante acorda e ataca no BR', async () => {
    const r = await h.play(() => {
      const QA = window.QA, A = window.__game.Alien;
      window.__BR_alien = true;
      QA.reset(A.SITE.x + 8, A.SITE.z + 8);
      const antes = QA.MP.player.health;
      QA.tick(600); // 10 s: acorda, blinka e atira plasma
      return { ativo: A.state.active, atirou: A.state.nextShot > 0, antes, depois: QA.MP.player.health };
    });
    assert.equal(r.ativo, true, 'alien não acordou no BR com flag ligado');
    assert.ok(r.atirou || r.depois < r.antes,
      `alien acordou mas não atacou (health ${r.antes} → ${r.depois})`);
  });
});
