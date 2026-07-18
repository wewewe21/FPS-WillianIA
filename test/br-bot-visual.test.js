'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { CHROME, bootGame, startBRMatch } = require('./helpers/harness');

describe('BR — representação visual de bot armado', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h, host, pageId, playerPos;
  const PORT = 3184;

  before(async () => {
    h = await bootGame({ port: PORT, extraEnv: { COUNTDOWN_S: '1', NEXT_IN_S: '300' } });
    host = await startBRMatch(h, { serverPort: PORT });
    ({ pageId, playerPos } = await h.play(() => ({
      pageId: window.__MP_init.id,
      playerPos: window.__MP.player.pos.toArray(),
    })));
    host.emit('hello', { nick: 'BotVisual', bot: true });
    // o servidor retransmite via volatile (pode dropar sob carga): repete o
    // MESMO estado até o avatar aparecer — idempotente, sem flake de boot
    const st = {
      pos: [playerPos[0] + 3, playerPos[1], playerPos[2]],
      rotY: -Math.PI / 2,
      heldWeapon: 'FUZIL',
    };
    host.emit('state', st);
    const retry = setInterval(() => host.emit('state', st), 250);
    try {
      await h.page.waitForFunction('window.__BR_debug.remotes.size > 0', { timeout: 15000 });
    } finally { clearInterval(retry); }
  });
  after(async () => { if (host) host.close(); if (h) await h.close(); });

  it('mostra arma na mão e conserva a marca de bot', async () => {
    const state = await h.play(() => {
      const rp = [...window.__BR_debug.remotes.values()][0];
      return { bot: rp.bot, heldWeapon: rp.heldWeapon, weaponVisible: !!(rp.body.weapon && rp.body.weapon.visible) };
    });
    assert.equal(state.bot, true);
    assert.equal(state.heldWeapon, 'FUZIL');
    assert.equal(state.weaponVisible, true);
  });

  it('anima o disparo replicado pelo servidor', async () => {
    host.emit('shotHit', {
      targetId: pageId, dmg: 5, weapon: 'FUZIL',
      fromPos: [playerPos[0] + 3, playerPos[1] + 1.4, playerPos[2]],
    });
    await new Promise(resolve => setTimeout(resolve, 150));
    const fireT = await h.play(() => [...window.__BR_debug.remotes.values()][0].fireT || 0);
    assert.ok(fireT > 0, 'avatar remoto não exibiu o disparo');
  });

  it('reconhece o nome completo da faca sem desenhá-la como fuzil', async () => {
    host.emit('state', {
      pos: [playerPos[0] + 3, playerPos[1], playerPos[2]],
      rotY: -Math.PI / 2,
      heldWeapon: 'FACA "AURORA"',
    });
    // espera a arma sumir (a transição de coldre leva alguns frames)
    await h.page.waitForFunction(() => {
      const rp = window.__BR_debug && [...window.__BR_debug.remotes.values()][0];
      return rp && rp.heldWeapon === 'FACA' && !rp.body.weapon.visible;
    }, { timeout: 3000, polling: 20 });
    const state = await h.play(() => {
      const rp = [...window.__BR_debug.remotes.values()][0];
      return { heldWeapon: rp.heldWeapon, weaponVisible: rp.body.weapon.visible };
    });
    assert.equal(state.heldWeapon, 'FACA');
    assert.equal(state.weaponVisible, false);
  });

  it('mostra o golpe corpo a corpo quando o bot usa a faca', async () => {
    host.emit('state', {
      pos: [playerPos[0] + 1.5, playerPos[1], playerPos[2]],
      rotY: -Math.PI / 2, heldWeapon: 'FACA "AURORA"', ship: false, fall: false,
    });
    await new Promise(resolve => setTimeout(resolve, 200));
    host.emit('shotFired', {
      weapon: 'FACA "AURORA"',
      fromPos: [playerPos[0] + 1.5, playerPos[1] + 1.4, playerPos[2]],
      toPos: [playerPos[0], playerPos[1], playerPos[2]],
    });
    await h.page.waitForFunction(() => {
      const rp = window.__BR_debug && [...window.__BR_debug.remotes.values()][0];
      return rp && rp.heldWeapon === 'FACA' && rp.fireT > 0 && rp.body.armR.rotation.x < -0.7;
    }, { timeout: 2000, polling: 20 });
    const state = await h.play(() => {
      const rp = [...window.__BR_debug.remotes.values()][0];
      return { fireT: rp.fireT, armX: rp.body.armR.rotation.x, heldWeapon: rp.heldWeapon };
    });
    assert.ok(state.fireT > 0, 'evento de faca não iniciou a animação');
    assert.ok(state.armX < -0.7,
      `braço não executou o golpe (rotation.x=${state.armX}, arma=${state.heldWeapon}, fireT=${state.fireT})`);
  });

  /* grava {escala, visível} da arma do remoto a cada frame renderizado —
     detecta pop instantâneo (0↔1 num frame) vs transição de coldre/saque */
  const startWeaponLog = () => h.play(() => {
    const rp = [...window.__BR_debug.remotes.values()][0];
    const log = window.__wpnLog = [];
    (function rec() {
      if (log.length < 600) requestAnimationFrame(rec);
      log.push({ s: rp.body.weapon.scale.x, v: rp.body.weapon.visible });
    })();
  });

  it('saca a arma com transição de escala em vez de pop', async () => {
    // estado anterior: FACA (arma invisível). Sacar FUZIL deve CRESCER.
    await startWeaponLog();
    const st = {
      pos: [playerPos[0] + 3, playerPos[1], playerPos[2]],
      rotY: -Math.PI / 2, heldWeapon: 'FUZIL', ship: false, fall: false,
    };
    host.emit('state', st);
    const retry = setInterval(() => host.emit('state', st), 250); // volatile pode dropar
    try {
      await h.page.waitForFunction(() => {
        const rp = window.__BR_debug && [...window.__BR_debug.remotes.values()][0];
        return rp && rp.body.weapon.visible && rp.body.weapon.scale.x >= 0.98;
      }, { timeout: 8000, polling: 20 });
    } finally { clearInterval(retry); }
    const log = await h.play(() => window.__wpnLog);
    const first = log.find(f => f.v);
    assert.ok(first, 'arma nunca apareceu no log de frames');
    assert.ok(first.s < 0.5,
      `saque teleportou a escala: primeiro frame visível já em ${first.s}`);
    assert.ok(log.some(f => f.v && f.s > 0.02 && f.s < 0.9),
      'sem frames intermediários de crescimento (pop instantâneo)');
  });

  it('guarda a arma com transição quando a flag de queda cai', async () => {
    // arma sacada (escala 1). fall:true deve ENCOLHER antes de sumir.
    // (mesma posição: um salto de altitude tropeçaria no anti-teleporte)
    await startWeaponLog();
    const st = {
      pos: [playerPos[0] + 3, playerPos[1], playerPos[2]],
      rotY: -Math.PI / 2, heldWeapon: 'FUZIL', fall: true,
    };
    host.emit('state', st);
    const retry = setInterval(() => host.emit('state', st), 250); // volatile pode dropar
    try {
      await h.page.waitForFunction(() => {
        const rp = window.__BR_debug && [...window.__BR_debug.remotes.values()][0];
        return rp && !rp.body.weapon.visible;
      }, { timeout: 8000, polling: 20 });
    } finally { clearInterval(retry); }
    const log = await h.play(() => window.__wpnLog);
    const lastVis = log.findIndex((f, i) => f.v && log[i + 1] && !log[i + 1].v);
    assert.ok(lastVis >= 0, 'transição de sumiço não registrada no log de frames');
    assert.ok(log[lastVis].s < 0.5,
      `arma sumiu de estalo: último frame visível ainda com escala ${log[lastVis].s}`);
    assert.ok(log.some(f => f.v && f.s > 0.02 && f.s < 0.9),
      'sem frames intermediários de encolhimento (pop instantâneo)');
  });

  /* troca a arma do remoto e devolve a assinatura da silhueta (nº de meshes,
     maior dimensão do Box3 e z do focinho) — DMR e SNIPER precisam divergir */
  const silhouetteOf = async code => {
    const st = {
      pos: [playerPos[0] + 3, playerPos[1], playerPos[2]],
      rotY: -Math.PI / 2, heldWeapon: code, ship: false, fall: false,
    };
    host.emit('state', st);
    const retry = setInterval(() => host.emit('state', st), 250); // volatile pode dropar
    try {
      await h.page.waitForFunction(c => {
        const rp = window.__BR_debug && [...window.__BR_debug.remotes.values()][0];
        return rp && rp.body.weapon.userData.weaponClass === c && rp.body.weapon.visible;
      }, { timeout: 8000, polling: 20 }, code);
    } finally { clearInterval(retry); }
    return h.play(() => {
      const rp = [...window.__BR_debug.remotes.values()][0];
      const THREE = window.__MP.THREE;
      const sil = rp.body.weapon.children.find(c => c !== rp.body.muzzle);
      let meshes = 0;
      sil.traverse(o => { if (o.isMesh) meshes++; });
      const size = new THREE.Box3().setFromObject(sil).getSize(new THREE.Vector3());
      return { meshes, len: Math.max(size.x, size.y, size.z), muzzleZ: rp.body.muzzle.position.z };
    });
  };

  it('sniper remoto tem silhueta própria, distinta da DMR', async () => {
    const dmr = await silhouetteOf('DMR');
    const sniper = await silhouetteOf('SNIPER');
    assert.notEqual(sniper.meshes, dmr.meshes,
      `sniper e DMR remotos compartilham a mesma silhueta (${dmr.meshes} meshes)`);
    assert.ok(sniper.len > dmr.len + 0.08,
      `cano da sniper remota não é mais longo (sniper=${sniper.len.toFixed(3)} vs dmr=${dmr.len.toFixed(3)})`);
    assert.ok(sniper.muzzleZ < dmr.muzzleZ - 0.05,
      `focinho da sniper não acompanha o cano longo (sniper=${sniper.muzzleZ} vs dmr=${dmr.muzzleZ})`);
  });

  it('rede de segurança: nenhum pageerror nos cenários visuais', () => {
    assert.deepEqual(h.pageErrors, [], 'erros de página: ' + h.pageErrors.join(' | '));
  });
});
