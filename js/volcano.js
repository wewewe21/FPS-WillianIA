/* vulcão: modelo GLB no canto do mapa + poço de lava na cratera que dá
   dano contínuo. A MONTANHA em si é o terreno (heightmap 2D do modelo
   baked em terrain.js) — aqui entra só o visual e o dano da lava.
   O chão autoritativo continua sendo heightAt: o mesh é decoração
   alinhada 1:1 (mesma escala e origem usadas no bake do heightmap). */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export function createVolcano(deps) {
  const { scene, VOLCANO, player, playerDamage, csmMat } = deps;

  const group = new THREE.Group();
  group.name = 'volcano';
  scene.add(group);

  const api = { VOLCANO, group, update, modelReady: false };

  new GLTFLoader().load('/assets/models/volcano.v1.glb', gltf => {
    const root = gltf.scene;
    // mesma transformação do bake: bbox centrado em (x,z), escala pelo
    // footprint, base (minY) na fração VBASE≈0 acima do nível baseY
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const s = (VOLCANO.r * 2) / Math.max(size.x, size.z);
    root.scale.setScalar(s);
    root.position.x = VOLCANO.x - (box.min.x + size.x / 2) * s;
    root.position.z = VOLCANO.z - (box.min.z + size.z / 2) * s;
    root.position.y = VOLCANO.baseY - 0.006 * size.y * s - box.min.y * s;
    root.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = true;
      if (o.material) {
        o.material.roughness = Math.max(o.material.roughness ?? 1, 0.88); // basalto fosco
        if (o.material.emissiveMap) o.material.emissiveIntensity = 1.35; // lava estoura no bloom
        csmMat(o.material);
      }
    });
    group.add(root);
    api.modelReady = true;
  }, undefined, e => console.warn('[vulcão] modelo não carregou', e));

  // brasa viva: luz quente pulsando sobre a boca da cratera
  const glow = new THREE.PointLight(0xff6a22, 30, 130, 1.6);
  glow.position.set(VOLCANO.lavaX, VOLCANO.baseY + VOLCANO.h * 0.92, VOLCANO.lavaZ);
  group.add(glow);

  let dmgAcc = 0;
  function update(dt, t) {
    glow.intensity = 30 + Math.sin(t * 2.3) * 6 + Math.sin(t * 7.1) * 3;
    // caiu na garganta da cratera (abaixo do teto do poço): queima por segundo
    const p = player.pos;
    const dv = Math.hypot(p.x - VOLCANO.lavaX, p.z - VOLCANO.lavaZ);
    if (!player.dead && dv < VOLCANO.lavaR && p.y < VOLCANO.lavaY) {
      dmgAcc += 26 * dt;
      if (dmgAcc >= 9) { playerDamage(dmgAcc); dmgAcc = 0; }
    } else dmgAcc = 0; // saiu da lava: nada de dano atrasado
  }

  return api;
}
