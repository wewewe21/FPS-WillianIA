/* ================================================================
   FOGUETES da bazuca — projétil físico com rastro de fumaça
   ================================================================ */
import * as THREE from 'three';

export function createRockets(deps) {
  const { rand, _v1, _v2, heightAt, FX, scene, Structures, player, Enemies, Grenades, Boss, Bosses = [], extraTargets = [] } = deps;
  const pool = [];
  const _prevR = new THREE.Vector3(); // posição anterior do foguete (temp exclusivo)
  const _segR = new THREE.Vector3();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3a3f3a, roughness: 0.5 });
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.34, 8), bodyMat);
    body.rotation.x = Math.PI / 2; m.add(body);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.13, 8), new THREE.MeshStandardMaterial({ color: 0xc8581e, roughness: 0.4 }));
    tip.rotation.x = -Math.PI / 2; tip.position.z = -0.22; m.add(tip);
    m.visible = false;
    scene.add(m);
    pool.push({ m, vel: new THREE.Vector3(), live: false, smokeAcc: 0 });
  }
  function fire(from, dir) {
    const r = pool.find(p => !p.live);
    if (!r) return;
    r.live = true; r.m.visible = true;
    r.m.position.copy(from);
    r.vel.copy(dir).multiplyScalar(34);
    r.smokeAcc = 0;            // RESET: item reutilizado do pool não herda o acumulador
    r.m.lookAt(_v1.copy(from).add(dir));
  }
  function detonate(r) {
    r.live = false; r.m.visible = false;
    Grenades.explode(r.m.position, 'BAZUCA'); // UMA explosão por foguete (live=false já feito)
  }
  // espoletas de proximidade (inimigos, bosses, alvos extras, players remotos)
  function proximityHit(pos) {
    for (const e of Enemies.list) if (e.alive && e.group.position.distanceToSquared(pos) < 2.3) return true;
    if (Boss.alive && Boss.pos().distanceTo(pos) < 2.6) return true;
    for (const b of Bosses) if (b !== Boss && b.alive && b.pos().distanceTo(pos) < 2.6) return true;
    for (const a of extraTargets) if (a.alive && a.enabled !== false && a.pos().distanceToSquared(pos) < 2.3) return true;
    const rps = typeof window !== 'undefined' && window.__MP_remotePlayers;
    if (rps) for (const rp of rps) if (rp.alive && rp.group.position.distanceToSquared(pos) < 4) return true;
    return false;
  }
  // integra UM passo de tempo pequeno: gravidade + varredura de segmento contra
  // terreno/estruturas (sem atravessar parede) + espoletas. Explode no 1º impacto.
  function stepRocket(r, h) {
    r.vel.y -= 2.5 * h;
    _prevR.copy(r.m.position);                 // posição anterior (checa parede no caminho)
    r.m.position.addScaledVector(r.vel, h);
    r.smokeAcc += h;
    if (r.smokeAcc > 0.03) {
      r.smokeAcc = 0;
      FX.spawnParticle(r.m.position, _v2.set(rand(-0.5, 0.5), rand(0.2, 0.8), rand(-0.5, 0.5)), 0x9b958c, 0.16, 0.5, -0.3);
    }
    let boom = r.m.position.y < heightAt(r.m.position.x, r.m.position.z) + 0.2; // terreno
    if (!boom && Structures.segBlocked(_prevR, r.m.position)) {                  // parede/telhado/laje
      _segR.copy(r.m.position).sub(_prevR);
      const segLen = _segR.length();
      if (segLen > 1e-5 && typeof Structures.rayHit === 'function') {
        _segR.multiplyScalar(1 / segLen);
        const hitD = Structures.rayHit(_prevR, _segR, segLen);
        if (Number.isFinite(hitD)) r.m.position.copy(_prevR).addScaledVector(_segR, Math.max(0, Math.min(segLen, hitD) - 0.04));
        else r.m.position.copy(_prevR);       // exatamente no ponto de impacto
      } else r.m.position.copy(_prevR);
      boom = true;
    }
    if (!boom) boom = proximityHit(r.m.position);
    if (boom || r.m.position.distanceTo(player.pos) > 340) detonate(r);
  }
  function update(dt) {
    const STEP = 1 / 120; // passo fixo: resultado estável entre 30/60/120 FPS e sem tunneling
    for (const r of pool) {
      if (!r.live) continue;
      let remaining = Math.min(dt, 0.25); // clamp anti-“spiral of death” em travadas
      while (remaining > 1e-6 && r.live) {
        const h = Math.min(STEP, remaining);
        remaining -= h;
        stepRocket(r, h);
      }
      if (r.live) r.m.lookAt(_v1.copy(r.m.position).add(r.vel)); // aponta na direção da velocidade
    }
  }
  return { fire, update };
}
