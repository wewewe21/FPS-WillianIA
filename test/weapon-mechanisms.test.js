/* ================================================================
   QA — mecanismos visuais das armas (js/weaponrig.js + game.js).
   Prova de MOVIMENTO real: gatilho/ferrolho/bomba/pente/célula/foguete
   mudam de transform durante fire/cycle/reload e VOLTAM ao bind pose;
   automáticas também ciclam; estojos são poolados com limite; troca de
   arma no meio da recarga restaura tudo e não duplica munição.
   ================================================================ */
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { CHROME, bootGame } = require('./helpers/harness.js');

describe('Mecanismos das armas (Chrome headless)', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h;
  before(async () => {
    h = await bootGame({ port: 3222 });
    await h.play(async () => {
      const G = window.QA.G;
      await G.WeaponModels.ready;
      for (let i = 0; i < 200 && !(G.FpBody.ready || G.FpBody.failed); i++)
        await new Promise(rs => setTimeout(rs, 100));
    });
  });
  after(async () => { if (h) await h.close(); });

  it('dado tiro de arma AUTOMÁTICA (fuzil/rajada), então o mecanismo cicla a cada disparo', async () => {
    const r = await h.play(() => {
      const G = window.QA.G;
      window.QA.reset();
      const out = {};
      for (const i of [0, 7]) {
        G.arsenal[i].locked = false;
        G.switchWeapon(i);
        window.QA.tick(60);
        G.gun.mag = G.gun.magSize;
        G.mouse.shooting = true;
        window.QA.tick(3); // 1 tiro
        out[i] = { cycleT: G.gun.cycleT, cycleDur: G.gun.cycleDur };
        G.mouse.shooting = false;
        window.QA.tick(90);
      }
      return out;
    });
    assert.ok(r[0].cycleT > 0, 'fuzil automático não ciclou o ferrolho');
    assert.ok(r[7].cycleT > 0, 'escopeta RAJADA (auto) não ciclou a bomba');
    assert.ok(r[0].cycleDur <= 60 / 690 * 0.92 + 1e-6, 'ciclo do fuzil mais longo que a cadência');
  });

  it('dado fire/cycle/reload em cada arma, então as peças MOVEM e voltam ao bind', async () => {
    const r = await h.play(() => {
      const G = window.QA.G;
      window.QA.reset();
      const out = [];
      for (const i of [0, 1, 2, 3, 4, 6, 7]) {
        G.arsenal[i].locked = false;
        G.switchWeapon(i);
        window.QA.tick(60);
        const gun = G.gun;
        gun.mag = gun.magSize; gun.reserve = Math.max(gun.reserve, 20); gun.reloading = false;
        window.QA.tick(30);
        const bind = G.WeaponRig.mechState(i);
        // tiro: gatilho recua; meio do ciclo: bolt/pump deslocados
        // (automática atira com shooting; semi com clicked — liga os dois)
        G.mouse.clicked = true; G.mouse.shooting = true;
        window.QA.tick(2);
        G.mouse.shooting = false;
        const atFire = G.WeaponRig.mechState(i);
        window.QA.tick(Math.max(2, Math.round((gun.cycleDur || 0.3) * 30)));
        const midCycle = G.WeaponRig.mechState(i);
        window.QA.tick(120); // assenta
        const afterFire = G.WeaponRig.mechState(i);
        // recarga: pente/célula sai; bomba bombeia; cartucho aparece na porta —
        // varre a recarga inteira acumulando os extremos de cada peça
        gun.mag = Math.max(0, gun.magSize - Math.max(2, Math.ceil(gun.magSize / 2)));
        window.QA.MP.justPressed.add('KeyR');
        const sweep = { magYMin: Infinity, pumpZMax: -Infinity, shellSeen: false };
        const nTicks = Math.round(gun.reloadTime * 60) + 30;
        for (let k = 0; k < nTicks; k++) {
          window.QA.tick(1);
          const s = G.WeaponRig.mechState(i);
          if (s.magY !== null) sweep.magYMin = Math.min(sweep.magYMin, s.magY);
          if (s.pumpZ !== null) sweep.pumpZMax = Math.max(sweep.pumpZMax, s.pumpZ);
          if (s.loadShellVisible) sweep.shellSeen = true;
        }
        const afterReload = G.WeaponRig.mechState(i);
        out.push({ i, bind, atFire, midCycle, afterFire, sweep, afterReload });
      }
      return out;
    });
    const moved = (a, b) => JSON.stringify(a) !== JSON.stringify(b);
    for (const x of r) {
      if (x.bind.trigger) {
        assert.ok(moved(x.bind.trigger, x.atFire.trigger), `arma ${x.i}: gatilho não recuou no tiro`);
        assert.deepEqual(x.afterFire.trigger, x.bind.trigger, `arma ${x.i}: gatilho não voltou ao bind`);
      }
      if (x.bind.pumpZ !== null) {
        assert.ok(Math.abs(x.midCycle.pumpZ - x.bind.pumpZ) > 0.03,
          `arma ${x.i}: bomba não percorreu curso visível (${x.midCycle.pumpZ} vs ${x.bind.pumpZ})`);
        assert.ok(Math.abs(x.afterFire.pumpZ - x.bind.pumpZ) < 1e-4, `arma ${x.i}: bomba não voltou`);
      }
      if (x.bind.boltZ !== null && x.bind.boltAuthority === 'procedural') {
        assert.ok(Math.abs(x.midCycle.boltZ - x.bind.boltZ) > 0.01, `arma ${x.i}: ferrolho não ciclou`);
        assert.ok(Math.abs(x.afterFire.boltZ - x.bind.boltZ) < 1e-4, `arma ${x.i}: ferrolho não voltou`);
      }
      if (x.bind.magY !== null && x.bind.magAuthority === 'procedural' && x.bind.pumpZ === null) {
        assert.ok(x.bind.magY - x.sweep.magYMin > 0.05,
          `arma ${x.i}: pente/célula não saiu na recarga`);
        assert.ok(Math.abs(x.afterReload.magY - x.bind.magY) < 1e-4, `arma ${x.i}: pente não voltou`);
      }
      if (x.bind.pumpZ !== null) {
        assert.ok(x.sweep.pumpZMax - x.bind.pumpZ > 0.03, `arma ${x.i}: recarga sem bombeada`);
      }
      if (x.bind.loadShellVisible !== null) {
        assert.equal(x.bind.loadShellVisible, false, `arma ${x.i}: cartucho visível fora da recarga`);
        assert.ok(x.sweep.shellSeen, `arma ${x.i}: cartucho nunca apareceu na recarga`);
        assert.equal(x.afterReload.loadShellVisible, false, `arma ${x.i}: cartucho ficou visível`);
      }
      if (x.bind.emitterIntensity !== null) {
        assert.ok(x.atFire.emitterIntensity > x.bind.emitterIntensity + 0.5,
          `arma ${x.i}: emissor de plasma não pulsou no tiro`);
      }
    }
  });

  it('dada a bazuca, então o foguete carregado some no tiro e só volta com a recarga', async () => {
    const r = await h.play(() => {
      const G = window.QA.G;
      window.QA.reset();
      G.arsenal[3].locked = false;
      G.switchWeapon(3);
      window.QA.tick(60);
      const gun = G.gun;
      gun.mag = 1; gun.reserve = 4; gun.reloading = false;
      window.QA.tick(2);
      const loaded = G.WeaponRig.mechState(3).rocketVisible;
      G.mouse.clicked = true;
      window.QA.tick(3);
      const afterFire = G.WeaponRig.mechState(3).rocketVisible;
      window.QA.MP.justPressed.add('KeyR');
      window.QA.tick(Math.round(gun.reloadTime * 60 * 0.5));
      const midReload = G.WeaponRig.mechState(3).rocketVisible;
      window.QA.tick(Math.round(gun.reloadTime * 60 * 0.6) + 20);
      const afterReload = G.WeaponRig.mechState(3).rocketVisible;
      return { loaded, afterFire, midReload, afterReload, mag: gun.mag, reserve: gun.reserve };
    });
    assert.equal(r.loaded, true, 'foguete carregado invisível antes do tiro');
    assert.equal(r.afterFire, false, 'foguete continuou no tubo depois do tiro');
    assert.equal(r.midReload, false, 'foguete reapareceu ANTES de a munição entrar');
    assert.equal(r.afterReload, true, 'foguete não voltou após a recarga');
    assert.equal(r.mag, 1);
    assert.equal(r.reserve, 3);
  });

  it('dada a sniper Agulha, então mag_4/bolt_6 ficam sob a raiz do mixer e o clip MOVE e devolve', async () => {
    const r = await h.play(() => {
      const G = window.QA.G;
      window.QA.reset();
      G.arsenal[6].locked = false;
      G.switchWeapon(6);
      window.QA.tick(60);
      const gun = G.gun;
      const root = gun.modelRoot;
      const find = re => { let n = null; root.traverse(o => { if (!n && re.test(o.name)) n = o; }); return n; };
      const mag = find(/^mag_4$/), bolt = find(/^bolt_6$/);
      if (!mag || !bolt) return { missing: true };
      const under = n => { for (let p = n; p; p = p.parent) if (p === root) return true; return false; };
      const bind = { mag: mag.position.toArray(), bolt: bolt.quaternion.toArray() };
      gun.mag = 2; gun.reserve = 20; gun.reloading = false;
      window.QA.MP.justPressed.add('KeyR');
      window.QA.tick(Math.round(gun.reloadTime * 60 * 0.5));
      const mid = { mag: mag.position.toArray(), bolt: bolt.quaternion.toArray() };
      window.QA.tick(Math.round(gun.reloadTime * 60 * 0.6) + 60);
      const end = { mag: mag.position.toArray() };
      const dist = (a, b) => Math.hypot(...a.map((v, k) => v - b[k]));
      return {
        underMag: under(mag), underBolt: under(bolt),
        magMoved: dist(bind.mag, mid.mag) > 1e-4 || dist(bind.bolt, mid.bolt) > 1e-4,
        magBack: dist(bind.mag, end.mag) < 1e-3,
        magAuthority: gun.parts.mag.userData.authority,
        boltAuthority: gun.parts.bolt.userData.authority,
      };
    });
    assert.ok(!r.missing, 'mag_4/bolt_6 não encontrados no GLB');
    assert.ok(r.underMag && r.underBolt, 'nós animados saíram da raiz do mixer (reparent quebrado)');
    assert.ok(r.magMoved, 'clip de reload não moveu mag_4/bolt_6');
    assert.ok(r.magBack, 'mag_4 não voltou ao bind pose depois do clip');
    assert.equal(r.magAuthority, 'clip', 'âncora mag deveria estar cedida ao clip');
    assert.equal(r.boltAuthority, 'clip', 'âncora bolt deveria estar cedida ao clip');
  });

  it('dada troca de arma no MEIO da recarga, então cancela, restaura bind e não duplica munição', async () => {
    const r = await h.play(() => {
      const G = window.QA.G;
      window.QA.reset();
      G.switchWeapon(0);
      window.QA.tick(60);
      const gun = G.gun;
      gun.mag = 10; gun.reserve = 60;
      const total = gun.mag + gun.reserve;
      const bindMagY = G.WeaponRig.mechState(0).magY;
      window.QA.MP.justPressed.add('KeyR');
      window.QA.tick(Math.round(gun.reloadTime * 60 * 0.3)); // pente saindo
      G.switchWeapon(1);
      window.QA.tick(10);
      G.switchWeapon(0);
      window.QA.tick(10);
      return {
        reloading: gun.reloading,
        magY: G.WeaponRig.mechState(0).magY, bindMagY,
        total: gun.mag + gun.reserve, wanted: total,
        mag: gun.mag,
      };
    });
    assert.equal(r.reloading, false, 'troca não cancelou a recarga');
    assert.ok(Math.abs(r.magY - r.bindMagY) < 1e-4, 'pente ficou deslocado após cancelamento');
    assert.equal(r.total, r.wanted, 'munição total mudou com recarga cancelada');
    assert.equal(r.mag, 10, 'pente ganhou munição sem completar a recarga');
  });

  it('dado spam de tiros, então estojos saem só de arma balística e o pool respeita o limite', async () => {
    const r = await h.play(() => {
      const G = window.QA.G;
      window.QA.reset();
      const out = {};
      for (const i of [0, 4]) { // fuzil (balística) vs plasma (energia)
        G.arsenal[i].locked = false;
        G.switchWeapon(i);
        window.QA.tick(60);
        G.gun.mag = G.gun.magSize; G.gun.reserve = 500;
        G.mouse.shooting = true;
        for (let k = 0; k < 200; k++) {
          window.QA.tick(1);
          if (G.gun.mag === 0) { G.gun.mag = G.gun.magSize; }
        }
        G.mouse.shooting = false;
        out[i] = { alive: G.WeaponRig.shellsAlive, max: G.WeaponRig.shellMax };
        window.QA.tick(120); // TTL esvazia
        out[i].after = G.WeaponRig.shellsAlive;
      }
      return out;
    });
    assert.ok(r[0].alive > 0, 'fuzil não ejetou estojos');
    assert.ok(r[0].alive <= r[0].max, `pool estourou o limite: ${r[0].alive} > ${r[0].max}`);
    assert.equal(r[0].after, 0, 'estojos não expiraram pelo TTL');
    assert.equal(r[4].alive, 0, 'plasma (energia) não pode ejetar estojo balístico');
  });

  it('dado ciclo intenso (2min simulados de troca/mira/tiro/recarga), então nada vaza', async () => {
    const r = await h.play(() => {
      const G = window.QA.G, MP = window.QA.MP;
      window.QA.reset();
      for (const g of G.arsenal) g.locked = false;
      const snap = () => ({
        geo: MP.renderer.info.memory.geometries,
        tex: MP.renderer.info.memory.textures,
        scene: (() => { let n = 0; MP.scene.traverse(() => n++); return n; })(),
      });
      // warmup: uma volta completa cria complementos/pools uma única vez
      const round = () => {
        for (let i = 0; i < G.arsenal.length; i++) {
          G.switchWeapon(i);
          window.QA.tick(20);
          G.mouse.aiming = true;
          window.QA.tick(20);
          G.gun.mag = G.gun.magSize; G.gun.reserve = 999;
          G.mouse.shooting = true; G.mouse.clicked = true;
          window.QA.tick(15);
          G.mouse.shooting = false; G.mouse.aiming = false;
          G.gun.mag = 1;
          window.QA.MP.justPressed.add('KeyR');
          window.QA.tick(Math.round(G.gun.reloadTime * 60) + 10);
        }
      };
      round();
      const antes = snap();
      for (let k = 0; k < 20; k++) round(); // ≈ 2min+ de tempo simulado
      const depois = snap();
      return { antes, depois, shells: G.WeaponRig.shellsAlive, shellMax: G.WeaponRig.shellMax };
    });
    assert.ok(r.depois.geo - r.antes.geo <= 2,
      `geometrias cresceram: ${r.antes.geo} → ${r.depois.geo}`);
    assert.ok(r.depois.tex - r.antes.tex <= 2,
      `texturas cresceram: ${r.antes.tex} → ${r.depois.tex}`);
    assert.ok(r.depois.scene - r.antes.scene <= 4,
      `nós de cena cresceram: ${r.antes.scene} → ${r.depois.scene}`);
    assert.ok(r.shells <= r.shellMax, 'pool de estojos acima do limite');
  });

  it('rede de segurança: nenhum pageerror durante os cenários de mecanismos', () => {
    assert.deepEqual(h.pageErrors, [], 'erros de página: ' + h.pageErrors.join(' | '));
  });
});
