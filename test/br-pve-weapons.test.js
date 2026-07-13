'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { CHROME, bootGame, startBRMatch } = require('./helpers/harness');

describe('BR — armas também atingem alvos PvE', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h, host;
  const PORT = 3181;

  before(async () => {
    h = await bootGame({ port: PORT, extraEnv: { COUNTDOWN_S: '1', NEXT_IN_S: '300' } });
    await h.page.waitForFunction('window.__game.Skeletons && window.__game.Skeletons.modelReady',
      { timeout: 30000, polling: 200 });
    host = await startBRMatch(h, { serverPort: PORT });
  });

  after(async () => { if (host) host.close(); if (h) await h.close(); });

  it('a faca BR causa dano no esqueleto mais próximo', async () => {
    const r = await h.play(() => {
      const { G, MP } = window.QA;
      const target = G.Skeletons.list[0];
      for (const sk of G.Skeletons.list) {
        sk.alive = false;
        sk.group.visible = false;
      }
      const origin = MP.player.pos.clone();
      origin.y += 1.05;
      target.pos().set(origin.x, MP.heightAt(origin.x, origin.z - 1.5), origin.z - 1.5);
      target.hp = 90;
      target.alive = true;
      target.group.visible = true;
      const before = target.hp;
      window.__BR_melee(origin, new MP.THREE.Vector3(0, 0, -1), 34);
      return { before, after: target.hp };
    });
    assert.ok(r.after < r.before, `faca não causou dano PvE: ${r.before} → ${r.after}`);
  });

  it('projétil BR de fuzil causa dano no esqueleto', async () => {
    const before = await h.play(() => {
      const { G, MP } = window.QA;
      const target = G.Skeletons.list[0];
      const origin = MP.player.pos.clone();
      origin.y += 1.05;
      target.pos().set(origin.x, MP.heightAt(origin.x, origin.z - 8), origin.z - 8);
      target.hp = 90;
      target.alive = true;
      target.group.visible = true;
      window.__BR_ballistics(origin, new MP.THREE.Vector3(0, 0, -1),
        { projSpeed: 120, projDrop: 0.01, dmg: 22, laser: false });
      return target.hp;
    });
    await new Promise(resolve => setTimeout(resolve, 350));
    const after = await h.play(() => window.__game.Skeletons.list[0].hp);
    assert.ok(after < before, `fuzil não causou dano PvE: ${before} → ${after}`);
  });

  it('animal desativado pela regra da sala não bloqueia a arma', async () => {
    const r = await h.play(() => {
      const { G, MP } = window.QA;
      const origin = MP.player.pos.clone();
      origin.y += 1.05;
      const animal = G.Animals.list[0];
      const target = G.Skeletons.list[0];
      for (const sk of G.Skeletons.list) { sk.alive = false; sk.group.visible = false; }
      animal.pos().set(origin.x, MP.heightAt(origin.x, origin.z - 0.7), origin.z - 0.7);
      animal.alive = true;
      target.pos().set(origin.x, MP.heightAt(origin.x, origin.z - 1.8), origin.z - 1.8);
      target.hp = 90;
      target.alive = true;
      target.group.visible = true;
      G.Animals.setEnabled(false);
      window.__BR_melee(origin, new MP.THREE.Vector3(0, 0, -1), 34);
      const hp = target.hp;
      G.Animals.setEnabled(true);
      return hp;
    });
    assert.ok(r < 90, `animal invisível interceptou a faca; HP do esqueleto=${r}`);
  });

  it('alvo PvE desativado não absorve o hitscan da escopeta', async () => {
    const hp = await h.play(() => {
      const { G, MP } = window.QA;
      window.QA.reset(30, 30);
      // o teste anterior deixa o esqueleto VIVO a 1,8m na frente da câmera —
      // ele absorveria o pellet antes do alvo fake a 2m; animais idem
      for (const sk of G.Skeletons.list) { sk.alive = false; sk.group.visible = false; }
      for (const a of G.Animals.list) a.alive = false;
      const gun = G.arsenal[1];
      const original = {
        locked: gun.locked, pellets: gun.pellets, spreadHip: gun.spreadHip,
        spreadAds: gun.spreadAds, mag: gun.mag, lastShot: gun.lastShot,
      };
      gun.locked = false;
      G.switchWeapon(1);
      window.QA.tick(70);
      const origin = MP.camera.getWorldPosition(new MP.THREE.Vector3());
      const dir = new MP.THREE.Vector3(0, 0, -1);
      MP.camera.getWorldDirection(dir);
      const blockerSphere = { c: origin.clone().addScaledVector(dir, 1), r: 0.35, part: 'body' };
      const targetSphere = { c: origin.clone().addScaledVector(dir, 2), r: 0.35, part: 'body' };
      const blocker = {
        alive: true, enabled: false,
        hitSpheres: () => [blockerSphere], damage: () => false,
      };
      const target = {
        alive: true, hp: 90,
        hitSpheres: () => [targetSphere],
        damage(dmg) { this.hp -= dmg; return false; },
      };
      G.extraTargets.push(blocker, target);
      try {
        gun.pellets = 1; gun.spreadHip = 0; gun.spreadAds = 0;
        gun.mag = 1; gun.lastShot = -99;
        G.mouse.clicked = true;
        window.QA.tick(1);
        return target.hp;
      } finally {
        G.extraTargets.splice(G.extraTargets.indexOf(blocker), 1);
        G.extraTargets.splice(G.extraTargets.indexOf(target), 1);
        Object.assign(gun, original);
        G.mouse.clicked = false;
      }
    });
    assert.ok(hp < 90, `alvo desativado absorveu a escopeta; HP final=${hp}`);
  });
});
