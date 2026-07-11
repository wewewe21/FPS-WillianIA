/* vida ambiente: borboletas, pássaros, fogueira, bandeiras — extraído de game.js; deps explícitas */
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

export function createAmb(deps) {
  const { rand, TAU, _v1, _v2, heightAt, biomeAt, addObstacle, SFX, FX, scene, csmMat, Structures, player } = deps;
  /* ---- borboletas perto do player ---- */
  const bflies = [];
  const wingGeo = new THREE.PlaneGeometry(0.16, 0.12);
  wingGeo.translate(0.08, 0, 0); // dobradiça no corpo
  const bColors = [0xffd24d, 0xff8ac2, 0x9ad9ff, 0xfff3c4, 0xcf9aff];
  for (let i = 0; i < 22; i++) {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: bColors[i % bColors.length], side: THREE.DoubleSide, transparent: true, opacity: 0.95 });
    const w1 = new THREE.Mesh(wingGeo, mat);
    const w2 = new THREE.Mesh(wingGeo, mat); w2.scale.x = -1;
    g.add(w1, w2);
    scene.add(g);
    bflies.push({ g, w1, w2, anchor: new THREE.Vector3(), phase: rand(TAU), speed: rand(0.5, 1.2), life: 0 });
  }
  function reanchor(b) {
    const a = rand(TAU), r = rand(7, 42);
    b.anchor.set(player.pos.x + Math.cos(a) * r, 0, player.pos.z + Math.sin(a) * r);
    b.anchor.y = heightAt(b.anchor.x, b.anchor.z) + rand(0.5, 1.6);
    b.life = rand(7, 15);
  }
  bflies.forEach(reanchor);

  /* ---- bandos de pássaros circulando alto ---- */
  const birds = [];
  const birdMat = new THREE.MeshBasicMaterial({ color: 0x1d2126, side: THREE.DoubleSide });
  const birdGeo = new THREE.PlaneGeometry(0.95, 0.22);
  for (let f = 0; f < 3; f++) {
    const center = new THREE.Vector3(rand(-260, 260), 0, rand(-260, 260));
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(birdGeo, birdMat);
      m.rotation.x = -0.35;
      scene.add(m);
      birds.push({ m, center, r: rand(16, 42), h: rand(26, 46), a: rand(TAU), sp: rand(0.22, 0.4) * (f % 2 ? 1 : -1), ph: rand(TAU) });
    }
  }

  /* ---- pólen dourado flutuando (1 draw call) ---- */
  const MOTES = 70;
  const moteGeo = new THREE.BufferGeometry();
  const motePos = new Float32Array(MOTES * 3);
  for (let i = 0; i < MOTES; i++) {
    motePos[i * 3] = rand(-22, 22); motePos[i * 3 + 1] = rand(0.3, 3.4); motePos[i * 3 + 2] = rand(-22, 22);
  }
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({
    color: 0xffe9b0, size: 0.055, transparent: true, opacity: 0.45,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
  motes.frustumCulled = false;
  scene.add(motes);

  /* ---- acampamento do spawn: fogueira, pedras, banco e tenda ---- */
  const campY = heightAt(2, -2);
  {
    const wood = csmMat(new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.8 }));
    const stone = csmMat(new THREE.MeshStandardMaterial({ color: 0x7e7a73, roughness: 0.9 }));
    const canvasM = csmMat(new THREE.MeshStandardMaterial({ color: 0xc26b3a, roughness: 0.85, side: THREE.DoubleSide }));
    for (let i = 0; i < 3; i++) { // lenha em tripé
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.95, 7), wood);
      log.position.set(2, campY + 0.28, -2);
      log.rotation.set(0.5, i * TAU / 3, 0.45);
      log.castShadow = true;
      scene.add(log);
    }
    for (let i = 0; i < 7; i++) { // círculo de pedras
      const st = new THREE.Mesh(new THREE.SphereGeometry(rand(0.09, 0.15), 7, 5), stone);
      const a = i / 7 * TAU;
      st.position.set(2 + Math.cos(a) * 0.78, campY + 0.06, -2 + Math.sin(a) * 0.78);
      scene.add(st);
    }
    const bench = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.7, 8), wood);
    bench.rotation.z = Math.PI / 2;
    bench.position.set(2.2, campY + 0.18, -0.2);
    bench.castShadow = true;
    scene.add(bench);
    // tenda em A
    const s1 = new THREE.PlaneGeometry(1.5, 2.3); s1.rotateX(-Math.PI / 2); s1.rotateZ(0.96);  s1.translate(-0.44, 0.62, 0);
    const s2 = new THREE.PlaneGeometry(1.5, 2.3); s2.rotateX(-Math.PI / 2); s2.rotateZ(-0.96); s2.translate(0.44, 0.62, 0);
    const tent = new THREE.Mesh(BufferGeometryUtils.mergeGeometries([s1, s2]), canvasM);
    tent.position.set(5.6, campY, -4.2);
    tent.rotation.y = 0.5;
    tent.castShadow = true;
    scene.add(tent);
    addObstacle(5.6, -4.2, 1.3);
  }
  // chamas da fogueira (3 quads aditivos cruzados)
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa53d, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const fireFlames = [];
  for (let i = 0; i < 3; i++) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.85), flameMat);
    f.position.set(2, campY + 0.5, -2);
    f.rotation.y = i * Math.PI / 3;
    scene.add(f);
    fireFlames.push(f);
  }
  const fireLight = new THREE.PointLight(0xff9a40, 2.2, 15, 2);
  fireLight.position.set(2, campY + 1, -2);
  scene.add(fireLight);

  let smokeAcc = 0, chirpAcc = rand(3, 7);

  function update(dt, t) {
    // borboletas vagueiam em volta de uma âncora
    for (const b of bflies) {
      b.life -= dt;
      if (b.life <= 0 || b.anchor.distanceToSquared(player.pos) > 85 * 85) reanchor(b);
      b.phase += dt * b.speed;
      const px = b.anchor.x + Math.sin(b.phase * 1.3) * 1.7 + Math.sin(b.phase * 0.7) * 1.1;
      const pz = b.anchor.z + Math.cos(b.phase * 1.1) * 1.7;
      const py = b.anchor.y + Math.sin(b.phase * 2.1) * 0.35;
      b.g.rotation.y = Math.atan2(px - b.g.position.x, pz - b.g.position.z);
      b.g.position.set(px, py, pz);
      const flap = 0.3 + Math.abs(Math.sin(t * 16 + b.phase * 7)) * 1.0;
      b.w1.rotation.y = flap;
      b.w2.rotation.y = -flap;
    }
    // pássaros circulam batendo asas
    for (const b of birds) {
      b.a += b.sp * dt;
      b.m.position.set(b.center.x + Math.cos(b.a) * b.r, b.h + Math.sin(t * 0.6 + b.ph) * 2, b.center.z + Math.sin(b.a) * b.r);
      b.m.rotation.y = -b.a + (b.sp > 0 ? 0 : Math.PI);
      b.m.scale.y = 0.45 + Math.abs(Math.sin(t * 7 + b.ph)) * 0.85;
    }
    // pólen acompanha o player
    motes.position.set(player.pos.x, player.pos.y, player.pos.z);
    motes.rotation.y += dt * 0.025;
    // fogueira tremeluz
    for (let i = 0; i < fireFlames.length; i++) {
      const f = fireFlames[i];
      const k = 0.82 + Math.sin(t * 11 + i * 2.1) * 0.18 + Math.sin(t * 23 + i) * 0.08;
      f.scale.set(k, k * (1 + Math.sin(t * 17 + i * 3) * 0.16), 1);
      f.position.y = campY + 0.5 + Math.sin(t * 13 + i) * 0.05;
    }
    fireLight.intensity = 2 + Math.sin(t * 9.3) * 0.5 + Math.sin(t * 23.7) * 0.3;
    // fumaça: fogueira + chaminés visíveis
    smokeAcc += dt;
    if (smokeAcc > 0.4) {
      smokeAcc = 0;
      _v1.set(2 + rand(-0.15, 0.15), campY + 0.9, -2 + rand(-0.15, 0.15));
      _v2.set(rand(-0.2, 0.2), rand(0.8, 1.3), rand(-0.2, 0.2));
      FX.spawnParticle(_v1, _v2, 0x6a6661, rand(0.25, 0.5), rand(1.4, 2.2), -0.55);
      for (const s of Structures.smokeSpots) {
        if (Math.random() < 0.55) continue;
        if (Math.hypot(s.x - player.pos.x, s.z - player.pos.z) > 140) continue;
        _v1.set(s.x, s.y, s.z);
        _v2.set(rand(-0.3, 0.3), rand(0.7, 1.2), rand(-0.3, 0.3));
        FX.spawnParticle(_v1, _v2, 0x8d8983, rand(0.3, 0.6), rand(1.6, 2.6), -0.5);
      }
    }
    // bandeiras do forte tremulam
    for (let i = 0; i < Structures.flags.length; i++) {
      const fl = Structures.flags[i];
      fl.rotation.y = fl.userData.ry + Math.sin(t * 2.6 + i * 1.3) * 0.3 + Math.sin(t * 5.1 + i) * 0.12;
      fl.scale.x = 1 + Math.sin(t * 7 + i * 2) * 0.09;
    }
    // braseiros do forte pulsam
    for (let i = 0; i < Structures.flames.length; i++) {
      const f = Structures.flames[i];
      f.scale.setScalar(1 + Math.sin(t * 9 + i * 1.9) * 0.16);
    }
    // canto de passarinhos quando fora do deserto
    chirpAcc -= dt;
    if (chirpAcc <= 0) {
      chirpAcc = rand(3.5, 9);
      if (biomeAt(player.pos.x, player.pos.z) > -0.15) SFX.chirp();
    }
  }
  return { update };
}
