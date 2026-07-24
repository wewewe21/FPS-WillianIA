/* Nave de inserção do Battle Royale. Carrega Nave.glb com fallback imediato,
   escala uniforme, animação FLY e propulsores próprios. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const SHIP_URL = './assets/models/Nave.glb';

export function createDropship({ scene }) {
  const loader = new GLTFLoader();
  let cached = null;
  const source = () => (cached ||= loader.loadAsync(SHIP_URL));

  function fallbackShip() {
    const g = new THREE.Group();
    g.name = 'naveFallback';
    const hull = new THREE.MeshStandardMaterial({ color: 0x303946, metalness: 0.66, roughness: 0.38 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(4.2, 20, 6, 14), hull);
    body.rotation.x = Math.PI / 2;
    g.add(body);
    for (const sx of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(14, 0.75, 8), hull);
      wing.position.set(sx * 7.8, -0.5, -1.5);
      wing.rotation.y = -sx * 0.2;
      g.add(wing);
    }
    return g;
  }

  function build() {
    const g = new THREE.Group();
    g.name = 'naveInsercaoBR';
    g.visible = false;
    const fallback = fallbackShip();
    g.add(fallback);

    /* Conves de observacao externo. Alem de dar leitura de escala a nave vista
       em terceira pessoa, preserva a janela inferior da cabine que ja fazia
       parte do contrato visual do Battle Royale antigo. As luzes compartilham
       geometria/material, portanto o detalhe custa pouco em cada rodada. */
    const windowMat = new THREE.MeshPhysicalMaterial({
      color: 0x87ddff, emissive: 0x174f68, emissiveIntensity: 0.9,
      metalness: 0.12, roughness: 0.08, transmission: 0.48,
      transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false,
    });
    const cabinWindow = new THREE.Mesh(new THREE.CircleGeometry(2.8, 24), windowMat);
    cabinWindow.name = 'cabineJanela';
    cabinWindow.rotation.x = -Math.PI / 2;
    cabinWindow.position.set(0, -3.2, 1.8);
    g.add(cabinWindow);

    const markerGeo = new THREE.BoxGeometry(0.75, 0.16, 1.5);
    const markerMat = new THREE.MeshStandardMaterial({
      color: 0x17333d, emissive: 0x4bdcff, emissiveIntensity: 2.4,
      metalness: 0.45, roughness: 0.34,
    });
    for (let i = 0; i < 12; i++) {
      const marker = new THREE.Mesh(markerGeo, markerMat);
      marker.name = `luzCasco${i + 1}`;
      const side = i < 6 ? -1 : 1;
      const row = i % 6;
      marker.position.set(side * (5.8 + row * 0.48), -2.7, -8 + row * 3.1);
      marker.rotation.z = side * 0.12;
      g.add(marker);
    }

    const engineRig = new THREE.Group();
    engineRig.name = 'propulsoresNave';
    const plumeMat = new THREE.MeshBasicMaterial({
      color: 0x62e8ff, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const plumes = [];
    for (const x of [-7, 0, 7]) {
      const plume = new THREE.Mesh(new THREE.ConeGeometry(1.35, 8, 10, 1, true), plumeMat);
      plume.rotation.x = -Math.PI / 2;
      plume.position.set(x, -0.7, -18);
      engineRig.add(plume); plumes.push(plume);
    }
    const engineLight = new THREE.PointLight(0x4bdcff, 4.5, 48, 1.7);
    engineLight.position.set(0, -0.5, -16);
    engineRig.add(engineLight);
    g.add(engineRig);
    scene.add(g);

    const api = {
      g,
      ring: engineRig, // compatibilidade com o cliente BR antigo.
      plumes,
      status: 'loading', error: null, metrics: null, modelRoot: null, mixer: null,
      ready: null,
      update(dt, t) {
        if (api.mixer) api.mixer.update(dt);
        const pulse = 0.82 + Math.sin(t * 12) * 0.16;
        plumeMat.opacity = 0.56 + pulse * 0.18;
        for (let i = 0; i < plumes.length; i++) plumes[i].scale.set(0.9 + pulse * 0.13, 0.78 + pulse * 0.3, 0.9 + pulse * 0.13);
        engineLight.intensity = 3.7 + pulse * 1.4;
      },
      dispose() {
        if (g.parent) g.parent.remove(g);
        if (api.mixer) api.mixer.stopAllAction();
      },
    };

    api.ready = source().then(gltf => {
      const model = gltf.scene;
      model.name = 'naveGLB';
      model.traverse(obj => {
        if (!obj.isMesh) return;
        obj.castShadow = false;
        obj.receiveShadow = false;
        obj.userData.importedDropshipModel = true;
        for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) {
          if (m?.isMeshStandardMaterial) {
            m.roughness = Math.max(0.42, m.roughness ?? 0.5);
            m.envMapIntensity = Math.min(0.85, m.envMapIntensity ?? 0.85);
          }
        }
      });
      const oriented = new THREE.Group();
      oriented.rotation.y = Math.PI / 2; // comprimento do asset (X) vira eixo de voo (+Z).
      oriented.add(model);
      oriented.updateMatrixWorld(true);
      const raw = new THREE.Box3().setFromObject(oriented);
      const size = raw.getSize(new THREE.Vector3());
      const scale = 40 / Math.max(size.x, size.z);
      oriented.scale.setScalar(scale);
      oriented.position.set(
        -(raw.min.x + raw.max.x) * 0.5 * scale,
        -(raw.min.y + raw.max.y) * 0.5 * scale,
        -(raw.min.z + raw.max.z) * 0.5 * scale,
      );
      g.add(oriented);
      fallback.visible = false;
      api.modelRoot = oriented;
      api.mixer = new THREE.AnimationMixer(model);
      const fly = gltf.animations.find(a => /^fly$/i.test(a.name)) || gltf.animations[0];
      if (fly) api.mixer.clipAction(fly).play();
      const final = new THREE.Box3().setFromObject(oriented).getSize(new THREE.Vector3());
      api.metrics = { scale, sizeX: final.x, sizeY: final.y, sizeZ: final.z, animation: fly?.name || null };
      api.status = 'ready';
      return api;
    }).catch(err => {
      api.status = 'fallback';
      api.error = err instanceof Error ? err.message : String(err);
      console.error('Nave.glb falhou — usando nave de inserção fallback:', err);
      return api;
    });

    return api;
  }

  return { url: SHIP_URL, build };
}
