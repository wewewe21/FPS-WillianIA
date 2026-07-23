/* Visual da cidade importada. A colisão continua nos AABBs simples de
   Structures: é muito mais barata e previsível do que colisão por triângulo. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

const CITY_URL = './assets/models/Cenários/new_york_city.optimized.glb';

export function createCityModel({ scene, renderer, Structures, CITY, heightAt, slopeAt }) {
  const root = new THREE.Group();
  root.name = 'cidadeNovaYork';
  root.visible = false;
  root.position.set(CITY.x, heightAt(CITY.x, CITY.z) + 0.025, CITY.z);
  scene.add(root);
  const dummy = new THREE.Object3D();

  /* Dois distritos satélite, sem clonar o GLB de 24 MB. Prédios, ruas e
     marcações são instanciados (três draw calls para os dois bairros) e o
     root é independente: destruir a cidade principal não apaga o resto do mapa. */
  const satelliteRoot = new THREE.Group();
  satelliteRoot.name = 'distritosSatelite';
  scene.add(satelliteRoot);
  const training = { x: 320, z: -350, radius: 125 };
  const candidateSets = [
    [[230, 250], [300, 210], [170, 330], [350, 110]],
    [[-80, -310], [-180, -300], [-40, -420], [-260, -190]],
  ];
  const districts = [];
  const clearCandidate = ([x, z]) => {
    if (Math.hypot(x - training.x, z - training.z) < training.radius + 80) return false;
    if (Math.hypot(x - CITY.x, z - CITY.z) < 190) return false;
    if (slopeAt && Math.max(slopeAt(x, z), slopeAt(x + 25, z), slopeAt(x - 25, z), slopeAt(x, z + 25), slopeAt(x, z - 25)) > 0.72) return false;
    return Structures.sites.every(s => Math.hypot(x - s.x, z - s.z) > (s.r || 5) + 48);
  };
  for (const set of candidateSets) {
    const picked = set.find(clearCandidate) || set.reduce((best, p) => {
      const clearance = Math.min(...Structures.sites.map(s => Math.hypot(p[0] - s.x, p[1] - s.z) - (s.r || 5)));
      return !best || clearance > best.clearance ? { p, clearance } : best;
    }, null).p;
    districts.push({ x: picked[0], z: picked[1], radius: 42 });
  }

  const buildingGeo = new THREE.BoxGeometry(1, 1, 1);
  const buildingMat = new THREE.MeshStandardMaterial({ color: 0x747c86, roughness: 0.84, metalness: 0.08 });
  const buildingLayout = [
    [-21, -20, 11, 12, 12], [-7, -21, 9, 18, 10], [19, -20, 14, 10, 12],
    [-21, 19, 12, 21, 13], [2, 20, 16, 13, 11], [22, 18, 10, 16, 10],
  ];
  const buildings = new THREE.InstancedMesh(buildingGeo, buildingMat, districts.length * buildingLayout.length);
  buildings.name = 'prediosDistritosSatelite';
  buildings.castShadow = false;
  buildings.receiveShadow = true;
  const roadGeo = new THREE.BoxGeometry(1, 1, 1);
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x292d32, roughness: 0.98 });
  const roads = new THREE.InstancedMesh(roadGeo, roadMat, districts.length * 3);
  roads.name = 'ruasDistritosSatelite';
  roads.receiveShadow = true;
  const districtStripes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.18, 0.025, 3.2),
    new THREE.MeshBasicMaterial({ color: 0xd8ca83 }), districts.length * 16);
  districtStripes.name = 'faixasDistritosSatelite';
  let bi = 0, ri = 0, di = 0;
  for (const district of districts) {
    Structures.sites.push({ x: district.x, z: district.z, r: district.radius, type: 'distrito' });
    for (const [ox, oz, w, h, depth] of buildingLayout) {
      const x = district.x + ox, z = district.z + oz, ground = heightAt(x, z);
      dummy.position.set(x, ground + h / 2, z);
      dummy.rotation.set(0, 0, 0); dummy.scale.set(w, h, depth); dummy.updateMatrix();
      buildings.setMatrixAt(bi++, dummy.matrix);
      Structures.walls.push({ x0: x - w / 2, x1: x + w / 2, y0: ground, y1: ground + h,
        z0: z - depth / 2, z1: z + depth / 2, satellite: true });
    }
    for (const [w, d, ox, oz, yaw] of [[62, 9, 0, 0, 0], [9, 62, 0, 0, 0], [11, 54, 0, 56, 0]]) {
      const x = district.x + ox, z = district.z + oz;
      dummy.position.set(x, heightAt(x, z) + 0.035, z);
      dummy.rotation.set(0, yaw, 0); dummy.scale.set(w, 0.07, d); dummy.updateMatrix();
      roads.setMatrixAt(ri++, dummy.matrix);
    }
    for (let i = 0; i < 8; i++) for (const axis of [0, 1]) {
      dummy.position.set(district.x + (axis ? -24 + i * 7 : 0),
        heightAt(district.x, district.z) + 0.085,
        district.z + (axis ? 0 : -24 + i * 7));
      dummy.rotation.set(0, axis ? Math.PI / 2 : 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
      districtStripes.setMatrixAt(di++, dummy.matrix);
    }
  }
  buildings.instanceMatrix.needsUpdate = true;
  roads.instanceMatrix.needsUpdate = true;
  districtStripes.instanceMatrix.needsUpdate = true;
  satelliteRoot.add(roads, districtStripes, buildings);

  /* Base urbana e acessos: poucos draw calls, sem espalhar milhares de
     detalhes procedurais pelo mapa. O GLB traz os quarteirões por cima. */
  const asphalt = new THREE.MeshStandardMaterial({ color: 0x24282d, roughness: 0.96, metalness: 0.02 });
  const base = new THREE.Mesh(new THREE.PlaneGeometry(180, 180), asphalt);
  base.name = 'asfaltoCidade';
  base.rotation.x = -Math.PI / 2;
  base.position.y = 0.01;
  base.receiveShadow = true;
  root.add(base);
  for (const [w, d, x, z] of [
    [14, 70, 0, -122], [14, 70, 0, 122], [70, 14, -122, 0], [70, 14, 122, 0],
  ]) {
    const road = new THREE.Mesh(new THREE.PlaneGeometry(w, d), asphalt);
    road.name = 'acessoAsfalto';
    road.rotation.x = -Math.PI / 2;
    road.position.set(x, 0.015, z);
    road.receiveShadow = true;
    root.add(road);
  }

  const stripeGeo = new THREE.BoxGeometry(0.18, 0.018, 3.3);
  const stripeMat = new THREE.MeshBasicMaterial({ color: 0xe9d786 });
  const stripes = new THREE.InstancedMesh(stripeGeo, stripeMat, 48);
  stripes.name = 'faixasAcessosCidade';
  let si = 0;
  for (const side of [-1, 1]) for (let i = 0; i < 12; i++) {
    dummy.position.set(0, 0.035, side * (91 + i * 5.3));
    dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); stripes.setMatrixAt(si++, dummy.matrix);
    dummy.position.set(side * (91 + i * 5.3), 0.035, 0);
    dummy.rotation.set(0, Math.PI / 2, 0); dummy.updateMatrix(); stripes.setMatrixAt(si++, dummy.matrix);
  }
  root.add(stripes);

  /* A Nexus continua sendo a referência jogável da missão. A cidade importada
     é cenário; esta casca barata coincide exatamente com as lajes/colisores
     legados, evitando escadas invisíveis ou uma torre sem entrada. */
  const towerH = Math.max(34, Structures.towerTopY - heightAt(CITY.x, CITY.z));
  const nexusParts = [];
  const nexusBox = (w, h, d, x, y, z) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    geo.translate(x, y, z);
    nexusParts.push(geo);
  };
  nexusBox(18, towerH, 0.5, 0, towerH / 2, -9);
  nexusBox(0.5, towerH, 18, -9, towerH / 2, 0);
  nexusBox(0.5, towerH, 18, 9, towerH / 2, 0);
  nexusBox(7, towerH, 0.5, -5.5, towerH / 2, 9);
  nexusBox(7, towerH, 0.5, 5.5, towerH / 2, 9);
  nexusBox(4.2, towerH - 3, 0.5, 0, 3 + (towerH - 3) / 2, 9);
  const nexusShell = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(nexusParts),
    new THREE.MeshStandardMaterial({ color: 0x26313d, emissive: 0x07131b, emissiveIntensity: 0.32,
      roughness: 0.68, metalness: 0.22 }));
  nexusShell.name = 'torreNexusAlinhada';
  nexusShell.castShadow = false;
  nexusShell.receiveShadow = true;
  root.add(nexusShell);

  const windowGeo = new THREE.BoxGeometry(3.2, 0.38, 0.035);
  const windowMat = new THREE.MeshStandardMaterial({ color: 0x15202a, emissive: 0x7fc8ff,
    emissiveIntensity: 0.48, roughness: 0.35 });
  const nexusWindows = new THREE.InstancedMesh(windowGeo, windowMat, 40);
  nexusWindows.name = 'janelasTorreNexus';
  let wi = 0;
  for (let floor = 0; floor < 10; floor++) {
    const y = 2 + floor * 3.35;
    for (const side of [0, 1, 2, 3]) {
      dummy.position.set(side === 1 ? 9.27 : side === 3 ? -9.27 : 0, y,
        side === 0 ? -9.27 : side === 2 ? 9.27 : 0);
      dummy.rotation.set(0, side % 2 ? Math.PI / 2 : 0, 0);
      dummy.scale.set(1, 1, 1); dummy.updateMatrix(); nexusWindows.setMatrixAt(wi++, dummy.matrix);
    }
  }
  nexusWindows.instanceMatrix.needsUpdate = true;
  root.add(nexusWindows);

  const api = {
    root,
    satelliteRoot,
    districts,
    nexusShell,
    url: CITY_URL,
    status: 'loading',
    error: null,
    metrics: null,
    modelRoot: null,
    ready: null,
  };

  api.ready = new GLTFLoader().loadAsync(CITY_URL).then(gltf => {
    const model = gltf.scene;
    model.name = 'newYorkGLB';
    const anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    let meshes = 0, vertices = 0;
    const materials = new Set();
    model.traverse(obj => {
      if (!obj.isMesh) return;
      meshes++;
      if (obj.geometry?.attributes?.position) vertices += obj.geometry.attributes.position.count;
      obj.castShadow = false;       // 79 submalhas x 4 cascatas seria caro.
      obj.receiveShadow = false;
      obj.userData.importedCityModel = true;
      for (const material of Array.isArray(obj.material) ? obj.material : [obj.material]) {
        if (!material || materials.has(material)) continue;
        materials.add(material);
        if (material.isMeshStandardMaterial) {
          material.roughness = Math.max(0.58, material.roughness ?? 0.8);
          material.metalness = Math.min(0.38, material.metalness ?? 0);
          material.envMapIntensity = Math.min(0.7, material.envMapIntensity ?? 0.7);
        }
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
          if (material[key]) material[key].anisotropy = anisotropy;
        }
      }
    });

    model.updateMatrixWorld(true);
    const rawBox = new THREE.Box3().setFromObject(model);
    const rawSize = rawBox.getSize(new THREE.Vector3());
    const footprint = Math.max(rawSize.x, rawSize.z);
    if (!Number.isFinite(footprint) || footprint < 0.01) throw new Error('cidade GLB sem volume utilizável');

    /* Escala SEMPRE uniforme: preserva as proporções dos prédios. O footprint
       fica dentro do raio urbano de 95 m e do plateau já reservado no terreno. */
    const scale = 176 / footprint;
    model.scale.setScalar(scale);
    model.position.set(
      -(rawBox.min.x + rawBox.max.x) * 0.5 * scale,
      -rawBox.min.y * scale + 0.035,
      -(rawBox.min.z + rawBox.max.z) * 0.5 * scale,
    );
    model.updateMatrixWorld(true);
    root.add(model);
    root.visible = true;
    Structures.city.attachVisual(root);

    const finalBox = new THREE.Box3().setFromObject(model);
    const finalSize = finalBox.getSize(new THREE.Vector3());
    api.modelRoot = model;
    api.metrics = {
      meshes, vertices, materials: materials.size, scale,
      sizeX: finalSize.x, sizeY: finalSize.y, sizeZ: finalSize.z,
      collision: 'structures-aabb', footprintTarget: 176,
    };
    api.status = 'ready';
    return api;
  }).catch(err => {
    api.status = 'fallback';
    api.error = err instanceof Error ? err.message : String(err);
    root.visible = false;
    console.error('Cidade New York GLB falhou — mantendo cidade procedural:', err);
    return api;
  });

  return api;
}
