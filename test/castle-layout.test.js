/* ================================================================
   QA — contrato espacial do castelo GLB.

   RED das Tasks 2/4:
   - layout/fundação/rampa e rota de guarda em seis seeds;
   - colisores, portão, keep, plataformas e cobertura;
   - clareira de vegetação e grama;
   - assinatura do worldgen no seed 424242.

   Este arquivo deliberadamente não conhece a malha visual. O contrato
   síncrono em Structures.castle é a fonte de verdade para física e QA.
   ================================================================ */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { CHROME, bootGame } = require('./helpers/harness');

// Exclusivas deste arquivo: os testes de navegador do repo usam 3164–3236.
const PORTS = new Map([
  ['424242', 3247],
  ['1', 3248],
  ['123456', 3249],
  ['987654', 3250],
  // Regressões encontradas pela varredura determinística de 500 seeds:
  // base militar e cidade destruída podiam invadir a órbita do Golem.
  ['138', 3297],
  ['150', 3298],
]);

const EXPECTED_RNG_424242 = {
  fort: [250.03092375466596, 299.4235932343926],
  sites: [
    ['torre', -214.79956304918247, -185.6650517049756],
    ['torre', -181.75926336442564, -334.34868188764347],
    ['torre', 359.83661116690143, 102.37719491295123],
    ['torre', 344.11016223641116, -154.02175947773085],
    ['torre', 225.49007457618097, -359.3977033972953],
    ['torre', 27.37382851338981, -189.64370139401822],
    ['cabana', 170.71841169406338, 326.563310259419],
    ['cabana', -337.9275101975562, 272.2908805997761],
    ['cabana', -110.79636305924241, -66.46392035619647],
    ['cabana', 270.50716908895185, -29.083622551537335],
    ['cabana', -336.07400456865054, -90.6674279866878],
    ['cabana', 162.94323979200942, -390.6077270928091],
    ['ruína', -114.33641849784532, 172.76225232145114],
    ['ruína', 115.4418069938283, -381.3910597033333],
    ['ruína', -92.06170500289655, -191.00861157470212],
    ['ruína', -178.19074971154976, 114.80570487448219],
    ['ruína', -68.14064089179509, 88.83153169547397],
  ],
  bases: [
    [-247.6920914879443, -101.44175487532809],
    [172.73894362582595, -285.9896094636178],
  ],
  cars: [
    [-326, 156, 0, 'sport'],
    [-348, 156, Math.PI, 'sport2'],
    [-314, 114, -Math.PI / 2, 'sport'],
    [-247.6920914879443, -105.44175487532809, 1.6543486853488587, 'truck'],
    [172.73894362582595, -289.9896094636178, 0.2290008629651304, 'truck'],
  ],
  enemies: [
    [-337, 130.37172725051641, 'suit', 10.316432285308839],
    [-336.82733972906135, 133.44996371073648, 'suit', 10.316432285308839],
    [-337, 129.38670558854938, 'suit', 17.11643228530884],
    [-336.28670680802315, 131.6231330554001, 'suit', 17.11643228530884],
    [-337, 133.7583620455116, 'suit', 23.916432285308836],
    [-336.0937000741251, 126.880184316542, 'suit', 23.916432285308836],
    [-337, 126.65377535112202, 'suit', 30.716432285308837],
    [-337.840162263019, 134.23308363417163, 'suit', 30.716432285308837],
    [-250.40315494745988, -97.8030470177491, 'army', null],
    [-249.18747708261031, -108.10964695885374, 'army', null],
    [-243.45400287270564, -95.31968785971, 'army', null],
    [-259.0086171223225, -105.53123973086073, 'army', null],
    [167.5289152959618, -289.39288470755577, 'army', null],
    [177.8620529553178, -279.05394560332655, 'army', null],
    [168.72627955174775, -284.8367214896834, 'army', null],
    [182.6510556346062, -287.3909603641486, 'army', null],
  ],
  chests: [
    [-318.5, 148],
    [-252.6920914879443, -109.44175487532809],
    [167.73894362582595, -293.9896094636178],
    [5, 0.5],
  ],
};

