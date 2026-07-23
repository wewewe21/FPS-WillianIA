/* ================================================================
   HELICÓPTERO — voo arcade no topo da TORRE NEXUS
   ================================================================ */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export function createHeli(deps) {
  const { CFG, clamp, damp, _v1, groundAt, SFX, scene, camera, csmMat, Structures, ui, centerMsg, state, keys, mouse, player, chaseCamPos } = deps;
  const group = new THREE.Group();
  /* O grupo externo continua sendo a identidade de física/multiplayer. O
     modelo procedural é apenas fallback enquanto o GLB carrega. */
  const fallbackRoot = new THREE.Group();
  fallbackRoot.name = 'HeliFallback';
  group.add(fallbackRoot);
  const body = csmMat(new THREE.MeshStandardMaterial({ color: 0x2b5e8c, metalness: 0.5, roughness: 0.3 }));
  const dark = csmMat(new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.6 }));
  const glassH = new THREE.MeshStandardMaterial({ color: 0xa8d8f0, metalness: 0.85, roughness: 0.08, transparent: true, opacity: 0.6 });
  function hp(geo, mat, x, y, z, o = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0);
    m.castShadow = true;
    fallbackRoot.add(m); return m;
  }
  hp(new RoundedBoxGeometry(3.1, 1.5, 1.6, 3, 0.5), body, 0.2, 1.15, 0);                   // fuselagem
  hp(new RoundedBoxGeometry(0.9, 1.1, 1.4, 3, 0.4), glassH, 1.6, 1.2, 0);                  // cabine de vidro
  hp(new THREE.CylinderGeometry(0.16, 0.3, 2.6, 10), body, -2.2, 1.45, 0, { rz: Math.PI / 2 }); // cauda
  hp(new RoundedBoxGeometry(0.5, 0.9, 0.12, 2, 0.05), body, -3.4, 1.8, 0);                 // leme
  const trotor = hp(new RoundedBoxGeometry(0.08, 1.1, 0.1, 1, 0.03), dark, -3.45, 1.8, 0.12);
  hp(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 8), dark, 0.4, 0.18, 0.78, { rz: Math.PI / 2 }); // esquis
  hp(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 8), dark, 0.4, 0.18, -0.78, { rz: Math.PI / 2 });
  for (const sx of [-0.5, 1.1]) for (const sz of [0.7, -0.7])
    hp(new THREE.CylinderGeometry(0.04, 0.04, 0.65, 6), dark, sx, 0.55, sz, { rx: sz > 0 ? 0.4 : -0.4 });
  hp(new THREE.CylinderGeometry(0.09, 0.12, 0.5, 8), dark, 0.2, 2.05, 0);                  // mastro
  const rotor = new THREE.Group();
  rotor.position.set(0.2, 2.3, 0);
  const blade = new RoundedBoxGeometry(5.6, 0.045, 0.32, 1, 0.02);
  const b1 = new THREE.Mesh(blade, dark), b2 = new THREE.Mesh(blade, dark);
  b2.rotation.y = Math.PI / 2;
  rotor.add(b1, b2);
  fallbackRoot.add(rotor);
  const hs = Structures.heliSpot;
  group.position.set(hs.x, hs.y + 0.05, hs.z);
  scene.add(group);

  const modelUrl = './assets/models/Veículos/low_poly_helicopter.glb';
  let modelStatus = 'loading', modelError = '', modelRoot = null;
  let modelMixer = null, modelAction = null, modelMetrics = null;
  const modelMaterials = new Set();

  /* O asset veio do Sketchfab com pivô longe da fuselagem e a frente em -X.
     Normaliza pela fuselagem (não pelo rotor) e ancora no eixo do rotor
     principal, que é o centro natural de giro do helicóptero. */
  function normalizedModel(gltf) {
    const imported = gltf.scene;
    let fuselage = null, mainRotor = null;
    imported.traverse(o => {
      if (/Copter_Palette/i.test(o.name)) fuselage = o;
      if (/^Propeller_2(?:_|$)/i.test(o.name)) mainRotor = o;
      if (!o.isMesh) return;
      const cloneMat = material => {
        const m = material.clone();
        modelMaterials.add(m);
        return m;
      };
      o.material = Array.isArray(o.material) ? o.material.map(cloneMat) : cloneMat(o.material);
      o.castShadow = false;
      o.receiveShadow = false;
    });

    const oriented = new THREE.Group();
    oriented.rotation.y = Math.PI; // nariz do asset (-X) -> frente arcade (+X)
    oriented.add(imported);
    oriented.updateWorldMatrix(true, true);
    const bodyBox = new THREE.Box3().setFromObject(fuselage || imported);
    const bodySize = bodyBox.getSize(new THREE.Vector3());
    if (bodySize.x < 1e-3 || bodySize.y < 1e-3)
      throw new Error('modelo de helicóptero sem volume');

    const scaled = new THREE.Group();
    scaled.scale.setScalar(6.1 / bodySize.x);
    scaled.add(oriented);
    scaled.updateWorldMatrix(true, true);
    const allBox = new THREE.Box3().setFromObject(scaled);
    const pivotBox = new THREE.Box3().setFromObject(mainRotor || fuselage || imported);
    const pivot = pivotBox.getCenter(new THREE.Vector3());
    scaled.position.set(-pivot.x, 0.05 - allBox.min.y, -pivot.z);
    scaled.updateWorldMatrix(true, true);

    const finalBox = new THREE.Box3().setFromObject(scaled);
    const size = finalBox.getSize(new THREE.Vector3());
    const visual = new THREE.Group();
    visual.name = 'HeliGLB';
    visual.add(scaled);

    /* "Main" também anima a translação/rotação do helicóptero. Essas
       tracks brigariam com a física; tocamos exclusivamente os dois rotores. */
    const sourceClip = gltf.animations.find(a => a.name === 'Main') || gltf.animations[0];
    if (sourceClip) {
      const rotorTracks = sourceClip.tracks.filter(track => /Propeller/i.test(track.name));
      if (rotorTracks.length) {
        const clip = new THREE.AnimationClip('Rotors', sourceClip.duration, rotorTracks);
        modelMixer = new THREE.AnimationMixer(imported);
        modelAction = modelMixer.clipAction(clip);
        modelAction.play();
      }
    }
    return { visual, metrics: { sizeX: size.x, sizeY: size.y, sizeZ: size.z, minY: finalBox.min.y } };
  }

  async function attachModel() {
    try {
      const gltf = await new GLTFLoader().loadAsync(modelUrl);
      const built = normalizedModel(gltf);
      modelRoot = built.visual;
      modelMetrics = built.metrics;
      group.add(modelRoot);
      fallbackRoot.visible = false;
      modelStatus = 'ready';
    } catch (err) {
      modelStatus = 'fallback';
      modelError = err instanceof Error ? err.message : String(err);
      fallbackRoot.visible = true;
      console.error('Helicóptero GLB falhou - mantendo modelo procedural:', err);
    }
  }
  const ready = attachModel();

  const vel = new THREE.Vector3();
  let yaw = 0, pitchK = 0, rollK = 0, rotorSpd = 0;

  function tryEnter() {
    if (player.pos.distanceTo(group.position) > 5) return false;
    if (window.__BR_heliTaken) { centerMsg('Helicóptero ocupado!', 1400); return false; }
    state.flying = true;
    ui.speedo.style.display = 'block';
    ui.ammoWrap.style.display = 'none';
    mouse.shooting = false; mouse.aiming = false;
    SFX.carDoor();
    chaseCamPos.copy(camera.position);
    centerMsg('ESPAÇO sobe · CTRL desce · WASD voa', 2600);
    return true;
  }
  function exit() {
    state.flying = false;
    _v1.set(0, 0, -2.6).applyQuaternion(group.quaternion).add(group.position);
    player.pos.set(_v1.x, Math.max(groundAt(_v1.x, _v1.z, group.position.y + 1), group.position.y - 0.6), _v1.z);
    player.vel.set(0, 0, 0);
    ui.speedo.style.display = 'none';
    ui.ammoWrap.style.display = '';
    SFX.carDoor();
  }
  function update(dt, t) {
    const on = state.flying && !state.paused;
    rotorSpd = damp(rotorSpd, on ? 26 : 1.2, 1.6, dt);
    rotor.rotation.y += rotorSpd * dt;
    trotor.rotation.x += rotorSpd * 3 * dt;
    if (modelMixer) {
      modelMixer.timeScale = 0.18 + (rotorSpd / 26) * 2.8;
      modelMixer.update(dt);
    }
    if (on) {
      const fwdIn = (keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0);
      const yawIn = (keys['KeyA'] ? 1 : 0) - (keys['KeyD'] ? 1 : 0);
      yaw += yawIn * 1.4 * dt;
      pitchK = damp(pitchK, fwdIn * 0.2, 4, dt);
      rollK = damp(rollK, -yawIn * 0.13, 4, dt);
      const fx = Math.cos(yaw), fz = -Math.sin(yaw); // nariz = +X girado
      vel.x = damp(vel.x, fx * fwdIn * 27, 1.8, dt);
      vel.z = damp(vel.z, fz * fwdIn * 27, 1.8, dt);
      const vyT = keys['Space'] ? 8 : (keys['ControlLeft'] || keys['ControlRight']) ? -7 : 0;
      vel.y = damp(vel.y, vyT, 3, dt);
      group.position.addScaledVector(vel, dt);
      const lim = CFG.WORLD_SIZE * 0.49;
      group.position.x = clamp(group.position.x, -lim, lim);
      group.position.z = clamp(group.position.z, -lim, lim);
      group.position.y = Math.min(group.position.y, 130);
      const minY = groundAt(group.position.x, group.position.z, group.position.y) + 0.55;
      if (group.position.y < minY) { group.position.y = minY; vel.y = Math.max(0, vel.y); }
      Structures.collide(group.position, 2.3, 2.2); // prédios/muros barram o heli
      group.rotation.set(rollK, yaw, -pitchK); // banca na curva, inclina o nariz ao acelerar
      // player acompanha (recentra grama/chunks)
      player.pos.set(group.position.x, groundAt(group.position.x, group.position.z, group.position.y), group.position.z);
      player.vel.set(0, 0, 0);
      ui.speedVal.textContent = Math.round(Math.hypot(vel.x, vel.z) * 3.6);
      SFX.heliUpdate(true, keys['Space'] ? 1 : 0.45);
    } else {
      SFX.heliUpdate(false, 0);
    }
  }
  return {
    group, update, tryEnter, exit, ready, modelUrl,
    get vel() { return vel; },
    get modelStatus() { return modelStatus; },
    get modelError() { return modelError; },
    get modelRoot() { return modelRoot; },
    get modelMetrics() { return modelMetrics; },
    get modelAction() { return modelAction; },
  };
}
