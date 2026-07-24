/* ================================================================
   Modelo de BAÚ compartilhado — solo (js/interact.js) e BR (br-game.js)
   usam o MESMO baú: corpo de madeira com tábua e ferragem, TAMPA ABAULADA
   (meio-cilindro), pés e fechadura que brilha de leve (marcador "ache o baú").
   Geometrias em cache (compartilhadas entre TODOS os baús → memória baixa) e
   criadas em noSeed: NUNCA consomem o rand seedado do worldgen.
   buildChest() devolve { group, lid, glow }:
     - group: baú inteiro, origem no chão (assenta em y=0 local)
     - lid : grupo da tampa com pivô na dobradiça (rotation.x negativo = abre)
     - glow: material emissivo da fechadura (BR muda a intensidade ao achar/abrir)
   ================================================================ */
import * as THREE from 'three';

let CACHE = null;
function geos() {
  if (CACHE) return CACHE;
  let s = 0xBEEF12 >>> 0; const R = Math.random;         // PRNG privado (noSeed)
  Math.random = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  try {
    // tampa abaulada: meio-cilindro deitado ao longo da LARGURA (X), curva pra cima
    const lid = new THREE.CylinderGeometry(0.34, 0.34, 0.92, 16, 1, false, 0, Math.PI);
    lid.rotateZ(-Math.PI / 2);   // eixo do cilindro passa a ficar ao longo de X (a largura)
    lid.rotateX(Math.PI);        // curva pra CIMA, base plana do semicírculo embaixo
    CACHE = {
      body: new THREE.BoxGeometry(0.9, 0.44, 0.6),
      plank: new THREE.BoxGeometry(0.93, 0.12, 0.63), // tábua central em relevo
      lid,
      strap: new THREE.BoxGeometry(0.09, 0.5, 0.64),  // ferragem vertical (canto)
      band: new THREE.BoxGeometry(0.95, 0.07, 0.66),  // aro de ferro da tampa
      bandBody: new THREE.BoxGeometry(0.94, 0.1, 0.64), // faixa dourada do corpo (brilha = achável)
      lock: new THREE.BoxGeometry(0.17, 0.2, 0.05),   // fechadura (brilha)
      foot: new THREE.BoxGeometry(0.13, 0.14, 0.13),  // pé
    };
  } finally { Math.random = R; }
  return CACHE;
}

export function buildChest(matFn = (m) => m) {
  const g = geos();
  const wood  = matFn(new THREE.MeshStandardMaterial({ color: 0x6e4a2a, roughness: 0.72 }));
  const wood2 = matFn(new THREE.MeshStandardMaterial({ color: 0x543821, roughness: 0.82 }));
  const iron  = matFn(new THREE.MeshStandardMaterial({ color: 0x35322c, metalness: 0.75, roughness: 0.45 }));
  const glow  = matFn(new THREE.MeshStandardMaterial({ color: 0xf2c14e, metalness: 0.7, roughness: 0.3, emissive: 0xf7b93c, emissiveIntensity: 1.0 }));

  const group = new THREE.Group();

  const body = new THREE.Mesh(g.body, wood);
  body.position.y = 0.24; body.castShadow = body.receiveShadow = true; group.add(body);
  const plank = new THREE.Mesh(g.plank, wood2); plank.position.y = 0.24; group.add(plank);
  const bodyBand = new THREE.Mesh(g.bandBody, glow); bodyBand.position.y = 0.24; group.add(bodyBand); // faixa dourada = achável de longe, de qualquer ângulo
  for (const sx of [-0.42, 0.42]) { const st = new THREE.Mesh(g.strap, iron); st.position.set(sx, 0.24, 0); group.add(st); }
  for (const sx of [-0.34, 0.34]) for (const sz of [-0.22, 0.22]) {
    const f = new THREE.Mesh(g.foot, wood2); f.position.set(sx, 0.05, sz); group.add(f);
  }

  // tampa: pivô na dobradiça (traseira, no topo do corpo)
  const lid = new THREE.Group();
  lid.position.set(0, 0.46, -0.3);
  const dome = new THREE.Mesh(g.lid, wood); dome.position.set(0, 0, 0.3); dome.castShadow = true; lid.add(dome);
  const lidBand = new THREE.Mesh(g.band, iron); lidBand.position.set(0, 0.12, 0.3); lid.add(lidBand);
  group.add(lid);

  const lock = new THREE.Mesh(g.lock, glow); lock.position.set(0, 0.3, 0.31); group.add(lock);

  return { group, lid, glow };
}
