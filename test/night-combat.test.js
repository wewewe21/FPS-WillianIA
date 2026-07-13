'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

async function makeNight({ segBlocked = () => false, obstaclesNear = () => [] } = {}) {
  const THREE = await import('three');
  const { createNight } = await import('../js/night.js');
  const damage = [];
  const player = { pos: new THREE.Vector3(1, 0, 0), dead: false };
  const night = createNight({
    rand: () => 0,
    TAU: Math.PI * 2,
    heightAt: () => 0,
    WATER_LEVEL: -10,
    SFX: { whisper() {}, groan() {} },
    scene: new THREE.Scene(),
    csmMat: material => material,
    Structures: { segBlocked, collide() {} },
    obstaclesNear,
    addScore() {},
    addKillFeed() {},
    state: { started: false },
    player,
    playerDamage: (...args) => damage.push(args),
    extraTargets: [],
    Pickups: { drop() {} },
    Env: { nightK: 0.6 },
    MFlags: {},
  });

  function activate(ghost) {
    for (const creature of night.list) {
      creature.alive = false;
      creature.group.visible = false;
    }
    const creature = night.list.find(candidate => candidate.ghost === ghost);
    creature.alive = true;
    creature.hp = 100;
    creature.hitT = 0;
    creature.group.visible = true;
    creature.group.position.set(0, 0, 0);
    return creature;
  }

  return { night, player, damage, activate };
}

describe('Criaturas da noite — contato físico', () => {
  it('zumbi e fantasma não acertam através de uma estrutura', async () => {
    for (const ghost of [false, true]) {
      const { night, damage, activate } = await makeNight({ segBlocked: () => true });
      activate(ghost);

      night.update(0, 0);

      assert.equal(damage.length, 0, `${ghost ? 'fantasma' : 'zumbi'} atravessou a estrutura`);
    }
  });

  it('zumbi e fantasma não acertam através de árvore ou pedra circular', async () => {
    for (const ghost of [false, true]) {
      const { night, damage, activate } = await makeNight({
        obstaclesNear: () => [{ x: 0.5, z: 0, r: 0.3 }],
      });
      activate(ghost);

      night.update(0, 0);

      assert.equal(damage.length, 0, `${ghost ? 'fantasma' : 'zumbi'} atravessou o obstáculo`);
    }
  });

  it('mantém posição e rotação finitas quando criatura e jogador têm o mesmo X/Z', async () => {
    const { night, player, activate } = await makeNight();
    const zombie = activate(false);
    player.pos.set(0, 10, 0);

    night.update(1 / 60, 0);

    assert.ok(Number.isFinite(zombie.group.position.x), 'posição X virou NaN');
    assert.ok(Number.isFinite(zombie.group.position.z), 'posição Z virou NaN');
    assert.ok(Number.isFinite(zombie.group.rotation.y), 'rotação virou NaN');
  });
});
