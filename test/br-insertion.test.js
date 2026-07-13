'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { CHROME, bootGame } = require('./helpers/harness');

describe('Inserção do Battle Royale', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h;
  let host;
  const port = 37500 + (process.pid % 1000);

  before(async () => {
    h = await bootGame({
      port,
      extraEnv: { HOST_CODE: 'INSERTIONQA', COUNTDOWN_S: '1', FLY_TIME: '30' },
    });
    host = io(`http://localhost:${port}`, { transports: ['websocket'] });
    await new Promise(resolve => host.once('init', resolve));
    host.emit('hello', { nick: 'HostInsercao' });
    await new Promise((resolve, reject) => host.timeout(4000).emit(
      'claimHost', { code: 'INSERTIONQA' },
      (error, result) => error || !result?.ok ? reject(error || new Error('claimHost falhou')) : resolve(),
    ));
    host.emit('requestStart');
    await h.page.waitForFunction(
      "window.__BR_debug?.S.phase === 'SHIP' && !!window.__BR_debug.ship",
      { timeout: 15000 },
    );
  });

  after(async () => {
    if (host) host.close();
    if (h) await h.close();
  });

  it('usa Nave.glb em terceira pessoa orbitável e faz transição suave ao saltar', async () => {
    const result = await h.play(async () => {
      const G = window.__game;
      const D = window.__BR_debug;
      if (D.ship.ready) await D.ship.ready;
      G.tick(1 / 60);
      const camera = G.camera;
      const distanceToShip = camera.position.distanceTo(D.ship.g.position);
      const beforeOrbit = camera.position.clone();
      const movement = new MouseEvent('mousemove', { bubbles: true });
      Object.defineProperty(movement, 'movementX', { value: 180 });
      Object.defineProperty(movement, 'movementY', { value: -35 });
      window.dispatchEvent(movement);
      G.tick(1 / 60);
      const orbitTravel = camera.position.distanceTo(beforeOrbit);

      D.jump();
      G.tick(1 / 60);
      const jumpDistance = camera.position.distanceTo(G.player.pos);
      await new Promise(resolve => setTimeout(resolve, 580));
      G.tick(1 / 60);
      const midDistance = camera.position.distanceTo(G.player.pos);
      await new Promise(resolve => setTimeout(resolve, 780));
      G.tick(1 / 60);
      const fpsDistance = camera.position.distanceTo(G.player.pos);

      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
      for (let i = 0; i < 90; i++) G.tick(1 / 60);
      return {
        modelStatus: D.ship.status,
        imported: !!D.ship.modelRoot,
        animation: D.ship.metrics?.animation,
        plumes: D.ship.plumes?.length || 0,
        shipPhase: 'SHIP',
        fallPhase: D.S.phase,
        distanceToShip,
        orbitTravel,
        jumpDistance,
        midDistance,
        fpsDistance,
        chuteOpen: D.S.chuteOpen,
        chuteVisible: G.Parachute.root.visible,
        chuteInflation: G.Parachute.openK,
      };
    });

    assert.equal(result.modelStatus, 'ready');
    assert.equal(result.imported, true);
    assert.equal(result.animation, 'FLY');
    assert.equal(result.plumes, 3);
    assert.ok(result.distanceToShip >= 29, `câmera não ficou externa (${result.distanceToShip})`);
    assert.ok(result.orbitTravel > 2, `mouse não orbitou a nave (${result.orbitTravel})`);
    assert.ok(result.jumpDistance > 20, 'salto perdeu a pose externa instantaneamente');
    assert.ok(result.midDistance < result.jumpDistance && result.midDistance > result.fpsDistance + 3,
      `transição não foi gradual: ${result.jumpDistance} → ${result.midDistance} → ${result.fpsDistance}`);
    assert.ok(result.fpsDistance < 2.2, `câmera não voltou à primeira pessoa (${result.fpsDistance})`);
    assert.equal(result.fallPhase, 'FALL');
    assert.equal(result.chuteOpen, true);
    assert.equal(result.chuteVisible, true);
    assert.ok(result.chuteInflation > 0.9);
  });

  it('não gera erro de runtime', () => assert.deepEqual(h.pageErrors, []));
});
