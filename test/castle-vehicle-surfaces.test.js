'use strict';
const assert = require('node:assert/strict');
const { after, before, describe, it } = require('node:test');
const { CHROME, bootGame } = require('./helpers/harness');

const PORT = 3252;

describe('Castelo — apoio físico dos veículos', {
  skip: !CHROME && 'Chrome não encontrado',
}, () => {
  let h;

  before(async () => {
    h = await bootGame({ port: PORT, worldSeed: '424242' });
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

  it('publica no CANNON o piso do pátio e a rampa com a mesma altura caminhável', async () => {
    const r = await h.play(() => {
      const { G, MP } = window.QA;
      const castle = G.Structures.castle;
      const bodies = MP.world.bodies.filter(body =>
        body.userData && body.userData.sourceId === 'castle-surface');

      function highestStaticHit(x, z, topY) {
        const from = new MP.world.gravity.constructor(x, topY + 10, z);
        const to = new MP.world.gravity.constructor(x, topY - 20, z);
        let best = null;
        MP.world.raycastAll(from, to, {}, hit => {
          if (hit.body.mass !== 0) return;
          if (!best || hit.hitPointWorld.y > best.y) {
            best = {
              y: hit.hitPointWorld.y,
              sourceId: hit.body.userData && hit.body.userData.sourceId,
              castlePart: hit.body.userData && hit.body.userData.castlePart,
            };
          }
        });
        return best;
      }

      const samples = [];
      for (const surface of castle.vehicleSurfaces) {
        const zs = surface.kind === 'ramp'
          ? [
            surface.z0 + 0.05,
            ...surface.segments.map(segment => (segment.z0 + segment.z1) / 2),
            surface.z1 - 0.05,
          ]
          : [(surface.z0 + surface.z1) / 2];
        for (const z of zs) {
          const x = (surface.x0 + surface.x1) / 2;
          const expected = surface.kind === 'ramp'
            ? surface.heightAt(z)
            : surface.topY;
          samples.push({
            part: surface.castlePart,
            expected,
            hit: highestStaticHit(x, z, expected),
          });
        }
      }

      return {
        descriptorCount: castle.vehicleSurfaces.length,
        bodyCount: bodies.length,
        bodyParts: bodies.map(body => body.userData.castlePart).sort(),
        bodyShapeCounts: Object.fromEntries(bodies.map(body =>
          [body.userData.castlePart, body.shapes.length])),
        bodyShapeTypes: Object.fromEntries(bodies.map(body =>
          [body.userData.castlePart, body.shapes.map(shape => shape.constructor.name)])),
        rampProfileSegments: castle.vehicleSurfaces.find(
          surface => surface.kind === 'ramp').segments.length,
        metadataValid: bodies.every(body =>
          body.userData.category === 'structural' &&
          body.userData.hardForVehicle === false),
        samples,
      };
    });

    assert.equal(r.descriptorCount, 3, 'contrato deve expor pátio, soleira e rampa');
    assert.equal(r.bodyCount, r.descriptorCount,
      'cada superfície veicular precisa de um corpo CANNON');
    assert.deepEqual(r.bodyParts, ['courtyard', 'gate-ramp', 'gate-threshold']);
    assert.ok(r.rampProfileSegments >= 8,
      `rampa lógica sem transição suave (${r.rampProfileSegments} segmentos)`);
    assert.equal(r.bodyShapeCounts['gate-ramp'], 1,
      'rampa física deve ser uma superfície contínua, sem faces internas');
    assert.deepEqual(r.bodyShapeTypes['gate-ramp'], ['Trimesh']);
    assert.ok(r.metadataValid, 'superfícies veiculares têm taxonomia rígida incorreta');
    for (const sample of r.samples) {
      assert.ok(sample.hit, `raycast físico não encontrou ${sample.part}`);
      assert.equal(sample.hit.sourceId, 'castle-surface',
        `o terreno ficou acima da superfície física de ${sample.part}`);
      assert.equal(sample.hit.castlePart, sample.part);
      assert.ok(Math.abs(sample.hit.y - sample.expected) <= 0.035,
        `${sample.part}: CANNON=${sample.hit.y}, layout=${sample.expected}`);
    }
  });

  it('permite que o carro atravesse a rampa e entre no pátio sem perder contato', async () => {
    const r = await h.play(() => {
      const { G, MP } = window.QA;
      const castle = G.Structures.castle;
      const ramp = castle.vehicleSurfaces.find(surface => surface.kind === 'ramp');
      const vehicle = G.Car.vehicles[0];
      const x = castle.center.x;
      const z = ramp.z1 - 0.35;
      const support = castle.groundAt(x, z, 999);

      G.Car.setCur(vehicle);
      vehicle.chassisBody.position.set(x, support + 1.25, z);
      vehicle.chassisBody.quaternion.setFromAxisAngle(
        new MP.world.gravity.constructor(0, 1, 0),
        Math.PI / 2,
      );
      vehicle.chassisBody.velocity.set(0, 0, 0);
      vehicle.chassisBody.angularVelocity.set(0, 0, 0);
      vehicle.chassisBody.wakeUp();
      window.QA.tick(90);

      G.state.driving = true;
      G.keys.KeyW = true;
      // 22° no seed de controle: os veículos precisam de embalo acima dos
      // 12° cobertos por hill-start no contrato de travessia do terreno.
      vehicle.chassisBody.velocity.set(0, 0, -8);
      vehicle.chassisBody.wakeUp();
      let castleContacts = 0;
      let noContactFrames = 0;
      let maxNoContactFrames = 0;
      let firstCastleContactFrame = -1;
      const contactParts = new Set();
      let finite = true;
      for (let i = 0; i < 360; i++) {
        window.QA.tick(1);
        const body = vehicle.chassisBody;
        finite &&= [body.position.x, body.position.y, body.position.z,
          body.velocity.x, body.velocity.y, body.velocity.z].every(Number.isFinite);
        let onCastle = false;
        for (const wheel of vehicle.vehicle.wheelInfos) {
          const data = wheel.raycastResult && wheel.raycastResult.body &&
            wheel.raycastResult.body.userData;
          if (!data || data.sourceId !== 'castle-surface') continue;
          onCastle = true;
          contactParts.add(data.castlePart);
        }
        if (onCastle) {
          if (firstCastleContactFrame < 0) firstCastleContactFrame = i;
          castleContacts++;
          noContactFrames = 0;
        } else if (castleContacts > 0) {
          noContactFrames++;
          maxNoContactFrames = Math.max(maxNoContactFrames, noContactFrames);
        }
      }
      G.keys.KeyW = false;
      G.state.driving = false;

      return {
        finite,
        castleContacts,
        firstCastleContactFrame,
        contactParts: [...contactParts],
        maxNoContactSeconds: maxNoContactFrames / 60,
        startZ: z,
        final: [
          vehicle.chassisBody.position.x,
          vehicle.chassisBody.position.y,
          vehicle.chassisBody.position.z,
        ],
        gateInnerZ: ramp.z0,
        floorY: castle.floorY,
      };
    });

    assert.ok(r.finite, 'a física do veículo produziu NaN na rampa');
    assert.ok(r.castleContacts >= 30,
      `rodas quase não tocaram a superfície do castelo (${r.castleContacts} frames)`);
    assert.ok(r.firstCastleContactFrame <= 2,
      `carro começou sem apoio da rampa (${r.firstCastleContactFrame} frames)`);
    // O entre-eixos pode fazer a ponte sobre a soleira curta enquanto rodas
    // traseiras ainda estão na rampa e dianteiras já estão no pátio. A prova
    // física da soleira é o raycast denso do teste anterior.
    for (const part of ['gate-ramp', 'courtyard'])
      assert.ok(r.contactParts.includes(part), `rodas não tocaram ${part}`);
    assert.ok(r.contactParts.indexOf('gate-ramp') < r.contactParts.indexOf('courtyard'),
      `sequência de apoio inválida: ${r.contactParts.join(' → ')}`);
    assert.ok(r.final[2] < r.gateInnerZ - 1,
      `carro não entrou no pátio: z ${r.startZ.toFixed(2)} → ${r.final[2].toFixed(2)}`);
    assert.ok(r.final[1] >= r.floorY - 0.5,
      `carro afundou abaixo do piso do pátio (${r.final[1]} < ${r.floorY})`);
    assert.ok(r.maxNoContactSeconds < 1,
      `carro perdeu o apoio por ${r.maxNoContactSeconds.toFixed(2)}s`);
  });
});
