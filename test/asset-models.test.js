/* Modelos 3D dos assets novos: armas em primeira pessoa, corpo do jogador
   rigado (helldiver), Guardião nos inimigos e alien no Visitante.
   Node puro: valida os arquivos GLB; Chrome: valida a integração viva. */
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { CHROME, bootGame } = require('./helpers/harness.js');

const MODELS = path.join(__dirname, '..', 'assets', 'models');

function glbJson(p) {
  const buf = fs.readFileSync(p);
  assert.equal(buf.readUInt32LE(0), 0x46546c67, p + ' não é GLB');
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.slice(20, 20 + len).toString('utf8'));
}

describe('Arquivos GLB dos assets', () => {
  it('dado o helldiver, então tem rig completo com dedos e sem cabeça extra', () => {
    const g = glbJson(path.join(MODELS, 'Personagens', 'low_poly_helldiver_rig.glb'));
    assert.ok(g.skins && g.skins[0].joints.length >= 50, 'rig com 51 ossos esperado');
    const names = g.nodes.map(n => n.name || '');
    for (const frag of ['Hand.L', 'Hand.R', 'Finger_1.L', 'Finger_1.R', 'Arm_1.L', 'Arm_2.R', 'Head'])
      assert.ok(names.some(n => n.includes(frag)), 'osso ausente: ' + frag);
  });
  it('dado o Guardião, então traz as animações Punch/Shoot/Walk e a arma embutida', () => {
    const g = glbJson(path.join(MODELS, 'Personagens', 'Guardiao.glb'));
    const anims = (g.animations || []).map(a => a.name);
    assert.deepEqual(anims.sort(), ['Punch', 'Shoot', 'Walk']);
    const names = g.nodes.map(n => n.name || '');
    assert.ok(names.some(n => n.includes('MuzzleFlash')), 'nó do flash ausente');
  });
  it('dado o soldado de visão noturna, então preserva rig e caminhada com SMG', () => {
    const g = glbJson(path.join(MODELS, 'Personagens', 'ps1low_poly_night_vision_special_forces_soldier.glb'));
    assert.ok(g.skins && g.skins[0].joints.length >= 20, 'rig do operador ausente');
    const anims = (g.animations || []).map(a => a.name);
    assert.ok(anims.includes('SMGwalk'), 'SMGwalk ausente');
    assert.ok(g.nodes.some(n => /SMGBone/i.test(n.name || '')), 'osso da SMG ausente');
  });
  it('dado o alien otimizado, então preserva o rig e a Take 001 abaixo de 1.5MB', () => {
    const p = path.join(MODELS, 'Personagens', 'alien.optimized.glb');
    assert.ok(fs.statSync(p).size < 1.5 * 1024 * 1024, 'alien otimizado grande demais');
    const g = glbJson(p);
    assert.ok(g.skins && g.skins[0].joints.length >= 50, 'rig perdido na otimização');
    assert.ok((g.animations || []).some(a => a.name === 'Take 001'), 'animação perdida');
  });
  it('dada a bazuca otimizada, então cabe em 1MB', () => {
    assert.ok(fs.statSync(path.join(MODELS, 'Armas', 'bazooka.optimized.glb')).size < 1024 * 1024);
  });
  it('dada a sniper leve, então traz as animações embutidas de recarga/ferrolho', () => {
    const g = glbJson(path.join(MODELS, 'Armas', 'low-poly_sniper_Rápida_Fraca.glb'));
    const anims = (g.animations || []).map(a => a.name).sort();
    assert.deepEqual(anims, ['bolt_slide', 'reload']);
  });
  it('dado o machado, então o GLB tem malha real para substituir a faca', () => {
    const g = glbJson(path.join(MODELS, 'Armas', 'low_poly_axe.glb'));
    assert.ok((g.meshes || []).length >= 2, 'machado deveria trazer cabo e cabeça em malhas reais');
    const names = (g.nodes || []).map(n => n.name || '');
    assert.ok(names.some(n => /axe/i.test(n)), 'nó do machado ausente');
  });
});

