'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { CHROME, bootGame } = require('./helpers/harness');

describe('Castelo — Colosso solo', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h;
  const PORT = 3226;

  before(async () => {
    h = await bootGame({ port: PORT });
  });
  after(async () => {
    if (!h) return;
    try {
      assert.deepEqual(h.pageErrors, [], `page errors: ${h.pageErrors.join(' | ')}`);
      assert.deepEqual(h.consoleErrors, [], `console errors: ${h.consoleErrors.join(' | ')}`);
      assert.deepEqual(h.requestFailures, [],
        `request failures: ${h.requestFailures.join(' | ')}`);
    } finally {
      await h.close();
    }
  });

  it('nasce e permanece no piso do pátio, não enterrado no terreno', async () => {
    const state = await h.play(() => {
      const { G, MP } = window.QA;
      const castle = G.Structures.castle;
      if (!castle) return { missingCastle: true };
      window.__BR_active = false;
      const P = MP.player;
      P.dead = false;
      P.pos.set(castle.center.x + 100, MP.heightAt(castle.center.x + 100, castle.center.z), castle.center.z);
      const bossPos = G.Boss.pos();
      const initial = [bossPos.x, bossPos.y, bossPos.z];
      G.Boss.state.active = false;
      window.QA.tick(3);
      const settledY = bossPos.y;

      // Exercita o caminho real de respawn sem disparar drops/timers de morte.
      bossPos.set(castle.center.x + 20, castle.floorY + 10, castle.center.z + 20);
      G.Boss.state.alive = false;
      G.Boss.state.deadT = -1;
      G.Boss.state.respawnT = 0;
      window.QA.tick(1);
      const respawned = [bossPos.x, bossPos.y, bossPos.z];
      return {
        initial,
        settledY,
        respawned,
        center: [castle.center.x, castle.center.z],
        floorY: castle.floorY,
        terrainY: MP.heightAt(castle.center.x, castle.center.z),
        groundY: MP.groundAt(castle.center.x, castle.center.z, castle.floorY + 1),
      };
    });
    assert.equal(state.missingCastle, undefined, 'Structures.castle ausente');
    assert.ok(Math.hypot(state.initial[0] - state.center[0],
      state.initial[2] - state.center[1]) < 0.01,
    'spawn real não usa o centro do castelo');
    assert.ok(Math.hypot(state.initial[0] - state.respawned[0],
      state.initial[2] - state.respawned[2]) < 0.01,
    'spawn e respawn reais não usam a mesma origem do castelo');
    assert.ok(Math.abs(state.initial[1] - state.floorY) < 0.02,
      `spawn real ficou em y=${state.initial[1].toFixed(2)}, piso=${state.floorY.toFixed(2)}`);
    assert.ok(Math.abs(state.settledY - state.floorY) < 0.08,
      `Colosso ficou em y=${state.settledY.toFixed(2)}, piso=${state.floorY.toFixed(2)}`);
    assert.ok(Math.abs(state.respawned[1] - state.floorY) < 0.02,
      `respawn real ficou em y=${state.respawned[1].toFixed(2)}, piso=${state.floorY.toFixed(2)}`);
    assert.ok(state.floorY - state.terrainY > 0.5, 'seed não exercitou o piso elevado');
    assert.ok(Math.abs(state.groundY - state.floorY) < 0.02, 'groundAt não reconhece o pátio');
  });

  it('sai pelo portão/rampa e retorna sem atravessar a contenção', async () => {
    const state = await h.play(() => {
      const { G, MP } = window.QA;
      const castle = G.Structures.castle;
      if (!castle) return { missingCastle: true };
      window.__BR_active = false;
      const P = MP.player, boss = G.Boss;
      const b = boss.pos();
      P.dead = false;
      P.invulnUntil = Infinity;
      boss.state.active = true;
      boss.state.stompT = -1;
      boss.state.nextStomp = Infinity;
      boss.state.nextVolley = Infinity;
      b.set(castle.center.x, castle.floorY, castle.center.z + 8);
      P.pos.set(castle.center.x,
        MP.groundAt(castle.center.x, castle.center.z + 25, castle.floorY + 2),
        castle.center.z + 25);
      for (let i = 0; i < 540; i++) G.tick(1 / 60);
      const outside = {
        z: b.z - castle.center.z,
        yError: Math.abs(b.y - MP.groundAt(b.x, b.z, b.y + 1)),
        x: b.x - castle.center.x,
      };
      P.dead = true;
      b.z = castle.center.z + 71;
      b.y = MP.groundAt(b.x, b.z, 999);
      for (let i = 0; i < 1500; i++) G.tick(1 / 60);
      return {
        outside,
        allowedGateCenterX: castle.gate.halfWidth - 1.5,
        returnedDistance: Math.hypot(b.x - castle.center.x, b.z - castle.center.z),
        returnedYError: Math.abs(b.y - MP.groundAt(b.x, b.z, b.y + 1)),
      };
    });
    assert.equal(state.missingCastle, undefined, 'Structures.castle ausente');
    assert.ok(state.outside.z > 18.8, `Colosso ficou preso antes do gate (z local=${state.outside.z.toFixed(2)})`);
    assert.ok(Math.abs(state.outside.x) <= state.allowedGateCenterX + 0.05,
      `raio do Colosso raspou a muralha ao sair (x local=${state.outside.x.toFixed(2)}, ` +
      `limite=${state.allowedGateCenterX.toFixed(2)})`);
    assert.ok(state.outside.yError < 0.2, `Colosso flutuou/enterrou na rampa (${state.outside.yError.toFixed(2)}m)`);
    assert.ok(state.returnedDistance < 5, `Colosso não retornou ao castelo (${state.returnedDistance.toFixed(2)}m)`);
    assert.ok(state.returnedYError < 0.2, 'Colosso retornou fora da superfície jogável');
  });

  it('contorna a muralha e retorna pelo gate quando vem da lateral', async () => {
    const state = await h.play(() => {
      const { G, MP } = window.QA;
      const castle = G.Structures.castle;
      const boss = G.Boss, b = boss.pos(), P = MP.player;
      window.__BR_active = false;
      P.dead = true;
      boss.state.active = true;
      boss.state.stompT = -1;
      b.set(castle.center.x - 71,
        MP.groundAt(castle.center.x - 71, castle.center.z, 999),
        castle.center.z);

      const collide = G.Structures.collide;
      const collisionTrace = {
        maxCorrection: 0,
        minWallClearance: Infinity,
        worstCorrection: null,
        worstClearance: null,
      };
      G.Structures.collide = function tracedBossCollision(pos, radius, height) {
        const tracked = pos === b && radius === 1.5 && height === 5;
        const beforeX = pos.x, beforeZ = pos.z;
        const result = collide.call(this, pos, radius, height);
        if (!tracked) return result;

        const correction = Math.hypot(pos.x - beforeX, pos.z - beforeZ);
        if (correction > collisionTrace.maxCorrection) {
          collisionTrace.maxCorrection = correction;
          collisionTrace.worstCorrection = {
            stage: boss.state.returnStage,
            x: pos.x - castle.center.x,
            z: pos.z - castle.center.z,
          };
        }
        for (const wall of castle.walls) {
          if (wall.noCollide ||
              pos.y + height < wall.y0 ||
              pos.y >= wall.y1 - 0.12) continue;
          const cx = (wall.x0 + wall.x1) / 2;
          const cz = (wall.z0 + wall.z1) / 2;
          const qx = Math.abs(pos.x - cx) - (wall.x1 - wall.x0) / 2;
          const qz = Math.abs(pos.z - cz) - (wall.z1 - wall.z0) / 2;
          const clearance = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) +
            Math.min(Math.max(qx, qz), 0) - radius;
          if (clearance < collisionTrace.minWallClearance) {
            collisionTrace.minWallClearance = clearance;
            collisionTrace.worstClearance = {
              part: wall.part,
              stage: boss.state.returnStage,
              x: pos.x - castle.center.x,
              z: pos.z - castle.center.z,
            };
          }
        }
        return result;
      };

      let ingress = null;
      let previousStage = null;
      const transitions = [];
      try {
        for (let i = 0; i < 3000; i++) {
          G.tick(1 / 60);
          const lx = b.x - castle.center.x, lz = b.z - castle.center.z;
          const stage = boss.state.returnStage;
          if (previousStage && stage !== previousStage) {
            transitions.push({
              from: previousStage,
              to: stage,
              radius: Math.hypot(lx, lz),
            });
          }
          previousStage = stage;
          if (!ingress && Math.abs(lx) < 16.55 && Math.abs(lz) < 16.55)
            ingress = { x: lx, z: lz };
        }
      } finally {
        G.Structures.collide = collide;
      }
      return {
        ingress,
        transitions,
        collisionTrace,
        guardRadius: castle.guardRadius,
        allowedGateCenterX: castle.gate.halfWidth - 1.5,
        returnedDistance: Math.hypot(b.x - castle.center.x, b.z - castle.center.z),
        yError: Math.abs(b.y - MP.groundAt(b.x, b.z, b.y + 1)),
        final: {
          x: b.x - castle.center.x,
          z: b.z - castle.center.z,
          stage: boss.state.returnStage,
        },
      };
    });

    assert.ok(state.ingress,
      `Colosso ficou pinado do lado de fora da muralha: ${JSON.stringify(state.final)}`);
    assert.ok(Math.abs(state.ingress.x) <= state.allowedGateCenterX + 0.05 &&
      state.ingress.z > 15.5,
      `Colosso entrou fora do gate: ${JSON.stringify(state.ingress)}`);
    assert.ok(state.returnedDistance < 5,
      `Colosso não retornou da lateral (${state.returnedDistance.toFixed(2)}m)`);
    assert.ok(state.yError < 0.2, `Colosso retornou fora do piso (${state.yError.toFixed(2)}m)`);
    for (const transition of state.transitions.filter(item =>
      !['gate', 'home'].includes(item.from))) {
      assert.ok(transition.radius <= state.guardRadius + 0.001,
        `waypoint '${transition.from}' saiu da área protegida: ` +
        `${transition.radius.toFixed(2)}m`);
    }
    assert.ok(state.collisionTrace.minWallClearance >= -0.001,
      `Colosso terminou dentro da muralha: ${JSON.stringify(state.collisionTrace.worstClearance)}`);
    assert.ok(state.collisionTrace.maxCorrection <= 0.005,
      `rota tentou atravessar a muralha e dependeu do solver: ` +
      `${state.collisionTrace.maxCorrection.toFixed(3)}m ` +
      `${JSON.stringify(state.collisionTrace.worstCorrection)}`);
  });

  it('contorna a muralha traseira antes de retornar pelo gate', async () => {
    const state = await h.play(() => {
      const { G, MP } = window.QA;
      const castle = G.Structures.castle;
      const boss = G.Boss, b = boss.pos(), P = MP.player;
      window.__BR_active = false;
      P.dead = true;
      boss.state.active = true;
      boss.state.stompT = -1;
      boss.state.returnStage = null;
      b.set(
        castle.center.x,
        MP.groundAt(castle.center.x, castle.center.z - 71, 999),
        castle.center.z - 71,
      );

      const stages = new Set();
      let ingress = null;
      for (let i = 0; i < 4200; i++) {
        G.tick(1 / 60);
        if (boss.state.returnStage) stages.add(boss.state.returnStage);
        const lx = b.x - castle.center.x, lz = b.z - castle.center.z;
        if (!ingress && Math.abs(lx) < 16.55 && Math.abs(lz) < 16.55)
          ingress = { x: lx, z: lz };
      }
      return {
        stages: [...stages],
        ingress,
        allowedGateCenterX: castle.gate.halfWidth - 1.5,
        returnedDistance: Math.hypot(b.x - castle.center.x, b.z - castle.center.z),
        yError: Math.abs(b.y - MP.groundAt(b.x, b.z, b.y + 1)),
      };
    });

    for (const stage of ['rear-side', 'side-front', 'gate-side', 'gate', 'home'])
      assert.ok(state.stages.includes(stage),
        `retorno traseiro pulou '${stage}': ${state.stages.join(' → ')}`);
    assert.ok(state.ingress &&
      Math.abs(state.ingress.x) <= state.allowedGateCenterX + 0.05 &&
      state.ingress.z > 15.5,
    `Colosso entrou fora do gate: ${JSON.stringify(state.ingress)}`);
    assert.ok(state.returnedDistance < 5,
      `Colosso não retornou de trás (${state.returnedDistance.toFixed(2)}m)`);
    assert.ok(state.yError < 0.2, `Colosso retornou fora do piso (${state.yError.toFixed(2)}m)`);
  });

  it('afunda a partir do piso do castelo após morrer e reaparece no mesmo apoio', async () => {
    const state = await h.play(() => {
      const { G } = window.QA;
      const castle = G.Structures.castle;
      const boss = G.Boss;
      const b = boss.pos();
      b.set(castle.center.x, castle.floorY, castle.center.z);
      boss.state.alive = false;
      boss.state.active = false;
      boss.state.deadT = 1.2;
      boss.state.respawnT = 120;
      boss.update(0.5, 100);
      const sunkY = b.y;
      const expectedSunkY = castle.floorY - 0.5 * 1.1;

      boss.state.deadT = -1;
      boss.state.respawnT = 0;
      boss.update(0, 101);
      return {
        sunkY,
        expectedSunkY,
        respawnY: b.y,
        floorY: castle.floorY,
        alive: boss.alive,
      };
    });

    assert.ok(Math.abs(state.sunkY - state.expectedSunkY) < 0.03,
      `morte afundou desde y=${state.sunkY}, esperado=${state.expectedSunkY}`);
    assert.equal(state.alive, true, 'Colosso não reapareceu após o ciclo testado');
    assert.ok(Math.abs(state.respawnY - state.floorY) < 0.02,
      `respawn pós-morte ignorou o piso (${state.respawnY} vs ${state.floorY})`);
  });

  it('orbe real atravessa o portão e respeita a altura da soleira/rampa', async () => {
    const state = await h.play(() => {
      const { G, MP } = window.QA;
      const castle = G.Structures.castle;
      const boss = G.Boss;
      const B = boss.state;
      const P = MP.player;
      const orbMeshes = MP.scene.children.filter(obj =>
        obj.isMesh &&
        obj.geometry && obj.geometry.type === 'SphereGeometry' &&
        Math.abs((obj.geometry.parameters && obj.geometry.parameters.radius) - 0.32) < 1e-6 &&
        obj.material && obj.material.emissive &&
        obj.material.emissive.getHex() === 0xff7a22);
      const hiddenBefore = orbMeshes.filter(mesh => !mesh.visible).length;

      window.__BR_active = false;
      // Dispara de dentro do pátio, já próximo ao gate. Do centro, a
      // trajetória balística baixa deve tocar o próprio piso antes da saída;
      // aqui exercitamos especificamente a passagem e o apoio da rampa.
      boss.pos().set(castle.center.x, castle.floorY, castle.center.z + 12);
      B.alive = true;
      B.active = true;
      B.deadT = -1;
      B.stompT = -1;
      B.nextStomp = Infinity;
      B.nextVolley = Infinity;
      B.volleyLeft = 1;
      B.nextOrb = 0;
      B.returnStage = null;
      B.yaw = 0;
      P.dead = true;
      P.invulnUntil = Infinity;
      const targetZ = (castle.ramp.z0 + castle.ramp.z1) / 2;
      P.pos.set(
        castle.center.x,
        castle.groundAt(castle.center.x, targetZ, 999),
        targetZ,
      );
      P.vel.set(0, 0, 0);

      boss.update(1 / 60, 200);
      const fired = orbMeshes.find(mesh => mesh.visible);
      const launchTarget = P.pos.toArray();
      // O orbe já capturou a direção. Tirar o jogador do caminho garante que
      // o término abaixo venha do apoio da rampa, não do raio de proximidade.
      P.pos.set(
        castle.center.x + 100,
        MP.heightAt(castle.center.x + 100, castle.center.z),
        castle.center.z,
      );
      let maxLocalZ = -Infinity;
      let minSupportClearance = Infinity;
      let liveSamples = 0;
      let previousVisible = null;
      let lastVisible = null;
      for (let i = 0; i < 180 && fired && fired.visible; i++) {
        boss.update(1 / 60, 200 + (i + 1) / 60);
        if (!fired.visible) break;
        liveSamples++;
        previousVisible = lastVisible;
        lastVisible = fired.position.clone();
        maxLocalZ = Math.max(maxLocalZ, fired.position.z - castle.center.z);
        minSupportClearance = Math.min(
          minSupportClearance,
          fired.position.y - castle.groundAt(
            fired.position.x,
            fired.position.z,
            fired.position.y + 0.5,
          ),
        );
      }
      let predictedBlockers = [];
      let predicted = null;
      if (previousVisible && lastVisible) {
        predicted = lastVisible.clone().add(lastVisible.clone().sub(previousVisible));
        const intersects = w => {
          const d = predicted.clone().sub(lastVisible);
          let t0 = 0, t1 = 1;
          for (const axis of ['x', 'y', 'z']) {
            const lo = w[`${axis}0`], hi = w[`${axis}1`];
            if (Math.abs(d[axis]) < 1e-8) {
              if (lastVisible[axis] < lo || lastVisible[axis] > hi) return false;
            } else {
              let a = (lo - lastVisible[axis]) / d[axis];
              let b = (hi - lastVisible[axis]) / d[axis];
              if (a > b) [a, b] = [b, a];
              t0 = Math.max(t0, a);
              t1 = Math.min(t1, b);
              if (t0 > t1) return false;
            }
          }
          return t0 > 0 && t0 < 1;
        };
        predictedBlockers = G.Structures.walls.filter(intersects).map(w => w.part || 'other');
      }
      const endedHidden = !!fired && !fired.visible;
      const predictedSupportClearance = predicted
        ? predicted.y - castle.groundAt(
          predicted.x,
          predicted.z,
          predicted.y + 0.5,
        )
        : null;
      const predictedLocalZ = predicted ? predicted.z - castle.center.z : null;
      B.volleyLeft = 0;
      B.active = false;
      P.dead = false;
      P.invulnUntil = 0;
      return {
        orbCount: orbMeshes.length,
        hiddenBefore,
        fired: !!fired,
        liveSamples,
        maxLocalZ,
        gateInnerLocalZ: castle.gate.innerZ - castle.center.z,
        minSupportClearance,
        endedHidden,
        lastVisible: lastVisible && lastVisible.toArray(),
        predicted: predicted && predicted.toArray(),
        predictedBlockers,
        predictedSupportClearance,
        predictedLocalZ,
        rampLocalZ: [
          castle.ramp.z0 - castle.center.z,
          castle.ramp.z1 - castle.center.z,
        ],
        target: launchTarget,
      };
    });

    assert.equal(state.orbCount, 8, 'pool real de orbes mudou ou não foi encontrado');
    assert.equal(state.hiddenBefore, state.orbCount, 'pré-condição falhou: havia orbe legado vivo');
    assert.equal(state.fired, true, 'rajada real não publicou um orbe visível');
    assert.ok(state.liveSamples > 5, `orbe teve só ${state.liveSamples} amostras`);
    assert.ok(state.maxLocalZ > state.gateInnerLocalZ,
      `orbe bateu antes de cruzar o portão: ${JSON.stringify(state)}`);
    assert.ok(state.minSupportClearance >= 0.28,
      `orbe atravessou o apoio do gate/rampa (${state.minSupportClearance}m)`);
    assert.equal(state.endedHidden, true, 'orbe não encerrou por impacto/tempo de vida');
    assert.deepEqual(state.predictedBlockers, [],
      `orbe terminou contra parede, não contra a rampa: ${state.predictedBlockers.join(', ')}`);
    assert.ok(state.predictedLocalZ >= state.rampLocalZ[1] &&
      state.predictedLocalZ <= state.rampLocalZ[1] + 3,
    `orbe não cruzou a rampa antes de tocar o terreno: ${JSON.stringify(state)}`);
    assert.ok(state.predictedSupportClearance <= 0.32,
      `orbe sumiu antes de alcançar o apoio (${state.predictedSupportClearance}m)`);
  });
});
