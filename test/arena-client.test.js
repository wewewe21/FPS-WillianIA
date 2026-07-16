'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { CHROME, bootGame } = require('./helpers/harness');

const ack = (socket, event, data) => new Promise((resolve, reject) =>
  socket.timeout(5000).emit(event, data, (error, result) => error ? reject(error) : resolve(result)));

describe('Cliente dos modos 1v1 e Mata-Mata', { skip: !CHROME && 'Chrome nao encontrado', timeout: 120000 }, () => {
  let h;
  let bot;
  let room;
  let botMatch;
  const port = 39100 + (process.pid % 700);

  before(async () => {
    h = await bootGame({
      port,
      extraEnv: { ARENA_COUNTDOWN_S: '1', ARENA_RETURN_S: '2', ARENA_INVULN_MS: '20' },
    });
    bot = io(`http://localhost:${port}`, { transports: ['websocket'] });
    await new Promise(resolve => bot.once('init', resolve));
    bot.emit('hello', { nick: 'BotArena' });
  });

  after(async () => {
    if (bot) bot.close();
    if (h) await h.close();
  });

  it('navega pelo hub responsivo, cria a sala e mostra o estado de espera', async () => {
    await h.page.waitForSelector('[data-hub-mode="DUEL"]', { timeout: 15000 });
    await h.page.waitForFunction('window.__MP.socket.connected', { timeout: 15000 });
    await h.play(() => document.querySelector('[data-hub-mode="DUEL"]').click());
    await h.page.waitForFunction("getComputedStyle(document.getElementById('arenaContent')).display !== 'none'");
    const visual = await h.play(() => ({
      modes: document.querySelectorAll('.brMode').length,
      arenaVisible: getComputedStyle(document.getElementById('arenaContent')).display !== 'none',
      background: getComputedStyle(document.getElementById('brLobby')).backgroundImage,
      columns: getComputedStyle(document.querySelector('.arenaGrid')).gridTemplateColumns,
    }));
    assert.equal(visual.modes, 4);
    assert.equal(visual.arenaVisible, true);
    assert.match(visual.background, /gradient/i);
    assert.notEqual(visual.columns, 'none');

    await h.play(() => {
      document.getElementById('arenaName').value = 'Duelo QA';
      document.getElementById('arenaMode').value = 'DUEL';
      document.getElementById('arenaMax').value = '2';
      document.getElementById('arenaMap').value = 'CAMP';
      document.getElementById('arenaScore').value = '3';
      document.getElementById('arenaTime').value = '3';
      document.getElementById('arenaRespawn').value = '1';
      document.getElementById('arenaCreateBtn').click();
    });
    await h.page.waitForFunction("getComputedStyle(document.getElementById('arenaCurrent')).display !== 'none'", { timeout: 8000 });
    const rooms = await ack(bot, 'arenaList', {});
    room = rooms.rooms.find(item => item.name === 'Duelo QA');
    assert.ok(room, 'sala criada pelo menu nao apareceu no servidor');
    assert.equal(room.mode, 'DUEL');
    assert.equal(room.maxPlayers, 2);
    assert.equal((await ack(bot, 'arenaJoin', { id: room.id })).ok, true);
    await h.page.waitForFunction("!document.getElementById('arenaCurrentStart').disabled", { timeout: 8000 });
    const state = await h.play(() => ({
      text: document.getElementById('arenaCurrent').textContent,
      startText: document.getElementById('arenaCurrentStart').textContent,
    }));
    assert.match(state.text, /BotArena/);
    assert.match(state.startText, /INICIAR/);
  });

  it('entra no FPS, sincroniza avatar e obedece morte/respawn autoritativos', async () => {
    const started = new Promise(resolve => bot.once('arenaMatchStart', resolve));
    await h.page.waitForFunction('window.__MP.socket.connected', { timeout: 15000 });
    await h.play(() => document.getElementById('arenaCurrentStart').click());
    botMatch = await started;
    await h.page.waitForFunction('window.__ARENA_active && window.__ARENA_debug?.active', { timeout: 15000 });
    const hostId = botMatch.room.hostId;
    const hostState = new Promise(resolve => {
      const handler = update => {
        if (update.id !== hostId) return;
        bot.off('arenaPlayerUpdate', handler);
        resolve(update);
      };
      bot.on('arenaPlayerUpdate', handler);
    });
    const stateTimer = setInterval(() => bot.emit('arenaState', { pos: botMatch.spawn, rotY: 0 }), 80);
    try {
      await h.page.waitForFunction(
        '[...window.__ARENA_debug.remotes.values()].some(remote => remote.group.visible)',
        { timeout: 8000 },
      );
      await h.play(() => {
        window.__arenaKilledQA = 0;
        window.__MP.socket.on('arenaKilled', data => {
          if (data.victimId === window.__MP_init.id) window.__arenaKilledQA++;
        });
      });
      const hostPos = (await hostState).pos;
      const delta = hostPos.map((value, index) => value - botMatch.spawn[index]);
      const length = Math.hypot(...delta) || 1;
      const hit = shotSeq => ({
        targetId: hostId, weaponId: 6, shotSeq, hits: 1, headshots: 1,
        aim: delta.map(value => value / length),
      });
      assert.equal((await ack(bot, 'arenaHit', hit(1))).health, 40);
      await new Promise(resolve => setTimeout(resolve, 280));
      assert.equal((await ack(bot, 'arenaHit', hit(2))).killed, true);
      await h.page.waitForFunction('window.__arenaKilledQA === 1', { timeout: 5000 });
      await h.page.waitForFunction('!window.__game.player.dead && window.__game.player.health === 100', { timeout: 7000 });
      const result = await h.play(() => ({
        active: window.__ARENA_active,
        remoteCount: window.__MP_remotePlayers.length,
        health: window.__game.player.health,
        dead: window.__game.player.dead,
        botScore: window.__ARENA_debug.room.players.find(player => player.nick === 'BotArena')?.score,
        errors: window.__game.errors.slice(),
      }));
      assert.equal(result.active, true);
      assert.equal(result.remoteCount, 1);
      assert.equal(result.health, 100);
      assert.equal(result.dead, false);
      assert.equal(result.botScore, 1);
      assert.deepEqual(result.errors, []);
      assert.deepEqual(h.pageErrors, []);
    } finally {
      clearInterval(stateTimer);
    }
  });

  it('entra diretamente em espectador quando o backend aplica a sanção de integridade', async () => {
    const results = await h.play(async () => {
      const socket = window.__MP.socket;
      window.__MP.playerDamage = () => ({ blocked: true });
      const targetId = [...window.__ARENA_debug.remotes.keys()][0];
      const payload = {
        targetId, weaponId: 5, shotSeq: 2_000_000,
        hits: 1, headshots: 1, aim: [0, 0, -1],
      };
      const emit = () => new Promise((res, rej) =>
        socket.timeout(3000).emit('arenaHit', payload, (error, data) => error ? rej(error) : res(data)));
      return { first: await emit(), second: await emit(), third: await emit() };
    });
    assert.equal(results.first.ok, false);
    assert.equal(results.second.ok, false);
    assert.equal(results.third.enforced, true);

    await h.page.waitForFunction(
      "window.__BR_freeze && document.getElementById('arenaSpawnNotice')?.textContent.includes('ESPECTADOR')",
      { timeout: 5000 },
    );
    await new Promise(resolve => setTimeout(resolve, 1200));
    const state = await h.play(() => ({
      frozen: window.__BR_freeze,
      notice: document.getElementById('arenaSpawnNotice')?.textContent,
      meAlive: window.__ARENA_debug.room.players.find(player => player.id === window.__MP_init.id)?.alive,
      errors: window.__game.errors.slice(),
    }));
    assert.equal(state.frozen, true);
    assert.match(state.notice, /ESPECTADOR/);
    assert.equal(state.meAlive, false);
    assert.deepEqual(state.errors, []);
    assert.deepEqual(h.pageErrors, []);
  });
});