function assertApproxTree(actual, expected, path = 'assinatura', epsilon = 1e-6) {
  if (typeof expected === 'number') {
    assert.equal(typeof actual, 'number', `${path}: número esperado`);
    assert.ok(Number.isFinite(actual), `${path}: número não finito (${actual})`);
    assert.ok(Math.abs(actual - expected) <= epsilon,
      `${path}: ${actual} mudou; esperado ${expected} (±${epsilon})`);
    return;
  }
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${path}: array esperado`);
    assert.equal(actual.length, expected.length,
      `${path}: tamanho mudou (${actual.length} != ${expected.length})`);
    for (let i = 0; i < expected.length; i++)
      assertApproxTree(actual[i], expected[i], `${path}[${i}]`, epsilon);
    return;
  }
  assert.equal(actual, expected, `${path}: valor mudou`);
}

async function inspectVerticalLayout(h) {
  return h.play(() => {
    const G = window.QA.G;
    const castle = G.Structures.castle;
    if (!castle) return null;
    const f = castle.footprint || {};
    const finiteFootprint = [f.x0, f.x1, f.z0, f.z1].every(Number.isFinite);
    if (!finiteFootprint) return { finiteFootprint: false };

    // Inclui os limites e usa passo denso o bastante para não perder o pico
    // do heightfield sob uma pegada de ~38 m.
    const axis = (lo, hi) => {
      const out = [];
      for (let v = lo; v < hi; v += 0.25) out.push(v);
      out.push(hi);
      return out;
    };
    let terrainMin = Infinity, terrainMax = -Infinity;
    for (const x of axis(f.x0, f.x1))
      for (const z of axis(f.z0, f.z1)) {
        const y = G.heightAt(x, z);
        terrainMin = Math.min(terrainMin, y);
        terrainMax = Math.max(terrainMax, y);
      }

    const ramp = castle.ramp;
    let rampMinClearance = Infinity;
    if (ramp) {
      for (const x of axis(ramp.x0, ramp.x1))
        for (const z of axis(ramp.z0, ramp.z1)) {
          const t = (z - ramp.z0) / (ramp.z1 - ramp.z0);
          const rampY = typeof ramp.heightAt === 'function'
            ? ramp.heightAt(z)
            : ramp.y0 + (ramp.y1 - ramp.y0) * t;
          rampMinClearance = Math.min(rampMinClearance, rampY - G.heightAt(x, z));
        }
    }

    const guardEnvelope = castle.guardRadius + 1.5;
    const citySite = G.Structures.sites.find(site => site.type === 'cidade');
    const cityGuardMargin = citySite
      ? Math.hypot(castle.center.x - citySite.x, castle.center.z - citySite.z) -
        citySite.r - guardEnvelope
      : -Infinity;
    const baseGuardMargins = G.Structures.baseSites.map(base => {
      const dx = Math.abs(base.x - castle.center.x);
      const dz = Math.abs(base.z - castle.center.z);
      // A base ocupa até ±21 m × ±15 m; distância ao retângulo completo é
      // conservadora e garante que nenhuma de suas paredes alcance o ator.
      const nearest = Math.hypot(Math.max(0, dx - 21), Math.max(0, dz - 15));
      return nearest - guardEnvelope;
    });

    return {
      finiteFootprint,
      center: castle.center && [castle.center.x, castle.center.z],
      fort: [G.Structures.FORT_POS.x, G.Structures.FORT_POS.z],
      footprint: [f.x0, f.x1, f.z0, f.z1],
      originY: castle.originY,
      floorY: castle.floorY,
      foundationBottom: castle.foundationBottom,
      terrainMin,
      terrainMax,
      ramp: ramp && {
        minClearance: rampMinClearance,
        slopeDegrees: ramp.slopeDegrees,
        maxSlopeDegrees: ramp.maxSlopeDegrees,
      },
      guardRadius: castle.guardRadius,
      clearRadius: castle.clearRadius,
      cityGuardMargin,
      baseCount: baseGuardMargins.length,
      minBaseGuardMargin: Math.min(...baseGuardMargins),
    };
  });
}

describe('Castelo GLB — layout síncrono e worldgen', {
  skip: !CHROME && 'Chrome não encontrado',
}, () => {
  let h;
  before(async () => {
    h = await bootGame({ port: PORTS.get('424242'), worldSeed: '424242' });
  });
  after(async () => {
    if (!h) return;
    try {
      assert.deepEqual(h.pageErrors, [], `page errors tardios: ${h.pageErrors.join(' | ')}`);
      assert.deepEqual(h.consoleErrors, [],
        `console errors tardios: ${h.consoleErrors.join(' | ')}`);
      assert.deepEqual(h.requestFailures, [],
        `request failures tardios: ${h.requestFailures.join(' | ')}`);
    } finally {
      await h.close();
    }
  });

  it('expõe Structures.castle como contrato síncrono completo', async () => {
    const r = await h.play(() => {
      const castle = window.QA.G.Structures.castle;
      if (!castle) return null;
      const own = key => Object.prototype.hasOwnProperty.call(castle, key);
      return {
        status: castle.status,
        url: castle.url,
        readyThen: !!castle.ready && typeof castle.ready.then === 'function',
        finiteScalars: ['originY', 'floorY', 'foundationBottom', 'guardRadius', 'clearRadius']
          .every(k => Number.isFinite(castle[k])),
        center: !!castle.center && Number.isFinite(castle.center.x) &&
          Number.isFinite(castle.center.z),
        footprint: !!castle.footprint,
        arrays: ['walls', 'platforms', 'roofs'].every(k => Array.isArray(castle[k])),
        roots: own('fallbackRoot') && own('modelRoot'),
        exclusion: typeof castle.excludesDecoration === 'function',
      };
    });

    assert.ok(r, 'Structures.castle não existe');
    assert.ok(['loading', 'ready', 'fallback'].includes(r.status),
      `status inválido: ${r.status}`);
    assert.equal(r.url, '/assets/models/boss-castle.v2.optimized.glb');
    assert.ok(r.readyThen, 'castle.ready não é Promise/thenable');
    assert.ok(r.finiteScalars, 'alturas/raios do castelo não são finitos');
    assert.ok(r.center && r.footprint, 'center/footprint ausentes');
    assert.ok(r.arrays, 'walls/platforms/roofs devem ser arrays síncronos');
    assert.ok(r.roots, 'fallbackRoot/modelRoot precisam existir mesmo quando null');
    assert.ok(r.exclusion, 'excludesDecoration(x,z) ausente');
  });

  it('carrega o GLB otimizado em escala autoral e troca o fallback atomicamente', async () => {
    const r = await h.play(async () => {
      const QA = window.QA, S = QA.G.Structures, castle = S.castle;
      if (!castle) return null;
      await castle.ready;
      const root = castle.modelRoot;
      if (!root) return { status: castle.status, error: String(castle.error || '') };
      root.updateMatrixWorld(true);
      const bounds = new QA.MP.THREE.Box3().setFromObject(root);
      const materials = new Set();
      let meshes = 0, triangles = 0;
      root.traverse(obj => {
        if (!obj.isMesh) return;
        meshes++;
        const position = obj.geometry.attributes.position;
        triangles += obj.geometry.index ? obj.geometry.index.count / 3 : position.count / 3;
        for (const material of Array.isArray(obj.material) ? obj.material : [obj.material])
          if (material && material.color) materials.add(material.color.getHexString());
      });
      let foundationMeshes = 0;
      let foundationShadowCasters = 0;
      castle.foundationRoot.traverse(obj => {
        if (!obj.isMesh) return;
        foundationMeshes++;
        if (obj.castShadow) foundationShadowCasters++;
      });
      return {
        status: castle.status,
        url: castle.url,
        visible: root.visible,
        name: root.name,
        position: [root.position.x, root.position.y, root.position.z],
        rotation: [root.rotation.x, root.rotation.y, root.rotation.z],
        scale: [root.scale.x, root.scale.y, root.scale.z],
        expected: [castle.center.x, castle.originY, castle.center.z],
        localBounds: [
          bounds.min.x - castle.center.x,
          bounds.min.y - castle.originY,
          bounds.min.z - castle.center.z,
          bounds.max.x - castle.center.x,
          bounds.max.y - castle.originY,
          bounds.max.z - castle.center.z,
        ],
        meshes,
        foundationMeshes,
        foundationShadowCasters,
        liveCastleMeshes: meshes + foundationMeshes,
        triangles,
        colors: materials.size,
        fallbackVisible: !!castle.fallbackRoot && castle.fallbackRoot.visible,
        foundationVisible: castle.foundationRoot.visible,
        legacyVisible: [...S.flags, ...S.flames].some(obj => obj.visible),
        legacyRootVisible: !!castle.legacyRoot && castle.legacyRoot.visible,
        visibleCastleRoots: [root, castle.fallbackRoot, castle.legacyRoot]
          .filter(obj => obj && obj.parent === QA.MP.scene && obj.visible).length,
        textState: JSON.parse(window.render_game_to_text()),
      };
    });

    assert.ok(r, 'Structures.castle não existe');
    assert.equal(r.status, 'ready', `GLB não ficou pronto: ${r.error || r.status}`);
    assert.equal(r.url, '/assets/models/boss-castle.v2.optimized.glb');
    assert.equal(r.visible, true);
    assert.equal(r.name, 'bossCastle');
    assertApproxTree(r.position, r.expected, 'transform.position', 1e-6);
    assertApproxTree(r.rotation, [0, 0, 0], 'transform.rotation', 1e-6);
    assertApproxTree(r.scale, [1, 1, 1], 'transform.scale', 1e-6);
    assertApproxTree(r.localBounds, [-19.18, -1.1, -19, 19.18, 19, 19.181], 'bbox GLB', 0.03);
    assert.ok(r.meshes <= 14, `castelo criou ${r.meshes} draw meshes`);
    assert.ok(r.liveCastleMeshes <= 12,
      `castelo+fundação criaram ${r.liveCastleMeshes} draw meshes vivos`);
    assert.equal(r.foundationShadowCasters, 0,
      'saia/rampa baixa duplicam os passes de sombra do próprio castelo');
    assert.ok(r.triangles <= 25000, `castelo criou ${r.triangles} triângulos`);
    assert.ok(r.colors >= 8, `paleta do castelo colapsou para ${r.colors} cores`);
    assert.equal(r.fallbackVisible, false, 'fallback ficou duplicado atrás do GLB');
    assert.equal(r.foundationVisible, true, 'fundação sumiu durante o swap');
    assert.equal(r.legacyVisible, false, 'flags/chamas do forte antigo ficaram flutuando');
    assert.equal(r.legacyRootVisible, false, 'malha do forte antigo ficou visível atrás do GLB');
    assert.equal(r.visibleCastleRoots, 1, 'há castelo novo e fallback visíveis ao mesmo tempo');
    assert.equal(r.textState.castle.status, 'ready', 'estado textual não publica o castelo pronto');
    assert.equal(r.textState.castle.guardRadius, 30, 'estado textual perdeu o raio de guarda');
    assert.ok(r.textState.golem && typeof r.textState.golem.alive === 'boolean',
      'estado textual não publica o Golem/Colosso');
    assert.deepEqual(h.pageErrors, [], `page errors: ${h.pageErrors.join(' | ')}`);
    assert.deepEqual(h.consoleErrors, [], `console errors: ${h.consoleErrors.join(' | ')}`);
    assert.deepEqual(h.requestFailures, [], `request failures: ${h.requestFailures.join(' | ')}`);
  });

  it('encaixa fundação, piso e rota de guarda em seis seeds sem mover o mapa canônico', async () => {
    for (const seed of PORTS.keys()) {
      let current = h;
      if (seed !== '424242')
        current = await bootGame({ port: PORTS.get(seed), worldSeed: seed });
      try {
        const r = await inspectVerticalLayout(current);
        assert.ok(r, `seed ${seed}: Structures.castle não existe`);
        assert.ok(r.finiteFootprint, `seed ${seed}: footprint inválido`);
        assertApproxTree(r.center, r.fort, `seed ${seed}: center/FORT_POS`);

        const [x0, x1, z0, z1] = r.footprint;
        assert.ok(x0 < x1 && z0 < z1, `seed ${seed}: footprint invertido`);
        assert.ok(x1 - x0 >= 38 && x1 - x0 <= 38.6,
          `seed ${seed}: largura incompatível com o GLB (${x1 - x0}m)`);
        assert.ok(z1 - z0 >= 38 && z1 - z0 <= 38.6,
          `seed ${seed}: profundidade incompatível com o GLB (${z1 - z0}m)`);
        assert.ok(Math.abs((x0 + x1) / 2 - r.center[0]) <= 0.02 &&
          Math.abs((z0 + z1) / 2 - r.center[1]) <= 0.12,
        `seed ${seed}: footprint não está centrado no FORT_POS`);

        assert.ok(Math.abs(r.originY - (r.terrainMax + 0.05)) <= 0.02,
          `seed ${seed}: originY=${r.originY}, pico=${r.terrainMax}`);
        assert.ok(Math.abs(r.floorY - (r.originY + 0.16)) <= 1e-6,
          `seed ${seed}: floorY não é originY+0,16`);
        assert.ok(r.foundationBottom <= r.terrainMin - 0.25 + 1e-6,
          `seed ${seed}: fundação termina acima do vale (${r.foundationBottom} > ${r.terrainMin - 0.25})`);
        assert.ok(r.terrainMax <= r.floorY + 0.05,
          `seed ${seed}: terreno atravessa o piso (${r.terrainMax} > ${r.floorY + 0.05})`);
        assert.ok(r.ramp && Number.isFinite(r.ramp.minClearance) &&
          Number.isFinite(r.ramp.slopeDegrees) &&
          Number.isFinite(r.ramp.maxSlopeDegrees),
        `seed ${seed}: rampa sem amostragem/declive finito`);
        assert.ok(r.ramp.minClearance >= 0.045,
          `seed ${seed}: terreno atravessa a rampa (folga=${r.ramp.minClearance})`);
        assert.ok(r.ramp.maxSlopeDegrees <= 30,
          `seed ${seed}: trecho da rampa íngreme demais (${r.ramp.maxSlopeDegrees}°)`);
        assert.equal(r.guardRadius, 30, `seed ${seed}: raio de guarda mudou`);
        assert.equal(r.clearRadius, 28, `seed ${seed}: raio da clareira mudou`);
        assert.ok(r.cityGuardMargin >= -1e-6,
          `seed ${seed}: ruínas da cidade invadem a rota (${r.cityGuardMargin}m)`);
        assert.equal(r.baseCount, 2,
          `seed ${seed}: worldgen perdeu base militar (${r.baseCount}/2)`);
        assert.ok(r.minBaseGuardMargin >= -1e-6,
          `seed ${seed}: base militar invade a rota (${r.minBaseGuardMargin}m)`);
        assert.deepEqual(current.pageErrors, [],
          `seed ${seed}: page errors: ${current.pageErrors.join(' | ')}`);
        assert.deepEqual(current.consoleErrors, [],
          `seed ${seed}: console errors: ${current.consoleErrors.join(' | ')}`);
        assert.deepEqual(current.requestFailures, [],
          `seed ${seed}: request failures: ${current.requestFailures.join(' | ')}`);
      } finally {
        if (current !== h) await current.close();
      }
    }
  });

  it('publica colliders do castelo, deixa o gate livre e torna pátio/rampa/keep pisáveis', async () => {
    const r = await h.play(() => {
      const QA = window.QA, G = QA.G, S = G.Structures, castle = S.castle;
      if (!castle) return null;
      const f = castle.footprint;
      const label = o => [o.part, o.kind, o.role, o.sourceId, o.name]
        .filter(Boolean).join(' ').toLowerCase();
      const has = (list, re) => list.some(o => re.test(label(o)));
      const finiteBox = w => [w.x0, w.x1, w.y0, w.y1, w.z0, w.z1]
        .every(Number.isFinite) && w.x0 < w.x1 && w.y0 < w.y1 && w.z0 < w.z1;
      const overlapsXZ = (w, q) =>
        w.x1 > q.x0 && w.x0 < q.x1 && w.z1 > q.z0 && w.z0 < q.z1;

      const gate = {
        x0: castle.center.x - 1.6,
        x1: castle.center.x + 1.6,
        z0: f.z1 - 2,
        z1: f.z1 + 2.5,
      };
      const gateBlockers = castle.walls.filter(w =>
        overlapsXZ(w, gate) &&
        w.y1 > castle.floorY + 0.05 &&
        w.y0 < castle.floorY + 2.8);

      const ramp = castle.platforms.find(p => p.ramp || /ramp|rampa/.test(label(p)));
      const platformChecks = {};
      for (const [key, re] of [
        ['courtyard', /courtyard|p[aá]tio/],
        ['ramp', /ramp|rampa/],
        ['wallWalk', /wall.?walk|adarve|passeio.?muralha/],
        ['keep', /keep|torre[aã]o/],
      ]) {
        const p = castle.platforms.find(v => re.test(label(v)));
        if (!p) { platformChecks[key] = null; continue; }
        const ratios = p.ramp ? [0.125, 0.375, 0.625, 0.875] : [0.5];
        const deltas = ratios.map(k => {
          const x = p.axis === 'x'
            ? p.x0 + (p.x1 - p.x0) * k
            : (p.x0 + p.x1) / 2;
          const z = p.axis === 'z'
            ? p.z0 + (p.z1 - p.z0) * k
            : (p.z0 + p.z1) / 2;
          const expected = p.ramp
            ? (typeof p.heightAt === 'function'
              ? p.heightAt(p.axis === 'x' ? x : z)
              : p.y0 + (p.y1 - p.y0) * k)
            : p.y;
          const actual = G.groundAt(x, z, expected + 0.05);
          return Math.abs(actual - expected);
        });
        platformChecks[key] = {
          global: G.platforms.includes(p),
          finite: deltas.every(Number.isFinite),
          delta: Math.max(...deltas),
          samples: deltas.length,
        };
      }

      const keepRoof = castle.roofs.find(v => /keep|torre[aã]o/.test(label(v)));
      let roof = null;
      if (keepRoof) {
        const x = (keepRoof.x0 + keepRoof.x1) / 2;
        const z = (keepRoof.z0 + keepRoof.z1) / 2;
        roof = {
          global: S.fieldRoofs.includes(keepRoof),
          marked: keepRoof.castle === true,
          covered: G.Cover.coverAt(x, Math.min(castle.floorY + 1.6, keepRoof.roofY - 0.1), z),
        };
      }

      // Nenhum AABB legado sem tag pode sobreviver dentro da implantação.
      const legacyWalls = S.walls.filter(w => !w.castle && overlapsXZ(w, f));
      const eligibleWalls = castle.walls.filter(w => !w.noCollide &&
        w.x1 - w.x0 >= 0.08 && w.y1 - w.y0 >= 0.08 && w.z1 - w.z0 >= 0.08);
      const bodies = QA.MP.world.bodies.filter(b =>
        b.userData && b.userData.sourceId === 'castle-wall');
      const unbackedWalls = eligibleWalls.filter(w => !bodies.some(b => {
        const shape = b.shapes && b.shapes[0];
        if (!shape || !shape.halfExtents) return false;
        return Math.abs(b.position.x - (w.x0 + w.x1) / 2) < 0.03 &&
          Math.abs(b.position.y - (w.y0 + w.y1) / 2) < 0.03 &&
          Math.abs(b.position.z - (w.z0 + w.z1) / 2) < 0.03 &&
          Math.abs(shape.halfExtents.x - (w.x1 - w.x0) / 2) < 0.03 &&
          Math.abs(shape.halfExtents.y - (w.y1 - w.y0) / 2) < 0.03 &&
          Math.abs(shape.halfExtents.z - (w.z1 - w.z0) / 2) < 0.03;
      }));
      const THREE = QA.MP.THREE;
      const shotY = castle.floorY + 1.5;
      const gateRay = S.rayHit(
        new THREE.Vector3(castle.center.x, shotY, f.z1 + 3),
        new THREE.Vector3(0, 0, -1),
        7,
      );
      const wallRay = S.rayHit(
        new THREE.Vector3(castle.center.x + 8, shotY, f.z1 + 3),
        new THREE.Vector3(0, 0, -1),
        7,
      );
      const keepRay = S.rayHit(
        new THREE.Vector3(castle.center.x + 2.5, shotY, castle.center.z),
        new THREE.Vector3(0, 0, -1),
        8,
      );
      // Os pilares visuais do portão avançam quase 1 m além do pano frontal.
      // Um tiro curto nessa faixa precisa encontrar um collider próprio, sem
      // fechar o vão central por onde passa o jogador/Colosso.
      const gatePierRay = S.rayHit(
        new THREE.Vector3(castle.center.x + 3.2, shotY, f.z1 + 0.1),
        new THREE.Vector3(0, 0, -1),
        1.4,
      );
      const oldShrine = new THREE.Vector3(
        castle.center.x + 2.4,
        castle.floorY,
        castle.center.z + 2.4,
      );
      const beforeShrine = oldShrine.clone();
      S.collide(oldShrine, 0.45, 1.8);

      return {
        wallCount: castle.walls.length,
        wallsFinite: castle.walls.every(finiteBox),
        wallsMarked: castle.walls.every(w => w.castle === true),
        wallsGlobal: castle.walls.every(w => S.walls.includes(w)),
        wallRoles: {
          foundation: has(castle.walls, /foundation|funda[cç][aã]o/),
          walls: has(castle.walls, /muralha|castle.?wall/),
          frontTowers: has(castle.walls, /front.?tower|torre.?frontal/),
          gatePiers: has(castle.walls, /gate.?pier|pilar.?port[aã]o/),
          keep: has(castle.walls, /keep|torre[aã]o/),
        },
        gateBlockers: gateBlockers.map(label),
        ramp: ramp && {
          global: G.platforms.includes(ramp),
          marked: ramp.castle === true,
          axis: ramp.axis,
          width: ramp.x1 - ramp.x0,
          centeredX: (ramp.x0 + ramp.x1) / 2 - castle.center.x,
          outerZ: Math.max(ramp.z0, ramp.z1) - castle.center.z,
          reachesOutside: Math.max(ramp.z0, ramp.z1) >= f.z1 - 0.05,
          finiteY: Number.isFinite(ramp.y0) && Number.isFinite(ramp.y1),
        },
        platformChecks,
        roof,
        legacyWalls: legacyWalls.length,
        bodyCount: bodies.length,
        eligibleWallCount: eligibleWalls.length,
        unbackedWalls: unbackedWalls.length,
        bodiesRigid: bodies.every(b => b.userData.category === 'rigid' &&
          b.userData.hardForVehicle === true),
        rays: {
          gateOpen: gateRay === Infinity,
          gatePierBlocked: Number.isFinite(gatePierRay),
          wallBlocked: Number.isFinite(wallRay),
          keepBlocked: Number.isFinite(keepRay),
        },
        oldShrineDisplacement: oldShrine.distanceTo(beforeShrine),
      };
    });

    assert.ok(r, 'Structures.castle não existe');
    assert.ok(r.wallCount >= 8, `poucos colliders do castelo (${r.wallCount})`);
    assert.ok(r.wallsFinite && r.wallsMarked && r.wallsGlobal,
      'walls do castelo inválidos, sem castle:true ou fora de Structures.walls');
    for (const [role, present] of Object.entries(r.wallRoles))
      assert.ok(present, `collider sem papel semântico: ${role}`);
    assert.deepEqual(r.gateBlockers, [],
      `gate de 3,2m bloqueado em altura jogável: ${r.gateBlockers.join(', ')}`);
    assert.ok(r.ramp, 'rampa de entrada ausente');
    assert.ok(r.ramp.global && r.ramp.marked, 'rampa não publicada/tagueada');
    assert.equal(r.ramp.axis, 'z', 'rampa deve apontar em +Z');
    assert.ok(r.ramp.width >= 3.2 && r.ramp.width <= 4.0,
      `largura da rampa fora de 3,2–4,0m (${r.ramp.width})`);
    assert.ok(Math.abs(r.ramp.centeredX) <= 0.05, 'rampa desalinhada do gate');
    assert.ok(r.ramp.outerZ <= 26.5 + 0.05 && r.ramp.reachesOutside && r.ramp.finiteY,
      `extremidade/altura da rampa inválida: ${JSON.stringify(r.ramp)}`);

    for (const [part, check] of Object.entries(r.platformChecks)) {
      assert.ok(check, `plataforma '${part}' ausente`);
      assert.ok(check.global && check.finite, `plataforma '${part}' não publicada/finita`);
      assert.ok(check.delta <= 0.05,
        `groundAt não consulta '${part}' (delta=${check.delta})`);
    }
    assert.ok(r.roof && r.roof.global && r.roof.marked,
      'roof do keep ausente de fieldRoofs ou sem castle:true');
    assert.ok(r.roof.covered.covered, 'keep não oferece cobertura de chuva');
    assert.equal(r.legacyWalls, 0, `${r.legacyWalls} colliders fantasmas do forte legado`);
    assert.equal(r.bodyCount, r.eligibleWallCount,
      'quantidade de corpos Cannon não acompanha os walls síncronos');
    assert.equal(r.unbackedWalls, 0, `${r.unbackedWalls} walls sem corpo Cannon correspondente`);
    assert.ok(r.bodiesRigid, 'corpos Cannon do castelo sem metadados rígidos');
    assert.deepEqual(r.rays, {
      gateOpen: true,
      gatePierBlocked: true,
      wallBlocked: true,
      keepBlocked: true,
    },
      `bala/LOS não coincide com gate, muralha e keep: ${JSON.stringify(r.rays)}`);
    assert.ok(r.oldShrineDisplacement < 1e-6,
      `colisor fantasma do santuário antigo moveu o player ${r.oldShrineDisplacement}m`);
  });

  it('mantém piso contínuo entre o pátio e o início da rampa', async () => {
    const r = await h.play(() => {
      const G = window.QA.G, castle = G.Structures.castle;
      const courtyard = castle.platforms.find(p => p.part === 'courtyard');
      const ramp = castle.platforms.find(p => p.part === 'gate-ramp');
      const threshold = castle.platforms.find(p => p.part === 'gate-threshold');
      if (!courtyard || !ramp || !threshold)
        return { courtyard: !!courtyard, ramp: !!ramp, threshold: !!threshold };

      let maxError = 0;
      for (let z = courtyard.z1; z <= ramp.z0; z += 0.05) {
        const actual = G.groundAt(castle.center.x, z, castle.floorY + 0.1);
        maxError = Math.max(maxError, Math.abs(actual - castle.floorY));
      }
      castle.foundationRoot.updateMatrixWorld(true);
      const THREE = window.QA.MP.THREE;
      const ray = new THREE.Raycaster(
        new THREE.Vector3(
          castle.center.x,
          castle.floorY + 2,
          (threshold.z0 + threshold.z1) / 2,
        ),
        new THREE.Vector3(0, -1, 0),
        0,
        4,
      );
      const visualHit = ray.intersectObject(castle.foundationRoot, true)[0];
      return {
        courtyard: true,
        ramp: true,
        threshold: true,
        startsAtCourtyard: threshold.z0 <= courtyard.z1 + 0.01,
        reachesRamp: threshold.z1 >= ramp.z0 - 0.01,
        alignedY: Math.abs(threshold.y - castle.floorY),
        maxError,
        visualPart: visualHit && visualHit.object.name,
        visualError: visualHit ? Math.abs(visualHit.point.y - castle.floorY) : Infinity,
      };
    });

    assert.ok(r.courtyard && r.ramp, 'pátio/rampa ausente');
    assert.equal(r.threshold, true, 'plataforma de soleira entre pátio e rampa ausente');
    assert.ok(r.startsAtCourtyard && r.reachesRamp,
      'soleira não cobre todo o vão físico entre pátio e rampa');
    assert.ok(r.alignedY <= 1e-6 && r.maxError <= 0.02,
      `solo descontínuo no gate (alinhamento=${r.alignedY}, erro=${r.maxError})`);
    assert.match(r.visualPart || '', /GateThreshold/,
      'soleira visual não permanece no foundationRoot quando o GLB fica ready');
    assert.ok(r.visualError <= 0.01,
      `soleira visual diverge do piso em ${r.visualError}m`);
  });

  it('vegetação instanciada e obstáculos ficam fora da fundação e da rampa', async () => {
    const r = await h.play(() => {
      const QA = window.QA, G = QA.G, castle = G.Structures.castle;
      if (!castle) return null;

      QA.reset(castle.center.x, castle.center.z);
      QA.tick(30); // atualiza LOD de árvores e traz os chunks locais.
      QA.MP.scene.updateMatrixWorld(true);

      const THREE = QA.MP.THREE;
      const matrix = new THREE.Matrix4();
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      let insideInstances = 0;
      const visibleInstances = [];
      QA.MP.scene.traverse(obj => {
        if (!obj.isInstancedMesh || !obj.visible || obj.material === G.Grass.material) return;
        for (let owner = obj; owner; owner = owner.parent) {
          if (owner === castle.foundationRoot || owner === castle.fallbackRoot ||
              owner === castle.modelRoot) return;
        }
        for (let i = 0; i < obj.count; i++) {
          obj.getMatrixAt(i, matrix);
          matrix.premultiply(obj.matrixWorld);
          matrix.decompose(pos, quat, scale);
          if (!castle.excludesDecoration(pos.x, pos.z)) continue;
          insideInstances++;
          const visible = pos.y > -50 &&
            Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)) > 0.001;
          if (visible && visibleInstances.length < 12)
            visibleInstances.push({
              x: +pos.x.toFixed(2), y: +pos.y.toFixed(2), z: +pos.z.toFixed(2),
              sy: +scale.y.toFixed(4),
              vertices: obj.geometry.attributes.position.count,
            });
        }
      });

      const seen = new Set(), obstacles = [];
      for (let x = castle.center.x - castle.clearRadius;
        x <= castle.center.x + castle.clearRadius; x += 8)
        for (let z = castle.center.z - castle.clearRadius;
          z <= castle.center.z + castle.clearRadius; z += 8)
          for (const o of G.obstaclesNear(x, z)) {
            const key = `${o.sourceId}|${o.x}|${o.z}`;
            if (seen.has(key)) continue;
            seen.add(key);
            if (castle.excludesDecoration(o.x, o.z) &&
                (o.category === 'rigid' || /tree|rock|cactus/.test(o.sourceId || '')))
              obstacles.push(o);
          }

      const cannonDecoration = QA.MP.world.bodies.filter(b => {
        const id = b.userData && b.userData.sourceId || '';
        return /^(tree|rock|cactus)/.test(id) &&
          castle.excludesDecoration(b.position.x, b.position.z);
      });
      return {
        centerExcluded: castle.excludesDecoration(castle.center.x, castle.center.z),
        insideInstances,
        visibleInstances,
        obstacles: obstacles.map(o => o.sourceId || o.category),
        cannonDecoration: cannonDecoration.map(b => b.userData.sourceId),
      };
    });

    assert.ok(r, 'Structures.castle não existe');
    assert.ok(r.centerExcluded, 'excludesDecoration não cobre a fundação');
    assert.ok(r.insideInstances > 0,
      'pré-condição vazia: nenhuma instância preservada dentro da clareira');
    assert.deepEqual(r.visibleInstances, [],
      `decoração visível atravessa o castelo: ${JSON.stringify(r.visibleInstances)}`);
    assert.deepEqual(r.obstacles, [],
      `obstáculos de vegetação na implantação: ${r.obstacles.join(', ')}`);
    assert.deepEqual(r.cannonDecoration, [],
      `corpos Cannon de vegetação na implantação: ${r.cannonDecoration.join(', ')}`);
  });

  it('grama fica colapsada em toda a fundação e rampa', async () => {
    const r = await h.play(() => {
      const QA = window.QA, G = QA.G, castle = G.Structures.castle;
      if (!castle) return null;
      QA.reset(castle.center.x, castle.center.z);
      QA.tick(30);
      // Prova também que um refill futuro conserva a clareira.
      G.Grass.refreshAll();

      const f = castle.footprint;
      const ramp = castle.platforms.find(p => p.ramp);
      const size = QA.MP.CFG.GRASS_CHUNK_SIZE;
      const minX = Math.min(f.x0, ramp ? ramp.x0 : f.x0);
      const maxX = Math.max(f.x1, ramp ? ramp.x1 : f.x1);
      const minZ = Math.min(f.z0, ramp ? ramp.z0 : f.z0);
      const maxZ = Math.max(f.z1, ramp ? ramp.z1 : f.z1);
      const minCx = Math.floor((minX - size / 2) / size);
      const maxCx = Math.ceil((maxX + size / 2) / size);
      const minCz = Math.floor((minZ - size / 2) / size);
      const maxCz = Math.ceil((maxZ + size / 2) / size);

      const unique = new Map();
      let sampledChunks = 0;
      for (let cx = minCx; cx <= maxCx; cx++)
        for (let cz = minCz; cz <= maxCz; cz++) {
          const chunk = G.Grass.debugSample(cx * size, cz * size, 100000);
          if (!chunk) continue;
          sampledChunks++;
          for (const blade of chunk) {
          if (!castle.excludesDecoration(blade.x, blade.z)) continue;
          unique.set(`${blade.x.toFixed(4)}|${blade.z.toFixed(4)}`, blade);
        }
        }
      const blades = [...unique.values()];
      return {
        sampledChunks,
        expectedChunks: (maxCx - minCx + 1) * (maxCz - minCz + 1),
        sampled: blades.length,
        tall: blades.filter(b => b.sy > 0.001)
          .slice(0, 12)
          .map(b => ({ x: +b.x.toFixed(2), z: +b.z.toFixed(2), sy: +b.sy.toFixed(4) })),
      };
    });

    assert.ok(r, 'Structures.castle não existe');
    assert.equal(r.sampledChunks, r.expectedChunks,
      `grade de grama incompleta (${r.sampledChunks}/${r.expectedChunks} chunks)`);
    assert.ok(r.sampled >= 100,
      `pré-condição vazia: só ${r.sampled} lâminas amostradas na implantação`);
    assert.deepEqual(r.tall, [],
      `grama atravessa fundação/rampa: ${JSON.stringify(r.tall)}`);
  });

  it('preserva a assinatura RNG do mundo no seed 424242', async () => {
    const r = await h.play(() => {
      const S = window.QA.G.Structures;
      if (!S.castle) return null;
      const types = new Set(['torre', 'cabana', 'ruína']);
      return {
        fort: [S.FORT_POS.x, S.FORT_POS.z],
        sites: S.sites.filter(s => types.has(s.type)).map(s => [s.type, s.x, s.z]),
        bases: S.baseSites.map(s => [s.x, s.z]),
        cars: S.carSpots.map(s => [s.x, s.z, s.ry, s.type]),
        enemies: S.enemyCamps.map(s => [
          s.x, s.z, s.suit ? 'suit' : s.army ? 'army' : 'unknown',
          s.floorY === undefined ? null : s.floorY,
        ]),
        chests: S.chestSpots.map(s => [s.x, s.z]),
      };
    });

    assert.ok(r, 'Structures.castle não existe');
    for (const key of Object.keys(EXPECTED_RNG_424242))
      assertApproxTree(r[key], EXPECTED_RNG_424242[key], `RNG.${key}`);
  });
});
