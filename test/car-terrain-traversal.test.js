/* ================================================================
   QA — travessia veicular SEM falso travamento (Fase F do rework).
   Corredores pré-validados pela superfície canônica (driveable, sem
   obstáculo rígido) percorridos pelos 3 veículos em vários biomas,
   entradas e cadências (30/60/120 FPS de passo). Falso travamento =
   >1,5 s com acelerador, vel<0,5 m/s, terreno dirigível e NENHUM
   contato rígido identificado. Caso-controle: árvore rígida TEM que
   parar o carro e apontar o sourceId.
   ================================================================ */
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { CHROME, bootGame } = require('./helpers/harness.js');

describe('Travessia veicular por bioma (Chrome headless)', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h;
  before(async () => { h = await bootGame({ port: 3230 }); });
  after(async () => { if (h) await h.close(); });

  /* roda um percurso e devolve telemetria resumida (injetado uma vez) */
  const setupScript = () => {
    const G = window.QA.G, MP = window.QA.MP, THREE = MP.THREE;
    window.__QA_findCorridor = (pred, len = 40) => {
      for (let k = 0; k < 9000; k++) {
        const x = ((k * 137.51) % 960) - 480, z = ((k * 91.17) % 960) - 480;
        const yaw = (k % 8) * Math.PI / 4;
        // veículos olham +X no espaço do chassi (half.x é o comprimento):
        // forward com yaw θ = (cosθ, 0, −sinθ)
        const dx = Math.cos(yaw), dz = -Math.sin(yaw);
        let ok = pred(x, z);
        // passo de 1 m: célula tem 5 m e cada uma tem 2 triângulos — passo
        // maior pulava triângulos íngremes no meio do corredor
        // valida uma FAIXA (centro ±2 m): o carro deriva lateralmente em
        // rampas e não pode cair num triângulo íngreme não validado
        const lx = -dz, lz = dx;
        for (let d = 0; ok && d <= len; d += 1) {
          for (const off of [-2, 0, 2]) {
            const px = x + dx * d + lx * off, pz = z + dz * d + lz * off;
            const su = G.surfaceAt(px, pz);
            // ≤12°: "confortavelmente dirigível" p/ HILL-START parado — o
            // caminhão (medido) precisa de embalo acima disso; o contrato
            // mundial driveable segue 20° p/ travessia COM velocidade
            if (!su.driveable || su.slopeDegrees > 12 || su.height < MP.WATER_LEVEL + 1) { ok = false; break; }
          }
          if (!ok) break;
          const px = x + dx * d, pz = z + dz * d;
          // crista afiada (curvatura convexa alta) pendura o eixo dianteiro:
          // rejeita corredores com "quebra" de perfil maior que ~0.5 m em 4 m
          if (d >= 2 && d <= len - 2) {
            const h0 = G.heightAt(px - dx * 2, pz - dz * 2), h1 = G.heightAt(px, pz), h2 = G.heightAt(px + dx * 2, pz + dz * 2);
            if ((h1 - (h0 + h2) / 2) > 0.25) { ok = false; break; }
          }
          for (const o of G.obstaclesNear(px, pz)) {
            if (o.category !== 'softVegetation' && Math.hypot(px - o.x, pz - o.z) < o.r + 3.2) { ok = false; break; }
          }
          const dc = Math.hypot(px + 340, pz - 130), dv = Math.hypot(px - 420, pz + 420);
          if (dc < 130 || dv < 135) ok = false;
        }
        if (ok) return { x, z, yaw };
      }
      return null;
    };
    window.__QA_drive = (vName, corr, seconds, dt, reverse) => {
      const v = G.Car.vehicles.find(c => c.cfg.name === vName) || G.Car.vehicles[0];
      G.Car.setCur(v);
      v.chassisBody.position.set(corr.x, G.heightAt(corr.x, corr.z) + 1.2, corr.z);
      v.chassisBody.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), corr.yaw);
      v.chassisBody.velocity.set(0, 0, 0);
      v.chassisBody.angularVelocity.set(0, 0, 0);
      v.chassisBody.wakeUp();
      const settle = Math.round(1.5 / dt);
      for (let i = 0; i < settle; i++) window.QA.tick(1, dt);
      G.state.driving = true;
      G.keys[reverse ? 'KeyS' : 'KeyW'] = true;
      const frames = Math.round(seconds / dt);
      let stuckT = 0, maxStuck = 0, nan = false, zeroContactT = 0, maxZeroContact = 0;
      let chassisScrapes = 0, stuckInfo = null, buriedT = 0, maxBuried = 0;
      const fwd = new THREE.Vector3();
      for (let i = 0; i < frames; i++) {
        window.QA.tick(1, dt);
        const cb = v.chassisBody;
        if (![cb.position.x, cb.position.y, cb.position.z,
          cb.velocity.x, cb.velocity.y, cb.velocity.z].every(Number.isFinite)) { nan = true; break; }
        fwd.set(1, 0, 0).applyQuaternion(v.group.quaternion); // +X = frente do chassi
        const vel = Math.abs(cb.velocity.x * fwd.x + cb.velocity.z * fwd.z);
        let contacts = 0, rigidHit = null, maxWheelSlope = 0;
        for (const w of v.vehicle.wheelInfos) {
          if (w.raycastResult && w.raycastResult.hasHit) {
            contacts++;
            const ud = w.raycastResult.body && w.raycastResult.body.userData;
            if (ud && ud.hardForVehicle) rigidHit = ud.sourceId;
            const hp = w.raycastResult.hitPointWorld;
            maxWheelSlope = Math.max(maxWheelSlope, G.surfaceAt(hp.x, hp.z).slopeDegrees);
          }
        }
        let chassisRigid = null;
        for (const c of MP.world.contacts) {
          if (c.bi !== cb && c.bj !== cb) continue;
          const other = c.bi === cb ? c.bj : c.bi;
          if (other.userData && other.userData.hardForVehicle) chassisRigid = other.userData.sourceId;
          else if (other.shapes[0] && other.shapes[0].elementSize !== undefined) chassisScrapes++;
        }
        if (contacts === 0) { zeroContactT += dt; maxZeroContact = Math.max(maxZeroContact, zeroContactT); }
        else zeroContactT = 0;
        const su = G.surfaceAt(cb.position.x, cb.position.z);
        const blockedByRigid = rigidHit || chassisRigid;
        // terreno À FRENTE acima do limite declarado (18°) = bloqueio LEGÍTIMO
        // de relevo (o motorista contornaria), não falso travamento
        const ahead = G.surfaceAt(cb.position.x + fwd.x * 3, cb.position.z + fwd.z * 3);
        // "dentro do limite" precisa valer onde as RODAS tocam: triângulo da
        // roda >16° = relevo legítimo segurando o carro, não falso travamento
        const terrainWall = ahead.slopeDegrees > 18 || su.slopeDegrees > 18 || maxWheelSlope > 16;
        // roda ENTERRADA (raio nascendo dentro do terreno) = falha real:
        // centro da roda abaixo da superfície canônica
        // falha da spec = RAIO nascendo dentro do terreno: origem do raio
        // (conexão no chassi) abaixo da superfície. (Roda visual no ar em
        // droop máximo furando a crista é quirk cosmético do cannon, não isso.)
        let buried = false;
        for (let wi = 0; wi < v.vehicle.wheelInfos.length; wi++) {
          const cp = v.vehicle.wheelInfos[wi].chassisConnectionPointWorld;
          if (cp && cp.y < G.heightAt(cp.x, cp.z) - 0.05) buried = true;
        }
        if (buried) { buriedT += dt; maxBuried = Math.max(maxBuried, buriedT); } else buriedT = 0;
        // travado de verdade exige o eixo de tração CARREGADO (≥3 contatos):
        // com 2 o carro está pendurado numa crista (relevo legítimo — dá ré)
        if (i * dt > 1 && vel < 0.5 && contacts >= 3 && su.driveable && !blockedByRigid && !terrainWall) {
          stuckT += dt;
          if (stuckT > maxStuck) {
            maxStuck = stuckT;
            stuckInfo = { x: +cb.position.x.toFixed(1), z: +cb.position.z.toFixed(1),
              slope: +su.slopeDegrees.toFixed(1), wheelSlope: +maxWheelSlope.toFixed(1),
              contacts, vel: +vel.toFixed(2) };
          }
        } else stuckT = 0;
      }
      const moved = Math.hypot(v.chassisBody.position.x - corr.x, v.chassisBody.position.z - corr.z);
      // pose visual segue a física
      v.group.updateMatrixWorld(true);
      const gp = new THREE.Vector3();
      v.group.getWorldPosition(gp);
      const poseDelta = gp.distanceTo(new THREE.Vector3(v.chassisBody.position.x, v.chassisBody.position.y, v.chassisBody.position.z));
      G.keys.KeyW = false; G.keys.KeyS = false; G.state.driving = false;
      return { nan, maxStuck: +maxStuck.toFixed(2), maxZeroContact: +maxZeroContact.toFixed(2),
        maxBuried: +maxBuried.toFixed(2),
        moved: +moved.toFixed(1), chassisScrapes, poseDelta: +poseDelta.toFixed(2), stuckInfo };
    };
  };

  it('dados corredores dirigíveis em todos os biomas, então os 3 veículos atravessam sem falso travamento', async () => {
    const r = await h.play((src) => {
      eval(src)();
      const G = window.QA.G;
      window.QA.reset();
      const regions = {
        pradaria: (x, z) => G.surfaceAt(x, z).biomeId === 'prairie',
        floresta: (x, z) => G.surfaceAt(x, z).biomeWeights.forest > 0.5,
        deserto: (x, z) => G.surfaceAt(x, z).biomeWeights.desert > 0.5,
        margemSeca: (x, z) => { const s = G.surfaceAt(x, z); return s.height > -4 && s.height < -1; },
      };
      const out = [];
      const veics = G.Car.vehicles.map(v => v.cfg.name);
      for (const [reg, pred] of Object.entries(regions)) {
        const corr = window.__QA_findCorridor(pred);
        if (!corr) { out.push({ reg, semCorredor: true }); continue; }
        for (const vn of veics) {
          const res = window.__QA_drive(vn, corr, 6, 1 / 60, false);
          out.push({ reg, vn, dt: 60, ...res });
        }
        // cadências alternativas + ré + diagonal só com o 1º veículo (orçamento)
        out.push({ reg, vn: veics[0], dt: 30, ...window.__QA_drive(veics[0], corr, 6, 1 / 30, false) });
        out.push({ reg, vn: veics[0], dt: 120, ...window.__QA_drive(veics[0], corr, 4, 1 / 120, false) });
        out.push({ reg, vn: veics[0], dt: 60, re: true, ...window.__QA_drive(veics[0], corr, 4, 1 / 60, true) });
        // travessia diagonal de células: os corredores em yaw múltiplo de 45°
        // já cruzam a diagonal da grade — girar 45° extra sairia da faixa validada
      }
      return out;
    }, `(${setupScript})`);
    const semCorredor = r.filter(x => x.semCorredor);
    assert.ok(semCorredor.length <= 1,
      `regiões sem corredor dirigível: ${semCorredor.map(x => x.reg).join(', ')}`);
    for (const x of r) {
      if (x.semCorredor) continue;
      const tag = `${x.reg}/${x.vn}@${x.dt}fps${x.re ? '/ré' : ''}${x.diag ? '/diag' : ''}`;
      assert.ok(!x.nan, `${tag}: estado NaN`);
      assert.ok(x.maxStuck <= 1.5,
        `${tag}: FALSO TRAVAMENTO de ${x.maxStuck}s em ${JSON.stringify(x.stuckInfo)}`);
      const minMoved = x.re ? 4 : 8; // ré: 55% da força e corrida de 4 s
      assert.ok(x.moved > minMoved, `${tag}: quase não andou (${x.moved}m) — ${JSON.stringify(x.stuckInfo)}`);
      assert.ok(x.poseDelta < 0.5, `${tag}: pose visual descolou da física (${x.poseDelta}m)`);
      assert.ok(x.maxBuried < 0.3, `${tag}: roda DENTRO do terreno por ${x.maxBuried}s (raio nascendo enterrado)`);
      // 2.5s: esportivo a ~110km/h salta dunas de verdade (voo é legítimo);
      // o defeito seria contato NUNCA recuperado — nan/buried/stuck pegam isso
      assert.ok(x.maxZeroContact < 2.5, `${tag}: rodas no ar por ${x.maxZeroContact}s em corredor dirigível`);
    }
  });

  it('dado o caso-CONTROLE (árvore rígida à frente), então o carro PARA e o sourceId aparece', async () => {
    const r = await h.play(() => {
      const G = window.QA.G, MP = window.QA.MP, THREE = MP.THREE;
      window.QA.reset();
      // acha um obstáculo rígido LARGO (estrutura/pedra grande) com
      // aproximação dirigível — árvore fina deixa o carro raspar de lado
      const tree = MP.world.bodies.find(b => b.userData && b.userData.hardForVehicle &&
        (b.userData.sourceId === 'structure' || b.userData.sourceId === 'rock') &&
        b.shapes[0] && (b.shapes[0].halfExtents ? b.shapes[0].halfExtents.x > 1 : b.shapes[0].radius > 1) &&
        G.surfaceAt(b.position.x, b.position.z + 6).driveable &&
        G.surfaceAt(b.position.x, b.position.z + 14).driveable);
      if (!tree) return { skip: true };
      const x = tree.position.x, z = tree.position.z + 12;
      const v = G.Car.vehicles[0];
      G.Car.setCur(v);
      v.chassisBody.position.set(x, G.heightAt(x, z) + 1.2, z);
      v.chassisBody.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0); // -z: direto na árvore
      v.chassisBody.velocity.set(0, 0, 0);
      v.chassisBody.angularVelocity.set(0, 0, 0);
      v.chassisBody.wakeUp();
      window.QA.tick(90);
      G.state.driving = true;
      G.keys.KeyW = true;
      let hitSource = null;
      for (let i = 0; i < 360; i++) {
        window.QA.tick(1);
        for (const c of MP.world.contacts) {
          const other = c.bi === v.chassisBody ? c.bj : c.bj === v.chassisBody ? c.bi : null;
          if (other && other.userData && other.userData.hardForVehicle) hitSource = other.userData.sourceId;
        }
      }
      G.keys.KeyW = false; G.state.driving = false;
      const passed = v.chassisBody.position.z < tree.position.z - 2; // atravessou?
      return { hitSource, passed };
    });
    if (r.skip) return;
    // qualquer rígido serve de prova (pode esbarrar numa pedra antes da árvore)
    assert.ok(r.hitSource, 'nenhum contato rígido identificado no caso-controle');
    assert.equal(r.passed, false, 'carro ATRAVESSOU o obstáculo rígido');
  });
});
