'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { CHROME, bootGame, startBRMatch } = require('./helpers/harness');

describe('BR — geometria e combate do Golem', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h, host;
  const PORT = 3183;

  before(async () => {
    h = await bootGame({ port: PORT, extraEnv: { COUNTDOWN_S: '1', NEXT_IN_S: '300' } });
    host = await startBRMatch(h, { serverPort: PORT });
    await h.page.waitForFunction('window.__BR_debug && window.__BR_debug.boss', { timeout: 30000 });
  });
  after(async () => { if (host) host.close(); if (h) await h.close(); });

  it('frente visual, movimento e hitbox do núcleo coincidem', async () => {
    await new Promise(resolve => setTimeout(resolve, 100));
    const p = await h.play(() => {
      const { boss } = window.__BR_debug;
      const visualForward = new window.__MP.THREE.Vector3(0, 0, -1)
        .applyQuaternion(boss.group.quaternion).normalize();
      const movementForward = new window.__MP.THREE.Vector3(boss.fw.x, 0, boss.fw.z).normalize();
      const visibleCore = new window.__MP.THREE.Vector3();
      boss.core.getWorldPosition(visibleCore);
      const coreHitbox = boss.hitSpheres().find(s => s.part === 'core').c;
      return {
        forwardDotMovement: visualForward.dot(movementForward),
        coreDistance: visibleCore.distanceTo(coreHitbox),
      };
    });
    assert.ok(p.forwardDotMovement > 0.99,
      `Golem anda de costas (dot=${p.forwardDotMovement.toFixed(3)})`);
    assert.ok(p.coreDistance < 0.08,
      `hitbox do core está ${p.coreDistance.toFixed(2)}m fora do modelo`);
  });

  it('a rota de patrulha não atravessa muralhas nem torres do forte', async () => {
    const route = await h.play(() => {
      const { boss } = window.__BR_debug;
      const { G, MP } = window.QA;
      const F = G.Structures.FORT_POS;
      const radius = Math.hypot(boss.group.position.x - F.x, boss.group.position.z - F.z);
      let minClearance = Infinity, collision = null;
      for (let i = 0; i < 360; i++) {
        const a = i * Math.PI / 180;
        const x = F.x + Math.cos(a) * radius;
        const z = F.z + Math.sin(a) * radius;
        const y = MP.heightAt(x, z);
        for (const w of G.Structures.walls) {
          if (w.noCollide || y >= w.y1 || y + 5.5 < w.y0) continue;
          const nx = Math.max(w.x0, Math.min(w.x1, x));
          const nz = Math.max(w.z0, Math.min(w.z1, z));
          const clearance = Math.hypot(x - nx, z - nz);
          if (clearance < minClearance) {
            minClearance = clearance;
            collision = { angle: i, wall: [w.x0, w.x1, w.z0, w.z1] };
          }
        }
      }
      return { radius, minClearance, collision };
    });
    assert.ok(route.minClearance >= 1.5,
      `órbita r=${route.radius.toFixed(1)} invade forte por ${route.minClearance.toFixed(2)}m em ${route.collision && route.collision.angle}°`);
  });

  it('ataca à distância quando o jogador está fora do alcance do soco', async () => {
    const beforeShots = await h.play(() => {
      const { boss, S } = window.__BR_debug;
      const P = window.__MP.player;
      S.phase = 'PLAY';
      P.dead = false;
      P.health = P.maxHealth;
      P.invulnUntil = 0;
      P.pos.set(boss.group.position.x + 24,
        window.__MP.heightAt(boss.group.position.x + 24, boss.group.position.z),
        boss.group.position.z);
      return window.__BR_debug.golemShots || 0;
    });
    await h.page.waitForFunction(n => window.__BR_debug.golemShots > n,
      { timeout: 4000, polling: 20 }, beforeShots);
    const state = await h.play(() => {
      const { boss, golemShots } = window.__BR_debug;
      const toPlayer = window.__MP.player.pos.clone().sub(boss.group.position);
      toPlayer.y = 0; toPlayer.normalize();
      const visualForward = new window.__MP.THREE.Vector3(0, 0, -1)
        .applyQuaternion(boss.group.quaternion).normalize();
      return { shots: golemShots, aimDot: visualForward.dot(toPlayer) };
    });
    assert.ok(state.shots > beforeShots, 'Golem não disparou nenhum ataque à distância');
    assert.ok(state.aimDot > 0.95,
      `Golem disparou de lado/de costas (dot com o alvo=${state.aimDot.toFixed(3)})`);
  });

  it('pisão não acerta jogador muitos metros acima', async () => {
    const before = await h.play(() => {
      const { boss, S } = window.__BR_debug;
      const P = window.__MP.player;
      S.phase = 'PLAY';
      P.dead = false; P.health = P.maxHealth; P.armor = 0; P.invulnUntil = 0;
      // Congela apenas a física do jogador: sem isto ele cai os 30 m antes
      // da próxima janela do pisão e o teste exercita um alvo já no chão.
      window.__BR_freeze = true;
      P.pos.set(boss.group.position.x + 2, boss.group.position.y + 30, boss.group.position.z);
      return P.health;
    });
    await new Promise(resolve => setTimeout(resolve, 2800));
    const after = await h.play(() => {
      window.__BR_freeze = false;
      return window.__MP.player.health;
    });
    assert.equal(after, before, `pisão atravessou 30m verticais (${before} → ${after})`);
  });

  it('o jogador não atravessa o corpo do Golem', async () => {
    await h.play(() => {
      const { boss, S } = window.__BR_debug;
      const P = window.__MP.player;
      S.phase = 'PLAY';
      window.__BR_freeze = false;
      P.dead = false;
      P.pos.copy(boss.group.position);
      P.vel.set(0, 0, 0);
    });
    await new Promise(resolve => setTimeout(resolve, 250));
    const distance = await h.play(() => {
      const bossPos = window.__BR_debug.boss.group.position;
      const P = window.__MP.player.pos;
      return Math.hypot(P.x - bossPos.x, P.z - bossPos.z);
    });
    assert.ok(distance >= 1.9, `jogador ficou dentro do Golem (distância=${distance.toFixed(2)}m)`);
  });
});
