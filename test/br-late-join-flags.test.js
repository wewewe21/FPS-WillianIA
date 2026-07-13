'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { CHROME, bootGame } = require('./helpers/harness');

describe('BR — flags para quem entra no meio da partida', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h, host;
  const PORT = 3186;

  before(async () => {
    h = await bootGame({ port: PORT, extraEnv: { COUNTDOWN_S: '1', NEXT_IN_S: '300' } });
    host = io(`http://localhost:${PORT}`, { transports: ['websocket'] });
    await new Promise(resolve => host.once('init', resolve));
    host.emit('hello', { nick: 'HostFlags' });
    await new Promise((resolve, reject) => host.timeout(4000).emit(
      'claimHost', { code: 'QUEDALIVRE' },
      (err, data) => (err || !data || !data.ok) ? reject(new Error('claimHost falhou')) : resolve(),
    ));
    host.emit('setFlags', { gas: 'off', alien: true, zumbis: true });
    await new Promise(resolve => setTimeout(resolve, 150));
    host.emit('requestStart');
    await h.page.waitForFunction('window.__BR_debug && !!window.__BR_debug.S.plan', { timeout: 30000 });

    // Novo documento = novo socket recebendo init já em PLAYING, sem matchStart.
    await h.page.reload({ waitUntil: 'networkidle0' });
    await h.page.waitForFunction('window.__BR_debug && window.__BR_debug.S.lateJoin',
      { timeout: 30000, polling: 200 });
  });

  after(async () => { if (host) host.close(); if (h) await h.close(); });

  it('aplica alien e zumbis diretamente das flags do init', async () => {
    const flags = await h.play(() => ({
      alien: window.__BR_alien,
      zumbis: window.__BR_zumbis,
      initAlien: window.__BR_debug.S.flags.alien,
      initZumbis: window.__BR_debug.S.flags.zumbis,
    }));
    assert.deepEqual(flags, { alien: true, zumbis: true, initAlien: true, initZumbis: true });
  });
});