describe('Integração viva dos modelos', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h;
  before(async () => { h = await bootGame({ port: 39123 }); });
  after(async () => { if (h) await h.close(); });

  it('dado o jogo carregado, então armas GLB, corpo FP, Guardião e alien ficam prontos', async () => {
    const r = await h.play(async () => {
      const G = window.QA.G;
      await G.WeaponModels.ready;
      for (let i = 0; i < 100 && !(G.FpBody.ready || G.FpBody.failed); i++)
        await new Promise(rs => setTimeout(rs, 100));
      for (let i = 0; i < 100 && !G.Enemies.list.some(e => e.hasModel); i++)
        await new Promise(rs => setTimeout(rs, 100));
      if (G.Enemies.ready) await G.Enemies.ready;
      const suits = G.Enemies.list.filter(e => e.suit);
      return {
        armas: G.WeaponModels.status(),
        fpPronto: G.FpBody.ready,
        fpFalhou: G.FpBody.failed,
        arsenalTotal: G.arsenal.length,
        guardioes: G.Enemies.list.filter(e => e.hasModel).length,
        operadores: suits.filter(e => e.hasModel && e.modelKind === 'special-forces').length,
        operadoresTotal: suits.length,
        operadoresComWalk: suits.filter(e => e.actions && e.actions.Walk).length,
      };
    });
    for (const a of r.armas) assert.equal(a.status, 'ready', `arma ${a.idx} não carregou: ${a.url}`);
    assert.equal(r.fpPronto, true, 'corpo FP (helldiver) não ficou pronto');
    assert.equal(r.fpFalhou, false);
    assert.equal(r.arsenalTotal, 8, 'arsenal deveria ter 8 armas (6 antigas + sniper leve + escopeta rajada)');
    assert.ok(r.guardioes >= 10, `esperava >=10 Guardiões com modelo, veio ${r.guardioes}`);
    assert.ok(r.operadoresTotal > 0, 'nenhum operador da Torre Nexus foi criado');
    assert.equal(r.operadores, r.operadoresTotal, 'algum antigo executivo permaneceu procedural');
    assert.equal(r.operadoresComWalk, r.operadoresTotal, 'algum operador ficou sem SMGwalk');
    assert.deepEqual(h.pageErrors, [], 'erros de página: ' + h.pageErrors.join(' | '));
  });

  it('dado um tiro com a sniper nova, então mag/bolt do GLB estão religados nas âncoras', async () => {
    const r = await h.play(() => {
      const G = window.QA.G;
      G.arsenal[6].locked = false;
      G.switchWeapon(6);
      const gun = G.gun;
      const magNode = gun.parts.mag && gun.parts.mag.children.some(c => /mag/i.test(c.name));
      const boltNode = gun.parts.bolt && gun.parts.bolt.children.some(c => /bolt/i.test(c.name));
      return { nome: gun.name, magNode, boltNode, temAnims: !!G.WeaponModels.status().find(s => s.idx === 6) };
    });
    assert.equal(r.nome, 'SNIPER "AGULHA"');
    assert.ok(r.magNode, 'pente do GLB não foi religado na âncora animada');
    assert.ok(r.boltNode, 'ferrolho do GLB não foi religado na âncora animada');
  });

  it('dado ADS em qualquer GLB, então a linha óptica fica no centro real da câmera', async () => {
    const result = await h.play(async () => {
      const G = window.QA.G, MP = window.QA.MP;
      const THREE = await import('three');
      await G.WeaponModels.ready;
      const out = [];
      for (const s of G.WeaponModels.status()) {
        const gun = G.arsenal[s.idx];
        if (!gun || !gun.sightAnchor) continue;
        gun.group.parent.position.set(0, 0, 0);
        gun.group.parent.rotation.set(0, 0, 0);
        MP.weaponRoot.position.copy(gun.adsV);
        MP.weaponRoot.rotation.set(0, 0, 0);
        MP.camera.updateWorldMatrix(true, true);
        const p = gun.sightAnchor.getWorldPosition(new THREE.Vector3());
        MP.camera.worldToLocal(p);
        out.push({
          idx: s.idx, calibrated: s.calibrated,
          x: p.x, y: p.y, z: p.z,
          eye: gun.adsCalibration.eye,
        });
      }
      return out;
    });
    assert.equal(result.length, 8, 'as oito armas precisam de GLB e sightAnchor');
    for (const a of result) {
      assert.equal(a.calibrated, true, `arma ${a.idx} sem calibração completa`);
      assert.ok(Math.abs(a.x) < 1e-5, `arma ${a.idx}: mira deslocada em X (${a.x})`);
      assert.ok(Math.abs(a.y) < 1e-5, `arma ${a.idx}: mira deslocada em Y (${a.y})`);
      assert.ok(Math.abs(a.z - a.eye) < 1e-5, `arma ${a.idx}: eye relief incorreto (${a.z})`);
      assert.ok(a.z < -0.2, `arma ${a.idx}: mira perto demais da câmera (${a.z})`);
    }
  });

  it('dados os modelos importados, então os sockets das duas mãos ficam junto ao volume da arma', async () => {
    const result = await h.play(async () => {
      const G = window.QA.G;
      const THREE = await import('three');
      await G.WeaponModels.ready;
      return G.WeaponModels.status().map(s => {
        const gun = G.arsenal[s.idx];
        const box = new THREE.Box3().setFromObject(gun.modelRoot).expandByScalar(0.025);
        return {
          idx: s.idx,
          sockets: ['handR', 'handL'].map(key => {
            const p = gun.parts[key].getWorldPosition(new THREE.Vector3());
            const nearest = box.clampPoint(p, new THREE.Vector3());
            return { key, distance: p.distanceTo(nearest), tagged: !!gun.parts[key].userData.importedGripSocket };
          }),
        };
      });
    });
    for (const gun of result) for (const s of gun.sockets) {
      assert.equal(s.tagged, true, `arma ${gun.idx}: socket ${s.key} não foi recalibrado`);
      assert.ok(s.distance < 1e-5, `arma ${gun.idx}: socket ${s.key} longe do modelo (${s.distance})`);
    }
  });

  it('dado o M4 importado, então trocar a ampliação não sobrepõe a mira procedural', async () => {
    const result = await h.play(async () => {
      const G = window.QA.G;
      await G.WeaponModels.ready;
      G.arsenal[0].locked = false;
      G.switchWeapon(0);
      const gun = G.gun;
      const before = gun.sightIdx || 0;
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT' }));
      G.tick(1 / 60);
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyT' }));
      return {
        before, after: gun.sightIdx,
        proceduralVisible: gun.parts.sights.some(s => s.mesh && s.mesh.visible),
        modelReady: gun.modelStatus === 'ready',
      };
    });
    assert.equal(result.modelReady, true);
    assert.notEqual(result.after, result.before, 'T não alternou a ampliação');
    assert.equal(result.proceduralVisible, false, 'mira procedural reapareceu sobre o GLB');
  });

  it('dado o arsenal especial, então os contratos visuais e de balanceamento ficam ativos', async () => {
    const result = await h.play(async () => {
      const G = window.QA.G, MP = window.QA.MP;
      await G.WeaponModels.ready;
      const heavy = G.arsenal[2], shotgun = G.arsenal[1], plasma = G.arsenal[4];
      const axe = G.arsenal[5], quick = G.arsenal[6], rapid = G.arsenal[7];
      const rapidColors = [];
      rapid.modelRoot.traverse(o => {
        if (!o.isMesh) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (!m || !m.isMeshStandardMaterial) continue;
          rapidColors.push(m.color.r * 0.299 + m.color.g * 0.587 + m.color.b * 0.114);
        }
      });
      return {
        heavy: {
          name: heavy.name, magSize: heavy.magSize, dmg: heavy.dmg, rpm: heavy.rpm,
          boltAction: heavy.boltAction, cycleDuration: heavy.cycleDuration,
          boltVisual: !!heavy.parts.boltVisual,
          boltTravel: heavy.parts.boltVisual && heavy.parts.boltVisual.userData.travel,
        },
        quick: { name: quick.name, dmg: quick.dmg, rpm: quick.rpm },
        shotgunSight: {
          eye: shotgun.adsCalibration.eye,
          y: shotgun.adsCalibration.point[1], z: shotgun.adsCalibration.point[2],
        },
        plasma: {
          enabled: plasma.plasma, muzzleX: plasma.muzzleAnchor.position.x,
          sightY: plasma.sightAnchor.position.y, sightZ: plasma.sightAnchor.position.z,
          hasBoltFx: typeof MP.FX.spawnPlasmaBolt === 'function',
        },
        axe: {
          name: axe.name, melee: axe.melee, duration: axe.meleeDuration,
          ready: axe.modelStatus, hasPose: !!axe.handPose,
        },
        rapid: {
          name: rapid.name, ready: rapid.modelStatus, materialCount: rapidColors.length,
          maxLuminance: Math.max(...rapidColors),
        },
      };
    });

    assert.match(result.heavy.name, /DOURADO/);
    assert.equal(result.heavy.magSize, 5);
    assert.ok(result.heavy.dmg >= 100, 'sniper pesada sem dano alto');
    assert.ok(result.heavy.rpm <= 60, 'sniper pesada rápida demais');
    assert.equal(result.heavy.boltAction, true);
    assert.ok(result.heavy.cycleDuration >= 0.9, 'ciclo do ferrolho curto demais');
    assert.equal(result.heavy.boltVisual, true, 'ferrolho visível ausente');
    assert.ok(result.heavy.boltTravel >= 0.06, 'ferrolho sem curso visível');
    assert.match(result.quick.name, /AGULHA/);
    assert.ok(result.quick.dmg < result.heavy.dmg, 'sniper branca não ficou mais fraca');
    assert.ok(result.quick.rpm > result.heavy.rpm, 'sniper branca não ficou mais rápida');
    assert.ok(result.shotgunSight.eye <= -0.4 && result.shotgunSight.y > 0.2 && result.shotgunSight.z > 0.5,
      'linha da escopeta lenta não ficou acima/atrás da coronha');
    assert.equal(result.plasma.enabled, true);
    assert.ok(Math.abs(result.plasma.muzzleX) < 0.01 && result.plasma.sightY >= 0.24 && result.plasma.sightZ > 0.35,
      'mira virtual da plasma não ficou acima do acumulador traseiro');
    assert.equal(result.plasma.hasBoltFx, true);
    assert.match(result.axe.name, /MACHADO/);
    assert.equal(result.axe.melee, true);
    assert.ok(result.axe.duration >= 0.45);
    assert.equal(result.axe.ready, 'ready');
    assert.equal(result.axe.hasPose, true, 'machado sem pose de empunhadura');
    assert.equal(result.rapid.ready, 'ready');
    assert.ok(result.rapid.materialCount > 0);
    assert.ok(result.rapid.maxLuminance < 0.18,
      `escopeta rápida ainda clara (${result.rapid.maxLuminance})`);
  });

  it('dado um disparo da sniper dourada, então o ferrolho bloqueia, move e soa antes do próximo tiro', async () => {
    const result = await h.play(async () => {
      const QA = window.QA, G = QA.G, MP = QA.MP;
      await G.WeaponModels.ready;
      QA.clearInput();
      G.state.paused = false;
      window.__BR_freeze = false;
      G.arsenal[2].locked = false;
      if (G.gun === G.arsenal[2]) G.switchWeapon(0);
      G.switchWeapon(2);
      QA.tick(60);
      const gun = G.gun, bolt = gun.parts.boltVisual;
      gun.mag = gun.magSize; gun.reloading = false; gun.lastShot = -99;
      gun.cycleT = 0; gun.boltSoundPending = false;
      let boltSounds = 0;
      const oldBolt = MP.SFX.bolt;
      MP.SFX.bolt = () => { boltSounds++; };

      G.mouse.clicked = true;
      QA.tick(1);
      const afterFirst = gun.mag, cycleStarted = gun.cycleT;
      G.mouse.clicked = true;
      QA.tick(1);
      const whileCycling = gun.mag;
      QA.tick(24);
      const boltTravel = Math.abs(bolt.position.z - bolt.userData.z0);
      const soundDuringCycle = boltSounds;
      QA.tick(70);
      G.mouse.clicked = true;
      QA.tick(1);
      const afterSecond = gun.mag;
      MP.SFX.bolt = oldBolt;
      QA.clearInput();
      return { afterFirst, whileCycling, afterSecond, cycleStarted, boltTravel, soundDuringCycle, boltSounds };
    });

    assert.equal(result.afterFirst, 4, 'primeiro tiro não consumiu uma das cinco munições');
    assert.equal(result.whileCycling, 4, 'arma disparou durante o ciclo do ferrolho');
    assert.equal(result.afterSecond, 3, 'segundo tiro não liberou depois do ciclo');
    assert.ok(result.cycleStarted > 0.9, 'ciclo não iniciou');
    assert.ok(result.boltTravel > 0.045, `ferrolho quase não moveu (${result.boltTravel})`);
    assert.ok(result.soundDuringCycle >= 1, 'som metálico não tocou durante o ciclo');
  });

  it('dado o machado e a arma alienígena, então golpe e projétil aparecem em jogo', async () => {
    const result = await h.play(async () => {
      const QA = window.QA, G = QA.G, MP = QA.MP;
      await G.WeaponModels.ready;
      QA.clearInput(); G.state.paused = false; window.__BR_freeze = false;

      G.arsenal[5].locked = false;
      G.switchWeapon(5); QA.tick(60);
      G.mouse.aiming = true; QA.tick(30);
      const axeAdsDistance = MP.weaponRoot.position.distanceTo(G.gun.adsV);
      G.mouse.aiming = false; QA.tick(20);
      G.gun.lastShot = -99; G.gun.cycleT = 0;
      G.mouse.clicked = true; QA.tick(9);
      const axe = {
        cycle: G.gun.cycleT,
        swing: Math.abs(MP.weaponRoot.rotation.z),
        shifted: Math.abs(MP.weaponRoot.position.x - G.gun.hipV.x),
        adsDistance: axeAdsDistance,
      };

      G.arsenal[4].locked = false;
      G.switchWeapon(4); QA.tick(60);
      G.gun.mag = G.gun.magSize; G.gun.lastShot = -99; G.gun.cycleT = 0;
      G.mouse.shooting = true; QA.tick(1); G.mouse.shooting = false;
      const plasmaActive = MP.FX.plasmaActiveCount;
      QA.clearInput();
      return { axe, plasmaActive };
    });

    assert.ok(result.axe.cycle > 0, 'machado não iniciou o golpe');
    assert.ok(result.axe.swing > 0.35, `arco do machado pequeno (${result.axe.swing})`);
    assert.ok(result.axe.shifted > 0.05, 'machado não deslocou durante o golpe');
    assert.ok(result.axe.adsDistance > 0.1, 'botão direito ainda forçou ADS quebrado no machado');
    assert.ok(result.plasmaActive >= 1, 'tiro de plasma continuou sem projétil visível');
  });
});
