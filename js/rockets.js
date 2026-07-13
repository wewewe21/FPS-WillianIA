/* ================================================================
   FOGUETES da bazuca — projétil físico com rastro de fumaça
   ================================================================ */
import * as THREE from 'three';

export function createRockets(deps) {
  const {
    rand, _v1, _v2, heightAt, FX, scene, Structures, player, Enemies, Grenades,
    Boss, Bosses = [], extraTargets = [], platforms = [], DmgNums, showHitmarker, SFX,
  } = deps;
  const pool = [];
  const _prevR = new THREE.Vector3(); // posição anterior do foguete (temp exclusivo)
  const _segR = new THREE.Vector3();
  const _toSphere = new THREE.Vector3();
  const _closest = new THREE.Vector3();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3a3f3a, roughness: 0.5 });
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.34, 8), bodyMat);
    body.rotation.x = Math.PI / 2; m.add(body);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.13, 8), new THREE.MeshStandardMaterial({ color: 0xc8581e, roughness: 0.4 }));
    tip.rotation.x = -Math.PI / 2; tip.position.z = -0.22; m.add(tip);
    m.visible = false;
    scene.add(m);
    pool.push({ m, vel: new THREE.Vector3(), live: false, smokeAcc: 0, splashProfile: null });
  }
  let lastExplosion = null;
  function fire(from, dir, splashProfile = null) {
    const r = pool.find(p => !p.live);
    if (!r) return;
    r.live = true; r.m.visible = true;
    r.m.position.copy(from);
    r.vel.copy(dir).multiplyScalar(34);
    r.smokeAcc = 0;
    r.splashProfile = splashProfile;
    r.m.lookAt(_v1.copy(from).add(dir));
  }
  function sweptTargetHit(target, to) {
    if (!target || !target.alive || typeof target.hitSpheres !== 'function') return false;
    _segR.copy(to).sub(_prevR);
    const len2 = _segR.lengthSq();
    for (const sphere of target.hitSpheres()) {
      _toSphere.copy(sphere.c).sub(_prevR);
      const k = len2 > 1e-8 ? THREE.MathUtils.clamp(_toSphere.dot(_segR) / len2, 0, 1) : 0;
      _closest.copy(_prevR).addScaledVector(_segR, k);
      const radius = sphere.r + 0.14;
      if (_closest.distanceToSquared(sphere.c) <= radius * radius) return true;
    }
    return false;
  }
  function crossedTrainingFloor(from, to) {
    const dy = to.y - from.y;
    if (Math.abs(dy) < 1e-8) return false;
    for (const p of platforms) {
      if (!p.training || p.ramp) continue;
      const k = (p.y - from.y) / dy;
      if (k < 0 || k > 1) continue;
      const x = from.x + (to.x - from.x) * k;
      const z = from.z + (to.z - from.z) * k;
      if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1) return true;
    }
    return false;
  }
  function update(dt, t) {
    for (const r of pool) {
      if (!r.live) continue;
      r.vel.y -= 2.5 * dt;
      _prevR.copy(r.m.position); // posição anterior (checa parede no caminho)
      r.m.position.addScaledVector(r.vel, dt);
      r.m.lookAt(_v1.copy(r.m.position).add(r.vel));
      r.smokeAcc += dt;
      if (r.smokeAcc > 0.03) {
        r.smokeAcc = 0;
        FX.spawnParticle(r.m.position, _v2.set(rand(-0.5, 0.5), rand(0.2, 0.8), rand(-0.5, 0.5)), 0x9b958c, 0.16, 0.5, -0.3);
      }
      let boom = r.m.position.y < heightAt(r.m.position.x, r.m.position.z) + 0.2;
      if (!boom && crossedTrainingFloor(_prevR, r.m.position)) boom = true;
      if (!boom && Structures.segBlocked(_prevR, r.m.position)) boom = true; // parede detona (antes atravessava prédio)
      if (!boom) for (const e of Enemies.list) if (e.alive && e.group.position.distanceToSquared(r.m.position) < 2.3) { boom = true; break; }
      if (!boom) for (const B2 of Bosses.length ? Bosses : [Boss])
        if (B2 && B2.alive && B2.pos().distanceTo(r.m.position) < 2.6) { boom = true; break; }
      if (!boom) {
        for (const target of extraTargets) if (sweptTargetHit(target, r.m.position)) { boom = true; break; }
      }
      // espoleta de proximidade também pros jogadores remotos (BR)
      if (!boom && window.__MP_remotePlayers) for (const rp of window.__MP_remotePlayers)
        if (rp.alive && rp.group.position.distanceToSquared(r.m.position) < 4) { boom = true; break; }
      if (boom || r.m.position.distanceTo(player.pos) > 340) {
        r.live = false; r.m.visible = false;
        const result = Grenades.explode(r.m.position, r.splashProfile || {});
        lastExplosion = {
          x: r.m.position.x, y: r.m.position.y, z: r.m.position.z,
          totalDamage: result.totalDamage, hitAny: result.hitAny, killAny: result.killAny,
        };
        if (result.hitAny && DmgNums && showHitmarker) {
          DmgNums.spawn(result.hitPos, Math.round(result.totalDamage), false);
          showHitmarker(result.killAny);
          if (SFX) { if (result.killAny) SFX.kill(); else SFX.hit(); }
        }
      }
    }
  }
  return {
    fire, update,
    get activeCount() { return pool.reduce((n, rocket) => n + (rocket.live ? 1 : 0), 0); },
    get lastExplosion() { return lastExplosion; },
  };
}
