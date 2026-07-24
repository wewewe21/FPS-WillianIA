'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { CHROME, bootGame } = require('./helpers/harness');

describe('Castelo — validação semântica e ciclo de vida', {
  skip: !CHROME && 'Chrome não encontrado',
}, () => {
  let h;

  before(async () => { h = await bootGame({ port: 3299 }); });
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

  it('rejeita materiais e extensões fora do contrato antes do swap', async () => {
    const result = await h.play(async () => {
      const castle = window.QA.G.Structures.castle;
      await castle.ready;
      const module = await import('/js/castle.js');
      if (typeof module.validateCastleModel !== 'function')
        return { exported: false };

      const cloneRoot = () => {
        const clone = castle.modelRoot.clone(true);
        clone.position.set(0, 0, 0);
        clone.traverse(obj => {
          if (!obj.isMesh) return;
          obj.material = Array.isArray(obj.material)
            ? obj.material.map(material => material.clone())
            : obj.material.clone();
        });
        return clone;
      };
      const metadata = {
        extensionsUsed: ['KHR_mesh_quantization'],
        extensionsRequired: ['KHR_mesh_quantization'],
      };
      const capture = fn => {
        try { fn(); return null; } catch (error) { return String(error && error.message || error); }
      };

      const valid = module.validateCastleModel(cloneRoot(), metadata);
      const badName = cloneRoot();
      let renamed = false;
      badName.traverse(obj => {
        if (!renamed && obj.isMesh) {
          obj.material.name = 'MAT_Corrompido';
          renamed = true;
        }
      });
      const wrongName = capture(() => module.validateCastleModel(badName, metadata));

      const badColor = cloneRoot();
      let recolored = false;
      badColor.traverse(obj => {
        if (!recolored && obj.isMesh) {
          obj.material.color.setHex(0xff00ff);
          recolored = true;
        }
      });
      const wrongColor = capture(() => module.validateCastleModel(badColor, metadata));
      const decoder = capture(() => module.validateCastleModel(cloneRoot(), {
        extensionsUsed: ['KHR_mesh_quantization', 'EXT_meshopt_compression'],
        extensionsRequired: ['KHR_mesh_quantization', 'EXT_meshopt_compression'],
      }));

      return {
        exported: true,
        validMaterials: valid.materials,
        wrongName,
        wrongColor,
        decoder,
      };
    });

    assert.equal(result.exported, true, 'validador semântico não é testável/exportado');
    assert.equal(result.validMaterials, 10);
    assert.match(result.wrongName || '', /material/i);
    assert.match(result.wrongColor || '', /cor|color|material/i);
    assert.match(result.decoder || '', /extens[aã]o|decoder|meshopt/i);
  });

  it('dispose libera uma vez os recursos próprios e remove as raízes da cena', async () => {
    const result = await h.play(async () => {
      const G = window.QA.G;
      const Structures = G.Structures;
      const castle = Structures.castle;
      await castle.ready;
      const model = castle.modelRoot;
      const foundation = castle.foundationRoot;
      const fallback = castle.fallbackRoot;
      const legacy = castle.legacyRoot;
      const effects = [...Structures.flags, ...Structures.flames];
      const ownedWalls = [...castle.walls];
      const ownedPlatforms = [...castle.platforms];
      const ownedRoofs = [...castle.roofs];
      const geometries = new Set(), materials = new Set();
      for (const root of [model, foundation, fallback, legacy, ...effects]) root.traverse(obj => {
        if (obj.geometry) geometries.add(obj.geometry);
        const list = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const material of list) if (material) materials.add(material);
      });
      const csmOwnedBefore = [...materials].filter(material =>
        material.defines && material.defines.USE_CSM === 1).length;
      const csmRegistryOwnedBefore = [...materials].filter(material =>
        G.csmDebug.hasMaterial(material) || G.csmDebug.hasShader(material)).length;
      const physicalBefore = window.QA.MP.world.bodies.filter(body =>
        body.userData && /^castle-(wall|surface)$/.test(body.userData.sourceId));

      const geometryDisposals = new Map(), materialDisposals = new Map();
      for (const geometry of geometries) {
        const original = geometry.dispose.bind(geometry);
        geometryDisposals.set(geometry, 0);
        geometry.dispose = () => {
          geometryDisposals.set(geometry, geometryDisposals.get(geometry) + 1);
          original();
        };
      }
      for (const material of materials) {
        const original = material.dispose.bind(material);
        materialDisposals.set(material, 0);
        material.dispose = () => {
          materialDisposals.set(material, materialDisposals.get(material) + 1);
          original();
        };
      }

      const wall = castle.walls.find(item => item.part === 'wall-left');
      const THREE = window.QA.MP.THREE;
      const rayOrigin = new THREE.Vector3(
        wall.x0 - 2,
        castle.floorY + 1.2,
        (wall.z0 + wall.z1) / 2,
      );
      const rayDirection = new THREE.Vector3(1, 0, 0);
      const rayBefore = Structures.rayHit(rayOrigin, rayDirection, 4);
      const keepRoof = castle.roofs.find(item => item.part === 'keep-roof');
      const coverPoint = {
        x: (keepRoof.x0 + keepRoof.x1) / 2,
        y: castle.floorY + 1.2,
        z: (keepRoof.z0 + keepRoof.z1) / 2,
      };
      const coverBefore = G.Cover.coverAt(coverPoint.x, coverPoint.y, coverPoint.z);
      castle.dispose();
      castle.dispose();
      const rayAfter = Structures.rayHit(rayOrigin, rayDirection, 4);
      const coverAfter = G.Cover.coverAt(coverPoint.x, coverPoint.y, coverPoint.z);
      const csmReleased = [...materials].every(material =>
        (!material.defines || !('USE_CSM' in material.defines)) &&
        !Object.prototype.hasOwnProperty.call(material, 'onBeforeCompile'));
      const csmRegistryReleased = [...materials].every(material =>
        !G.csmDebug.hasMaterial(material) && !G.csmDebug.hasShader(material));
      return {
        status: castle.status,
        geometryCount: geometries.size,
        materialCount: materials.size,
        geometryDisposals: [...geometryDisposals.values()],
        materialDisposals: [...materialDisposals.values()],
        csmOwnedBefore,
        csmRegistryOwnedBefore,
        csmReleased,
        csmRegistryReleased,
        modelDetached: model.parent === null,
        foundationDetached: foundation.parent === null,
        fallbackDetached: fallback.parent === null,
        legacyDetached: legacy.parent === null,
        effectsDetached: effects.every(effect => effect.parent === null),
        effectsUnregistered: effects.every(effect =>
          !Structures.flags.includes(effect) && !Structures.flames.includes(effect)),
        fallbackVisible: castle.fallbackRoot.visible,
        wallsUnregistered: ownedWalls.every(item => !Structures.walls.includes(item)),
        platformsUnregistered: ownedPlatforms.every(item => !G.platforms.includes(item)),
        roofsUnregistered: ownedRoofs.every(item => !Structures.fieldRoofs.includes(item)),
        rayBefore: Number.isFinite(rayBefore),
        rayAfterOpen: rayAfter === Infinity,
        coverBefore,
        coverAfter,
        physicalBefore: physicalBefore.length,
        physicalAfter: window.QA.MP.world.bodies.filter(body =>
          body.userData && /^castle-(wall|surface)$/.test(body.userData.sourceId)).length,
      };
    });

    assert.equal(result.status, 'disposed');
    assert.equal(result.geometryDisposals.length, result.geometryCount);
    assert.ok(result.geometryDisposals.every(count => count === 1),
      `geometrias não foram liberadas uma vez cada: ${result.geometryDisposals.join(',')}`);
    assert.equal(result.materialDisposals.length, result.materialCount);
    assert.ok(result.materialDisposals.every(count => count === 1),
      `materiais não foram liberados uma vez cada: ${result.materialDisposals.join(',')}`);
    assert.ok(result.csmOwnedBefore > 0, 'pré-condição vazia: nenhum material usava CSM');
    assert.ok(result.csmRegistryOwnedBefore > 0,
      'pré-condição vazia: registries do CSM não continham materiais do castelo');
    assert.equal(result.csmReleased, true,
      'CSM ainda referencia/configura materiais descartados do castelo');
    assert.equal(result.csmRegistryReleased, true,
      'registries do CSM ainda retêm materiais descartados do castelo');
    assert.equal(result.modelDetached, true);
    assert.equal(result.foundationDetached, true);
    assert.equal(result.fallbackDetached, true);
    assert.equal(result.legacyDetached, true);
    assert.equal(result.effectsDetached, true, 'flags/chamas legadas continuam na cena');
    assert.equal(result.effectsUnregistered, true, 'Amb ainda atualizaria flags/chamas descartadas');
    assert.equal(result.fallbackVisible, false);
    assert.equal(result.wallsUnregistered, true, 'walls lógicas sobreviveram ao dispose');
    assert.equal(result.platformsUnregistered, true, 'plataformas lógicas sobreviveram ao dispose');
    assert.equal(result.roofsUnregistered, true, 'fieldRoofs lógicos sobreviveram ao dispose');
    assert.equal(result.rayBefore, true, 'pré-condição vazia: tiro não encontrou wall-left');
    assert.equal(result.rayAfterOpen, true, 'rayHit ainda encontra castelo fantasma');
    assert.equal(result.coverBefore.covered, true, 'pré-condição vazia: keep não oferecia cobertura');
    assert.equal(result.coverAfter.covered, false, 'Cover ainda encontra telhado descartado');
    assert.ok(result.physicalBefore > 0, 'pré-condição vazia: castelo sem corpos físicos');
    assert.equal(result.physicalAfter, 0, 'dispose deixou colisores físicos fantasmas');
  });

  it('dispose durante o carregamento impede publicação tardia do GLB', async () => {
    const result = await h.play(async () => {
      const { createCastle } = await import('/js/castle.js');
      const THREE = window.QA.MP.THREE;
      const scene = new THREE.Scene();
      const additions = [];
      const originalAdd = scene.add.bind(scene);
      scene.add = (...objects) => {
        additions.push(...objects);
        return originalAdd(...objects);
      };
      let privateSeed = 0xD15A05E;
      const noSeed = fn => {
        const original = Math.random;
        Math.random = () =>
          (privateSeed = (privateSeed * 1664525 + 1013904223) >>> 0) / 4294967296;
        try { return fn(); } finally { Math.random = original; }
      };
      const castle = createCastle({
        center: { x: 0, z: 0 },
        heightAt: () => 2,
        scene,
        csmMat: material => material,
        noSeed,
        modelUrl: '/assets/models/boss-castle.v2.optimized.glb',
        walls: [],
        platforms: [],
        fieldRoofs: [],
      });
      const synchronousAdds = additions.length;
      castle.dispose();
      await castle.ready;
      return {
        status: castle.status,
        modelNull: castle.modelRoot === null,
        asynchronousAdds: additions.length - synchronousAdds,
        remainingChildren: scene.children.length,
      };
    });

    assert.equal(result.status, 'disposed');
    assert.equal(result.modelNull, true);
    assert.equal(result.asynchronousAdds, 0, 'GLB foi anexado depois do dispose');
    assert.equal(result.remainingChildren, 0, 'raízes síncronas sobreviveram ao dispose');
  });
});
