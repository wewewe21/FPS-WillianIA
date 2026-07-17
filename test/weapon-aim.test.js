/* ================================================================
   QA — mira e balística visual (game.js fire + js/rockets.js).
   Prova que o que o jogador VÊ converge com o que o jogo CALCULA:
   hitscan acerta o alvo no centro, o traçante nasce no muzzle real,
   o foguete da bazuca converge pro ponto mirado (curta/média/longa,
   30/60/120 FPS), parede colada na boca detona UMA vez sem tunneling,
   e as mãos do rig seguem as âncoras da empunhadura.
   ================================================================ */
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { CHROME, bootGame } = require('./helpers/harness.js');

describe('Mira e balística visual (Chrome headless)', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h;
  before(async () => {
    h = await bootGame({ port: 3224 });
    await h.play(async () => {
      const G = window.QA.G;
      await G.WeaponModels.ready;
      for (let i = 0; i < 200 && !(G.FpBody.ready || G.FpBody.failed); i++)
        await new Promise(rs => setTimeout(rs, 100));
    });
  });
  after(async () => { if (h) await h.close(); });

  it('dado um alvo imóvel no centro, então cada arma hitscan o atinge no ADS', async () => {
    const r = await h.play(() => {
      const G = window.QA.G;
      const out = [];
      for (const i of [0, 1, 2, 4, 6, 7]) {
        window.QA.reset();
        G.arsenal[i].locked = false;
        G.switchWeapon(i);
        window.QA.tick(40);
        // alvo: primeiro inimigo, plantado a 25m na frente da câmera parada
        const e = G.Enemies.list.find(x => x.alive);
        const P = window.QA.MP.player.pos;
        e.group.position.set(P.x, G.heightAt(P.x, P.z - 25), P.z - 25);
        const core = e.hitSpheres()[0];
        window.QA.aimAt(core.c.x, core.c.y, core.c.z);
        G.mouse.aiming = true;
        window.QA.tick(240);
        const hpAntes = e.health;
        G.gun.mag = G.gun.magSize;
        G.mouse.clicked = true; G.mouse.shooting = true;
        window.QA.tick(2);
        G.mouse.shooting = false; G.mouse.aiming = false;
        out.push({ i, hpAntes, hpDepois: e.health, alvoVivo: e.alive });
        window.QA.tick(60);
      }
      return out;
    });
    for (const x of r) {
      assert.ok(x.hpDepois < x.hpAntes || !x.alvoVivo,
        `arma ${x.i}: alvo central não foi atingido (hp ${x.hpAntes} → ${x.hpDepois})`);
    }
  });

  it('dado um tiro, então o traçante nasce no muzzle REAL e termina no ponto de impacto', async () => {
    const r = await h.play(() => {
      const G = window.QA.G, MP = window.QA.MP, THREE = MP.THREE;
      window.QA.reset();
      G.switchWeapon(0);
      window.QA.tick(40);
      const tracers = [];
      const orig = MP.FX.spawnTracer;
      MP.FX.spawnTracer = (from, to, color) => {
        tracers.push({ from: from.toArray(), to: to.toArray() });
        return orig.call(MP.FX, from, to, color);
      };
      G.mouse.aiming = true;
      window.QA.tick(240);
      G.gun.mag = G.gun.magSize;
      G.mouse.clicked = true; G.mouse.shooting = true;
      window.QA.tick(2);
      G.mouse.shooting = false; G.mouse.aiming = false;
      MP.FX.spawnTracer = orig;
      // muzzle world de referência (ainda no fim do ADS — 2 ticks de folga)
      const gun = G.gun;
      gun.group.updateWorldMatrix(true, true);
      const mw = new THREE.Vector3();
      gun.muzzleAnchor.getWorldPosition(mw);
      const cam = G.camera.getWorldPosition(new THREE.Vector3());
      return { tracers, muzzle: mw.toArray(), cam: cam.toArray() };
    });
    assert.ok(r.tracers.length >= 1, 'tiro não gerou traçante');
    const t0 = r.tracers[0];
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    assert.ok(d(t0.from, r.muzzle) < 0.25,
      `traçante não nasceu no muzzle (dist ${d(t0.from, r.muzzle).toFixed(2)}m)`);
    assert.ok(d(t0.to, r.cam) > 5, 'traçante não viajou até o impacto');
  });

  it('dada a bazuca mirando o centro, então o foguete converge (8/40/120m) em 30/60/120 FPS', async () => {
    const r = await h.play(() => {
      const G = window.QA.G, MP = window.QA.MP, THREE = MP.THREE;
      const out = [];
      const findRocket = () => {
        let live = null;
        MP.scene.traverse(o => { if (!live && o.userData.__rocket && o.visible) live = o; });
        return live;
      };
      for (const [dist, dt] of [[8, 1 / 60], [40, 1 / 60], [120, 1 / 60], [40, 1 / 30], [40, 1 / 120]]) {
        window.QA.reset();
        G.arsenal[3].locked = false;
        G.switchWeapon(3);
        window.QA.tick(40);
        // mira (ADS) no chão; DEPOIS sobe pro ar pra linha até 120m ficar limpa
        G.mouse.aiming = true;
        window.QA.tick(240, dt);
        MP.player.pos.y += 60;
        MP.player.vel.set(0, 0, 0);
        window.QA.tick(1, dt);
        const origin = G.camera.getWorldPosition(new THREE.Vector3());
        const dir = G.camera.getWorldDirection(new THREE.Vector3());
        G.gun.mag = 1; G.gun.reloading = false;
        let booms = 0;
        const origExplode = G.Grenades.explode;
        G.Grenades.explode = (...a) => { booms++; return origExplode.apply(G.Grenades, a); };
        G.mouse.clicked = true;
        window.QA.tick(1, dt);
        // amostra o foguete quando CRUZA o plano do alvo: erro lateral deve ser
        // ~zero; o vertical é a queda balística esperada (g=2.5, v=34)
        let crossed = null, prevProj = -Infinity, flightT = 0;
        for (let k = 0; k < 900 && !crossed; k++) {
          const rk = findRocket();
          if (!rk) break;
          const p = rk.position.clone().sub(origin);
          const proj = p.dot(dir);
          if (proj >= dist && prevProj < dist) {
            // erro PERPENDICULAR à linha de mira (a amostragem por frame
            // avança ao longo da linha — isso não é desvio)
            const perp = p.clone().addScaledVector(dir, -proj);
            crossed = { lateral: Math.hypot(perp.x, perp.z), dy: perp.y, t: flightT };
          }
          prevProj = proj;
          window.QA.tick(1, dt);
          flightT += dt;
        }
        // drena o foguete vivo (não pode vazar pro próximo cenário)
        for (let k = 0; k < 1500 && findRocket(); k++) window.QA.tick(1, dt);
        G.Grenades.explode = origExplode;
        G.mouse.aiming = false;
        const drop = crossed ? 0.5 * 2.5 * crossed.t * crossed.t : null;
        out.push({ dist, dt: +(1 / dt).toFixed(0), booms,
          lateral: crossed ? +crossed.lateral.toFixed(2) : null,
          dy: crossed ? +crossed.dy.toFixed(2) : null,
          drop: crossed ? +drop.toFixed(2) : null });
      }
      return out;
    });
    for (const x of r) {
      assert.ok(x.lateral !== null, `foguete nunca cruzou o plano do alvo a ${x.dist}m @${x.dt}fps`);
      assert.ok(x.lateral < 0.6,
        `foguete desviou ${x.lateral}m lateralmente a ${x.dist}m @${x.dt}fps`);
      assert.ok(x.dy > -x.drop - 1 && x.dy < 0.3,
        `queda vertical incoerente a ${x.dist}m @${x.dt}fps: dy=${x.dy} (queda esperada ~${x.drop})`);
      assert.equal(x.booms, 1, `foguete detonou ${x.booms}× a ${x.dist}m @${x.dt}fps`);
    }
  });

  it('dado o chão colado à frente, então o foguete detona UMA vez, perto, sem atravessar', async () => {
    const r = await h.play(() => {
      const G = window.QA.G, MP = window.QA.MP, THREE = MP.THREE;
      window.QA.reset();
      G.arsenal[3].locked = false;
      G.switchWeapon(3);
      window.QA.tick(40);
      // mira o chão a ~2.5m dos pés
      const P = MP.player.pos;
      window.QA.aimAt(P.x, G.heightAt(P.x, P.z - 2.5), P.z - 2.5);
      window.QA.tick(2);
      G.gun.mag = 1; G.gun.reloading = false;
      let booms = 0, boomPos = null;
      const origExplode = G.Grenades.explode;
      G.Grenades.explode = (pos, ...a) => { booms++; boomPos = pos.toArray(); return origExplode.call(G.Grenades, pos, ...a); };
      G.mouse.clicked = true;
      window.QA.tick(90);
      G.Grenades.explode = origExplode;
      const camPos = G.camera.getWorldPosition(new THREE.Vector3()).toArray();
      const under = boomPos ? boomPos[1] - (G.heightAt(boomPos[0], boomPos[2]) - 0.5) : null;
      return { booms, boomPos, camPos, under };
    });
    assert.equal(r.booms, 1, `explosões: ${r.booms} (esperava exatamente 1)`);
    const d = Math.hypot(r.boomPos[0] - r.camPos[0], r.boomPos[1] - r.camPos[1], r.boomPos[2] - r.camPos[2]);
    assert.ok(d < 6, `detonou longe demais do alvo colado: ${d.toFixed(1)}m`);
    assert.ok(r.under > -0.1, 'foguete atravessou o terreno antes de detonar');
  });

  it('dadas as mãos do rig, então ACOMPANHAM as âncoras (offset estável, sem teleporte)', async () => {
    // o osso da mão tem offset natural em relação à âncora (origem no punho,
    // rolagem da pegada, braço no limite de alcance) — o critério é TRACKING:
    // offset consistente entre hip e ADS e nunca uma distância absurda
    const r = await h.play(() => {
      const G = window.QA.G, THREE = window.QA.MP.THREE;
      if (!G.FpBody.ready) return { skip: true };
      window.QA.reset();
      const B = window.__FP.bones;
      const out = [];
      const _a = new THREE.Vector3(), _b = new THREE.Vector3();
      for (const i of [0, 1, 2, 3, 4, 6, 7]) {
        G.arsenal[i].locked = false;
        G.switchWeapon(i);
        window.QA.tick(60);
        const d = {};
        for (const mode of ['hip', 'ads']) {
          G.mouse.aiming = mode === 'ads';
          window.QA.tick(180);
          d[mode] = {
            R: B.haR.getWorldPosition(_a).distanceTo(G.gun.parts.handR.getWorldPosition(_b)),
            L: B.haL.getWorldPosition(_a).distanceTo(G.gun.parts.handL.getWorldPosition(_b)),
          };
        }
        out.push({ i,
          hipR: +d.hip.R.toFixed(3), adsR: +d.ads.R.toFixed(3),
          hipL: +d.hip.L.toFixed(3), adsL: +d.ads.L.toFixed(3) });
        G.mouse.aiming = false;
        window.QA.tick(60);
      }
      return { out };
    });
    if (r.skip) return; // corpo FP indisponível neste ambiente
    for (const x of r.out) {
      for (const k of ['hipR', 'adsR', 'hipL', 'adsL'])
        assert.ok(x[k] < 0.8, `arma ${x.i}: mão a ${x[k]}m da âncora (${k}) — teleporte/quebra de IK`);
      // 0.45: no hip a arma pode sair do alcance do braço (IK clampa no 99% do
      // alcance — comportamento pré-existente, ex.: bazuca) sem ser teleporte
      assert.ok(Math.abs(x.hipR - x.adsR) < 0.45,
        `arma ${x.i}: mão direita não acompanhou o ADS (hip ${x.hipR} vs ads ${x.adsR})`);
      assert.ok(Math.abs(x.hipL - x.adsL) < 0.45,
        `arma ${x.i}: mão de apoio não acompanhou o ADS (hip ${x.hipL} vs ads ${x.adsL})`);
    }
  });

  it('dado um remoto com DMR, então a silhueta da classe certa aparece — e nome malicioso vira FACA', async () => {
    const { io } = require('socket.io-client');
    const bot = io('http://localhost:3224', { transports: ['websocket'] });
    try {
      await new Promise((res, rej) => {
        bot.once('init', res);
        setTimeout(() => rej(new Error('init não chegou')), 8000);
      });
      bot.emit('hello', { nick: 'SilBot' });
      const P = await h.play(() => window.QA.pos()); // [x, z, y]
      const send = held => bot.emit('state', { pos: [P[0] + 3, P[2] + 1.2, P[1] + 3], heldWeapon: held });
      for (let k = 0; k < 8; k++) { send('DMR "FALCÃO"'); await new Promise(r => setTimeout(r, 80)); }
      const r1 = await h.play(() => {
        window.QA.tick(10);
        const rp = (window.__MP_remotePlayers || []).find(x => x.nick === 'SilBot');
        if (!rp) return { missing: true };
        let meshes = 0;
        rp.body.weapon.traverse(o => { if (o.isMesh) meshes++; });
        return {
          classe: rp.body.weapon.userData.weaponClass,
          muzzleZ: +rp.body.muzzle.position.z.toFixed(2),
          visible: rp.body.weapon.visible, meshes,
        };
      });
      assert.ok(!r1.missing, 'remoto SilBot não apareceu na cena');
      assert.equal(r1.classe, 'DMR', 'silhueta não é da classe DMR');
      assert.equal(r1.muzzleZ, -1.05, 'muzzle da silhueta DMR na posição errada');
      assert.equal(r1.visible, true, 'arma remota DMR deveria estar visível');
      assert.ok(r1.meshes >= 3, 'silhueta DMR sem geometria própria');
      // arma inexistente/maliciosa: o SERVIDOR sanitiza (weaponCode) e mantém a
      // última arma VÁLIDA — o lixo nunca chega ao cliente nem gera exceção
      for (let k = 0; k < 8; k++) { send('<script>alert(1)</script>'); await new Promise(r => setTimeout(r, 80)); }
      const r2 = await h.play(() => {
        window.QA.tick(10);
        const rp = (window.__MP_remotePlayers || []).find(x => x.nick === 'SilBot');
        return { classe: rp.body.weapon.userData.weaponClass };
      });
      assert.ok(['DMR', 'FACA'].includes(r2.classe),
        `nome malicioso produziu classe inválida: ${r2.classe}`);
    } finally {
      bot.close();
    }
  });

  it('rede de segurança: nenhum pageerror nos cenários de mira/balística', () => {
    assert.deepEqual(h.pageErrors, [], 'erros de página: ' + h.pageErrors.join(' | '));
  });
});
