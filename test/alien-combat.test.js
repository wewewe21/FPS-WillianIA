/* Visitante: ataques precisam continuar funcionais depois da troca do visual GLB. */
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { CHROME, bootGame } = require('./helpers/harness');

describe('Combate do Visitante', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h;
  before(async () => { h = await bootGame({ port: 3215 }); });
  after(async () => { if (h) await h.close(); });

  it('atinge o jogador com plasma e com o golpe de curta distância', async () => {
    const result = await h.play(() => {
      const { G } = window.QA;
      const P = G.player;
      window.QA.reset(35, 35);
      window.__BR_active = false;
      for (const e of G.Enemies.list) {
        e.alive = false;
        e.respawnT = 999;
        e.group.visible = false;
      }
      P.maxHealth = 5000;
      P.health = 5000;
      P.invulnUntil = 0;

      const A = G.Alien;
      const S = A.state;
      S.alive = true;
      S.active = true;
      S.hp = S.hpMax;
      S.deadT = -1;
      S.blinkT = 999;
      S.nextMelee = Infinity;
      S.nextShot = G.state.gameTime;
      A.pos().set(P.pos.x, P.pos.y, P.pos.z - 14);
      const beforePlasma = P.health;
      window.QA.tick(90);
      const afterPlasma = P.health;

      // Deixa os projéteis anteriores terminarem antes de isolar o golpe.
      S.nextShot = Infinity;
      S.nextMelee = G.state.gameTime;
      S.meleeT = 0;
      S.meleeHit = false;
      P.health = 5000;
      P.invulnUntil = 0;
      A.pos().set(P.pos.x, P.pos.y, P.pos.z - 3.2);
      const beforeMelee = P.health;
      window.QA.tick(55);
      return {
        plasmaDamage: beforePlasma - afterPlasma,
        meleeDamage: beforeMelee - P.health,
        active: S.active,
      };
    });

    assert.equal(result.active, true);
    assert.ok(result.plasmaDamage > 0, `plasma não causou dano (${result.plasmaDamage})`);
    assert.ok(result.meleeDamage >= 30, `golpe não causou dano suficiente (${result.meleeDamage})`);
  });

  it('não gera erro de runtime', () => assert.deepEqual(h.pageErrors, []));
});
