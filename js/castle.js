/* Castelo do boss: encaixe determinístico sobre o terreno sem deformar a
   superfície canônica. O módulo publica uma descrição única de layout,
   colisores e pisos; o GLB é apenas o adapter visual assíncrono. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MODEL_URL = '/assets/models/boss-castle.v2.optimized.glb';
const FOOTPRINT_HALF = 19.18;
const COURTYARD_HALF = 18.3;
const FLOOR_LOCAL_Y = 0.16;
const BASE_CLEARANCE = 0.05;
const FOUNDATION_BURY = 0.25;
const GATE_HALF = 2.3;
const GATE_INNER_Z = 19.24;
const RAMP_OUTER_Z = 26.5;
const RAMP_HALF = 2;
const RAMP_SEGMENTS = 12;
const RAMP_EASE_FRACTION = 0.25;
export const MAX_CASTLE_RAMP_SLOPE_DEGREES = 30;
const GUARD_RADIUS = 30;
const CLEARING_RADIUS = 28;
// Maior envelope suportado: árvore-ilha normalizada a 12 m, escala máxima
// 1,6 (~16,48 m de raio horizontal) + corpo do Golem (1,5 m) na órbita de
// 30 m. Arredondar para 49 m deixa 1 m de tolerância para a copa rotacionada.
const RIGID_CLEAR_RADIUS = 49;
const SAMPLE_STEP = 0.25;

const MATERIAL_COLORS = {
  MAT_Earth_Brown: 0x563a26,
  MAT_Grass_Olive: 0x69733a,
  MAT_Stone_Warm: 0x8f806d,
  MAT_Stone_Dark: 0x4b4742,
  MAT_Stone_Light: 0xb8ad9e,
  MAT_Iron: 0x35383c,
  MAT_Wood_Oak: 0x6b4426,
  MAT_Heraldic_Blue: 0x244c7a,
  MAT_Heraldic_White: 0xece8dc,
  MAT_Flag_Red: 0xa92f2f,
};

function finite(value, label) {
  if (!Number.isFinite(value)) throw new Error(`Castelo: ${label} não é finito`);
  return value;
}

function sampleRect(heightAt, cx, cz, halfX, halfZ, step = SAMPLE_STEP) {
  const nx = Math.max(1, Math.ceil(halfX * 2 / step));
  const nz = Math.max(1, Math.ceil(halfZ * 2 / step));
  let min = Infinity, max = -Infinity;
  for (let ix = 0; ix <= nx; ix++) {
    const x = cx - halfX + halfX * 2 * ix / nx;
    for (let iz = 0; iz <= nz; iz++) {
      const z = cz - halfZ + halfZ * 2 * iz / nz;
      const y = finite(heightAt(x, z), `heightAt(${x}, ${z})`);
      min = Math.min(min, y);
      max = Math.max(max, y);
    }
  }
  return { min, max };
}

// Perfil C1: a inclinação cresce linearmente, fica constante e volta a zero.
// A fração de 25% dá 1,8 m de transição em cada ponta da rampa de 7,26 m,
// suficiente para o entre-eixos atravessar a emenda sem ser lançado.
function rampProgress(value) {
  const t = Math.max(0, Math.min(1, value));
  const ease = RAMP_EASE_FRACTION;
  const scale = 1 - ease;
  if (t < ease) return t * t / (2 * ease * scale);
  if (t > 1 - ease) {
    const remaining = 1 - t;
    return 1 - remaining * remaining / (2 * ease * scale);
  }
  return (t - ease / 2) / scale;
}

function rampHeight(innerY, outerY, value) {
  return innerY + (outerY - innerY) * rampProgress(value);
}

function approachHeight(heightAt, center, floorY) {
  const length = RAMP_OUTER_Z - GATE_INNER_Z;
  const outer = sampleRect(
    heightAt,
    center.x,
    center.z + RAMP_OUTER_Z,
    RAMP_HALF,
    0.25,
  );
  let y = outer.max + BASE_CLEARANCE;
  const nz = Math.ceil(length / SAMPLE_STEP);
  const nx = Math.ceil(RAMP_HALF * 2 / SAMPLE_STEP);

  /* Escolhe a altura externa mínima cuja reta até o pátio fica acima de
     todo o terreno no corredor. Não consome RNG e funciona também se a
     aproximação estiver mais alta que o castelo. */
  for (let iz = 1; iz <= nz; iz++) {
    const t = iz / nz;
    const progress = rampProgress(t);
    const z = center.z + GATE_INNER_Z + length * t;
    for (let ix = 0; ix <= nx; ix++) {
      const x = center.x - RAMP_HALF + RAMP_HALF * 2 * ix / nx;
      const terrainY = finite(heightAt(x, z), `heightAt(${x}, ${z})`) + BASE_CLEARANCE;
      y = Math.max(y, floorY + (terrainY - floorY) / progress);
    }
  }
  return y;
}

/**
 * Mede o encaixe físico antes de criar qualquer objeto Three/Cannon.
 * Structures usa a mesma função para rejeitar locais cuja aproximação
 * produziria uma rampa perigosa; createCastle a reutiliza como fonte única.
 */
