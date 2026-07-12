/* Integração dos modelos GLB dos veículos: carregamento, normalização e orçamento. */
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { CHROME, bootGame } = require('./helpers/harness');

describe('Modelos 3D dos veículos', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h;
  before(async () => { h = await bootGame({ port: 3195 }); });
  after(async () => { if (h) await h.close(); });

  it('carrega os três GLBs normalizados com geometria compartilhada e custo limitado', async () => {
    const report = await h.play(async () => {
      const Car = window.QA.G.Car;
      if (!Car.ready) return { hasReady: false };
      await Car.ready;

      const geometries = new Set();
      let uniqueVertices = 0;
      const vehicles = Car.vehicles.map(v => {
        let importedMeshes = 0;
        let mappedMaterials = 0;
        let standardMaterials = 0;
        const floorNodes = [];
        v.group.traverse(obj => {
          if (/^floor$/i.test(obj.name)) floorNodes.push(obj.name);
          if (!obj.isMesh || !obj.userData.importedCarModel) return;
          importedMeshes++;
          const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
          mappedMaterials += materials.filter(m => m && m.map).length;
          standardMaterials += materials.filter(m => m && m.isMeshStandardMaterial).length;
          if (!geometries.has(obj.geometry)) {
            geometries.add(obj.geometry);
            uniqueVertices += obj.geometry.attributes.position.count;
          }
        });
        return {
          status: v.modelStatus,
          error: v.modelError,
          url: v.modelUrl,
          importedMeshes,
          mappedMaterials,
          standardMaterials,
          floorNodes,
          metrics: v.modelMetrics,
          collider: { x: v.cfg.half[0] * 2, z: v.cfg.half[2] * 2 },
          modelYaw: v.cfg.modelYaw,
          groundOffset: -(v.cfg.wheelR + v.cfg.half[1] + 0.32),
        };
      });
      return {
        hasReady: true, vehicles, uniqueVertices, uniqueGeometries: geometries.size,
        hooks: {
          render: typeof window.render_game_to_text === 'function',
          advance: typeof window.advanceTime === 'function',
        },
      };
    });

    assert.equal(report.hasReady, true, 'Car.ready não foi exposto');
    assert.ok(report.vehicles.length >= 3, 'frota incompleta');
    assert.deepEqual([...new Set(report.vehicles.map(v => v.url))].sort(), [
      '/assets/models/gumball-car.optimized.glb',
      '/assets/models/mazda-rx7.optimized.glb',
      '/assets/models/truck-drifter.optimized.glb',
    ]);
    for (const v of report.vehicles) {
      assert.equal(v.status, 'ready', `modelo não carregou: ${v.url} (${v.error || 'sem detalhe'})`);
      assert.ok(v.importedMeshes > 0 && v.importedMeshes <= 12,
        `${v.url} usa ${v.importedMeshes} malhas importadas`);
      assert.deepEqual(v.floorNodes, [], `${v.url} manteve piso auxiliar`);
      assert.ok(Math.abs(v.metrics.sizeX - v.collider.x * 0.98) < 0.06,
        `${v.url} não acompanha o comprimento do collider`);
      assert.ok(Math.abs(v.metrics.sizeZ - v.collider.z * 0.98) < 0.06,
        `${v.url} não acompanha a largura do collider`);
      assert.ok(Math.abs(v.metrics.minY - v.groundOffset) < 0.04,
        `${v.url} não foi apoiado no chão`);
      if (v.url.endsWith('/mazda-rx7.optimized.glb')) {
        assert.ok(Math.abs(v.modelYaw - Math.PI) < 1e-6, 'RX-7 está com a traseira apontada para +X');
        assert.equal(v.mappedMaterials, 0, 'RX-7 preto manteve a paleta sem contraste');
        assert.equal(v.standardMaterials, v.importedMeshes,
          'RX-7 não recebeu material iluminado por variante');
      }
    }
    assert.ok(report.uniqueVertices <= 55000,
      `geometria única acima do orçamento: ${report.uniqueVertices} vértices`);
    assert.deepEqual(report.hooks, { render: true, advance: true },
      'hooks determinísticos do playtest não foram expostos');
    assert.deepEqual(h.pageErrors, [], `erros de página: ${h.pageErrors.join('\n')}`);
  });
});
