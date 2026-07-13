'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { CHROME, bootGame, startBRMatch } = require('./helpers/harness');

describe('BR — cobertura também bloqueia dano de rede', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h, host;
  const PORT = 3185;

  before(async () => {
    h = await bootGame({ port: PORT, extraEnv: { COUNTDOWN_S: '1', NEXT_IN_S: '300' } });
    host = await startBRMatch(h, { serverPort: PORT });
  });
  after(async () => { if (host) host.close(); if (h) await h.close(); });

  it('tiro remoto não atravessa uma parede entre atirador e vítima', async () => {
    const setup = await h.play(() => {
      const { G, MP } = window.QA;
      const wall = G.Structures.walls.find(w => {
        if (w.noCollide || w.y1 - w.y0 < 2.2) return false;
        const thinX = w.x1 - w.x0 < 1.5;
        const thinZ = w.z1 - w.z0 < 1.5;
        return thinX !== thinZ;
      });
      if (!wall) return null;
      const thinX = wall.x1 - wall.x0 < 1.5;
      const cx = (wall.x0 + wall.x1) / 2, cz = (wall.z0 + wall.z1) / 2;
      const victimX = thinX ? wall.x0 - 1.2 : cx;
      const victimZ = thinX ? cz : wall.z0 - 1.2;
      const shooterX = thinX ? wall.x1 + 1.2 : cx;
      const shooterZ = thinX ? cz : wall.z1 + 1.2;
      window.QA.reset(victimX, victimZ);
      const P = MP.player;
      P.health = 100; P.armor = 0; P.invulnUntil = 0;
      return {
        victimId: window.__MP_init.id,
        shooter: [shooterX, MP.heightAt(shooterX, shooterZ), shooterZ],
      };
    });
    assert.ok(setup, 'nenhuma parede apropriada encontrada');
    host.emit('state', {
      pos: setup.shooter, rotY: 0, heldWeapon: 'FUZIL', ship: false, fall: false,
    });
    await new Promise(resolve => setTimeout(resolve, 350));
    host.emit('shotHit', {
      targetId: setup.victimId, dmg: 25, weapon: 'FUZIL',
      fromPos: [setup.shooter[0], setup.shooter[1] + 1.5, setup.shooter[2]],
    });
    await new Promise(resolve => setTimeout(resolve, 350));
    const health = await h.play(() => window.__game.player.health);
    assert.equal(health, 100, `parede não bloqueou o dano de rede (vida=${health})`);
  });

  it('o heliponto tem baú DE VERDADE no BR (key torre, na altura do telhado)', async () => {
    const crate = await h.play(() => {
      const c = window.__BR_debug.crates.find(c => c.key === 'torre');
      return c ? { y: c.g.position.y, opened: c.opened } : null;
    });
    assert.ok(crate, 'baú do heliponto não existe no BR');
    assert.ok(crate.y > 20, `baú da torre no chão (y=${crate.y}) — deveria estar no telhado`);
    assert.equal(crate.opened, false);
  });

  it('tiro humano que ERRA vira playerFired visível pros outros', async () => {
    const fired = [];
    host.on('playerFired', d => fired.push(d));
    await h.play(() => { window.QA.reset(30, 30); });
    await new Promise(resolve => setTimeout(resolve, 350)); // estado autoritativo assenta
    await h.play(() => {
      const { MP } = window.QA;
      const P = MP.player.pos;
      window.__BR_shotMiss(
        new MP.THREE.Vector3(P.x, P.y + 1.5, P.z),
        new MP.THREE.Vector3(P.x + 40, P.y + 1, P.z),
        'FUZIL');
    });
    await new Promise(resolve => setTimeout(resolve, 400));
    host.off('playerFired');
    assert.equal(fired.length, 1, 'erro de tiro humano continua invisível na rede');
    assert.equal(fired[0].weapon, 'FUZIL');
    assert.equal(fired[0].targetId, null, 'miss não pode apontar vítima');
  });

  it('explosão BR não atravessa parede até outro jogador', async () => {
    const result = await h.play(() => {
      const { G, MP } = window.QA;
      const p = new MP.THREE.Vector3(70, 60, 70);
      const wall = { x0: 72.2, x1: 72.7, y0: 56, y1: 65, z0: 66, z1: 74 };
      const target = {
        alive: true, health: 100,
        group: { position: new MP.THREE.Vector3(75, 60, 70) },
        damage(dmg) { this.health -= dmg; },
      };
      G.Structures.walls.push(wall);
      window.__MP_remotePlayers.push(target);
      try {
        window.__BR_splash(p, 7.5, 110);
        const blocked = target.health;
        G.Structures.walls.splice(G.Structures.walls.indexOf(wall), 1);
        target.health = 100;
        window.__BR_splash(p, 7.5, 110);
        return { blocked, open: target.health };
      } finally {
        const wi = G.Structures.walls.indexOf(wall);
        if (wi >= 0) G.Structures.walls.splice(wi, 1);
        const ti = window.__MP_remotePlayers.indexOf(target);
        if (ti >= 0) window.__MP_remotePlayers.splice(ti, 1);
      }
    });
    assert.equal(result.blocked, 100, `splash BR atravessou parede (vida=${result.blocked})`);
    assert.ok(result.open < 100, 'controle de splash BR em campo aberto não causou dano');
  });
});