export function measureCastleSite({ center, heightAt }) {
  if (!center || typeof center !== 'object') throw new Error('Castelo: center ausente');
  if (typeof heightAt !== 'function') throw new Error('Castelo: heightAt ausente');
  const cx = finite(center.x, 'center.x'), cz = finite(center.z, 'center.z');
  const measuredCenter = { x: cx, z: cz };
  const terrain = sampleRect(heightAt, cx, cz, FOOTPRINT_HALF, FOOTPRINT_HALF);
  const originY = terrain.max + BASE_CLEARANCE;
  const floorY = originY + FLOOR_LOCAL_Y;
  // Folga adicional cobre os poucos milímetros entre nossa malha de amostragem
  // uniforme e consultas que começam exatamente no limite da fundação.
  const foundationBottom = terrain.min - FOUNDATION_BURY - BASE_CLEARANCE;
  const approachY = approachHeight(heightAt, measuredCenter, floorY);
  const rampSlopeDegrees = Math.atan2(
    Math.abs(floorY - approachY),
    RAMP_OUTER_Z - GATE_INNER_Z,
  ) * 180 / Math.PI;
  const rampMaxSlopeDegrees = Math.atan(
    Math.abs(floorY - approachY) /
    (RAMP_OUTER_Z - GATE_INNER_Z) /
    (1 - RAMP_EASE_FRACTION),
  ) * 180 / Math.PI;
  return {
    center: measuredCenter,
    terrain,
    originY,
    floorY,
    foundationBottom,
    approachY,
    rampSlopeDegrees,
    rampMaxSlopeDegrees,
  };
}

