'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { CHROME, bootGame } = require('./helpers/harness');

describe('Ataques autônomos — direção e cobertura', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h;
  const PORT = 3185;
  before(async () => { h = await bootGame({ port: PORT }); });
  after(async () => { if (h) await h.close(); });

  it('cano do soldado aponta para o alvo durante a rajada', async () => {
    const probe = await h.play(() => {
      const { G, MP } = window.QA;
      window.QA.reset(30, 30);
      const enemy = G.Enemies.list[0];
      for (const other of G.Enemies.list) other.alive = other === enemy;
      enemy.group.position.set(30, G.heightAt(30, 42), 42);
      enemy.fsm = 'ATAQUE';
      enemy.lastKnown.copy(MP.player.pos);
      enemy.burstLeft = 2;
      enemy.nextShot = 0;
      enemy.nextBurst = 99;
      for (let i = 0; i < 12; i++) G.Enemies.update(1 / 60, i / 60);
      enemy.group.updateMatrixWorld(true);
      const gun = enemy.parts.armR.children.find(o => o.isGroup);
      const gunPos = new MP.THREE.Vector3();
      const gunQ = new MP.THREE.Quaternion();
      gun.getWorldPosition(gunPos);
      gun.getWorldQuaternion(gunQ);
      const gunForward = new MP.THREE.Vector3(0, 0, 1).applyQuaternion(gunQ).normalize();
      const target = MP.player.pos.clone(); target.y += 1.1;
      const targetDir = target.sub(gunPos).normalize();
      return gunForward.dot(targetDir);
    });
    assert.ok(probe > 0.9, `cano fora do alvo: dot=${probe.toFixed(3)}`);
  });

  it('plasma do Visitante não atravessa estrutura', async () => {
    const result = await h.play(() => {
      const { G, MP } = window.QA;
      const alien = G.Alien;
      window.QA.reset(alien.pos().x + 12, alien.pos().z);
      alien.state.alive = true;
      alien.state.active = true;
      alien.state.nextShot = 0;
      const before = MP.player.health;
      const original = G.Structures.segBlocked;
      G.Structures.segBlocked = () => true;
      window.__BR_alien = true;
      for (let i = 0; i < 600; i++) window.QA.tick(1);
      G.Structures.segBlocked = original;
      window.__BR_alien = false;
      return { before, after: MP.player.health };
    });
    assert.ok(result.after >= result.before - 0.1,
      `plasma atravessou parede: ${result.before} → ${result.after}`);
  });

  it('Visitante não pisca nem persegue através de uma estrutura', async () => {
    const moved = await h.play(() => {
      const { G, MP } = window.QA;
      const alien = G.Alien;
      window.__BR_alien = true;
      alien.state.alive = true;
      alien.state.active = true;
      alien.state.blinkT = 0;
      MP.player.dead = false;
      MP.player.pos.set(alien.pos().x + 12, alien.pos().y, alien.pos().z);
      const before = alien.pos().clone();
      const original = G.Structures.segBlocked;
      G.Structures.segBlocked = () => true;
      try {
        alien.update(0.1, 1);
      } finally {
        G.Structures.segBlocked = original;
        window.__BR_alien = false;
      }
      return Math.hypot(before.x - alien.pos().x, before.z - alien.pos().z);
    });
    assert.ok(moved < 0.05, `Visitante atravessou a estrutura (${moved.toFixed(2)}m)`);
  });

  it('orbe do Colosso não atravessa estrutura', async () => {
    const result = await h.play(() => {
      const { G, MP } = window.QA;
      const boss = G.Boss;
      window.__BR_alien = false;
      window.QA.reset(boss.pos().x + 20, boss.pos().z);
      boss.state.alive = true;
      boss.state.active = true;
      boss.state.nextVolley = 0;
      boss.state.nextOrb = 0;
      const before = MP.player.health;
      const original = G.Structures.segBlocked;
      G.Structures.segBlocked = () => true;
      for (let i = 0; i < 180; i++) boss.update(1 / 60, i / 60);
      G.Structures.segBlocked = original;
      return { before, after: MP.player.health };
    });
    assert.ok(result.after >= result.before - 0.1,
      `orbe atravessou parede: ${result.before} → ${result.after}`);
  });

  it('pisão do Colosso não causa dano através de estrutura', async () => {
    const result = await h.play(() => {
      const { G, MP } = window.QA;
      const boss = G.Boss;
      window.__BR_alien = false;
      window.QA.reset(boss.pos().x + 3, boss.pos().z);
      const P = MP.player;
      P.health = 100; P.armor = 0; P.invulnUntil = 0; P.dead = false;
      boss.state.alive = true;
      boss.state.active = true;
      boss.state.stompT = 0;
      boss.state.stompHit = false;
      const before = P.health;
      const original = G.Structures.segBlocked;
      G.Structures.segBlocked = () => true;
      try {
        for (let i = 0; i < 80; i++) boss.update(1 / 60, i / 60);
      } finally {
        G.Structures.segBlocked = original;
      }
      return { before, after: P.health };
    });
    assert.equal(result.after, result.before,
      `pisão atravessou parede: ${result.before} → ${result.after}`);
  });
});
