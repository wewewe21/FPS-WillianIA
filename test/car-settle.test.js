/* Assentamento dos veículos em seeds diferentes: ninguém nasce enterrado,
   flutuando ou ejetado — e a travessia cidade↔campo não dá salto visual.
   O apoio é medido nas RODAS físicas (raycast), não no Box3 do modelo. */
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { CHROME, bootGame } = require('./helpers/harness');

function settleChecks(h) {
  return h.play(() => {
    const QA = window.QA, G = QA.G;
    QA.tick(360); // 6 s de física: tudo assenta
    return G.Car.vehicles.map(v => {
      const up = v.chassisBody.quaternion.vmult(
        new (Object.getPrototypeOf(v.chassisBody.position).constructor)(0, 1, 0));
      return {
        tipo: v.cfg.name,
        rig: v.wheelRigStatus,
        upY: +up.y.toFixed(3),
        vel: +v.chassisBody.velocity.length().toFixed(3),
        finito: [v.chassisBody.position.x, v.chassisBody.position.y, v.chassisBody.position.z,
          v.chassisBody.quaternion.x, v.chassisBody.quaternion.w,
          ...v.vehicle.wheelInfos.map(w => w.suspensionLength)].every(Number.isFinite),
        rodas: v.vehicle.wheelInfos.map(w => ({
          contato: !!w.raycastResult.body,
          susp: +w.suspensionLength.toFixed(3),
          apoio: +(w.worldTransform.position.y - w.raycastResult.hitPointWorld.y - w.radius).toFixed(3),
        })),
      };
    });
  });
}

function assertSettled(r) {
  for (const v of r) {
    assert.equal(v.rig, 'ready', `${v.tipo}: rig ${v.rig}`);
    assert.ok(v.finito, `${v.tipo}: estado não finito`);
    assert.ok(v.vel < 0.6, `${v.tipo}: ainda se movendo (${v.vel} m/s) — spawn ejetou?`);
    assert.ok(v.upY > 0.85, `${v.tipo}: tombado (up.y=${v.upY})`);
    const contato = v.rodas.filter(w => w.contato);
    assert.ok(contato.length >= 3, `${v.tipo}: só ${contato.length}/4 rodas apoiadas`);
    for (const w of contato) {
      // apoio ≈ raio: nem enterrado (apoio<-0.06) nem flutuando (apoio>0.08)
      assert.ok(w.apoio > -0.06 && w.apoio < 0.08,
        `${v.tipo}: pneu a ${w.apoio}m do apoio esperado (susp=${w.susp})`);
    }
  }
}

for (const [seed, port] of [['99', 3173], ['7', 3180]]) {
  describe(`Veículos assentados na seed ${seed}`, { skip: !CHROME && 'Chrome não encontrado' }, () => {
    let h;
    before(async () => {
      h = await bootGame({ port, worldSeed: seed });
      await h.play(async () => { await window.QA.G.Car.ready; });
    });
    after(async () => { if (h) await h.close(); });

    it('dado o spawn, então nenhum carro nasce enterrado, flutuando ou ejetado', async () => {
      assertSettled(await settleChecks(h));
    });
  });
}

describe('Travessia cidade ↔ campo (seed 424242)', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h;
  before(async () => {
    h = await bootGame({ port: 3193 });
    await h.play(async () => { await window.QA.G.Car.ready; window.QA.tick(240); });
  });
  after(async () => { if (h) await h.close(); });

  it('dado um esportivo saindo da cidade pro campo, então não há salto visual nem estado urbano preso', async () => {
    const r = await h.play(() => {
      const QA = window.QA, G = QA.G, THREE = QA.MP.THREE;
      const v = G.Car.vehicles.find(x => x.cfg.name === 'ESPORTIVO GT');
      G.Car.setCur(v);
      // rua leste da cidade apontando pro campo (+x)
      const CITY = { x: -340, z: 130 };
      v.chassisBody.position.set(CITY.x + 55, QA.MP.heightAt(CITY.x + 55, CITY.z) + 1.3, CITY.z);
      v.chassisBody.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0);
      v.chassisBody.velocity.set(0, 0, 0); v.chassisBody.angularVelocity.set(0, 0, 0);
      v.chassisBody.wakeUp();
      QA.tick(120); // assenta na laje da rua
      G.state.driving = true;
      G.keys.KeyW = true;
      let prevY = null, maxDropPerFrame = 0, maxX = -1e9;
      const _p = new THREE.Vector3();
      for (let i = 0; i < 420; i++) {
        QA.tick(1);
        v.group.updateMatrixWorld(true);
        v.bodyRoot.getWorldPosition(_p);
        if (prevY !== null) maxDropPerFrame = Math.max(maxDropPerFrame, Math.abs(_p.y - prevY));
        prevY = _p.y;
        maxX = Math.max(maxX, v.chassisBody.position.x);
      }
      G.keys.KeyW = false; G.state.driving = false;
      QA.clearInput();
      const distDaCidade = Math.hypot(v.chassisBody.position.x - CITY.x, v.chassisBody.position.z - CITY.z);
      return {
        maxDropPerFrame, distDaCidade, maxX: maxX - CITY.x,
        semEstadoUrbano: v.naCidade === undefined && v.modelBottomRel === undefined,
        finito: Number.isFinite(v.chassisBody.position.y),
      };
    });
    assert.ok(r.maxX > 95, `carro não cruzou a fronteira (chegou a +${r.maxX.toFixed(0)}m do centro)`);
    // descer da laje do asfalto (~0,15 m) amortecido pela suspensão: nada de salto
    assert.ok(r.maxDropPerFrame < 0.3, `salto visual na travessia: ${r.maxDropPerFrame.toFixed(2)}m num frame`);
    assert.ok(r.semEstadoUrbano, 'estado cacheado "naCidade" voltou');
    assert.ok(r.finito, 'pose não finita');
  });

  it('dado um carro na rua da cidade, então ele apoia NA LAJE do asfalto (acima do terreno)', async () => {
    const r = await h.play(() => {
      const QA = window.QA, G = QA.G, THREE = QA.MP.THREE;
      const v = G.Car.vehicles.find(x => x.cfg.name === 'ESPORTIVO GT');
      // devolve pra rua (o teste anterior dirigiu ele pro campo) e deixa assentar
      const CITY = { x: -340, z: 130 };
      v.chassisBody.position.set(CITY.x + 14, QA.MP.heightAt(CITY.x + 14, CITY.z + 26) + 1.5, CITY.z + 26);
      v.chassisBody.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0);
      v.chassisBody.velocity.set(0, 0, 0); v.chassisBody.angularVelocity.set(0, 0, 0);
      v.chassisBody.wakeUp();
      QA.tick(300);
      /* a laje do asfalto é PLANA na altura do centro da cidade (+0,14 m); o
         terreno local ondula um pouco — compara com a cota da laje, não com
         o heightAt do ponto */
      const lajeTopo = QA.MP.heightAt(CITY.x, CITY.z) + 0.14;
      const contatos = v.vehicle.wheelInfos.map(w => ({
        contato: !!w.raycastResult.body,
        vsLaje: +(w.raycastResult.hitPointWorld.y - lajeTopo).toFixed(3),
      }));
      return { contatos };
    });
    const apoiadas = r.contatos.filter(c => c.contato);
    assert.ok(apoiadas.length >= 3, `só ${apoiadas.length}/4 rodas apoiadas na rua`);
    for (const c of apoiadas)
      assert.ok(Math.abs(c.vsLaje) < 0.1, `pneu apoiado a ${c.vsLaje}m da laje do asfalto`);
  });
});
