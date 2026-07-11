/* COLOSSO — guardião do forte — extraído de game.js; deps explícitas */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export function createBoss(deps) {
  const { clamp, damp, rand, TAU, _v1, _v2, heightAt, SFX, FX, scene, csmMat, Structures, ui, addScore, addKillFeed, showBanner, player, playerDamage, addTrauma, Bosses, Pickups, MFlags, setTimeScale } = deps;
  const HOME = Structures.FORT_POS;
  const mArmor = csmMat(new THREE.MeshStandardMaterial({ color: 0x2e333d, roughness: 0.5, metalness: 0.45 }));
  const mDark  = csmMat(new THREE.MeshStandardMaterial({ color: 0x15181d, roughness: 0.6, metalness: 0.35 }));
  const mCore  = new THREE.MeshStandardMaterial({ color: 0x1a0500, emissive: 0xff5a1e, emissiveIntensity: 3, roughness: 0.3 });
  const mEye   = new THREE.MeshStandardMaterial({ color: 0x200505, emissive: 0xff2417, emissiveIntensity: 3, roughness: 0.3 });

  const group = new THREE.Group();
  const parts = {};
  {
    const cast = m => { m.castShadow = true; return m; };
    const torso = cast(new THREE.Mesh(new THREE.CapsuleGeometry(0.95, 1.1, 6, 16), mArmor));
    torso.position.y = 2.9; group.add(torso);
    const plate = cast(new THREE.Mesh(new RoundedBoxGeometry(1.5, 1.3, 0.6, 3, 0.18), mDark));
    plate.position.set(0, 3.1, 0.42); group.add(plate);
    parts.core = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), mCore);
    parts.core.position.set(0, 3.05, 0.82); group.add(parts.core);
    parts.head = new THREE.Group(); parts.head.position.y = 4.35;
    parts.head.add(cast(new THREE.Mesh(new THREE.SphereGeometry(0.48, 18, 14), mArmor)));
    const visor = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.16, 0.2, 2, 0.06), mEye);
    visor.position.set(0, 0.05, 0.4); parts.head.add(visor);
    const crest = cast(new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.7, 6), mDark));
    crest.position.y = 0.62; parts.head.add(crest);
    group.add(parts.head);
    for (const s of [-1, 1]) {
      const pad = cast(new THREE.Mesh(new THREE.SphereGeometry(0.62, 14, 10), mDark));
      pad.position.set(s * 1.25, 3.85, 0); pad.scale.y = 0.8; group.add(pad);
      const arm = new THREE.Group(); arm.position.set(s * 1.3, 3.7, 0);
      const upper = cast(new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.9, 5, 12), mArmor));
      upper.position.y = -0.6; arm.add(upper);
      const fist = cast(new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 9), mDark));
      fist.position.y = -1.35; arm.add(fist);
      parts[s < 0 ? 'armL' : 'armR'] = arm; group.add(arm);
      const leg = new THREE.Group(); leg.position.set(s * 0.55, 1.95, 0);
      const thigh = cast(new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 0.9, 5, 12), mArmor));
      thigh.position.y = -0.65; leg.add(thigh);
      const boot = cast(new THREE.Mesh(new RoundedBoxGeometry(0.7, 0.5, 1, 2, 0.14), mDark));
      boot.position.set(0, -1.6, 0.1); leg.add(boot);
      parts[s < 0 ? 'legL' : 'legR'] = leg; group.add(leg);
    }
    const cannon = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 1.1, 10), mDark));
    cannon.rotation.x = Math.PI / 2; cannon.position.set(0, -1.3, 0.5);
    parts.armR.add(cannon);
    // armadura samurai: sode (ombreiras laminadas), kusazuri (saiote) e kuwagata no elmo
    const mLacq = csmMat(new THREE.MeshStandardMaterial({ color: 0x8c1c14, metalness: 0.4, roughness: 0.35 }));
    const mGold = csmMat(new THREE.MeshStandardMaterial({ color: 0xc9a04e, metalness: 0.85, roughness: 0.3 }));
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const pl = new THREE.Mesh(new RoundedBoxGeometry(0.7 + i * 0.12, 0.16, 0.8, 1, 0.05), mLacq);
        pl.position.set(s * (1.32 + i * 0.06), 3.95 - i * 0.18, 0);
        pl.rotation.z = s * (0.25 + i * 0.08);
        group.add(pl);
      }
    }
    for (let i = 0; i < 5; i++) { // saiote
      const a = (i - 2) * 0.55;
      const sk = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.75, 0.1, 1, 0.04), mLacq);
      sk.position.set(Math.sin(a) * 0.85, 1.75, Math.cos(a) * 0.85);
      sk.rotation.y = a;
      sk.rotation.x = 0.18;
      group.add(sk);
    }
    const kw1 = new THREE.Mesh(new RoundedBoxGeometry(0.08, 0.85, 0.18, 1, 0.03), mGold);
    kw1.position.set(-0.25, 4.95, 0.25); kw1.rotation.z = 0.45; group.add(kw1);
    const kw2 = new THREE.Mesh(new RoundedBoxGeometry(0.08, 0.85, 0.18, 1, 0.03), mGold);
    kw2.position.set(0.25, 4.95, 0.25); kw2.rotation.z = -0.45; group.add(kw2);
    group.scale.setScalar(1.18); // ~5.5m de altura
  }
  group.position.set(HOME.x, heightAt(HOME.x, HOME.z), HOME.z);
  scene.add(group);

  const B = {
    alive: true, active: false, enraged: false,
    hpMax: 2800, hp: 2800,
    yaw: 0, walkPhase: 0,
    nextVolley: 0, volleyLeft: 0, nextOrb: 0, nextStomp: 0,
    stompT: -1, stompHit: false, deadT: -1, respawnT: 0,
    flinch: 0,
  };

  /* orbes de plasma (pool) */
  const orbs = [];
  const orbMat = new THREE.MeshStandardMaterial({ color: 0x301000, emissive: 0xff7a22, emissiveIntensity: 4, roughness: 0.3 });
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 9), orbMat);
    m.visible = false; scene.add(m);
    orbs.push({ mesh: m, vel: new THREE.Vector3(), live: false });
  }
  function fireOrb() {
    const o = orbs.find(o => !o.live);
    if (!o) return;
    o.live = true;
    const fs = Math.sin(B.yaw), fc = Math.cos(B.yaw);
    o.mesh.position.set(group.position.x + fs * 1.2 - fc * 1.5, group.position.y + 2.9, group.position.z + fc * 1.2 + fs * 1.5);
    _v2.copy(player.pos); _v2.y += 1.2;
    _v2.addScaledVector(player.vel, _v2.distanceTo(o.mesh.position) / 26 * 0.65); // predição
    o.vel.copy(_v2).sub(o.mesh.position).normalize().multiplyScalar(26);
    o.mesh.visible = true;
    SFX.bossShot();
  }
  function orbExplode(o) {
    o.live = false;
    o.mesh.visible = false;
    FX.burst(o.mesh.position, _v1.set(0, 1, 0), 'spark');
    FX.burst(o.mesh.position, _v1.set(0, 1, 0), 'dirt');
    const d = o.mesh.position.distanceTo(player.pos);
    if (d < 4.5) playerDamage(Math.round(20 * (1 - d / 5)) + 6, o.mesh.position);
    addTrauma(clamp(0.55 - d * 0.025, 0, 0.55));
  }

  const sph = [
    { c: new THREE.Vector3(), r: 0.46, part: 'core' },
    { c: new THREE.Vector3(), r: 0.62, part: 'head' },
    { c: new THREE.Vector3(), r: 1.3, part: 'body' },
    { c: new THREE.Vector3(), r: 0.95, part: 'body' },
  ];
  function hitSpheres() {
    const p = group.position;
    const fs = Math.sin(B.yaw), fc = Math.cos(B.yaw);
    sph[0].c.set(p.x + fs * 0.97, p.y + 3.6, p.z + fc * 0.97); // núcleo
    sph[1].c.set(p.x, p.y + 5.15, p.z);                         // cabeça
    sph[2].c.set(p.x, p.y + 3.45, p.z);                         // torso
    sph[3].c.set(p.x, p.y + 1.9, p.z);                          // pernas
    return sph;
  }

  function updateBar() {
    ui.bossFill.style.width = clamp(B.hp / B.hpMax * 100, 0, 100) + '%';
  }
  function activate() {
    B.active = true;
    SFX.roar();
    addTrauma(0.45);
    showBanner('COLOSSO DESPERTOU<small>destrua o núcleo brilhante no peito</small>', 3400);
  }
  function damage(dmg, hitPos, dir, part) {
    if (!B.alive || B.deadT >= 0) return false;
    if (!B.active) activate();
    B.hp -= dmg * (part === 'core' ? 1.5 : 1); // núcleo: 2x do tiro + 1.5x aqui = 3x
    B.flinch = Math.min(1, B.flinch + 0.12);
    if (part === 'core') parts.core.material.emissiveIntensity = 7;
    updateBar();
    if (B.hp <= 0) { die(); return true; }
    if (!B.enraged && B.hp < B.hpMax * 0.35) {
      B.enraged = true;
      mEye.emissiveIntensity = 5.5;
      SFX.roar();
      showBanner('COLOSSO ENFURECIDO', 1800);
    }
    return false;
  }
  function die() {
    B.alive = false;
    B.deadT = 0;
    B.respawnT = 120;
    addScore(2500, true);
    addKillFeed('<b>Você</b> ▸ <b>COLOSSO</b>');
    SFX.explosion();
    SFX.victory();
    addTrauma(1);
    setTimeScale(0.25); // câmera lenta
    setTimeout(() => { setTimeScale(1); }, 1000);
    showBanner('COLOSSO ELIMINADO<small>+2500 pontos · pegue a ARMADURA do guardião</small>', 4500);
    for (let i = 0; i < 5; i++) {
      FX.burst(_v1.set(group.position.x + rand(-2, 2), group.position.y + rand(1, 4), group.position.z + rand(-2, 2)), _v2.set(0, 1, 0), 'spark');
      Pickups.drop({ x: group.position.x + rand(-5, 5), z: group.position.z + rand(-5, 5) }, true);
    }
    Pickups.spawn({ x: group.position.x, z: group.position.z + 3 }, 'armor'); // recompensa: armadura azul
    MFlags.colosso = true;
    ui.bossWrap.style.opacity = '0';
  }
  function respawn() {
    B.alive = true; B.active = false; B.enraged = false;
    B.hp = B.hpMax; B.stompT = -1; B.deadT = -1; B.flinch = 0;
    group.visible = true;
    group.rotation.set(0, 0, 0);
    group.scale.setScalar(1.18);
    group.position.set(HOME.x, heightAt(HOME.x, HOME.z), HOME.z);
    mEye.emissiveIntensity = 3;
    updateBar();
  }

  function update(dt, t) {
    // orbes sempre voam, mesmo com o boss morto
    for (const o of orbs) {
      if (!o.live) continue;
      o.vel.y -= 3 * dt;
      o.mesh.position.addScaledVector(o.vel, dt);
      o.mesh.scale.setScalar(1 + Math.sin(t * 30) * 0.12);
      if (o.mesh.position.y < heightAt(o.mesh.position.x, o.mesh.position.z) + 0.3 ||
          o.mesh.position.distanceTo(player.pos) < 1.3) orbExplode(o);
    }
    parts.core.material.emissiveIntensity =
      damp(parts.core.material.emissiveIntensity, B.enraged ? 4.5 : 3, 4, dt) + Math.sin(t * 6) * 0.25;
    B.flinch = Math.max(0, B.flinch - dt * 2);

    if (!B.alive) {
      if (B.deadT >= 0) { // tomba e afunda
        B.deadT += dt;
        group.rotation.x = -Math.min(1.35, B.deadT * 1.3);
        if (B.deadT > 1.2) group.position.y = heightAt(group.position.x, group.position.z) - (B.deadT - 1.2) * 1.1;
        if (B.deadT > 3.6) { B.deadT = -1; group.visible = false; }
      } else {
        B.respawnT -= dt;
        if (B.respawnT <= 0) respawn();
      }
      return;
    }

    const dPlayer = group.position.distanceTo(player.pos);
    ui.bossWrap.style.opacity = (B.active && dPlayer < 140) ? '1' : '0';
    if (!B.active) {
      if (dPlayer < 60 && !player.dead) activate();
      else {
        group.position.y = heightAt(group.position.x, group.position.z) + Math.sin(t * 0.9) * 0.04; // respira
        return;
      }
    }

    const dHome = Math.hypot(group.position.x - HOME.x, group.position.z - HOME.z);
    const leashing = dHome > 70 || player.dead;
    const speed = B.enraged ? 4.6 : 3.1;
    const tx = leashing ? HOME.x : player.pos.x;
    const tz = leashing ? HOME.z : player.pos.z;
    if (leashing) { B.hp = Math.min(B.hpMax, B.hp + 30 * dt); updateBar(); }

    if (B.stompT >= 0) {
      /* ---- PISÃO: agacha, esmaga, onda de choque ---- */
      B.stompT += dt;
      const k = B.stompT / 1.05;
      if (k < 0.6) {
        group.scale.y = 1.18 * (1 - k * 0.28);
        parts.armL.rotation.x = parts.armR.rotation.x = -k * 1.6;
      } else {
        group.scale.y = damp(group.scale.y, 1.18, 14, dt);
        parts.armL.rotation.x = damp(parts.armL.rotation.x, 0, 10, dt);
        parts.armR.rotation.x = damp(parts.armR.rotation.x, 0, 10, dt);
      }
      if (!B.stompHit && k >= 0.62) {
        B.stompHit = true;
        SFX.stomp();
        addTrauma(0.8);
        for (let i = 0; i < 10; i++) { // anel de poeira
          const a = i / 10 * TAU;
          _v1.set(group.position.x + Math.cos(a) * 2, group.position.y + 0.4, group.position.z + Math.sin(a) * 2);
          _v2.set(Math.cos(a) * 6, 2.5, Math.sin(a) * 6);
          FX.spawnParticle(_v1, _v2, 0x9a8a6a, rand(0.3, 0.5), 0.7, 8);
        }
        const d = group.position.distanceTo(player.pos);
        if (d < 11) {
          playerDamage(Math.round(32 * (1 - d / 13)), group.position);
          _v2.copy(player.pos).sub(group.position).normalize();
          player.vel.x += _v2.x * 13; player.vel.z += _v2.z * 13; player.vel.y = 7;
          player.onGround = false;
        }
      }
      if (k >= 1) { B.stompT = -1; B.stompHit = false; group.scale.y = 1.18; }
    } else {
      /* ---- locomoção + ataques ---- */
      const dx = tx - group.position.x, dz = tz - group.position.z;
      const dd = Math.hypot(dx, dz);
      let spd = 0;
      if (dd > (leashing ? 2 : 5.5)) {
        spd = speed;
        group.position.x += dx / dd * speed * dt;
        group.position.z += dz / dd * speed * dt;
      }
      Structures.collide(group.position, 1.5, 5); // entra/sai só pelo portão
      const targetYaw = Math.atan2(dx, dz);
      let dy = targetYaw - B.yaw;
      while (dy > Math.PI) dy -= TAU;
      while (dy < -Math.PI) dy += TAU;
      B.yaw += dy * Math.min(1, 3.5 * dt);
      group.rotation.y = B.yaw;
      B.walkPhase += dt * (1.2 + spd * 0.9);
      const sw = Math.sin(B.walkPhase * 2) * 0.5 * (spd > 0 ? 1 : 0);
      parts.legL.rotation.x = sw;
      parts.legR.rotation.x = -sw;
      parts.armL.rotation.x = -sw * 0.5;
      parts.armR.rotation.x = sw * 0.5 - 0.25;
      group.position.y = heightAt(group.position.x, group.position.z) + Math.abs(Math.sin(B.walkPhase)) * 0.12 * (spd > 0 ? 1 : 0);
      group.rotation.x = -B.flinch * 0.1 + (spd > 0 ? 0.05 : 0);

      if (!leashing && !player.dead) {
        if (dPlayer < 8.5 && t >= B.nextStomp) {
          B.stompT = 0; B.stompHit = false;
          B.nextStomp = t + 5;
        } else if (dPlayer < 80 && dPlayer > 9 && t >= B.nextVolley) {
          B.volleyLeft = B.enraged ? 5 : 3;
          B.nextVolley = t + (B.enraged ? 1.7 : 2.8);
          B.nextOrb = t;
        }
      }
      if (B.volleyLeft > 0 && t >= B.nextOrb) {
        B.volleyLeft--;
        B.nextOrb = t + 0.22;
        fireOrb();
      }
    }
  }
  updateBar();
  const api = { update, damage, hitSpheres, get alive() { return B.alive; }, pos: () => group.position, state: B, name: 'COLOSSO' };
  Bosses.push(api);
  return api;
}
