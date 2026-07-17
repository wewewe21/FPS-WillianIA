/* Animação de rodas de carros REMOTOS no BR: dica visual derivada da pose
   validada (nunca autoridade), e lixo de rede não corrompe nada. */
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { CHROME, bootGame, startBRMatch } = require('./helpers/harness');

describe('Rodas de carros remotos (BR)', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h, bot;
  before(async () => {
    h = await bootGame({ port: 3190 });
    bot = await startBRMatch(h, { serverPort: 3190 });
    await h.play(async () => { await window.QA.G.Car.ready; window.QA.tick(120); });
  });
  after(async () => {
    if (bot) bot.close();
    if (h) await h.close();
  });

  /* bot emite 'state' dirigindo o carro `car` e a página processa em tempo
     real (tick + espera do socket) */
  async function botDrives(frames, makeState) {
    for (let f = 0; f < frames; f++) {
      bot.emit('state', makeState(f));
      await h.play(() => new Promise(res => setTimeout(() => { window.QA.tick(4, 1 / 60); res(); }, 34)));
    }
  }

  it('dado um remoto dirigindo em linha reta, então as rodas do carro giram', async () => {
    const before = await h.play(() => {
      const v = window.QA.G.Car.vehicles[1];
      return { rot: v.vehicle.wheelInfos.map(w => w.rotation), pos: [v.chassisBody.position.x, v.chassisBody.position.z] };
    });
    const p0 = await h.play(() => {
      const v = window.QA.G.Car.vehicles[1];
      return [v.chassisBody.position.x, v.chassisBody.position.z];
    });
    // 12 m/s pra frente (+x, yaw 0), ~2 s
    await botDrives(15, f => ({
      pos: [p0[0] + 3 + f * 12 * 0.166, 4.4, p0[1]], rotY: 0, car: 1, heldWeapon: 'PISTOLA',
    }));
    const after = await h.play(() => {
      const v = window.QA.G.Car.vehicles[1];
      return {
        rot: v.vehicle.wheelInfos.map(w => w.rotation),
        hint: v.remoteHint && { speed: +v.remoteHint.speed.toFixed(1), steer: +v.remoteHint.steer.toFixed(3) },
        pos: [v.chassisBody.position.x, v.chassisBody.position.z],
        finito: v.vehicle.wheelInfos.every(w => Number.isFinite(w.rotation)),
      };
    });
    assert.ok(Math.abs(after.pos[0] - before.pos[0]) > 5, 'carro remoto nem se moveu — teste vazio');
    assert.ok(after.hint, 'dica visual não foi criada');
    assert.ok(after.hint.speed > 4, `velocidade estimada baixa (${after.hint.speed} m/s)`);
    for (let i = 0; i < 4; i++) {
      const d = after.rot[i] - before.rot[i];
      // convenção do cannon (indexUpAxis 1): frente = rotation NEGATIVA — o
      // mesmo sentido do carro dirigido localmente
      assert.ok(d < -1, `roda ${i} do carro remoto não girou pra frente (Δ=${d.toFixed(2)})`);
    }
    assert.ok(after.finito, 'rotação não finita');
  });

  it('dado lixo de rede (NaN, índice fora da frota, teleporte), então nada corrompe', async () => {
    const before = await h.play(() => {
      const G = window.QA.G;
      return G.Car.vehicles.map(v => ({
        pos: [v.chassisBody.position.x, v.chassisBody.position.y, v.chassisBody.position.z],
        rot: v.vehicle.wheelInfos.map(w => w.rotation),
      }));
    });
    // NaN na pose (servidor deve derrubar), índice gigante, índice negativo,
    // float como índice e teleporte impossível no mesmo carro
    bot.emit('state', { pos: [NaN, 4, 10], rotY: 0, car: 1 });
    bot.emit('state', { pos: [10, 4, 10], rotY: 0, car: 9999 });
    bot.emit('state', { pos: [10, 4, 10], rotY: 0, car: -7 });
    bot.emit('state', { pos: [10, 4, 10], rotY: 0, car: 1.7 });
    bot.emit('state', { pos: [10, 4, 10], rotY: Infinity, car: 2 });
    await h.play(() => new Promise(res => setTimeout(() => { window.QA.tick(20, 1 / 60); res(); }, 120)));
    // teleporte gigante dentro do mesmo carro: reseta a dica em vez de girar
    bot.emit('state', { pos: [400, 4, 400], rotY: 0, car: 1 });
    await h.play(() => new Promise(res => setTimeout(() => { window.QA.tick(20, 1 / 60); res(); }, 120)));
    const after = await h.play(() => {
      const G = window.QA.G;
      return {
        estados: G.Car.vehicles.map(v => ({
          finito: [v.chassisBody.position.x, v.chassisBody.position.y, v.chassisBody.position.z,
            ...v.vehicle.wheelInfos.map(w => w.rotation)].every(Number.isFinite),
          hintOk: !v.remoteHint || (Number.isFinite(v.remoteHint.speed) && Number.isFinite(v.remoteHint.steer)),
        })),
        erros: [],
      };
    });
    for (const [i, v] of after.estados.entries()) {
      assert.ok(v.finito, `veículo ${i} corrompido por pacote inválido`);
      assert.ok(v.hintOk, `veículo ${i} com dica não finita`);
    }
    assert.deepEqual(h.pageErrors, [], `erros de página: ${h.pageErrors.join('\n')}`);
    void before;
  });

  it('dado o remoto saindo do carro, então a dica visual morre e as rodas param', async () => {
    bot.emit('state', { pos: [30, 4, 30], rotY: 0, car: -1 });
    await h.play(() => new Promise(res => setTimeout(() => { window.QA.tick(30, 1 / 60); res(); }, 120)));
    const r = await h.play(() => {
      const v = window.QA.G.Car.vehicles[1];
      window.QA.tick(300); // o carro largado assenta de vez (o teste anterior o teleportou)
      const rot0 = v.vehicle.wheelInfos.map(w => w.rotation);
      window.QA.tick(60);
      return {
        ttl: v.remoteHint ? v.remoteHint.ttl : 0,
        dRot: v.vehicle.wheelInfos.map((w, i) => Math.abs(w.rotation - rot0[i])),
      };
    });
    assert.ok(r.ttl <= 0, `dica visual continuou viva (ttl=${r.ttl})`);
    for (const d of r.dRot) assert.ok(d < 0.05, `roda continuou girando após sair do carro (Δ=${d})`);
  });
});
