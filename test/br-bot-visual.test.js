'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { CHROME, bootGame, startBRMatch } = require('./helpers/harness');

describe('BR — representação visual de bot armado', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h, host, pageId, playerPos;
  const PORT = 3184;

  before(async () => {
    h = await bootGame({ port: PORT, extraEnv: { COUNTDOWN_S: '1', NEXT_IN_S: '300' } });
    host = await startBRMatch(h, { serverPort: PORT });
    ({ pageId, playerPos } = await h.play(() => ({
      pageId: window.__MP_init.id,
      playerPos: window.__MP.player.pos.toArray(),
    })));
    host.emit('hello', { nick: 'BotVisual', bot: true });
    host.emit('state', {
      pos: [playerPos[0] + 3, playerPos[1], playerPos[2]],
      rotY: -Math.PI / 2,
      heldWeapon: 'FUZIL',
    });
    await h.page.waitForFunction('window.__BR_debug.remotes.size > 0', { timeout: 5000 });
  });
  after(async () => { if (host) host.close(); if (h) await h.close(); });

  it('mostra arma na mão e conserva a marca de bot', async () => {
    const state = await h.play(() => {
      const rp = [...window.__BR_debug.remotes.values()][0];
      return { bot: rp.bot, heldWeapon: rp.heldWeapon, weaponVisible: !!(rp.body.weapon && rp.body.weapon.visible) };
    });
    assert.equal(state.bot, true);
    assert.equal(state.heldWeapon, 'FUZIL');
    assert.equal(state.weaponVisible, true);
  });

  it('anima o disparo replicado pelo servidor', async () => {
    host.emit('shotHit', {
      targetId: pageId, dmg: 5, weapon: 'FUZIL',
      fromPos: [playerPos[0] + 3, playerPos[1] + 1.4, playerPos[2]],
    });
    await new Promise(resolve => setTimeout(resolve, 150));
    const fireT = await h.play(() => [...window.__BR_debug.remotes.values()][0].fireT || 0);
    assert.ok(fireT > 0, 'avatar remoto não exibiu o disparo');
  });

  it('reconhece o nome completo da faca sem desenhá-la como fuzil', async () => {
    host.emit('state', {
      pos: [playerPos[0] + 3, playerPos[1], playerPos[2]],
      rotY: -Math.PI / 2,
      heldWeapon: 'FACA "AURORA"',
    });
    await new Promise(resolve => setTimeout(resolve, 250));
    const state = await h.play(() => {
      const rp = [...window.__BR_debug.remotes.values()][0];
      return { heldWeapon: rp.heldWeapon, weaponVisible: rp.body.weapon.visible };
    });
    assert.equal(state.heldWeapon, 'FACA');
    assert.equal(state.weaponVisible, false);
  });

  it('mostra o golpe corpo a corpo quando o bot usa a faca', async () => {
    host.emit('state', {
      pos: [playerPos[0] + 1.5, playerPos[1], playerPos[2]],
      rotY: -Math.PI / 2, heldWeapon: 'FACA "AURORA"', ship: false, fall: false,
    });
    await new Promise(resolve => setTimeout(resolve, 200));
    host.emit('shotFired', {
      weapon: 'FACA "AURORA"',
      fromPos: [playerPos[0] + 1.5, playerPos[1] + 1.4, playerPos[2]],
      toPos: [playerPos[0], playerPos[1], playerPos[2]],
    });
    await h.page.waitForFunction(() => {
      const rp = window.__BR_debug && [...window.__BR_debug.remotes.values()][0];
      return rp && rp.heldWeapon === 'FACA' && rp.fireT > 0 && rp.body.armR.rotation.x < -0.7;
    }, { timeout: 2000, polling: 20 });
    const state = await h.play(() => {
      const rp = [...window.__BR_debug.remotes.values()][0];
      return { fireT: rp.fireT, armX: rp.body.armR.rotation.x, heldWeapon: rp.heldWeapon };
    });
    assert.ok(state.fireT > 0, 'evento de faca não iniciou a animação');
    assert.ok(state.armX < -0.7,
      `braço não executou o golpe (rotation.x=${state.armX}, arma=${state.heldWeapon}, fireT=${state.fireT})`);
  });
});
