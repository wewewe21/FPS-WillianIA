/* ================================================================
   QA — correções de personagem/armas (rodada "da água pro vinho", lote 1).
   (1) recarga: GLB da sniper idx6 em fallback NÃO pode derrubar os
       complementos da escopeta idx7 (bug do rig que sumia a arma);
   (2) recarga: startReload/finishReload não rodam dirigindo/morto.
   Boot com o GLB da sniper BLOQUEADO → força o caminho de fallback (RED/GREEN).
   Porta própria 3263.
   ================================================================ */
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { CHROME, bootGame, startBRMatch } = require('./helpers/harness');

describe('Correções de personagem/armas — lote 1', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h, host;
  const PORT = 3263;

  before(async () => {
    // bloqueia só a sniper "Rápida" (idx6, minúsculo 'sniper_R') — idx2 é 'Sniper_l'
    h = await bootGame({ port: PORT, blockRequests: ['low-poly_sniper_R'], extraEnv: { COUNTDOWN_S: '1', NEXT_IN_S: '300' } });
    host = await startBRMatch(h, { serverPort: PORT });
  });
  after(async () => { if (host) host.close(); if (h) await h.close(); });

  it('sniper idx6 em fallback não derruba o attach das outras armas (idx7 recebe complementos)', async () => {
    const r = await h.play(async () => {
      await window.__game.WeaponModels.ready;
      await new Promise(res => setTimeout(res, 60)); // deixa o .then de attachComplements rodar
      const st = window.__game.WeaponRig.status();
      return { status: st.map(s => ({ idx: s.idx, name: s.name, sights: s.sights })), errors: window.__game.errors.slice() };
    });
    assert.deepEqual(r.errors, [], `erros de página: ${r.errors.join(' | ')}`);
    const sniper = r.status.find(s => s.idx === 6);
    assert.ok(sniper, 'sniper idx6 ausente');
    const shotgun = r.status.find(s => s.idx === 7);
    assert.ok(shotgun && shotgun.sights > 0, `escopeta idx7 (${shotgun && shotgun.name}) sem complementos — a corrente de attach quebrou no fallback da sniper`);
    // toda arma não-faca (idx 5) tem que ter recebido miras
    for (const s of r.status) {
      if (s.idx === 5) continue; // faca não tem mira
      assert.ok(s.sights > 0, `${s.name} (idx${s.idx}) ficou sem miras — attach interrompido`);
    }
  });

  it('recarga não começa/completa dirigindo ou morto; completa normal', async () => {
    const r = await h.play(() => {
      const G = window.__game, MP = window.__MP, QA = window.QA;
      QA.reset(40, 40);
      G.arsenal[0].locked = false; G.switchWeapon(0); // FUZIL idx0 (GLB carregou normal)
      const gun = G.gun;
      gun.mag = 5; gun.reserve = 100; gun.reloading = false;

      G.state.driving = true;                       // dirigindo: R não faz nada
      MP.justPressed.add('KeyR'); QA.tick(1);
      const driving = { reloading: gun.reloading, mag: gun.mag };
      G.state.driving = false;

      MP.player.dead = true;                         // morto: R não faz nada
      MP.justPressed.add('KeyR'); QA.tick(1);
      const dead = { reloading: gun.reloading, mag: gun.mag };
      MP.player.dead = false;

      MP.justPressed.add('KeyR'); QA.tick(1);        // normal: começa
      const started = gun.reloading;
      for (let i = 0; i < Math.ceil(gun.reloadTime * 62); i++) QA.tick(1); // passa do reloadEnd
      const done = { reloading: gun.reloading, mag: gun.mag };
      return { driving, dead, started, done, magSize: gun.magSize };
    });
    assert.equal(r.driving.reloading, false, 'recarga começou dirigindo');
    assert.equal(r.driving.mag, 5, 'mag mudou dirigindo');
    assert.equal(r.dead.reloading, false, 'recarga começou morto');
    assert.equal(r.dead.mag, 5, 'mag mudou morto');
    assert.equal(r.started, true, 'recarga normal não começou');
    assert.equal(r.done.reloading, false, 'recarga normal não terminou');
    assert.equal(r.done.mag, r.magSize, `pente não encheu (${r.done.mag}/${r.magSize})`);
  });
});
