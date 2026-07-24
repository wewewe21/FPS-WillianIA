'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { CHROME, bootGame } = require('./helpers/harness');

describe('Castelo — fallback de carregamento', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h;
  const PORT = 3251;

  before(async () => {
    h = await bootGame({
      port: PORT,
      blockRequests: ['boss-castle.v2.optimized.glb'],
    });
  });
  after(async () => {
    if (!h) return;
    try {
      assert.deepEqual(h.pageErrors, [], `page errors: ${h.pageErrors.join(' | ')}`);
      const unexpectedConsoleErrors = h.consoleErrors.filter(error =>
        !/Failed to load resource.*ERR_FAILED/i.test(error));
      assert.deepEqual(unexpectedConsoleErrors, [],
        `console errors inesperados: ${unexpectedConsoleErrors.join(' | ')}`);
      assert.equal(h.requestFailures.length, 1,
        `falhas de request inesperadas: ${h.requestFailures.join(' | ')}`);
    } finally {
      await h.close();
    }
  });

  it('usa proxy visual paritário aos colliders novos quando o GLB não chega', async () => {
    const r = await h.play(async () => {
      const G = window.QA.G, castle = G.Structures.castle;
      await castle.ready;
      const text = JSON.parse(window.render_game_to_text());
      const THREE = window.QA.MP.THREE;
      castle.fallbackRoot.updateMatrixWorld(true);
      const proxyMeshes = [];
      castle.fallbackRoot.traverse(obj => {
        if (obj.isMesh) proxyMeshes.push(obj);
      });
      const colliderMeshes = proxyMeshes.filter(obj =>
        obj.userData.castleVisualKind === 'collider');
      const surfaceMeshes = proxyMeshes.filter(obj =>
        obj.userData.castleVisualKind === 'surface');
      const proxyParts = colliderMeshes.map(obj => obj.userData.castlePart).sort();
      const expectedProxyParts = castle.walls
        .filter(w => !w.part.startsWith('foundation-'))
        .map(w => w.part)
        .sort();
      const boundsMismatches = [];
      for (const mesh of colliderMeshes) {
        const wall = castle.walls.find(w => w.part === mesh.userData.castlePart);
        const bounds = new THREE.Box3().setFromObject(mesh);
        const got = [
          bounds.min.x, bounds.max.x,
          bounds.min.y, bounds.max.y,
          bounds.min.z, bounds.max.z,
        ];
        const expected = wall && [
          wall.x0, wall.x1, wall.y0, wall.y1, wall.z0, wall.z1,
        ];
        if (!expected || got.some((value, i) => Math.abs(value - expected[i]) > 1e-4))
          boundsMismatches.push({ part: mesh.userData.castlePart, got, expected });
      }
      const expectedSurfaceParts = castle.platforms
        .filter(p => !['gate-ramp', 'gate-threshold'].includes(p.castlePart))
        .map(p => p.castlePart)
        .sort();
      const surfaceParts = surfaceMeshes.map(obj => obj.userData.castlePart).sort();
      const containsVisibleProxy = point => proxyMeshes.some(mesh =>
        new THREE.Box3().setFromObject(mesh).containsPoint(point));
      const rampZ = (castle.gate.innerZ + castle.gate.outerZ) / 2;
      const rampExpected = castle.ramp.heightAt(rampZ);
      const rampVisual = castle.foundationRoot.getObjectByName(
        'bossCastleGateThresholdAndRamp',
      );
      const visualRampDeltas = [];
      if (rampVisual) {
        const ray = new THREE.Raycaster();
        const samples = [
          ...[0.05, 0.125, 0.375, 0.625, 0.875, 0.95].map(k => {
            const z = castle.ramp.z0 + (castle.ramp.z1 - castle.ramp.z0) * k;
            return [z, castle.ramp.heightAt(z)];
          }),
          [
            (castle.footprint.z1 + castle.ramp.z0) / 2,
            castle.floorY,
          ],
        ];
        for (const [z, expected] of samples) {
          ray.set(
            new THREE.Vector3(castle.center.x, expected + 10, z),
            new THREE.Vector3(0, -1, 0),
          );
          const hit = ray.intersectObject(rampVisual, false)[0];
          visualRampDeltas.push(hit ? Math.abs(hit.point.y - expected) : Infinity);
        }
      }
      let legacyMeshes = 0;
      if (castle.legacyRoot) castle.legacyRoot.traverse(obj => {
        if (obj.isMesh) legacyMeshes++;
      });
      const effects = [...G.Structures.flags, ...G.Structures.flames];
      return {
        status: castle.status,
        error: String(castle.error || ''),
        modelNull: castle.modelRoot === null,
        fallbackName: castle.fallbackRoot.name,
        fallbackVisible: castle.fallbackRoot.visible,
        foundationVisible: castle.foundationRoot.visible,
        legacyRootPresent: !!castle.legacyRoot,
        legacyRootVisible: !!castle.legacyRoot && castle.legacyRoot.visible,
        legacyMeshes,
        legacyEffectCount: effects.length,
        legacyEffectsVisible: effects.filter(obj => obj.visible).length,
        proxyMeshCount: proxyMeshes.length,
        proxyParts,
        expectedProxyParts,
        boundsMismatches,
        surfaceParts,
        expectedSurfaceParts,
        shrinePhantom: containsVisibleProxy(new THREE.Vector3(
          castle.center.x + 2.4, castle.originY + 1.7, castle.center.z + 2.4)),
        rearTowerPhantom: containsVisibleProxy(new THREE.Vector3(
          castle.center.x - 17, castle.originY + 8.5, castle.center.z - 17)),
        frontTowerPresent: containsVisibleProxy(new THREE.Vector3(
          castle.center.x - 17, castle.originY + 8.5, castle.center.z + 17)),
        walls: castle.walls.length,
        rampVisualPresent: !!rampVisual && rampVisual.visible,
        visualRampDeltas,
        gateGroundDelta: Math.abs(
          G.groundAt(castle.center.x, rampZ, rampExpected + 0.1) - rampExpected),
        textStatus: text.castle.status,
      };
    });

    assert.equal(r.status, 'fallback');
    assert.match(r.error, /fetch|load|network|failed/i);
    assert.equal(r.modelNull, true);
    assert.equal(r.fallbackName, 'bossCastleFallbackProxy');
    assert.equal(r.fallbackVisible, true);
    assert.equal(r.foundationVisible, true);
    assert.equal(r.legacyRootPresent, true, 'forte legado deixou de ser construído');
    assert.ok(r.legacyMeshes > 0, 'forte legado não preservou sua geometria/UUIDs');
    assert.equal(r.legacyRootVisible, false, 'malha visual legada ficou ativa');
    assert.ok(r.legacyEffectCount > 0, 'pré-condição vazia: efeitos legados ausentes');
    assert.equal(r.legacyEffectsVisible, 0, 'bandeiras/chamas fantasmas ficaram ativas');
    assert.ok(r.proxyMeshCount > 0, 'proxy de fallback vazio');
    assert.deepEqual(r.proxyParts, r.expectedProxyParts,
      'proxy não representa exatamente os colliders novos');
    assert.deepEqual(r.boundsMismatches, [],
      `proxy diverge dos AABBs: ${JSON.stringify(r.boundsMismatches)}`);
    assert.deepEqual(r.surfaceParts, r.expectedSurfaceParts,
      'proxy não representa exatamente as superfícies jogáveis');
    assert.equal(r.shrinePhantom, false, 'santuário legado não tem collider correspondente');
    assert.equal(r.rearTowerPhantom, false, 'torre traseira legada não tem collider correspondente');
    assert.equal(r.frontTowerPresent, true, 'proxy perdeu a torre frontal física');
    assert.ok(r.walls >= 8, 'fallback perdeu colisores síncronos');
    assert.equal(r.rampVisualPresent, true, 'fallback perdeu a malha visual da rampa/soleira');
    assert.ok(r.visualRampDeltas.length >= 7 &&
      r.visualRampDeltas.every(delta => delta <= 0.02),
    `visual da rampa diverge do apoio lógico: ${r.visualRampDeltas.join(', ')}`);
    assert.ok(r.gateGroundDelta <= 0.02,
      `fallback perdeu a rampa jogável (delta=${r.gateGroundDelta})`);
    assert.equal(r.textStatus, 'fallback');
    assert.deepEqual(h.pageErrors, [], `page errors: ${h.pageErrors.join(' | ')}`);
    const expectedNetworkErrors = h.consoleErrors.filter(error =>
      /Failed to load resource.*ERR_FAILED/i.test(error));
    const unexpectedConsoleErrors = h.consoleErrors.filter(error =>
      !/Failed to load resource.*ERR_FAILED/i.test(error));
    assert.equal(expectedNetworkErrors.length, 1,
      `erro esperado do abort não foi observado: ${h.consoleErrors.join(' | ')}`);
    assert.deepEqual(unexpectedConsoleErrors, [],
      `console errors inesperados: ${unexpectedConsoleErrors.join(' | ')}`);
    assert.equal(h.requestFailures.length, 1,
      `falhas de request inesperadas: ${h.requestFailures.join(' | ')}`);
    assert.match(h.requestFailures[0], /boss-castle\.v2\.optimized\.glb/);
  });

  it('mantém o mesmo proxy quando recebe bytes de GLB inválidos', async () => {
    const invalidGlb = 'data:application/octet-stream;base64,bm90LWEtZ2xi';
    const failuresBefore = h.requestFailures.length;
    const r = await h.play(async modelUrl => {
      const { createCastle } = await import('/js/castle.js');
      const THREE = window.QA.MP.THREE;
      const scene = new THREE.Scene();
      let privateSeed = 0xC4571E;
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
        modelUrl,
        walls: [],
        platforms: [],
        fieldRoofs: [],
      });
      await castle.ready;
      return {
        url: castle.url,
        status: castle.status,
        error: String(castle.error || ''),
        modelNull: castle.modelRoot === null,
        fallbackName: castle.fallbackRoot && castle.fallbackRoot.name,
        fallbackVisible: !!castle.fallbackRoot && castle.fallbackRoot.visible,
        proxyMeshes: castle.fallbackRoot
          ? castle.fallbackRoot.children.filter(obj => obj.isMesh).length
          : 0,
      };
    }, invalidGlb);

    assert.equal(r.url, invalidGlb, 'teste não exercitou a resposta inválida');
    assert.equal(r.status, 'fallback');
    assert.match(r.error, /glb|gltf|json|parse|buffer|unexpected|invalid/i);
    assert.equal(r.modelNull, true);
    assert.equal(r.fallbackName, 'bossCastleFallbackProxy');
    assert.equal(r.fallbackVisible, true);
    assert.ok(r.proxyMeshes > 0);
    assert.equal(h.requestFailures.length, failuresBefore,
      'GLB inválido foi confundido com falha de rede');
  });

  it('mantém o proxy quando um GLB parseável viola o contrato semântico', async () => {
    const failuresBefore = h.requestFailures.length;
    const r = await h.play(async () => {
      const { createCastle } = await import('/js/castle.js');
      const { GLTFExporter } =
        await import('three/addons/exporters/GLTFExporter.js');
      const THREE = window.QA.MP.THREE;
      const invalidScene = new THREE.Scene();
      invalidScene.add(new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ name: 'MAT_Invalido', color: 0xffffff }),
      ));
      const bytes = await new GLTFExporter().parseAsync(invalidScene, { binary: true });
      const modelUrl = URL.createObjectURL(new Blob([bytes], {
        type: 'model/gltf-binary',
      }));
      const privateScene = new THREE.Scene();
      let invalidModelAdds = 0;
      const addedObjects = [];
      const originalAdd = privateScene.add.bind(privateScene);
      privateScene.add = (...objects) => {
        addedObjects.push(...objects);
        invalidModelAdds += objects.filter(obj => obj && obj.name === 'bossCastle').length;
        return originalAdd(...objects);
      };
      let privateSeed = 0x5E6A17;
      const noSeed = fn => {
        const original = Math.random;
        Math.random = () =>
          (privateSeed = (privateSeed * 1664525 + 1013904223) >>> 0) / 4294967296;
        try { return fn(); } finally { Math.random = original; }
      };
      const castle = createCastle({
        center: { x: 0, z: 0 },
        heightAt: () => 2,
        scene: privateScene,
        csmMat: material => material,
        noSeed,
        modelUrl,
        walls: [],
        platforms: [],
        fieldRoofs: [],
      });
      const synchronousAdds = addedObjects.length;
      await castle.ready;
      const result = {
        status: castle.status,
        error: String(castle.error || ''),
        modelNull: castle.modelRoot === null,
        fallbackVisible: castle.fallbackRoot.visible,
        invalidModelAdds,
        asynchronousAdds: addedObjects.length - synchronousAdds,
        visibleModelRoots: privateScene.children.filter(obj =>
          obj.visible && obj.name === 'bossCastle').length,
      };
      castle.dispose();
      URL.revokeObjectURL(modelUrl);
      return result;
    });

    assert.equal(r.status, 'fallback');
    assert.match(r.error, /extens[aã]o|bounds|material/i,
      'GLB parseável não chegou ao validador semântico');
    assert.equal(r.modelNull, true, 'modelo inválido foi publicado antes/depois da validação');
    assert.equal(r.fallbackVisible, true, 'proxy sumiu após falha semântica');
    assert.equal(r.invalidModelAdds, 0, 'modelo inválido chegou a ser anexado à cena');
    assert.equal(r.asynchronousAdds, 0,
      'GLB inválido sem nome chegou a ser anexado transitoriamente à cena');
    assert.equal(r.visibleModelRoots, 0, 'swap parcial deixou uma raiz visual inválida');
    assert.equal(h.requestFailures.length, failuresBefore,
      'falha semântica local foi confundida com falha de rede');
  });
});