function rampGeometry(innerY, outerY) {
  const zThreshold = COURTYARD_HALF, z0 = GATE_INNER_Z, z1 = RAMP_OUTER_Z;
  const x0 = -RAMP_HALF, x1 = RAMP_HALF;
  const thickness = 0.28;
  const positions = [];
  const indices = [];
  const point = (x, y, z) => [x, y, z];
  const quad = (a, b, c, d) => {
    const start = positions.length / 3;
    positions.push(...a, ...b, ...c, ...d);
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  };
  const nodes = [];
  for (let i = 0; i <= RAMP_SEGMENTS; i++) {
    const t = i / RAMP_SEGMENTS;
    nodes.push({
      z: z0 + (z1 - z0) * t,
      y: rampHeight(innerY, outerY, t),
    });
  }

  quad(
    point(x0, innerY, zThreshold), point(x0, innerY, z0),
    point(x1, innerY, z0), point(x1, innerY, zThreshold),
  );
  quad(
    point(x1, innerY - thickness, zThreshold), point(x1, innerY - thickness, z0),
    point(x0, innerY - thickness, z0), point(x0, innerY - thickness, zThreshold),
  );
  quad(
    point(x0, innerY, zThreshold), point(x0, innerY - thickness, zThreshold),
    point(x0, innerY - thickness, z0), point(x0, innerY, z0),
  );
  quad(
    point(x1, innerY, zThreshold), point(x1, innerY, z0),
    point(x1, innerY - thickness, z0), point(x1, innerY - thickness, zThreshold),
  );

  for (let i = 0; i < RAMP_SEGMENTS; i++) {
    const a = nodes[i], b = nodes[i + 1];
    quad(
      point(x0, a.y, a.z), point(x0, b.y, b.z),
      point(x1, b.y, b.z), point(x1, a.y, a.z),
    );
    quad(
      point(x1, a.y - thickness, a.z), point(x1, b.y - thickness, b.z),
      point(x0, b.y - thickness, b.z), point(x0, a.y - thickness, a.z),
    );
    quad(
      point(x0, a.y, a.z), point(x0, a.y - thickness, a.z),
      point(x0, b.y - thickness, b.z), point(x0, b.y, b.z),
    );
    quad(
      point(x1, a.y, a.z), point(x1, b.y, b.z),
      point(x1, b.y - thickness, b.z), point(x1, a.y - thickness, a.z),
    );
  }
  const last = nodes[nodes.length - 1];
  quad(
    point(x0, last.y, last.z), point(x0, last.y - thickness, last.z),
    point(x1, last.y - thickness, last.z), point(x1, last.y, last.z),
  );

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function addBox(group, material, name, x0, x1, y0, y1, z0, z1) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0),
    material,
  );
  mesh.name = name;
  mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function slopedBoxGeometry(x0, x1, z0, z1, y0, y1, axis, thickness = 0.12) {
  const top = axis === 'x'
    ? [y0, y1, y1, y0]
    : [y0, y0, y1, y1];
  const positions = new Float32Array([
    x0, top[0], z0, x1, top[1], z0, x1, top[2], z1, x0, top[3], z1,
    x0, top[0] - thickness, z0, x1, top[1] - thickness, z0,
    x1, top[2] - thickness, z1, x0, top[3] - thickness, z1,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex([
    0, 1, 2, 0, 2, 3,
    5, 4, 7, 5, 7, 6,
    4, 0, 3, 4, 3, 7,
    1, 5, 6, 1, 6, 2,
    3, 2, 6, 3, 6, 7,
    4, 5, 1, 4, 1, 0,
  ]);
  geometry.computeVertexNormals();
  return geometry;
}

function createFallbackVisual({
  center,
  originY,
  colliders,
  walkSurfaces,
  scene,
  csmMat,
  noSeed,
}) {
  const guarded = typeof noSeed === 'function' ? noSeed : fn => fn();
  return guarded(() => {
    const root = new THREE.Group();
    root.name = 'bossCastleFallbackProxy';
    root.position.set(center.x, originY, center.z);
    const wrap = csmMat || (material => material);
    const stone = wrap(new THREE.MeshStandardMaterial({
      color: MATERIAL_COLORS.MAT_Stone_Warm,
      roughness: 0.9,
      metalness: 0.01,
    }));
    const floor = wrap(new THREE.MeshStandardMaterial({
      color: MATERIAL_COLORS.MAT_Grass_Olive,
      roughness: 0.95,
      metalness: 0,
    }));

    // Cada caixa vem do mesmo descritor que alimenta colisão/LOS/Cannon.
    // A fundação já tem sua representação exata em foundationRoot.
    for (const collider of colliders) {
      if (collider.part.startsWith('foundation-')) continue;
      const mesh = addBox(
        root,
        stone,
        `castleFallbackCollider-${collider.part}`,
        collider.x0 - center.x,
        collider.x1 - center.x,
        collider.y0 - originY,
        collider.y1 - originY,
        collider.z0 - center.z,
        collider.z1 - center.z,
      );
      mesh.userData.castleVisualKind = 'collider';
      mesh.userData.castlePart = collider.part;
    }

    // Superfícies finas impedem o jogador de parecer flutuar no pátio,
    // degraus e adarves. A rampa do gate também já vive em foundationRoot.
    for (const surface of walkSurfaces) {
      if (surface.castlePart === 'gate-ramp' ||
          surface.castlePart === 'gate-threshold') continue;
      let mesh;
      if (surface.ramp) {
        mesh = new THREE.Mesh(
          slopedBoxGeometry(
            surface.x0 - center.x,
            surface.x1 - center.x,
            surface.z0 - center.z,
            surface.z1 - center.z,
            surface.y0 - originY,
            surface.y1 - originY,
            surface.axis,
          ),
          floor,
        );
        mesh.name = `castleFallbackSurface-${surface.castlePart}`;
        mesh.castShadow = mesh.receiveShadow = true;
        root.add(mesh);
      } else {
        const top = surface.y - originY;
        mesh = addBox(
          root,
          floor,
          `castleFallbackSurface-${surface.castlePart}`,
          surface.x0 - center.x,
          surface.x1 - center.x,
          top - 0.12,
          top,
          surface.z0 - center.z,
          surface.z1 - center.z,
        );
      }
      mesh.userData.castleVisualKind = 'surface';
      mesh.userData.castlePart = surface.castlePart;
    }

    scene.add(root);
    return root;
  });
}

function createFoundationVisual({ center, originY, foundationBottom, approachY, scene, csmMat, noSeed }) {
  const guarded = typeof noSeed === 'function' ? noSeed : fn => fn();
  return guarded(() => {
    const root = new THREE.Group();
    root.name = 'bossCastleFoundation';
    root.position.set(center.x, originY, center.z);
    const material = (csmMat || (m => m))(new THREE.MeshStandardMaterial({
      color: 0x6f6559,
      roughness: 0.92,
      metalness: 0.01,
    }));
    const rampMaterial = (csmMat || (m => m))(new THREE.MeshStandardMaterial({
      color: 0x827668,
      roughness: 0.9,
      metalness: 0.01,
    }));
    // Em terreno muito plano a base do próprio GLB (-1,10 m) já fica enterrada.
    // Mantém ainda assim uma saia positiva de 10 cm, nunca uma BoxGeometry invertida.
    const bottom = Math.min(foundationBottom - originY, -1.15);
    const top = -1.05; // sobrepõe 5 cm da base do GLB, que termina em -1,10
    const edge = 0.46;
    const skirtBoxes = [
      [-FOOTPRINT_HALF, -FOOTPRINT_HALF + edge, bottom, top,
        -FOOTPRINT_HALF, FOOTPRINT_HALF],
      [FOOTPRINT_HALF - edge, FOOTPRINT_HALF, bottom, top,
        -FOOTPRINT_HALF, FOOTPRINT_HALF],
      [-FOOTPRINT_HALF, FOOTPRINT_HALF, bottom, top,
        -FOOTPRINT_HALF, -FOOTPRINT_HALF + edge],
      [-FOOTPRINT_HALF, -GATE_HALF, bottom, top,
        FOOTPRINT_HALF - edge, FOOTPRINT_HALF],
      [GATE_HALF, FOOTPRINT_HALF, bottom, top,
        FOOTPRINT_HALF - edge, FOOTPRINT_HALF],
    ];
    const skirt = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      material,
      skirtBoxes.length,
    );
    skirt.name = 'castleFoundationSkirt';
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < skirtBoxes.length; i++) {
      const [x0, x1, y0, y1, z0, z1] = skirtBoxes[i];
      matrix.makeScale(x1 - x0, y1 - y0, z1 - z0);
      matrix.setPosition((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      skirt.setMatrixAt(i, matrix);
    }
    skirt.instanceMatrix.needsUpdate = true;
    skirt.castShadow = false;
    skirt.receiveShadow = true;
    root.add(skirt);

    const ramp = new THREE.Mesh(
      rampGeometry(FLOOR_LOCAL_Y, approachY - originY),
      rampMaterial,
    );
    // Uma única geometria cobre a soleira plana (18,30..19,24) e a rampa,
    // economizando um draw call sem deixar o trecho plano semanticamente
    // invisível para inspeções/testes.
    ramp.name = 'bossCastleGateThresholdAndRamp';
    ramp.userData.castleParts = ['gate-threshold', 'gate-ramp'];
    ramp.castShadow = false;
    ramp.receiveShadow = true;
    root.add(ramp);
    scene.add(root);
    return root;
  });
}

export function validateCastleModel(root, metadata = {}) {
  if (!root || !root.isObject3D) throw new Error('Castelo: GLB sem cena');
  const extensionsUsed = Array.isArray(metadata.extensionsUsed)
    ? metadata.extensionsUsed
    : [];
  const extensionsRequired = Array.isArray(metadata.extensionsRequired)
    ? metadata.extensionsRequired
    : [];
  const extensions = new Set([...extensionsUsed, ...extensionsRequired]);
  for (const extension of extensions) {
    if (extension !== 'KHR_mesh_quantization')
      throw new Error(`Castelo: extensão GLB não permitida (${extension})`);
  }
  if (!extensionsUsed.includes('KHR_mesh_quantization') ||
      !extensionsRequired.includes('KHR_mesh_quantization')) {
    throw new Error('Castelo: extensão obrigatória KHR_mesh_quantization ausente');
  }

  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  if (bounds.isEmpty()) throw new Error('Castelo: GLB sem geometria');
  for (const value of [...bounds.min.toArray(), ...bounds.max.toArray()])
    finite(value, 'limite do GLB');

  const near = (got, expected) => Math.abs(got - expected) <= 0.02;
  if (!near(bounds.min.x, -19.18) || !near(bounds.max.x, 19.18) ||
      !near(bounds.min.y, -1.1) || !near(bounds.max.y, 19) ||
      !near(bounds.min.z, -19) || !near(bounds.max.z, 19.19084)) {
    throw new Error(
      `Castelo: bounds inesperados ${bounds.min.toArray().map(v => v.toFixed(2))}` +
      `..${bounds.max.toArray().map(v => v.toFixed(2))}`,
    );
  }

  let meshes = 0, triangles = 0;
  const materials = new Set();
  const materialsByName = new Map();
  root.traverse(obj => {
    if (!obj.isMesh) return;
    meshes++;
    const position = obj.geometry && obj.geometry.attributes.position;
    if (!position) throw new Error(`Castelo: mesh ${obj.name || '(sem nome)'} sem POSITION`);
    triangles += obj.geometry.index ? obj.geometry.index.count / 3 : position.count / 3;
    const meshMaterials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const material of meshMaterials) {
      if (!material) continue;
      materials.add(material);
      const expectedHex = MATERIAL_COLORS[material.name];
      if (expectedHex === undefined)
        throw new Error(`Castelo: material inesperado (${material.name || 'sem nome'})`);
      const previous = materialsByName.get(material.name);
      if (previous && previous !== material)
        throw new Error(`Castelo: material duplicado (${material.name})`);
      materialsByName.set(material.name, material);
      if (!material.color)
        throw new Error(`Castelo: material ${material.name} sem cor`);
      const expected = new THREE.Color(expectedHex);
      const colorDelta = Math.max(
        Math.abs(material.color.r - expected.r),
        Math.abs(material.color.g - expected.g),
        Math.abs(material.color.b - expected.b),
      );
      if (colorDelta > 0.001)
        throw new Error(`Castelo: cor inesperada no material ${material.name}`);
    }
  });
  if (!meshes) throw new Error('Castelo: GLB sem meshes');
  if (meshes > 14) throw new Error(`Castelo: GLB não otimizado (${meshes} meshes)`);
  if (triangles > 25000)
    throw new Error(`Castelo: GLB excede 25k triângulos (${Math.ceil(triangles)})`);
  if (materials.size !== Object.keys(MATERIAL_COLORS).length)
    throw new Error(`Castelo: materiais inesperados (${materials.size})`);
  for (const name of Object.keys(MATERIAL_COLORS)) {
    if (!materialsByName.has(name))
      throw new Error(`Castelo: material obrigatório ausente (${name})`);
  }
  return {
    bounds,
    meshes,
    materials: materials.size,
    triangles: Math.ceil(triangles),
  };
}

function disposeObject3Ds(roots, releaseMaterial) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  for (const root of roots) {
    if (!root || typeof root.traverse !== 'function') continue;
    root.traverse(obj => {
      if (obj.geometry && typeof obj.geometry.dispose === 'function')
        geometries.add(obj.geometry);
      const objectMaterials = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const material of objectMaterials) {
        if (!material || typeof material.dispose !== 'function') continue;
        materials.add(material);
        for (const value of Object.values(material)) {
          if (value && value.isTexture && typeof value.dispose === 'function')
            textures.add(value);
        }
      }
    });
  }
  for (const texture of textures) texture.dispose();
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) {
    if (releaseMaterial) releaseMaterial(material);
    material.dispose();
  }
}

