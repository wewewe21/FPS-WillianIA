'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { CHROME, bootGame, startBRMatch } = require('./helpers/harness');

describe('Dano — causa explícita e compatível', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h, host, lateAttacker;
  const PORT = 3182;

  before(async () => {
    h = await bootGame({ port: PORT, extraEnv: { COUNTDOWN_S: '1', NEXT_IN_S: '300' } });
    lateAttacker = io(`http://localhost:${PORT}`, { transports: ['websocket'] });
    await new Promise(resolve => lateAttacker.once('init', resolve));
    lateAttacker.emit('hello', { nick: 'TiroTardio' });
    host = await startBRMatch(h, { serverPort: PORT });
  });
  after(async () => {
    if (host) host.close();
    if (lateAttacker) lateAttacker.close();
    if (h) await h.close();
  });

  it('registra causa PvE sem confundi-la com gás', async () => {
    const result = await h.play(() => {
      const { MP, G } = window.QA;
      window.QA.reset();
      MP.playerDamage(1, null, { type: 'animal' });
      return G.player.lastDamageCause || null;
    });
    assert.equal(result && result.type, 'animal');
  });

  it('registra gás como causa própria', async () => {
    const result = await h.play(() => {
      const { MP, G } = window.QA;
      window.QA.reset();
      MP.playerDamage(1, null, { type: 'gas' });
      return G.player.lastDamageCause || null;
    });
    assert.equal(result && result.type, 'gas');
  });

  it('mantém chamadas antigas de dois argumentos válidas', async () => {
    const result = await h.play(() => {
      const { MP } = window.QA;
      window.QA.reset();
      const before = MP.player.health;
      MP.playerDamage(3, { x: 10, y: 0, z: 10 });
      return { before, after: MP.player.health };
    });
    assert.ok(result.after < result.before);
  });

  it('tiro recebido depois da morte não apaga o atacante do golpe letal', async () => {
    const victim = await h.play(() => {
      window.QA.reset(30, 30);
      const P = window.QA.MP.player;
      P.health = 10;
      P.armor = 0;
      P.invulnUntil = 0;
      P.lastDamageCause = null;
      return { id: window.__MP_init.id, pos: P.pos.toArray() };
    });
    host.emit('state', {
      pos: [victim.pos[0] + 2, victim.pos[1], victim.pos[2]], rotY: 0,
      heldWeapon: 'FUZIL', fall: false, ship: false,
    });
    lateAttacker.emit('state', {
      pos: [victim.pos[0] + 3, victim.pos[1], victim.pos[2]], rotY: 0,
      heldWeapon: 'DMR', fall: false, ship: false,
    });
    await new Promise(resolve => setTimeout(resolve, 300));

    const killed = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('morte não foi reportada')), 7000);
      const onKilled = d => {
        if (d.victimId !== victim.id) return;
        clearTimeout(timeout);
        host.off('playerKilled', onKilled);
        resolve(d);
      };
      host.on('playerKilled', onKilled);
    });
    host.emit('shotHit', {
      targetId: victim.id, dmg: 20, weapon: 'FUZIL',
      fromPos: [victim.pos[0] + 2, victim.pos[1] + 1.5, victim.pos[2]],
    });
    await h.page.waitForFunction('window.__game.player.dead === true', { timeout: 3000 });
    lateAttacker.emit('shotHit', {
      targetId: victim.id, dmg: 5, weapon: 'DMR',
      fromPos: [victim.pos[0] + 3, victim.pos[1] + 1.5, victim.pos[2]],
    });
    await new Promise(resolve => setTimeout(resolve, 150));
    await h.play(() => window.__QA_originalRespawn());

    const event = await killed;
    assert.equal(event.killerId, host.id, 'o tiro tardio apagou o atacante letal');
    assert.equal(event.weapon, 'FUZIL');
    assert.equal(event.cause, 'player');
  });
});
