/* Rig declarativo das armas em primeira pessoa.
   Fonte única de: pose de ADS por mira (eixo óptico eye→front mapeado pro -Z
   da câmera), âncoras de empunhadura/boca, acessórios de mira (tecla T) e
   mecanismos visuais. Nada aqui é autoridade de gameplay: dano, spread e
   validação do servidor não passam por este módulo.
   Coordenadas dos perfis: espaço local do gun.group, calibradas contra os
   GLBs reais (scripts/inspect-glb-spatial.js → output/weapon-spatial.json).
   `fb` = coordenadas de FALLBACK pro modelo procedural (GLB falhou). */
import * as THREE from 'three';

export function createWeaponRig(deps) {
  const { arsenal, camera } = deps;
  const _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
  const _m = new THREE.Matrix4();

  const PROFILES = [
    { idx: 0, sights: [
        // canal LIVRE da alça do M4 (scan de raycast): y 0.112–0.132 através do aro
        { id: 'iron', label: 'Alça de ferro', type: 'iron', eye: [0, 0.124, 0.18], front: [0, 0.124, -0.45], eyeRelief: 0.28, fov: 55, reticle: 'none',
          fb: { eye: [0, 0.0915, 0.0], front: [0, 0.0915, -0.8] } },
        { id: 'reddot', label: 'Red Dot', type: 'redDot', eye: [0, 0.185, 0.1], front: [0, 0.185, -0.6], eyeRelief: 0.3, fov: 48, reticle: 'dot',
          mountY: 0.15, mountZ: 0.1 },
        { id: 'scope2x', label: 'Luneta 2x', type: 'scope', eye: [0, 0.19, 0.16], front: [0, 0.19, -0.4], eyeRelief: 0.24, fov: 36, reticle: 'overlay',
          mountY: 0.15, mountZ: 0.05 },
      ],
      anchors: { muzzle: [0, 0.033, -0.47], gripR: [0.02, -0.1, 0.17], supportHand: [0, -0.078, -0.38], ejection: [0.045, 0.02, 0.03] },
      mechanisms: { trigger: { pos: [0, -0.058, 0.095] }, boltHandle: { pos: [0.045, 0.05, 0.06] },
        magazine: { size: [0.048, 0.16, 0.085], off: [0, -0.05, 0] }, shellPort: true } },
    { idx: 1, sights: [
        // o GLB tem uma lâmina de alça alta (z≈0.09, topo 0.221): mira POR CIMA dela
        { id: 'bead', label: 'Lâmina de alça', type: 'iron', eye: [0, 0.226, 0.2], front: [0, 0.226, -0.49], eyeRelief: 0.3, fov: 62, reticle: 'none',
          fb: { eye: [0, 0.075, 0.0], front: [0, 0.075, -0.69] } },
      ],
      anchors: { muzzle: [0, 0.045, -0.5], gripR: [0.02, -0.09, 0.22], supportHand: [0, -0.052, -0.38], ejection: [0.04, -0.01, 0.04] },
      mechanisms: { trigger: { pos: [0, -0.05, 0.12] }, pumpSleeve: { size: [0.08, 0.07, 0.16], off: [0, 0.018, 0] },
        loadShell: { pos: [0.045, -0.01, 0.04] }, shellPort: true } },
    { idx: 2, sights: [
        { id: 'scope', label: 'Luneta', type: 'scope', eye: [0, 0.1, 0.18], front: [0, 0.1, -0.2], eyeRelief: 0.2, fov: 26, reticle: 'overlay',
          fb: { eye: [0, 0.115, 0.14], front: [0, 0.115, -0.18] } },
      ],
      anchors: { muzzle: [0, 0.03, -0.6], gripR: [0.02, -0.095, 0.22], supportHand: [0, -0.062, -0.42], ejection: [0.045, 0.03, 0.1] },
      mechanisms: { trigger: { pos: [0, -0.05, 0.12] }, boltHandle: { pos: [0.035, 0.05, 0.12] },
        magazine: { size: [0.046, 0.12, 0.08], off: [0, -0.04, 0] }, shellPort: true } },
    { idx: 3, sights: [
        // scope LATERAL real do GLB (materiais Scope/Glass em x≈+0.07): a câmera
        // olha POR ELE; o tubo fica deslocado — centralizar o tubo seria errado
        { id: 'launcher', label: 'Visor do lançador', type: 'launcher', eye: [0.072, 0.075, 0.3], front: [0.072, 0.075, -0.4], eyeRelief: 0.34, fov: 55, reticle: 'launcher',
          fb: { eye: [0.055, 0.096, 0.25], front: [0.055, 0.096, -0.4] } },
      ],
      anchors: { muzzle: [-0.058, 0.06, -0.6], gripR: [0.02, -0.16, 0.14], supportHand: [0.02, -0.15, -0.15] },
      mechanisms: { trigger: { pos: [-0.03, -0.1, 0.09] },
        loadedRocket: { pos: [-0.058, 0.06, -0.5] } } },
    { idx: 4, sights: [
        // corpo do alien sobe até y≈0.19 na traseira (scan): janela holo em 0.21
        { id: 'holo', label: 'Mira holográfica', type: 'holo', eye: [0, 0.21, 0.15], front: [0, 0.21, -0.5], eyeRelief: 0.36, fov: 58, reticle: 'holo',
          mountY: 0.17, mountZ: 0.15 },
      ],
      anchors: { muzzle: [0, 0.01, -0.44], gripR: [0.02, -0.095, 0.19], supportHand: [0, -0.075, -0.3] },
      // célula de energia (sem estojo balístico!) + emissor que pulsa no tiro
      mechanisms: { trigger: { pos: [0, -0.06, 0.14] },
        energyCell: { size: [0.05, 0.1, 0.08], off: [0, -0.03, 0] },
        emitter: { pos: [0, 0.01, -0.47] } } },
    { idx: 5, melee: true, sights: [],
      // botão direito = pose de guarda (ex-adsV da faca), NUNCA scope/retículo
      guard: { pos: [0.16, -0.19, -0.4], roll: 0.1 },
      anchors: { muzzle: [0, 0.02, -0.4], gripR: [0.015, -0.055, 0.03], supportHand: [-0.24, -0.16, 0.28] },
      mechanisms: {} },
    { idx: 6, sights: [
        { id: 'scope', label: 'Luneta', type: 'scope', eye: [-0.015, 0.085, 0.22], front: [-0.015, 0.085, -0.3], eyeRelief: 0.22, fov: 30, reticle: 'overlay',
          fb: { eye: [0, 0.115, 0.14], front: [0, 0.115, -0.18] } },
      ],
      anchors: { muzzle: [0, 0.028, -0.55], gripR: [0.02, -0.095, 0.22], supportHand: [0, -0.062, -0.42], ejection: [0.045, 0.03, 0.08] },
      // mag_4/bolt_6 são AUTORIDADE DO CLIP (AnimationMixer) — o rig só anima
      // o gatilho real (trigger_2), que nenhum clip toca
      mechanisms: { trigger: { node: /^trigger_2$/ }, shellPort: true } },
    { idx: 7, sights: [
        // alça traseira do GLB termina em y≈0.112 e tem um decal fino (Plane_0)
        // até y 0.1192: linha de mira em 0.122 passa limpa por cima
        { id: 'bead', label: 'Mira aberta', type: 'iron', eye: [0, 0.122, 0.02], front: [0, 0.122, -0.43], eyeRelief: 0.32, fov: 62, reticle: 'none',
          fb: { eye: [0, 0.075, 0.0], front: [0, 0.075, -0.69] } },
      ],
      anchors: { muzzle: [0, 0.03, -0.45], gripR: [0.02, -0.09, 0.22], supportHand: [0, -0.052, -0.34], ejection: [0.04, -0.01, 0.04] },
      // bomba REAL do GLB (Cube.010) religada na âncora pump pelo weaponmodels
      mechanisms: { trigger: { pos: [0, -0.045, -0.1] }, loadShell: { pos: [0.04, -0.01, 0.04] }, shellPort: true } },
  ];

  const byGun = new Map(); // gun -> { profile, sightIdx, poseCache, reticles, built }
  arsenal.forEach((gun, i) => {
    const profile = PROFILES.find(p => p.idx === i);
    if (profile) byGun.set(gun, { profile, sightIdx: 0, poseCache: new Map(), reticles: [], built: false });
  });
  const stateOf = gun => byGun.get(gun) || null;

  /* coordenadas efetivas da mira: GLB calibrado ou fallback procedural */
  function sightCoords(gun, sight) {
    if (gun.modelStatus === 'fallback' && sight.fb) return sight.fb;
    return sight;
  }

  /* mapeia o eixo óptico (eye→front, up de referência) pro eixo da câmera:
     forward vira -Z, up vira +Y; o olho fica a eyeRelief da ocular. */
  function computePose(gun, sight) {
    const c = sightCoords(gun, sight);
    const eye = new THREE.Vector3().fromArray(c.eye);
    const f = new THREE.Vector3().fromArray(c.front).sub(eye).normalize();
    const upHint = _v3.fromArray(sight.up || [0, 1, 0]);
    const r = new THREE.Vector3().crossVectors(f, upHint);
    if (r.lengthSq() < 1e-8) r.set(1, 0, 0); else r.normalize();
    const u = new THREE.Vector3().crossVectors(r, f).normalize();
    _m.makeBasis(r, u, _v2.copy(f).negate());
    const quat = new THREE.Quaternion().setFromRotationMatrix(_m).invert();
    const pos = new THREE.Vector3(0, 0, -sight.eyeRelief).sub(eye.applyQuaternion(quat));
    return { pos, quat };
  }

  function activeSight(gun) {
    const st = stateOf(gun);
    if (!st || !st.profile.sights.length) return null;
    return st.profile.sights[st.sightIdx % st.profile.sights.length];
  }

  const _hip = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  function hipPose(gun) {
    // hip um tico mais alto/perto que hipV: as mãos do rig entram no quadro
    _hip.pos.copy(gun.hipV); _hip.pos.y += 0.05; _hip.pos.z += 0.06;
    _hip.quat.identity();
    return _hip;
  }

  const _guard = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  const _guardEuler = new THREE.Euler();
  function adsPose(gun) {
    const st = stateOf(gun);
    const s = activeSight(gun);
    if (!st || !s) {
      // faca/sem perfil: botão direito vira pose de guarda, não ADS de firearm
      const g = st && st.profile.guard;
      if (g) {
        _guard.pos.fromArray(g.pos);
        _guard.quat.setFromEuler(_guardEuler.set(0, 0, g.roll || 0));
        return _guard;
      }
      return hipPose(gun);
    }
    const key = s.id + ':' + (gun.modelStatus || 'procedural');
    if (!st.poseCache.has(key)) st.poseCache.set(key, computePose(gun, s));
    return st.poseCache.get(key);
  }

  function cycleSight(gun) {
    const st = stateOf(gun);
    if (!st || st.profile.sights.length < 2) return null;
    st.sightIdx = (st.sightIdx + 1) % st.profile.sights.length;
    return activeSight(gun);
  }
  function invalidatePose(gun) { const st = stateOf(gun); if (st) st.poseCache.clear(); }

  /* referência de mira "usável": 0 enquanto não há nada alinhado na tela,
     1 quando o ADS está quase completo. O crosshair só some com isto > 0. */
  function sightRefK(gun, adsT) {
    if (!activeSight(gun)) return 0; // faca: crosshair nunca some
    return THREE.MathUtils.clamp((adsT - 0.75) / 0.2, 0, 1);
  }

  /* ---------- acessórios de mira construídos SOBRE o GLB (tecla T) ---------- */
  const MAT = {
    black: new THREE.MeshStandardMaterial({ color: 0x16191e, metalness: 0.6, roughness: 0.44 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x343a42, metalness: 0.82, roughness: 0.3 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x0a1013, roughness: 0.12, metalness: 0.4, transparent: true, opacity: 0.4, depthWrite: false }),
  };
  function reticleMat(color) {
    return new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  }
  function markGlass(obj) { obj.userData.sightGlass = true; return obj; }

  function buildSightAttachment(gun, sight, st) {
    const c = sightCoords(gun, sight);
    const [ex, ey] = c.eye;
    const g = new THREE.Group();
    g.userData.sightAttachment = true;
    if (sight.type === 'redDot') {
      const mz = sight.mountZ ?? 0.1;
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.036, Math.max(0.012, ey - 0.03 - sight.mountY), 0.075), MAT.black);
      base.position.set(ex, (sight.mountY + ey - 0.03) / 2, mz);
      g.add(base);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.005, 8, 16), MAT.black);
      ring.position.set(ex, ey, mz);
      g.add(ring);
      const lens = markGlass(new THREE.Mesh(new THREE.CircleGeometry(0.024, 16), MAT.glass));
      lens.position.set(ex, ey, mz);
      g.add(lens);
      const mat = reticleMat(0xff2222);
      const dot = markGlass(new THREE.Mesh(new THREE.CircleGeometry(0.0035, 8), mat));
      dot.position.set(ex, ey, mz - 0.003);
      g.add(dot);
      st.reticles.push({ sight, mat });
    } else if (sight.type === 'scope' && sight.mountY !== undefined) { // luneta 2x do fuzil
      const mz = sight.mountZ ?? 0.05;
      for (const dz of [-0.055, 0.055]) {
        const mount = new THREE.Mesh(new THREE.BoxGeometry(0.022, Math.max(0.012, ey - sight.mountY), 0.028), MAT.black);
        mount.position.set(ex, (sight.mountY + ey) / 2, mz + dz);
        g.add(mount);
      }
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.2, 12, 1, true), MAT.black);
      tube.rotation.x = Math.PI / 2;
      tube.position.set(ex, ey, mz);
      g.add(tube);
      for (const dz of [-0.1, 0.1]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.005, 8, 16), MAT.black);
        ring.position.set(ex, ey, mz + dz);
        g.add(ring);
      }
      const mat = reticleMat(0x111111);
      const h = markGlass(new THREE.Mesh(new THREE.PlaneGeometry(0.044, 0.0016), mat));
      h.position.set(ex, ey, mz);
      const v = markGlass(new THREE.Mesh(new THREE.PlaneGeometry(0.0016, 0.044), mat));
      v.position.set(ex, ey, mz - 0.001);
      g.add(h, v);
      st.reticles.push({ sight, mat });
    } else if (sight.type === 'holo') {
      const mz = sight.mountZ ?? 0.1;
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.014, 0.07), MAT.steel);
      base.position.set(ex, sight.mountY, mz);
      g.add(base);
      for (const dx of [-0.026, 0.026]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.007, ey - sight.mountY + 0.028, 0.012), MAT.steel);
        post.position.set(ex + dx, (sight.mountY + ey + 0.028) / 2, mz);
        g.add(post);
      }
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.059, 0.007, 0.012), MAT.steel);
      top.position.set(ex, ey + 0.03, mz);
      g.add(top);
      const win = markGlass(new THREE.Mesh(new THREE.PlaneGeometry(0.046, 0.052), MAT.glass));
      win.position.set(ex, ey, mz);
      g.add(win);
      const mat = reticleMat(0x2ee6c8);
      const ring = markGlass(new THREE.Mesh(new THREE.RingGeometry(0.008, 0.0105, 16), mat));
      ring.position.set(ex, ey, mz - 0.002);
      const dot = markGlass(new THREE.Mesh(new THREE.CircleGeometry(0.0025, 8), mat));
      dot.position.set(ex, ey, mz - 0.002);
      g.add(ring, dot);
      st.reticles.push({ sight, mat });
    } else if (sight.type === 'launcher') {
      // o corpo do visor é o scope REAL do GLB — aqui só o retículo de lançador
      const mz = (c.eye[2] + c.front[2] !== 0) ? c.eye[2] - sight.eyeRelief * 0.4 : 0.2;
      const mat = reticleMat(0xffb347);
      for (const [dy, rz] of [[-0.012, Math.PI / 4], [-0.012, -Math.PI / 4]]) {
        const seg = markGlass(new THREE.Mesh(new THREE.PlaneGeometry(0.014, 0.002), mat));
        seg.position.set(ex, ey + dy, mz);
        seg.rotation.z = rz;
        g.add(seg);
      }
      const h = markGlass(new THREE.Mesh(new THREE.PlaneGeometry(0.02, 0.0016), mat));
      h.position.set(ex, ey, mz);
      g.add(h);
      st.reticles.push({ sight, mat });
    } else {
      return null; // 'iron': a referência é a geometria da própria arma
    }
    return g;
  }

  /* ---------- mecanismos visuais (bind pose salvo; delta por frame) ---------- */
  const MECH_MAT = {
    dark: new THREE.MeshStandardMaterial({ color: 0x22262c, metalness: 0.55, roughness: 0.42 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xc9a04e, metalness: 0.85, roughness: 0.35 }),
    shell: new THREE.MeshStandardMaterial({ color: 0xb3474e, roughness: 0.5 }),
    rocket: new THREE.MeshStandardMaterial({ color: 0x3a3f3a, roughness: 0.5 }),
    rocketTip: new THREE.MeshStandardMaterial({ color: 0x2a1500, emissive: 0xff9a2e, emissiveIntensity: 1.2, roughness: 0.4 }),
  };
  function findNode(root, re) {
    let hit = null;
    root.traverse(o => { if (!hit && re.test(o.name)) hit = o; });
    return hit;
  }
  function buildMechanisms(gun, st) {
    const M = st.profile.mechanisms || {};
    const reg = st.mech = {};
    if (M.trigger) {
      let obj;
      if (M.trigger.node && gun.modelRoot) obj = findNode(gun.modelRoot, M.trigger.node);
      // fallback procedural SÓ quando o perfil dá uma posição: perfil node-only
      // (ex.: sniper idx6, node trigger_2 sem pos) num GLB em fallback não achava
      // o nó e fazia fromArray(undefined) → TypeError que derrubava o attach das
      // armas seguintes. Sem pos e sem nó = simplesmente sem gatilho animado.
      if (!obj && Array.isArray(M.trigger.pos)) {
        obj = new THREE.Group();
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.03, 0.011), MECH_MAT.dark);
        blade.position.y = -0.014; // pivô no topo: gatilho gira pra trás
        obj.add(blade);
        obj.position.fromArray(M.trigger.pos);
        gun.group.add(obj);
      }
      if (obj) reg.trigger = { obj, baseQ: obj.quaternion.clone() }; // update()/mechState já guardam m.trigger?
    }
    if (M.boltHandle && gun.parts.bolt && gun.parts.bolt.userData.authority !== 'clip') {
      const obj = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.015, 0.042), MECH_MAT.dark);
      obj.position.fromArray(M.boltHandle.pos);
      gun.group.add(obj);
      reg.bolt = { obj, baseZ: obj.position.z, anchor: gun.parts.bolt };
    }
    if (M.magazine && gun.parts.mag) { // réplica visível presa na âncora animada
      const obj = new THREE.Mesh(new THREE.BoxGeometry(...M.magazine.size), MECH_MAT.dark);
      obj.position.fromArray(M.magazine.off || [0, 0, 0]);
      gun.parts.mag.add(obj);
      reg.mag = { obj };
    }
    if (M.energyCell && gun.parts.mag) {
      const obj = new THREE.Mesh(new THREE.BoxGeometry(...M.energyCell.size),
        new THREE.MeshStandardMaterial({ color: 0x05201f, emissive: 0x2ee6c8, emissiveIntensity: 1.3, roughness: 0.4 }));
      obj.position.fromArray(M.energyCell.off || [0, 0, 0]);
      gun.parts.mag.add(obj);
      reg.cell = { obj };
    }
    if (M.pumpSleeve && gun.parts.pump) { // luva visível na âncora da bomba
      const obj = new THREE.Mesh(new THREE.BoxGeometry(...M.pumpSleeve.size), MECH_MAT.dark);
      obj.position.fromArray(M.pumpSleeve.off || [0, 0, 0]);
      gun.parts.pump.add(obj);
      reg.pump = { obj };
    }
    if (M.loadShell) { // cartucho que aparece na mão/porta durante a recarga
      const obj = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.05, 8), MECH_MAT.shell);
      obj.rotation.z = Math.PI / 2;
      obj.position.fromArray(M.loadShell.pos);
      obj.visible = false;
      gun.group.add(obj);
      reg.loadShell = { obj };
    }
    if (M.loadedRocket) { // ogiva visível no tubo enquanto há munição
      const obj = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.16, 10), MECH_MAT.rocket);
      body.rotation.x = Math.PI / 2;
      obj.add(body);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.042, 0.11, 10), MECH_MAT.rocketTip);
      tip.rotation.x = -Math.PI / 2;
      tip.position.z = -0.13;
      obj.add(tip);
      obj.position.fromArray(M.loadedRocket.pos);
      gun.group.add(obj);
      reg.rocket = { obj };
    }
    if (M.emitter) { // núcleo do plasma pulsa no disparo
      const mat = new THREE.MeshStandardMaterial({ color: 0x05201f, emissive: 0x2ee6c8, emissiveIntensity: 1.0, roughness: 0.4 });
      const obj = new THREE.Mesh(new THREE.SphereGeometry(0.024, 10, 8), mat);
      obj.position.fromArray(M.emitter.pos);
      gun.group.add(obj);
      reg.emitter = { mat };
    }
    reg.shellPort = !!M.shellPort;
  }

  /* pool de estojos ejetados (mundo): limite fixo, TTL, sem corpo de física */
  const SHELLS = [];
  const SHELL_MAX = 16;
  let shellGeo = null;
  function ejectShell(gun) {
    const st = stateOf(gun);
    if (!st || !st.mech || !st.mech.shellPort) return;
    const ej = st.profile.anchors.ejection;
    if (!ej) return;
    const scene = camera.parent;
    if (!scene) return;
    let s = SHELLS.find(x => !x.live);
    if (!s) {
      if (SHELLS.length >= SHELL_MAX) s = SHELLS[0]; // recicla o mais antigo
      else {
        if (!shellGeo) shellGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.02, 6);
        const m = new THREE.Mesh(shellGeo, MECH_MAT.brass);
        scene.add(m);
        s = { m, vel: new THREE.Vector3(), spin: 0, ttl: 0, live: false };
        SHELLS.push(s);
      }
    }
    gun.group.updateWorldMatrix(true, false);
    s.m.position.fromArray(ej).applyMatrix4(gun.group.matrixWorld);
    _v2.set(1.6 + Math.random(), 1.4 + Math.random() * 0.8, 0.2).applyQuaternion(camera.getWorldQuaternion(_q));
    s.vel.copy(_v2);
    s.spin = 8 + Math.random() * 10;
    s.ttl = 1.2;
    s.live = true;
    s.m.visible = true;
  }
  const _q = new THREE.Quaternion();
  function updateShells(dt) {
    for (const s of SHELLS) {
      if (!s.live) continue;
      s.ttl -= dt;
      if (s.ttl <= 0) { s.live = false; s.m.visible = false; continue; }
      s.vel.y -= 9.8 * dt;
      s.m.position.addScaledVector(s.vel, dt);
      s.m.rotation.x += s.spin * dt;
      s.m.rotation.z += s.spin * 0.6 * dt;
    }
  }

  function attachComplements(gun) {
    const st = stateOf(gun);
    if (!st || st.built) return;
    st.built = true;
    // empunhadura: as âncoras das mãos (alvos do IK do fpbody) vêm do perfil.
    // handL pode morar dentro de um grupo de mecanismo (bomba da escopeta) —
    // converte pro espaço do pai assumindo grupos sem rotação (convenção atual)
    const A = st.profile.anchors;
    if (gun.parts.handR && A.gripR) gun.parts.handR.position.fromArray(A.gripR);
    if (gun.parts.handL && A.supportHand) {
      const hl = gun.parts.handL;
      _v3.fromArray(A.supportHand);
      if (hl.parent && hl.parent !== gun.group) _v3.sub(hl.parent.position);
      hl.position.copy(_v3);
      if (hl.userData.base) hl.userData.base.p.copy(_v3);
    }
    for (const s of st.profile.sights) {
      const mesh = buildSightAttachment(gun, s, st);
      if (mesh) {
        s.mesh = mesh;
        mesh.visible = false;
        gun.group.add(mesh);
      }
    }
    buildMechanisms(gun, st);
    applySightVisibility(gun);
  }

  function applySightVisibility(gun) {
    const st = stateOf(gun);
    if (!st) return;
    const act = activeSight(gun);
    for (const s of st.profile.sights) if (s.mesh) s.mesh.visible = s === act;
    invalidatePose(gun);
  }

  /* por frame: retículo do acessório (só com a janela alinhada) + mecanismos.
     Tudo idempotente a partir do estado (lastShot/cycleT/reloading) — nada
     acumula, então troca/cancelamento restauram sozinhos o bind pose. */
  const _trigQ = new THREE.Quaternion();
  const _xAxis = new THREE.Vector3(1, 0, 0);
  function update(dt, t, gun, adsT) {
    updateShells(dt);
    const st = stateOf(gun);
    if (!st) return;
    const act = activeSight(gun);
    const k = sightRefK(gun, adsT);
    for (const r of st.reticles) r.mat.opacity = r.sight === act ? k * 0.95 : 0;
    const mech = st.mech;
    if (!mech) return;
    const fireK = THREE.MathUtils.clamp(1 - (t - gun.lastShot) / 0.12, 0, 1);
    if (mech.trigger) {
      const { obj, baseQ } = mech.trigger;
      obj.quaternion.copy(baseQ).multiply(_trigQ.setFromAxisAngle(_xAxis, -fireK * 0.35));
    }
    if (mech.bolt) { // segue o delta da âncora animada pelo ciclo (bind = z0)
      const a = mech.bolt.anchor;
      mech.bolt.obj.position.z = mech.bolt.baseZ + (a.position.z - a.userData.z0);
    }
    if (mech.rocket) mech.rocket.obj.visible = gun.mag > 0; // some no tiro, volta no finishReload
    if (mech.emitter) mech.emitter.mat.emissiveIntensity = 1.0 + fireK * 3.5;
    if (mech.loadShell) {
      let vis = false;
      if (gun.reloading) { // aparece em pulsos, no ritmo da mão indo à porta
        const rk = THREE.MathUtils.clamp(1 - (gun.reloadEnd - t) / gun.reloadTime, 0, 1);
        vis = rk > 0.2 && rk < 0.92 && Math.sin(rk * Math.PI * 5) > 0.15;
      }
      mech.loadShell.obj.visible = vis;
    }
  }

  function status() {
    return arsenal.map((gun, idx) => ({
      idx, name: gun.name, model: gun.modelStatus || 'procedural',
      sight: (activeSight(gun) || { id: null }).id,
      sights: stateOf(gun) ? stateOf(gun).profile.sights.length : 0,
    }));
  }
  function inspect(idx) {
    const st = stateOf(arsenal[idx]);
    return st ? st.profile : null;
  }
  /* estado VIVO dos mecanismos (leitura p/ QA): transform atual de cada peça */
  function mechState(idx) {
    const gun = arsenal[idx];
    const st = stateOf(gun);
    if (!st || !st.mech) return null;
    const m = st.mech;
    return {
      trigger: m.trigger ? m.trigger.obj.quaternion.toArray().map(v => +v.toFixed(5)) : null,
      boltZ: m.bolt ? +m.bolt.obj.position.z.toFixed(5)
        : (gun.parts.bolt ? +gun.parts.bolt.position.z.toFixed(5) : null),
      boltAuthority: gun.parts.bolt ? (gun.parts.bolt.userData.authority || 'procedural') : null,
      magY: gun.parts.mag ? +gun.parts.mag.position.y.toFixed(5) : null,
      magAuthority: gun.parts.mag ? (gun.parts.mag.userData.authority || 'procedural') : null,
      pumpZ: gun.parts.pump ? +gun.parts.pump.position.z.toFixed(5) : null,
      pumpZ0: gun.parts.pump ? +gun.parts.pump.userData.z0.toFixed(5) : null,
      loadShellVisible: m.loadShell ? m.loadShell.obj.visible : null,
      rocketVisible: m.rocket ? m.rocket.obj.visible : null,
      emitterIntensity: m.emitter ? +m.emitter.mat.emissiveIntensity.toFixed(3) : null,
      shellPort: m.shellPort,
    };
  }

  /* métricas de alinhamento em mundo/câmera — só leitura, para QA/testes. */
  function getAlignmentMetrics(idx, sightId) {
    const gun = arsenal[idx];
    const st = stateOf(gun);
    if (!st) return null;
    const s = sightId ? st.profile.sights.find(x => x.id === sightId) : activeSight(gun);
    if (!s) return null;
    const c = sightCoords(gun, s);
    gun.group.updateWorldMatrix(true, false);
    camera.updateMatrixWorld(true);
    const eyeW = new THREE.Vector3().fromArray(c.eye).applyMatrix4(gun.group.matrixWorld);
    const frontW = new THREE.Vector3().fromArray(c.front).applyMatrix4(gun.group.matrixWorld);
    const axis = frontW.clone().sub(eyeW).normalize();
    const camDir = camera.getWorldDirection(new THREE.Vector3());
    const ndcFront = frontW.clone().project(camera);
    const ndcEye = eyeW.clone().project(camera);
    return {
      sight: s.id,
      angleErrDeg: THREE.MathUtils.radToDeg(axis.angleTo(camDir)),
      ndcFront: [ndcFront.x, ndcFront.y],
      ndcEye: [ndcEye.x, ndcEye.y],
      eyeCam: eyeW.applyMatrix4(camera.matrixWorldInverse).toArray(),
    };
  }

  return {
    adsPose, hipPose, activeSight, cycleSight, invalidatePose, sightRefK,
    status, inspect, mechState, getAlignmentMetrics,
    attachComplements, applySightVisibility, update, ejectShell,
    get shellsAlive() { return SHELLS.filter(s => s.live).length; }, // QA/pool
    shellMax: SHELL_MAX,
  };
}