function disposeObject3D(root, releaseMaterial) {
  disposeObject3Ds([root], releaseMaterial);
}

function prepareModel(root, csmMat) {
  const preparedMaterials = new Set();
  root.traverse(obj => {
    if (/^RB_GateDoor_(Left|Right)$/.test(obj.name)) obj.visible = false;
    if (!obj.isMesh) return;
    obj.castShadow = obj.receiveShadow = true;
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const material of materials) {
      if (!material || preparedMaterials.has(material)) continue;
      preparedMaterials.add(material);
      if (material.color && MATERIAL_COLORS[material.name] !== undefined &&
          !material.map && material.color.getHex() === 0xffffff) {
        material.color.setHex(MATERIAL_COLORS[material.name]);
      }
      material.side = /flag|heraldic/i.test(material.name || '')
        ? THREE.DoubleSide
        : THREE.FrontSide;
      material.needsUpdate = true;
      if (csmMat) csmMat(material);
    }
  });
}

export function createCastle({
  center,
  heightAt,
  scene,
  csmMat,
  noSeed,
  modelUrl = MODEL_URL,
  legacyRoot = null,
  legacyFlags = [],
  legacyFlames = [],
  walls,
  platforms,
  fieldRoofs,
}) {
  const placement = measureCastleSite({ center, heightAt });
  const { center: castleCenter, terrain, originY, floorY, foundationBottom,
    approachY, rampSlopeDegrees, rampMaxSlopeDegrees } = placement;
  const { x: cx, z: cz } = castleCenter;
  if (!scene || typeof scene.add !== 'function') throw new Error('Castelo: scene inválida');
  if (!Array.isArray(walls) || !Array.isArray(platforms) || !Array.isArray(fieldRoofs))
    throw new Error('Castelo: walls/platforms/fieldRoofs devem ser arrays');
  const releaseMaterial = csmMat && typeof csmMat.unregister === 'function'
    ? material => csmMat.unregister(material)
    : null;

  const colliders = [], walkSurfaces = [], roofs = [];

  const wall = (part, x0, x1, y0, y1, z0, z1, extra = {}) => {
    const collider = {
      x0: cx + x0, x1: cx + x1,
      y0: originY + y0, y1: originY + y1,
      z0: cz + z0, z1: cz + z1,
      castle: true,
      part,
      castlePart: part,
      kind: 'castle-wall',
      sourceId: 'castle-wall',
      ...extra,
    };
    for (const key of ['x0', 'x1', 'y0', 'y1', 'z0', 'z1'])
      finite(collider[key], `${part}.${key}`);
    walls.push(collider);
    colliders.push(collider);
    return collider;
  };
  const surface = descriptor => {
    const p = {
      ...descriptor,
      part: descriptor.part || descriptor.castlePart,
      castle: true,
    };
    platforms.push(p);
    walkSurfaces.push(p);
    return p;
  };
  const roof = descriptor => {
    const r = {
      ...descriptor,
      part: descriptor.part || descriptor.castlePart,
      castle: true,
    };
    fieldRoofs.push(r);
    roofs.push(r);
    return r;
  };

  /* Contenção segmentada: o vão ±2,30 m nunca pertence a um AABB cheio. */
  const bottomLocal = foundationBottom - originY;
  const edge0 = FOOTPRINT_HALF - 0.46;
  wall('foundation-left', -FOOTPRINT_HALF, -edge0, bottomLocal, FLOOR_LOCAL_Y,
    -FOOTPRINT_HALF, FOOTPRINT_HALF);
  wall('foundation-right', edge0, FOOTPRINT_HALF, bottomLocal, FLOOR_LOCAL_Y,
    -FOOTPRINT_HALF, FOOTPRINT_HALF);
  wall('foundation-back', -FOOTPRINT_HALF, FOOTPRINT_HALF, bottomLocal, FLOOR_LOCAL_Y,
    -FOOTPRINT_HALF, -edge0);
  wall('foundation-front-left', -FOOTPRINT_HALF, -GATE_HALF, bottomLocal, FLOOR_LOCAL_Y,
    edge0, FOOTPRINT_HALF);
  wall('foundation-front-right', GATE_HALF, FOOTPRINT_HALF, bottomLocal, FLOOR_LOCAL_Y,
    edge0, FOOTPRINT_HALF);

  // Muralha externa e duas torres frontais.
  wall('wall-left', -17.45, -16.55, 0, 7.1, -17.45, 17.45);
  wall('wall-right', 16.55, 17.45, 0, 7.1, -17.45, 17.45);
  wall('wall-back', -17.45, 17.45, 0, 7.1, -17.45, -16.55);
  wall('wall-front-left', -17.45, -2.3, 0, 7.1, 16.55, 17.45);
  wall('wall-front-right', 2.3, 17.45, 0, 7.1, 16.55, 17.45);
  // A malha tem pilares que avançam até z=18,40. Sem estes AABBs, o pano
  // frontal terminava 0,95 m antes do visual e aceitava tiros/corpos dentro
  // da pedra. O vão central ±2,30 m permanece rigorosamente aberto.
  wall('gate-pier-left', -4.1, -2.3, 0, 8.5, 16.3, 18.4, {
    role: 'gate-pier',
  });
  wall('gate-pier-right', 2.3, 4.1, 0, 8.5, 16.3, 18.4, {
    role: 'gate-pier',
  });
  wall('gate-bridge', -2.3, 2.3, 7, 8.5, 16.3, 18.4);
  wall('front-tower-left', -19, -13, 0, 9.78, 13, 19, {
    role: 'front-tower',
  });
  wall('front-tower-right', 13, 19, 0, 9.78, 13, 19, {
    role: 'front-tower',
  });

  // Keep com vãos reais de porta e janela.
  wall('keep-left', -5, -4.1, 0, 14, -15, -5);
  wall('keep-right', 4.1, 5, 0, 14, -15, -5);
  wall('keep-back', -5, 5, 0, 14, -15.35, -14.45);
  wall('keep-front-sill', -5, 5, 0, 1.2, -5.55, -4.65);
  wall('keep-front-door-left', -5, -1.2, 1.2, 4.4, -5.55, -4.65);
  wall('keep-front-door-right', 1.2, 5, 1.2, 4.4, -5.55, -4.65);
  wall('keep-front-mid', -5, 5, 4.4, 5.8, -5.55, -4.65);
  wall('keep-front-window-left', -5, -0.8, 5.8, 8.4, -5.55, -4.65);
  wall('keep-front-window-right', 0.8, 5, 5.8, 8.4, -5.55, -4.65);
  wall('keep-front-top', -5, 5, 8, 14, -5.55, -4.65);
  wall('keep-roof', -5.2, 5.2, 13.89, 14.31, -15.2, -4.8, { noCollide: true });

  surface({
    x0: cx - COURTYARD_HALF, x1: cx + COURTYARD_HALF,
    z0: cz - COURTYARD_HALF, z1: cz + COURTYARD_HALF,
    y: floorY, castlePart: 'courtyard',
  });
  surface({
    x0: cx - RAMP_HALF, x1: cx + RAMP_HALF,
    z0: cz + COURTYARD_HALF, z1: cz + GATE_INNER_Z,
    y: floorY, castlePart: 'gate-threshold',
  });
  const entryRamp = {
    x0: cx - RAMP_HALF, x1: cx + RAMP_HALF,
    z0: cz + GATE_INNER_Z, z1: cz + RAMP_OUTER_Z,
    y0: floorY, y1: approachY,
    width: RAMP_HALF * 2,
    length: RAMP_OUTER_Z - GATE_INNER_Z,
    slopeDegrees: rampSlopeDegrees,
    maxSlopeDegrees: rampMaxSlopeDegrees,
    heightAt(z) {
      return rampHeight(floorY, approachY,
        (z - (cz + GATE_INNER_Z)) / (RAMP_OUTER_Z - GATE_INNER_Z));
    },
  };
  entryRamp.segments = Array.from({ length: RAMP_SEGMENTS }, (_, i) => {
    const t0 = i / RAMP_SEGMENTS, t1 = (i + 1) / RAMP_SEGMENTS;
    return {
      z0: entryRamp.z0 + entryRamp.length * t0,
      z1: entryRamp.z0 + entryRamp.length * t1,
      y0: rampHeight(floorY, approachY, t0),
      y1: rampHeight(floorY, approachY, t1),
    };
  });
  surface({
    ramp: true, axis: 'z',
    ...entryRamp,
    castlePart: 'gate-ramp',
  });
  surface({
    x0: cx - 4.55, x1: cx + 4.55,
    z0: cz - 14.55, z1: cz - 5.45,
    y: originY + 0.36, castlePart: 'keep-floor',
  });
  for (let i = 0; i < 7; i++) {
    const z = -2.65 - i * 0.3;
    surface({
      x0: cx - 1.5, x1: cx + 1.5,
      z0: cz + z - 0.19, z1: cz + z + 0.19,
      y: originY + 0.18 * (i + 1), castlePart: `keep-step-${i}`,
    });
  }
  surface({
    x0: cx - 16.55, x1: cx - 15.15, z0: cz - 15.9, z1: cz + 15.9,
    y: originY + 6.96, castlePart: 'wall-walk-left',
  });
  surface({
    x0: cx + 15.15, x1: cx + 16.55, z0: cz - 15.9, z1: cz + 15.9,
    y: originY + 6.96, castlePart: 'wall-walk-right',
  });
  surface({
    x0: cx - 15.9, x1: cx + 15.9, z0: cz - 16.55, z1: cz - 15.15,
    y: originY + 6.96, castlePart: 'wall-walk-back',
  });
  surface({
    x0: cx - 16.1, x1: cx - 2.3, z0: cz + 15.15, z1: cz + 16.55,
    y: originY + 6.96, castlePart: 'wall-walk-front-left',
  });
  surface({
    x0: cx + 2.3, x1: cx + 16.1, z0: cz + 15.15, z1: cz + 16.55,
    y: originY + 6.96, castlePart: 'wall-walk-front-right',
  });
  surface({
    ramp: true, axis: 'z',
    x0: cx - 15.35, x1: cx - 13.75,
    z0: cz - 2.68, z1: cz + 7.16,
    y0: originY + 6.65, y1: originY + 0.19,
    castlePart: 'wall-stair',
  });
  surface({
    x0: cx - 16.65, x1: cx - 13.75, z0: cz - 3.78, z1: cz - 2.78,
    y: originY + 6.86, castlePart: 'wall-stair-landing',
  });
  surface({
    x0: cx - 5.2, x1: cx + 5.2, z0: cz - 15.2, z1: cz - 4.8,
    y: originY + 14.31, castlePart: 'keep-roof',
  });
  surface({
    x0: cx - 19, x1: cx - 13, z0: cz + 13, z1: cz + 19,
    y: originY + 9.78, castlePart: 'tower-front-left-top',
  });
  surface({
    x0: cx + 13, x1: cx + 19, z0: cz + 13, z1: cz + 19,
    y: originY + 9.78, castlePart: 'tower-front-right-top',
  });

  roof({
    x0: cx - 5.2, x1: cx + 5.2, z0: cz - 15.2, z1: cz - 4.8,
    roofY: originY + 14.31, castlePart: 'keep-roof',
  });
  roof({
    x0: cx - 2.3, x1: cx + 2.3, z0: cz + 16.3, z1: cz + 18.4,
    roofY: originY + 8.5, castlePart: 'gate-bridge',
  });

  const foundationRoot = createFoundationVisual({
    center: castleCenter,
    originY,
    foundationBottom,
    approachY,
    scene,
    csmMat,
    noSeed,
  });

  const ramp = entryRamp;
  const vehicleSurfaces = [
    {
      kind: 'box', castlePart: 'courtyard',
      x0: cx - COURTYARD_HALF, x1: cx + COURTYARD_HALF,
      z0: cz - COURTYARD_HALF, z1: cz + COURTYARD_HALF,
      topY: floorY, thickness: 0.3,
    },
    {
      kind: 'box', castlePart: 'gate-threshold',
      x0: cx - RAMP_HALF, x1: cx + RAMP_HALF,
      z0: cz + COURTYARD_HALF, z1: cz + GATE_INNER_Z,
      topY: floorY, thickness: 0.28,
    },
    { kind: 'ramp', castlePart: 'gate-ramp', ...ramp, thickness: 0.28 },
  ];

  const fallbackRoot = createFallbackVisual({
    center: castleCenter,
    originY,
    colliders,
    walkSurfaces,
    scene,
    csmMat,
    noSeed,
  });
  const groundAt = (x, z, currentY = Infinity) => {
    let ground = heightAt(x, z);
    for (const p of walkSurfaces) {
      if (x < p.x0 || x > p.x1 || z < p.z0 || z > p.z1) continue;
      let top = p.y;
      if (p.ramp) {
        if (typeof p.heightAt === 'function') top = p.heightAt(z);
        else {
          const k = p.axis === 'x'
            ? (x - p.x0) / (p.x1 - p.x0)
            : (z - p.z0) / (p.z1 - p.z0);
          top = p.y0 + (p.y1 - p.y0) * Math.max(0, Math.min(1, k));
        }
      }
      if (top > ground && top <= currentY + 0.65) ground = top;
    }
    return ground;
  };

  let status = 'loading', modelRoot = null, loadError = null, modelMetrics = null;
  let disposed = false;
  let physicsWorld = null;
  const physicsBodies = [];
  const cleanupCallbacks = [];
  const legacyEffects = [...new Set([...legacyFlags, ...legacyFlames].filter(Boolean))];
  const removeOwned = (registry, owned) => {
    const set = new Set(owned);
    for (let i = registry.length - 1; i >= 0; i--)
      if (set.has(registry[i])) registry.splice(i, 1);
  };
  const setFallbackVisible = visible => {
    fallbackRoot.visible = visible;
  };
  const setLegacyVisible = visible => {
    if (legacyRoot) legacyRoot.visible = visible;
    for (const obj of legacyFlags) if (obj) obj.visible = visible;
    for (const obj of legacyFlames) if (obj) obj.visible = visible;
  };
  setLegacyVisible(false);
  setFallbackVisible(true);

  const loader = new GLTFLoader();
  const ready = loader.loadAsync(modelUrl).then(gltf => {
    const root = gltf.scene;
    if (disposed) {
      disposeObject3D(root, releaseMaterial);
      return null;
    }
    try {
      modelMetrics = validateCastleModel(root, gltf.parser && gltf.parser.json);
      prepareModel(root, csmMat);
      root.name = 'bossCastle';
      root.position.set(cx, originY, cz); // escala e rotação autorais permanecem intactas
      root.visible = false;
      scene.add(root);
      root.updateMatrixWorld(true);

      // Swap atômico: o fallback só some depois de validar e anexar o GLB.
      root.visible = true;
      setFallbackVisible(false);
      modelRoot = root;
      status = 'ready';
      return root;
    } catch (error) {
      scene.remove(root);
      disposeObject3D(root, releaseMaterial);
      throw error;
    }
  }).catch(error => {
    if (disposed) return null;
    loadError = error;
    status = 'fallback';
    setFallbackVisible(true);
    console.warn(`[Castelo] ${modelUrl} indisponível/inválido; mantendo fallback:`, error);
    return null;
  });

  return {
    url: modelUrl,
    center: castleCenter,
    originY,
    floorY,
    foundationBottom,
    terrainMin: terrain.min,
    terrainMax: terrain.max,
    footprintHalf: FOOTPRINT_HALF,
    footprint: {
      x0: cx - FOOTPRINT_HALF,
      x1: cx + FOOTPRINT_HALF,
      z0: cz - FOOTPRINT_HALF,
      z1: cz + FOOTPRINT_HALF,
    },
    guardRadius: GUARD_RADIUS,
    clearRadius: CLEARING_RADIUS,
    rigidClearRadius: RIGID_CLEAR_RADIUS,
    clearing: { x: cx, z: cz, r: CLEARING_RADIUS },
    gate: {
      halfWidth: GATE_HALF,
      innerZ: cz + GATE_INNER_Z,
      outerZ: cz + RAMP_OUTER_Z,
    },
    ramp,
    walls: colliders,
    colliders,
    platforms: walkSurfaces,
    roofs,
    vehicleSurfaces,
    fallbackRoot,
    legacyRoot,
    foundationRoot,
    excludesDecoration(x, z) {
      const localX = x - cx, localZ = z - cz;
      const inClearing = Math.hypot(localX, localZ) <= CLEARING_RADIUS;
      const inRamp = Math.abs(localX) <= RAMP_HALF &&
        localZ >= GATE_INNER_Z && localZ <= RAMP_OUTER_Z;
      return inClearing || inRamp;
    },
    excludesGuardRoute(x, z) {
      return Math.hypot(x - cx, z - cz) <= RIGID_CLEAR_RADIUS;
    },
    groundAt,
    ready,
    registerPhysicsBody(world, body) {
      if (!world || !body || typeof world.removeBody !== 'function')
        throw new Error('Castelo: registro físico inválido');
      if (disposed) {
        world.removeBody(body);
        return;
      }
      if (physicsWorld && physicsWorld !== world)
        throw new Error('Castelo: corpos registrados em mundos físicos distintos');
      physicsWorld = world;
      if (!physicsBodies.includes(body)) physicsBodies.push(body);
    },
    registerCleanup(callback) {
      if (typeof callback !== 'function')
        throw new Error('Castelo: cleanup deve ser função');
      if (disposed) {
        callback();
        return;
      }
      cleanupCallbacks.push(callback);
    },
    get status() { return status; },
    get modelRoot() { return modelRoot; },
    get modelMetrics() { return modelMetrics; },
    get error() { return loadError; },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (physicsWorld) {
        for (const body of physicsBodies) physicsWorld.removeBody(body);
        physicsBodies.length = 0;
        physicsWorld = null;
      }
      removeOwned(walls, colliders);
      removeOwned(platforms, walkSurfaces);
      removeOwned(fieldRoofs, roofs);
      for (const callback of cleanupCallbacks.splice(0)) callback();
      if (modelRoot) {
        scene.remove(modelRoot);
        disposeObject3D(modelRoot, releaseMaterial);
        modelRoot = null;
      }
      if (foundationRoot) {
        scene.remove(foundationRoot);
        disposeObject3D(foundationRoot, releaseMaterial);
      }
      scene.remove(fallbackRoot);
      disposeObject3D(fallbackRoot, releaseMaterial);
      if (legacyRoot) {
        scene.remove(legacyRoot);
        disposeObject3D(legacyRoot, releaseMaterial);
      }
      for (const effect of legacyEffects) scene.remove(effect);
      disposeObject3Ds(legacyEffects, releaseMaterial);
      removeOwned(legacyFlags, legacyEffects);
      removeOwned(legacyFlames, legacyEffects);
      setFallbackVisible(false);
      setLegacyVisible(false);
      status = 'disposed';
    },
  };
}
