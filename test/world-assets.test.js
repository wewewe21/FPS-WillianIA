'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CHROME, bootGame } = require('./helpers/harness');

const MODELS = path.join(__dirname, '..', 'assets', 'models');
function glbJson(file) {
  const b = fs.readFileSync(file);
  assert.equal(b.readUInt32LE(0), 0x46546c67, `${file} não é GLB`);
  const jsonLen = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + jsonLen).toString('utf8'));
}

describe('Assets do mundo e da inserção', () => {
  it('mantém cidade otimizada, nave animada e soldado rigado dentro do orçamento', () => {
    const original = path.join(MODELS, 'Cenários', 'new_york_city.glb');
    const optimized = path.join(MODELS, 'Cenários', 'new_york_city.optimized.glb');
    assert.ok(fs.statSync(optimized).size < 26 * 1024 * 1024, 'cidade otimizada passou de 26 MiB');
    assert.ok(fs.statSync(optimized).size < fs.statSync(original).size * 0.45, 'otimização da cidade foi insuficiente');
    const city = glbJson(optimized);
    assert.ok((city.meshes || []).length > 10, 'cidade sem quarteirões reais');
    assert.ok(!(city.extensionsRequired || []).includes('EXT_meshopt_compression'),
      'cidade exigiria decoder Meshopt não configurado');

    const ship = glbJson(path.join(MODELS, 'Nave.glb'));
    assert.ok((ship.animations || []).some(a => /^FLY$/i.test(a.name)), 'Nave.glb sem animação FLY');
    const soldier = glbJson(path.join(MODELS, 'Personagens', 'ps1low_poly_night_vision_special_forces_soldier.glb'));
    assert.ok((soldier.skins || []).length > 0, 'soldado sem rig');
    assert.ok((soldier.animations || []).some(a => a.name === 'SMGwalk'), 'soldado sem SMGwalk');
  });
});

