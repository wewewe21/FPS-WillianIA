/* Rig visual de rodas dos veículos: extração dos GLBs, animação física
   (giro/esterço/suspensão) e assentamento por contato real dos pneus.
   Antes do rig, as rodas dos GLBs eram estáticas (fundidas na carroceria) e
   o modelo era colado no chão por hacks visuais — estes testes falham lá. */
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { CHROME, bootGame } = require('./helpers/harness');

describe('Rig de rodas dos veículos', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h;
  before(async () => {
    h = await bootGame({ port: 3168 });
    await h.play(async () => {
      await window.QA.G.Car.ready;
      window.QA.tick(240);
      /* campo plano e SEM estruturas (árvore/tenda desviaria os testes de
         pista): confere o apoio estático real contra o terreno */
      window.QA_findFlat = () => {
        const MP = window.QA.MP;
        const Vec3 = Object.getPrototypeOf(MP.world.bodies[0].position).constructor;
        const from = new Vec3(), to = new Vec3();
        const staticTop = (x, z) => {
          const base = MP.heightAt(x, z);
          from.set(x, base + 30, z); to.set(x, base - 10, z);
          let best = -1e9;
          MP.world.raycastAll(from, to, {}, r => {
            if (r.body.mass === 0 && r.hitPointWorld.y > best) best = r.hitPointWorld.y;
          });
          return best;
        };
        // apoio FÍSICO quase plano em toda a pegada do carro + pista à frente
        // (o apoio real importa: heightAt bilinear esconde vinco da malha)
        let best = null;
        for (const [x, z] of [[30, -30], [0, -45], [60, 60], [90, -50], [-70, -90], [130, 60], [40, 120]]) {
          let lo = 1e9, hi = -1e9, blocked = false;
          for (let dx = -3; dx <= 15; dx += 3) for (let dz = -3; dz <= 3; dz += 3) {
            const t = staticTop(x + dx, z + dz);
            // corpo alto acima do terreno = árvore/tenda/pedra no caminho
            if (t - MP.heightAt(x + dx, z + dz) > 0.5) { blocked = true; break; }
            lo = Math.min(lo, t); hi = Math.max(hi, t);
          }
          if (blocked) continue;
          if (best === null || hi - lo < best.range) best = { x, z, range: hi - lo };
          if (hi - lo < 0.35) break; // bom o bastante
        }
        return best ? [best.x, best.z] : [30, -30];
      };
    });
  });
  after(async () => { if (h) await h.close(); });

  it('dado cada veículo, então o rig extrai exatamente 4 rodas visíveis calibradas', async () => {
    const r = await h.play(() => {
      const G = window.QA.G;
      return G.Car.vehicles.map(v => ({
        tipo: v.cfg.name,
        rigStatus: v.wheelRigStatus,
        rigError: v.wheelRigError || null,
        pivos: (v.visualWheels || []).map((p, i) => {
          let meshes = 0, verts = 0, finito = true, materialOk = true;
          p.traverse(o => {
            if (!o.isMesh) return;
            meshes++;
            verts += o.geometry.attributes.position.count;
            const pa = o.geometry.attributes.position.array;
            for (let k = 0; k < pa.length; k++) if (!Number.isFinite(pa[k])) finito = false;
            if (!o.material || o.material.color === undefined) materialOk = false;
          });
          const cfgW = v.cfg.wheelsVis[i];
          return {
            nome: p.name, meshes, verts, finito, materialOk,
            visivel: p.visible,
            rig: v.wheelRig && {
              r: v.wheelRig[i].radius, w: v.wheelRig[i].width,
              steerBake: v.wheelRig[i].bakedSteer, tris: v.wheelRig[i].tris,
              erroCentro: Math.hypot(v.wheelRig[i].center.x - cfgW[0],
                v.wheelRig[i].center.y - cfgW[1], v.wheelRig[i].center.z - cfgW[2]),
            },
            rCfg: Array.isArray(v.cfg.wheelRVis) ? v.cfg.wheelRVis[i] : v.cfg.wheelRVis,
            wCfg: v.cfg.wheelWVis,
          };
        }),
      }));
    });
    assert.ok(r.length >= 3, 'frota incompleta');
    for (const v of r) {
      assert.equal(v.rigStatus, 'ready', `${v.tipo}: rig não ficou pronto (${v.rigError})`);
      assert.equal(v.pivos.length, 4, `${v.tipo}: ${v.pivos.length} pivôs`);
      assert.deepEqual(v.pivos.map(p => p.nome), ['Wheel_FR', 'Wheel_FL', 'Wheel_RR', 'Wheel_RL'],
        `${v.tipo}: nomes/ordem dos pivôs`);
      for (const p of v.pivos) {
        assert.ok(p.visivel, `${v.tipo} ${p.nome} invisível`);
        assert.ok(p.meshes > 0 && p.verts > 30, `${v.tipo} ${p.nome} sem geometria (${p.meshes} malhas, ${p.verts} verts)`);
        assert.ok(p.finito, `${v.tipo} ${p.nome} com vértice não finito`);
        assert.ok(p.materialOk, `${v.tipo} ${p.nome} sem material válido`);
        assert.ok(p.rig.tris >= 60, `${v.tipo} ${p.nome} só ${p.rig.tris} triângulos`);
        assert.ok(p.rig.erroCentro <= 0.12, `${v.tipo} ${p.nome} centro fora da calibração (${p.rig.erroCentro.toFixed(3)}m)`);
        assert.ok(p.rig.r >= p.rCfg * 0.72 && p.rig.r <= p.rCfg * 1.35,
          `${v.tipo} ${p.nome} raio ${p.rig.r.toFixed(3)} vs cfg ${p.rCfg}`);
        assert.ok(p.rig.w <= p.wCfg * 1.6 + 0.05, `${v.tipo} ${p.nome} largura ${p.rig.w.toFixed(3)} vs cfg ${p.wCfg}`);
      }
    }
    // o RX-7 vem de fábrica com as dianteiras viradas: o rig precisa DESFAZER
    const rx7 = r.find(v => v.tipo === 'ESPORTIVO GT');
    assert.ok(Math.abs(rx7.pivos[0].rig.steerBake) > 0.2, 'RX-7 dianteira sem esterço de fábrica detectado');
    assert.ok(Math.abs(rx7.pivos[2].rig.steerBake) < 0.06, 'RX-7 traseira "detectou" esterço inexistente');
  });

  it('dada a carroceria, então nenhuma roda original ficou duplicada nela', async () => {
    const r = await h.play(async () => {
      const G = window.QA.G, THREE = window.QA.MP.THREE;
      const { analyzeCarModel } = await import('/js/carwheels.js');
      const seen = new Set();
      const out = [];
      for (const v of G.Car.vehicles) {
        if (seen.has(v.cfg.modelUrl) || v.wheelRigStatus !== 'ready') continue;
        seen.add(v.cfg.modelUrl);
        // corpo destacado com transformações identidade (geometria já é do chassi)
        const tmp = new THREE.Group();
        v.bodyRoot.traverse(o => { if (o.isMesh) tmp.add(new THREE.Mesh(o.geometry, o.material)); });
        const islands = analyzeCarModel(tmp, 100);
        const sobras = [];
        for (const isl of islands) {
          for (const [wx, wy, wz] of v.cfg.wheelsVis) {
            const d = Math.hypot(isl.center[0] - wx, isl.center[1] - wy, isl.center[2] - wz);
            if (d < 0.12) sobras.push({ tris: isl.tris, d: +d.toFixed(3) });
          }
        }
        out.push({ url: v.cfg.modelUrl, sobras, corpoIlhas: islands.length });
      }
      return out;
    });
    assert.equal(r.length, 3, 'nem todos os modelos analisados');
    for (const m of r) {
      assert.deepEqual(m.sobras, [], `${m.url}: roda estática sobrou na carroceria`);
      assert.ok(m.corpoIlhas > 0, `${m.url}: carroceria ficou vazia`);
    }
  });

  it('dado o acelerador, então as 4 rodas visíveis ROLAM de verdade (topo anda, contato não desliza)', async () => {
    const r = await h.play(() => {
      const QA = window.QA, G = QA.G, THREE = QA.MP.THREE;
      const [px, pz] = window.QA_findFlat();
      QA.reset(px - 12, pz);
      const v = G.Car.vehicles[0];
      G.Car.setCur(v);
      // pista plana longe de obstáculos
      v.chassisBody.position.set(px, QA.MP.heightAt(px, pz) + 1.4, pz);
      v.chassisBody.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0);
      v.chassisBody.velocity.set(0, 0, 0); v.chassisBody.angularVelocity.set(0, 0, 0);
      v.chassisBody.wakeUp();
      QA.tick(90); // assenta
      v.chassisBody.wakeUp(); // parado por 1,5 s ele dorme — como ao ENTRAR no carro
      G.state.driving = true;
      G.keys.KeyW = true;
      QA.tick(75);  // pega velocidade
      const rot0 = v.vehicle.wheelInfos.map(w => w.rotation);
      const _q = new THREE.Quaternion(), _dq = new THREE.Quaternion(),
        _qPrev = [new THREE.Quaternion(), new THREE.Quaternion()], _p = new THREE.Vector3();
      const _fwd = new THREE.Vector3();
      /* rolagem SEM deslizar: v_frente + ω_z·raio ≈ 0 no pivô VISÍVEL (a
         convenção do cannon dá ω negativo pra frente — sinal incluso).
         Só conta tick com a roda em contato e sem flag de patinação. */
      let validos = 0, chasD = 0, errPosMax = 0;
      const rolagem = [];
      _qPrev[0].copy(v.visualWheels[2].quaternion);
      _qPrev[1].copy(v.visualWheels[3].quaternion);
      for (let n = 0; n < 40; n++) {
        const c0 = v.chassisBody.position.x;
        QA.tick(1);
        v.group.updateMatrixWorld(true);
        chasD += Math.abs(v.chassisBody.position.x - c0);
        _fwd.set(1, 0, 0).applyQuaternion(v.group.quaternion);
        const vFwd = v.chassisBody.velocity.x * _fwd.x + v.chassisBody.velocity.y * _fwd.y + v.chassisBody.velocity.z * _fwd.z;
        for (let k = 0; k < 2; k++) {
          const i = 2 + k; // traseiras: motrizes e carregadas
          const w = v.vehicle.wheelInfos[i];
          // quaternion LOCAL do pivô: mede só o giro da roda (solavanco do
          // chassi não contamina)
          _q.copy(v.visualWheels[i].quaternion);
          _dq.copy(_qPrev[k]).invert().multiply(_q);
          _qPrev[k].copy(_q);
          if (!w.raycastResult.body || w.sliding || Math.abs(vFwd) < 2) continue;
          const omega = 2 * Math.atan2(_dq.z, _dq.w) / (1 / 60); // giro no eixo Z local
          validos++;
          rolagem.push(Math.abs(vFwd + omega * w.radius) / Math.abs(vFwd));
        }
        for (let i = 0; i < 4; i++) {
          const wt = v.vehicle.wheelInfos[i].worldTransform;
          v.visualWheels[i].getWorldPosition(_p);
          errPosMax = Math.max(errPosMax, Math.hypot(_p.x - wt.position.x, _p.y - wt.position.y, _p.z - wt.position.z));
        }
      }
      const rotFwd = v.vehicle.wheelInfos.map((w, i) => w.rotation - rot0[i]);
      // ré: freia até parar e acelera de costas
      G.keys.KeyW = false; G.keys.Space = true; QA.tick(150); G.keys.Space = false;
      const rotR0 = v.vehicle.wheelInfos.map(w => w.rotation);
      G.keys.KeyS = true; QA.tick(90); G.keys.KeyS = false;
      const rotRe = v.vehicle.wheelInfos.map((w, i) => w.rotation - rotR0[i]);
      G.state.driving = false;
      QA.clearInput();
      rolagem.sort((a, b) => a - b);
      const p80 = rolagem.length ? rolagem[Math.floor(rolagem.length * 0.8)] ?? rolagem[rolagem.length - 1] : 1e9;
      return { rotFwd, rotRe, validos, p80, chasD, errPosMax };
    });
    assert.ok(r.chasD > 2, `carro nem andou (${r.chasD.toFixed(1)}m) — teste vazio`);
    for (const d of r.rotFwd) assert.ok(Math.abs(d) > 1, `roda não girou pra frente (Δrot=${d.toFixed(3)})`);
    const sig = Math.sign(r.rotFwd[0]);
    for (const d of r.rotFwd) assert.equal(Math.sign(d), sig, 'rodas girando em sentidos opostos entre si');
    for (const d of r.rotRe) assert.ok(Math.sign(d) === -sig && Math.abs(d) > 0.3,
      `ré não inverteu o giro (Δrot=${d.toFixed(3)})`);
    // rolagem visual real: v + ω·r ≈ 0 (sinal errado daria escorregão de 2x)
    assert.ok(r.validos >= 10, `poucas amostras de rolagem em contato (${r.validos})`);
    assert.ok(r.p80 < 0.35,
      `pneu desliza/gira errado: |v+ωr|/v (p80) = ${(r.p80 * 100).toFixed(0)}%`);
    assert.ok(r.errPosMax <= 0.02, `pivô visual descolou da roda física: ${(r.errPosMax * 100).toFixed(1)}cm`);
  });

  it('dado o esterço, então SÓ as dianteiras viram, com o sinal certo', async () => {
    const r = await h.play(() => {
      const QA = window.QA, G = QA.G, THREE = QA.MP.THREE;
      const v = G.Car.vehicles[0];
      G.Car.setCur(v);
      v.chassisBody.wakeUp();
      const _q = new THREE.Quaternion(), _a = new THREE.Vector3(), _qi = new THREE.Quaternion();
      // yaw do eixo (axle local Z) RELATIVO ao chassi — imune ao giro de rolagem
      const axleYaw = i => {
        v.group.updateMatrixWorld(true);
        v.visualWheels[i].getWorldQuaternion(_q);
        _qi.copy(v.group.quaternion).invert().multiply(_q);
        _a.set(0, 0, 1).applyQuaternion(_qi);
        return Math.atan2(_a.x, _a.z);
      };
      const medir = key => {
        G.state.driving = true;
        G.keys[key] = true;
        QA.tick(60);
        const out = [axleYaw(0), axleYaw(1), axleYaw(2), axleYaw(3), v.vehicle.wheelInfos[0].steering];
        G.keys[key] = false;
        QA.tick(60); // esterço volta ao centro
        G.state.driving = false;
        return out;
      };
      const esq = medir('KeyA');
      const dir = medir('KeyD');
      QA.clearInput();
      return { esq, dir, maxSteer: v.cfg.steer };
    });
    const [eFR, eFL, eRR, eRL, steerFisico] = r.esq;
    // KeyA = +steer = esquerda (convenção do jogo); pivô visual segue o físico
    assert.ok(steerFisico > 0.1, `esterço físico não aplicou (${steerFisico})`);
    assert.ok(eFR > 0.1 && eFL > 0.1, `dianteiras não viraram à esquerda (${eFR.toFixed(2)}, ${eFL.toFixed(2)})`);
    assert.ok(Math.abs(eRR) < 0.03 && Math.abs(eRL) < 0.03, `traseiras esterçaram (${eRR.toFixed(3)}, ${eRL.toFixed(3)})`);
    assert.ok(eFR <= r.maxSteer + 0.05, `esterço visual acima do limite (${eFR.toFixed(2)} > ${r.maxSteer})`);
    const [dFR, dFL, dRR, dRL] = r.dir;
    assert.ok(dFR < -0.1 && dFL < -0.1, `dianteiras não viraram à direita (${dFR.toFixed(2)}, ${dFL.toFixed(2)})`);
    assert.ok(Math.abs(dRR) < 0.03 && Math.abs(dRL) < 0.03, 'traseiras esterçaram na direita');
  });

  it('dado o carro parado, então as rodas não acumulam giro nem drift', async () => {
    const r = await h.play(() => {
      const QA = window.QA, G = QA.G, THREE = QA.MP.THREE;
      const v = G.Car.vehicles[0];
      QA.clearInput();
      G.state.driving = false;
      const [px, pz] = window.QA_findFlat();
      v.chassisBody.position.set(px, QA.MP.heightAt(px, pz) + 1.4, pz);
      v.chassisBody.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0);
      v.chassisBody.velocity.set(0, 0, 0); v.chassisBody.angularVelocity.set(0, 0, 0);
      v.chassisBody.wakeUp();
      QA.tick(180); // freio de estacionamento assenta tudo
      const rot0 = v.vehicle.wheelInfos.map(w => w.rotation);
      const q0 = v.visualWheels.map(p => p.quaternion.toArray());
      QA.tick(300);
      const dRot = v.vehicle.wheelInfos.map((w, i) => Math.abs(w.rotation - rot0[i]));
      const dQ = v.visualWheels.map((p, i) => {
        const q = p.quaternion.toArray();
        return Math.max(...q.map((c, k) => Math.abs(c - q0[i][k])));
      });
      return { dRot, dQ, vel: v.chassisBody.velocity.length() };
    });
    // o atrito de estacionamento do cannon oscila em micro-ciclos (~0,15 m/s
    // pico); o que NÃO pode é a roda visível girar ou o pivô derivar
    assert.ok(r.vel < 0.2, `carro parado com velocidade ${r.vel}`);
    for (const d of r.dRot) assert.ok(d < 0.01, `roda parada acumulou giro (${d})`);
    for (const d of r.dQ) assert.ok(d < 0.02, `pivô parado acumulou drift no quaternion (${d})`);
  });

  it('dado o carro no ar, então as rodas ficam na posição da suspensão (NÃO coladas ao solo)', async () => {
    const r = await h.play(() => {
      const QA = window.QA, G = QA.G, THREE = QA.MP.THREE;
      const v = G.Car.vehicles[0];
      // pouso na rua da cidade: laje PLANA (campo tem vinco/inclinação que
      // deixa carro legitimamente apoiado na diagonal)
      const px = -340 + 34, pz = 130 + 26;
      const gy = QA.MP.heightAt(px, pz);
      v.chassisBody.position.set(px, gy + 7, pz);
      v.chassisBody.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0);
      v.chassisBody.velocity.set(0, 0, 0); v.chassisBody.angularVelocity.set(0, 0, 0);
      v.chassisBody.wakeUp();
      QA.tick(3); // ainda caindo
      const _p = new THREE.Vector3();
      v.group.updateMatrixWorld(true);
      const noAr = v.vehicle.wheelInfos.map((w, i) => {
        v.visualWheels[i].getWorldPosition(_p);
        return {
          // cannon-es: raio sem hit = suspensão volta ao comprimento de REPOUSO
          susp: w.suspensionLength,
          rest: w.suspensionRestLength,
          contato: !!w.raycastResult.body,
          alturaRoda: _p.y - QA.MP.heightAt(_p.x, _p.z),
          errPos: Math.hypot(_p.x - w.worldTransform.position.x, _p.y - w.worldTransform.position.y, _p.z - w.worldTransform.position.z),
        };
      });
      QA.tick(600); // pousa e estabiliza
      const up = v.chassisBody.quaternion.vmult(new (Object.getPrototypeOf(v.chassisBody.position).constructor)(0, 1, 0));
      const finais = v.vehicle.wheelInfos.map(w => ({
        contato: !!w.raycastResult.body,
        contatoVsRaio: w.worldTransform.position.y - w.raycastResult.hitPointWorld.y - w.radius,
      }));
      return {
        noAr, finais, upY: up.y,
        y: v.chassisBody.position.y, gy: QA.MP.heightAt(v.chassisBody.position.x, v.chassisBody.position.z),
        finito: [v.chassisBody.position.y, v.chassisBody.velocity.y, ...v.vehicle.wheelInfos.map(w => w.suspensionLength)].every(Number.isFinite),
      };
    });
    for (const w of r.noAr) {
      assert.equal(w.contato, false, 'roda "em contato" no meio da queda');
      assert.ok(Math.abs(w.susp - w.rest) < 0.01, `no ar a suspensão devia estar no repouso do cannon (susp=${w.susp})`);
      assert.ok(w.alturaRoda > 3, `roda foi colada no chão durante a queda (altura=${w.alturaRoda.toFixed(2)})`);
      assert.ok(w.errPos <= 0.02, `pivô descolou da física na queda (${w.errPos.toFixed(3)}m)`);
    }
    assert.ok(r.upY > 0.9, `carro capotou/ejetou no pouso (up.y=${r.upY.toFixed(2)})`);
    assert.ok(r.y > r.gy - 0.5 && r.y < r.gy + 3, `pouso irreal: y=${r.y.toFixed(2)} solo=${r.gy.toFixed(2)}`);
    const pousadas = r.finais.filter(w => w.contato);
    assert.ok(pousadas.length >= 3, `só ${pousadas.length}/4 rodas apoiadas após o pouso`);
    for (const w of pousadas)
      assert.ok(Math.abs(w.contatoVsRaio) < 0.04, `apoio do pneu ≠ raio após pouso (${w.contatoVsRaio.toFixed(3)}m)`);
    assert.ok(r.finito, 'estado não finito após queda');
  });

  it('dado o load do modelo, então o offset carroceria–chassi é constante (sem re-ancoragem)', async () => {
    const r = await h.play(() => {
      const QA = window.QA, G = QA.G;
      const v = G.Car.vehicles[0];
      const esperado = [v.cfg.comDrop || 0, 0, 0]; // offset de calibração (CG baixo), fixo no load
      const antes = [v.bodyRoot.position.y, v.bodyRoot.position.x, v.bodyRoot.position.z];
      G.Car.setCur(v);
      G.state.driving = true;
      G.keys.KeyW = true; QA.tick(120);
      G.keys.KeyW = false; G.state.driving = false;
      QA.clearInput();
      QA.tick(240); // para e dorme fora da cidade — a antiga re-ancoragem rodava aqui
      const depois = [v.bodyRoot.position.y, v.bodyRoot.position.x, v.bodyRoot.position.z];
      return { esperado, antes, depois, hacksMortos: v.modelAlignPending === undefined && v.modelBottomRel === undefined };
    });
    assert.deepEqual(r.depois, r.antes, 'bodyRoot foi movido em relação ao chassi');
    assert.deepEqual(r.antes, r.esperado, 'bodyRoot fora do offset de calibração');
    assert.ok(r.hacksMortos, 'campos do antigo alinhamento visual voltaram');
  });

  it('dados todos os veículos assentados, então cada pneu em contato apoia à distância do raio', async () => {
    const r = await h.play(() => {
      const QA = window.QA, G = QA.G, THREE = QA.MP.THREE;
      // os testes anteriores levaram o buggy pra longe: devolve pra um campo limpo
      const v0 = G.Car.vehicles[0];
      const [px, pz] = window.QA_findFlat();
      v0.chassisBody.position.set(px, QA.MP.heightAt(px, pz) + 1.4, pz);
      v0.chassisBody.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0);
      v0.chassisBody.velocity.set(0, 0, 0); v0.chassisBody.angularVelocity.set(0, 0, 0);
      v0.chassisBody.wakeUp();
      QA.tick(240);
      return G.Car.vehicles.map(v => ({
        tipo: v.cfg.name,
        finito: Number.isFinite(v.chassisBody.position.y) && Number.isFinite(v.chassisBody.quaternion.w),
        rodas: v.vehicle.wheelInfos.map(w => ({
          contato: !!w.raycastResult.body,
          susp: +w.suspensionLength.toFixed(3),
          apoio: +(w.worldTransform.position.y - w.raycastResult.hitPointWorld.y - w.radius).toFixed(3),
        })),
      }));
    });
    for (const v of r) {
      assert.ok(v.finito, `${v.tipo} com pose não finita`);
      const emContato = v.rodas.filter(w => w.contato);
      assert.ok(emContato.length >= 3, `${v.tipo} com só ${emContato.length} rodas em contato`);
      for (const w of emContato)
        assert.ok(Math.abs(w.apoio) < 0.05, `${v.tipo}: pneu apoiado a ${w.apoio}m do raio (susp=${w.susp})`);
    }
  });
});
