'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const THREE = require('three');

describe('Explosivos — cobertura e alvos PvE', () => {
  it('bazuca detona ao atingir animal/esqueleto do registro de alvos', async () => {
    const oldWindow = global.window;
    global.window = {};
    try {
      const { createRockets } = await import('../js/rockets.js');
      let explosions = 0;
      const target = {
        alive: true, enabled: true,
        pos: () => new THREE.Vector3(3.4, 0, 0),
      };
      const rockets = createRockets({
        rand: (lo, hi) => (lo + hi) / 2,
        _v1: new THREE.Vector3(), _v2: new THREE.Vector3(),
        heightAt: () => -100,
        FX: { spawnParticle() {} }, scene: new THREE.Scene(),
        Structures: { segBlocked: () => false },
        player: { pos: new THREE.Vector3(100, 0, 100) },
        Enemies: { list: [] }, Grenades: { explode() { explosions++; } },
        Boss: { alive: false }, Bosses: [], extraTargets: [target],
      });
      rockets.fire(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0));
      rockets.update(0.1, 0.1);
      assert.equal(explosions, 1, 'foguete atravessou o alvo PvE sem detonar');
    } finally {
      global.window = oldWindow;
    }
  });

  it('onda de choque não empurra o carro através de parede', async () => {
    const oldWindow = global.window;
    global.window = {};
    try {
      const { createGrenades } = await import('../js/grenades.js');
      const makeCase = blocked => {
        const impulses = [];
        const grenades = createGrenades({
          clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
          rand: (lo, hi) => (lo + hi) / 2,
          _v1: new THREE.Vector3(),
          heightAt: () => -100, terrainNormal: () => {},
          rayBlockedAt: () => (blocked ? 0.5 : Infinity),
          SFX: { explosion() {}, throwNade() {}, bounce() {} },
          FX: { spawnParticle() {} },
          scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(),
          updateInvHUD() {}, state: {},
          player: { pos: new THREE.Vector3(100, 0, 100), vel: new THREE.Vector3() },
          playerDamage() {}, addTrauma() {}, recoil: { kickRot: 0 },
          inventory: { nades: 0 },
          Car: { chassisBody: { position: { x: 5, y: 0, z: 0 }, wakeUp() {}, applyImpulse: v => impulses.push(v) } },
          Enemies: { list: [] }, Bosses: [], extraTargets: [], groundAt: () => -100,
        });
        grenades.explode(new THREE.Vector3(0, 0, 0));
        return impulses;
      };
      assert.equal(makeCase(true).length, 0, 'onda de choque empurrou o carro através da parede');
      assert.equal(makeCase(false).length, 1, 'carro em campo aberto não sentiu a explosão');
    } finally {
      global.window = oldWindow;
    }
  });

  it('bazuca posiciona a explosão antes da face da parede', async () => {
    const oldWindow = global.window;
    global.window = {};
    try {
      const { createRockets } = await import('../js/rockets.js');
      let explosionX = null;
      const rockets = createRockets({
        rand: (lo, hi) => (lo + hi) / 2,
        _v1: new THREE.Vector3(), _v2: new THREE.Vector3(),
        heightAt: () => -100,
        FX: { spawnParticle() {} }, scene: new THREE.Scene(),
        Structures: { segBlocked: () => true, rayHit: () => 1 },
        player: { pos: new THREE.Vector3(100, 0, 100) },
        Enemies: { list: [] }, Grenades: { explode(p) { explosionX = p.x; } },
        Boss: { alive: false }, Bosses: [], extraTargets: [],
      });
      rockets.fire(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0));
      rockets.update(0.1, 0.1);
      assert.ok(explosionX !== null, 'parede não detonou a bazuca');
      assert.ok(explosionX <= 1,
        `explosão nasceu depois da parede (x=${explosionX})`);
    } finally {
      global.window = oldWindow;
    }
  });
});