describe('Integração visual do mundo', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h;
  const port = 36000 + (process.pid % 20000);
  before(async () => { h = await bootGame({ port }); });
  after(async () => { if (h) await h.close(); });

  it('carrega cidade proporcional, nuvens baratas e operadores rigados', async () => {
    const r = await h.play(async () => {
      const G = window.QA.G;
      await Promise.all([G.CityModel.ready, G.Car.ready, G.Enemies.ready]);
      const cars = G.Car.vehicles.map(v => ({
        rawAspect: v.modelMetrics.rawAspect,
        finalAspect: v.modelMetrics.finalAspect,
        sizeX: v.modelMetrics.sizeX, sizeZ: v.modelMetrics.sizeZ,
        colliderX: v.cfg.half[0] * 2, colliderZ: v.cfg.half[2] * 2,
      }));
      const suits = G.Enemies.list.filter(e => e.suit);
      return {
        city: { status: G.CityModel.status, error: G.CityModel.error, metrics: G.CityModel.metrics,
          visible: G.CityModel.root.visible, imported: !!G.CityModel.modelRoot },
        clouds: { count: G.Clouds.count, instanced: G.Clouds.mesh.isInstancedMesh,
          castsShadow: G.Clouds.mesh.castShadow },
        districts: {
          spots: G.CityModel.districts,
          independent: G.CityModel.satelliteRoot.parent !== G.CityModel.root,
          visible: G.CityModel.satelliteRoot.visible,
          drawables: (() => { let n = 0; G.CityModel.satelliteRoot.traverse(o => { if (o.isMesh) n++; }); return n; })(),
          colliders: G.Structures.walls.filter(w => w.satellite).length,
        },
        suits: suits.map(e => ({ hasModel: e.hasModel, kind: e.modelKind, walk: !!e.actions?.Walk })),
        cars,
      };
    });
    assert.equal(r.city.status, 'ready', `cidade não carregou: ${r.city.error || 'sem detalhe'}`);
    assert.equal(r.city.visible, true);
    assert.equal(r.city.imported, true);
    assert.ok(Math.abs(Math.max(r.city.metrics.sizeX, r.city.metrics.sizeZ) - 176) < 0.2,
      `footprint urbano incorreto: ${JSON.stringify(r.city.metrics)}`);
    assert.equal(r.city.metrics.collision, 'structures-aabb');
    assert.ok(r.city.metrics.meshes <= 90, `cidade usa ${r.city.metrics.meshes} drawables`);
    assert.deepEqual(r.clouds, { count: 126, instanced: true, castsShadow: false });
    assert.equal(r.districts.spots.length, 2);
    assert.equal(r.districts.independent, true, 'distritos foram presos à cidade destrutível');
    assert.equal(r.districts.visible, true);
    assert.equal(r.districts.drawables, 3, 'distritos deveriam usar só três draw calls');
    assert.equal(r.districts.colliders, 12, 'colisão simplificada dos distritos incompleta');
    for (const spot of r.districts.spots)
      assert.ok(Math.hypot(spot.x - 320, spot.z + 350) > 205, 'distrito invadiu o Campo de Tiro');
    assert.ok(r.suits.length > 0 && r.suits.every(s => s.hasModel && s.kind === 'special-forces' && s.walk),
      `operadores incompletos: ${JSON.stringify(r.suits)}`);
    for (const car of r.cars) {
      assert.ok(Math.abs(car.rawAspect - car.finalAspect) < 1e-5, 'carro deformado');
      assert.ok(car.sizeX <= car.colliderX + 0.01 && car.sizeZ <= car.colliderZ + 0.01, 'carro fora do collider');
    }
    assert.deepEqual(h.pageErrors, [], `erros de página: ${h.pageErrors.join('\n')}`);
  });

  it('monta Nave.glb grande com FLY/propulsão e abre o paraquedas acima do jogador', async () => {
    const r = await h.play(async () => {
      const G = window.QA.G;
      const ship = G.DropShip.build();
      await ship.ready;
      ship.g.visible = true;
      ship.update(1 / 60, 1.25);
      const shipResult = {
        status: ship.status, error: ship.error, metrics: ship.metrics,
        plumes: ship.plumes.length,
        importedMeshes: (() => { let n = 0; ship.g.traverse(o => { if (o.userData.importedDropshipModel) n++; }); return n; })(),
      };
      ship.dispose();

      window.__BR_chuteOpen = true;
      window.QA.tick(90);
      G.Parachute.root.updateWorldMatrix(true, true);
      const THREE = await import('three');
      const canopyBox = new THREE.Box3().setFromObject(G.Parachute.canopy);
      const chuteResult = {
        visible: G.Parachute.root.visible,
        lineCount: G.Parachute.lineCount,
        openK: G.Parachute.openK,
        rimAbovePlayer: canopyBox.min.y - G.player.pos.y,
      };
      window.__BR_chuteOpen = false;
      window.QA.tick(60);
      return { ship: shipResult, chute: chuteResult };
    });
    assert.equal(r.ship.status, 'ready', `Nave.glb não carregou: ${r.ship.error || 'sem detalhe'}`);
    assert.ok(Math.abs(Math.max(r.ship.metrics.sizeX, r.ship.metrics.sizeZ) - 40) < 0.2,
      `escala da nave incorreta: ${JSON.stringify(r.ship.metrics)}`);
    assert.equal(r.ship.metrics.animation, 'FLY');
    assert.equal(r.ship.plumes, 3);
    assert.ok(r.ship.importedMeshes >= 10, 'malhas da Nave.glb ausentes');
    assert.equal(r.chute.visible, true);
    assert.equal(r.chute.lineCount, 8);
    assert.ok(r.chute.openK > 0.95, 'velame não inflou');
    assert.ok(r.chute.rimAbovePlayer > 4.4, 'paraquedas não ficou visível acima do jogador');
  });
});
