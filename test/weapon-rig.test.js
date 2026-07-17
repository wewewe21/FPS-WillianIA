/* ================================================================
   QA — WeaponRig (js/weaponrig.js) rodando em Node puro.
   Perfis declarativos das 8 armas: miras com eixo óptico real,
   âncoras e a matemática de pose de ADS (eye→front mapeado pro -Z
   da câmera). Nada aqui depende de browser/GLB: o rig precisa ser
   válido mesmo no fallback procedural.
   ================================================================ */
'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert');

let THREE, createWeaponRig;
before(async () => {
  THREE = await import('three');
  ({ createWeaponRig } = await import('../js/weaponrig.js'));
});

/* esqueleto mínimo de arma compatível com o rig (sem js/weapons.js) */
function fakeGun(idx) {
  return {
    name: 'w' + idx, group: new THREE.Group(), parts: {},
    hipV: new THREE.Vector3(0.26, -0.235, -0.5),
    adsV: new THREE.Vector3(0, -0.09, -0.3),
    mag: 5, magSize: 5, reloading: false, reloadEnd: 0, reloadTime: 1.5,
    cycleT: 0, lastShot: -9,
  };
}
function makeRig() {
  const camera = new THREE.PerspectiveCamera();
  const arsenal = Array.from({ length: 8 }, (_, i) => fakeGun(i));
  const rig = createWeaponRig({ arsenal, camera, weaponRoot: new THREE.Group() });
  return { rig, arsenal, camera };
}

describe('WeaponRig — perfis', () => {
  it('dado o rig, então há perfil válido pros 8 índices e a faca é melee sem mira de firearm', () => {
    const { rig } = makeRig();
    for (let i = 0; i < 8; i++) {
      const p = rig.inspect(i);
      assert.ok(p, 'sem perfil idx ' + i);
      if (i === 5) {
        assert.equal(p.melee, true, 'faca deveria ser melee');
        assert.equal(p.sights.length, 0, 'faca não pode ter mira de arma de fogo');
        continue;
      }
      assert.ok(p.sights.length >= 1, 'arma de fogo sem mira idx ' + i);
      assert.ok(p.anchors.muzzle && p.anchors.gripR && p.anchors.supportHand,
        'âncora faltando idx ' + i);
      for (const s of p.sights) {
        for (const v of [...s.eye, ...s.front]) assert.ok(Number.isFinite(v), 'NaN em mira idx ' + i);
        assert.ok(s.eyeRelief > 0.05 && s.eyeRelief < 0.6, 'eyeRelief fora da janela idx ' + i);
        assert.ok(s.fov >= 20 && s.fov <= 70, 'fov fora da janela idx ' + i);
        // eixo óptico aponta pra FRENTE da arma (-Z local)
        assert.ok(s.front[2] < s.eye[2], `front não está à frente do eye (idx ${i}, ${s.id})`);
      }
      assert.ok(p.anchors.muzzle[2] < -0.3, 'muzzle não está na ponta idx ' + i);
    }
  });

  it('dada a pose ADS, então o eixo óptico mapeia pro -Z da câmera com quat normalizado', () => {
    const { rig, arsenal } = makeRig();
    for (const i of [0, 1, 2, 3, 4, 6, 7]) {
      const gun = arsenal[i];
      const pose = rig.adsPose(gun);
      assert.ok(Math.abs(pose.quat.length() - 1) < 1e-6, 'quat não normalizado idx ' + i);
      const s = rig.activeSight(gun);
      const f = new THREE.Vector3().fromArray(s.front)
        .sub(new THREE.Vector3().fromArray(s.eye)).normalize().applyQuaternion(pose.quat);
      assert.ok(f.angleTo(new THREE.Vector3(0, 0, -1)) < THREE.MathUtils.degToRad(0.1),
        `eixo óptico não mapeou pro -Z (idx ${i}): ${f.toArray().map(v => v.toFixed(3))}`);
      // olho na ocular: eye transformado cai em (0, 0, -eyeRelief)
      const eyeCam = new THREE.Vector3().fromArray(s.eye).applyQuaternion(pose.quat).add(pose.pos);
      assert.ok(eyeCam.distanceTo(new THREE.Vector3(0, 0, -s.eyeRelief)) < 1e-6,
        `eye fora da ocular idx ${i}: ${eyeCam.toArray()}`);
      for (const v of [...pose.pos.toArray(), ...pose.quat.toArray()])
        assert.ok(Number.isFinite(v), 'pose com NaN idx ' + i);
    }
  });

  it('dada uma mira LATERAL (bazuca), então a pose desloca o tubo pro lado', () => {
    const { rig, arsenal } = makeRig();
    const s = rig.activeSight(arsenal[3]);
    assert.ok(Math.abs(s.eye[0]) > 0.03, 'mira da bazuca deveria ser lateral (|x| > 3cm)');
    const pose = rig.adsPose(arsenal[3]);
    // centro do tubo (x=0 local) NÃO pode ficar no eixo da câmera
    const tube = new THREE.Vector3(0, 0.02, -0.3).applyQuaternion(pose.quat).add(pose.pos);
    assert.ok(Math.abs(tube.x) > 0.02, 'tubo continua no centro da tela: x=' + tube.x.toFixed(3));
  });

  it('dado cycleSight, então alterna, persiste por arma e só existe com 2+ miras', () => {
    const { rig, arsenal } = makeRig();
    const rifle = arsenal[0];
    const s0 = rig.activeSight(rifle);
    const s1 = rig.cycleSight(rifle);
    assert.ok(s1 && s0.id !== s1.id, 'T não alternou a mira do fuzil');
    assert.equal(rig.activeSight(rifle).id, s1.id, 'escolha não persistiu');
    assert.equal(rig.cycleSight(arsenal[5]), null, 'faca não pode ciclar mira');
    if (rig.inspect(1).sights.length === 1)
      assert.equal(rig.cycleSight(arsenal[1]), null, 'arma de mira única não cicla');
  });

  it('dada a pose de hip, então preserva a convenção atual (hipV + [0, .05, .06], sem rotação)', () => {
    const { rig, arsenal } = makeRig();
    const hip = rig.hipPose(arsenal[0]);
    assert.ok(hip.pos.distanceTo(new THREE.Vector3(0.26, -0.185, -0.44)) < 1e-6,
      'pose de hip mudou: ' + hip.pos.toArray());
    assert.ok(Math.abs(hip.quat.w - 1) < 1e-9, 'hip deveria ter quat identidade');
  });

  it('dado sightRefK, então é 0 fora do ADS, 1 no ADS completo e sempre 0 na faca', () => {
    const { rig, arsenal } = makeRig();
    assert.equal(rig.sightRefK(arsenal[0], 0), 0);
    assert.equal(rig.sightRefK(arsenal[0], 1), 1);
    assert.ok(rig.sightRefK(arsenal[0], 0.5) === 0, 'referência não pode valer antes da mira alinhar');
    assert.equal(rig.sightRefK(arsenal[5], 1), 0, 'faca nunca ganha referência de firearm');
  });
});
