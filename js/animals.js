/* animais (veados, lobos) — extraído de game.js; deps explícitas */
import * as THREE from 'three';

export function createAnimals(deps) {
  const { clamp, rand, TAU, heightAt, slopeAt, WATER_LEVEL, CITY, scene, csmMat, addScore, player, playerDamage, extraTargets, Pickups,
    Structures = null, obstaclesNear = null, SFX = null } = deps;
  const list = [];
  const _biteFrom = new THREE.Vector3(), _biteTo = new THREE.Vector3();

  function biteBlocked(a) {
    _biteFrom.copy(a.group.position); _biteFrom.y += 0.55 * a.size;
    _biteTo.copy(player.pos); _biteTo.y += 0.7;
    if (Structures && typeof Structures.segBlocked === 'function' && Structures.segBlocked(_biteFrom, _biteTo)) return true;
    if (typeof obstaclesNear !== 'function') return false;

    const dx = _biteTo.x - _biteFrom.x, dz = _biteTo.z - _biteFrom.z;
    const len2 = dx * dx + dz * dz;
    if (len2 < 1e-6) return false;
    const mx = (_biteFrom.x + _biteTo.x) * 0.5, mz = (_biteFrom.z + _biteTo.z) * 0.5;
    for (const o of obstaclesNear(mx, mz)) {
      const k = clamp(((o.x - _biteFrom.x) * dx + (o.z - _biteFrom.z) * dz) / len2, 0, 1);
      const nx = _biteFrom.x + dx * k, nz = _biteFrom.z + dz * k;
      const ox = nx - o.x, oz = nz - o.z;
      if (ox * ox + oz * oz < o.r * o.r) return true;
    }
    return false;
  }
  function quadruped(color, size, predator) {
    const g = new THREE.Group();
    const mat = csmMat(new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26 * size, 0.6 * size, 5, 10), mat);
    body.rotation.z = Math.PI / 2;
    body.position.y = 0.62 * size;
    body.castShadow = true;
    g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17 * size, 10, 8), mat);
    head.position.set(0.48 * size, 0.85 * size, 0);
    g.add(head);
    const snout = new THREE.Mesh(new THREE.CapsuleGeometry(0.07 * size, 0.14 * size, 4, 8), mat);
    snout.rotation.z = Math.PI / 2;
    snout.position.set(0.64 * size, 0.8 * size, 0);
    g.add(snout);
    for (const se of [-1, 1]) { // orelhas
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.045 * size, 0.14 * size, 6), mat);
      ear.position.set(0.42 * size, 1.0 * size, se * 0.1 * size);
      g.add(ear);
    }
    if (!predator) { // chifres do cervo
      for (const se of [-1, 1]) {
        const h1 = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.3, 5), csmMat(new THREE.MeshStandardMaterial({ color: 0x9a7e54, roughness: 0.7 })));
        h1.position.set(0.42 * size, 1.12 * size, se * 0.08 * size);
        h1.rotation.z = -0.3; h1.rotation.x = se * 0.5;
        g.add(h1);
      }
    }
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.07 * size, 6, 5), mat);
    tail.position.set(-0.55 * size, 0.72 * size, 0);
    g.add(tail);
    const legs = [];
    for (const [lx, lz] of [[0.32, 0.14], [0.32, -0.14], [-0.32, 0.14], [-0.32, -0.14]]) {
      const lg = new THREE.Group();
      lg.position.set(lx * size, 0.5 * size, lz * size);
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.045 * size, 0.04 * size, 0.5 * size, 6), mat);
      l.position.y = -0.25 * size;
      lg.add(l);
      g.add(lg);
      legs.push(lg);
    }
    return { g, legs };
  }
  function spawnPos() {
    for (let i = 0; i < 30; i++) {
      const a = rand(TAU), r = rand(60, 420);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (heightAt(x, z) > WATER_LEVEL + 1 && slopeAt(x, z) < 0.4 && Math.hypot(x - CITY.x, z - CITY.z) > 100) return { x, z };
    }
    return { x: 120, z: 60 };
  }
  function makeAnimal(predator) {
    const size = predator ? 0.85 : rand(0.9, 1.15);
    const { g, legs } = quadruped(predator ? 0x4a4a52 : 0x9a6b42, size, predator);
    scene.add(g);
    const s = spawnPos();
    g.position.set(s.x, heightAt(s.x, s.z), s.z);
    const a = {
      predator, size, group: g, legs,
      alive: true, enabled: true, hp: predator ? 70 : 40,
      yaw: rand(TAU), phase: rand(TAU), speedF: 0,
      side: list.length % 2 ? 1 : -1,
      wander: rand(3, 8), biteT: 0, deadT: 0,
      sph: [{ c: new THREE.Vector3(), r: 0.55 * size, part: 'body' }, { c: new THREE.Vector3(), r: 0.24 * size, part: 'head' }],
      pos() { return g.position; },
      hitSpheres() {
        const p = g.position;
        this.sph[0].c.set(p.x, p.y + 0.62 * size, p.z);
        const fs = Math.sin(this.yaw), fc = Math.cos(this.yaw);
        this.sph[1].c.set(p.x + fs * 0.5 * size, p.y + 0.85 * size, p.z + fc * 0.5 * size);
        return this.sph;
      },
      damage(dmg, hitPos, dir, head) {
        if (!this.alive || !this.enabled) return false;
        this.hp -= dmg;
        this.fleeing = 6; // tomou tiro: foge (ou ataca, se lobo)
        if (this.hp <= 0) {
          this.alive = false;
          this.deadT = 0;
          addScore(40, false);
          Pickups.spawn({ x: g.position.x, z: g.position.z }, 'meat');
          return true;
        }
        return false;
      },
    };
    list.push(a);
    extraTargets.push(a);
    return a;
  }
  for (let i = 0; i < 8; i++) makeAnimal(false);
  for (let i = 0; i < 5; i++) makeAnimal(true);

  function update(dt, t) {
    for (const a of list) {
      const g = a.group;
      if (!a.enabled) continue;
      if (!a.alive) { // tomba de lado e some
        a.deadT += dt;
        g.rotation.z = Math.min(Math.PI / 2, a.deadT * 3);
        if (a.deadT > 5) {
          const s = spawnPos();
          g.position.set(s.x, heightAt(s.x, s.z), s.z);
          g.rotation.z = 0;
          a.hp = a.predator ? 70 : 40;
          a.alive = true;
          g.visible = true;
        }
        continue;
      }
      const dP = g.position.distanceTo(player.pos);
      const moveStartX = g.position.x, moveStartZ = g.position.z;
      let tx = null, tz = null, speed = 0;
      if (a.predator && dP < 24 && !player.dead) { // lobo caça
        tx = player.pos.x; tz = player.pos.z; speed = 4.4;
        if (dP < 1.7 && a.biteT <= 0 && !biteBlocked(a)) {
          a.biteT = 1.2;
          playerDamage(8 + (Math.random() * 5 | 0), g.position, { type: 'animal' });
          if (SFX && typeof SFX.groan === 'function') SFX.groan();
        }
      } else if (!a.predator && (dP < 12 || a.fleeing > 0)) { // cervo foge
        if (dP < 1.6 && a.biteT <= 0 && !biteBlocked(a)) { // encurralado: cabeçada/chifrada defensiva
          a.biteT = 1.5;
          playerDamage(6 + (Math.random() * 4 | 0), g.position, { type: 'animal' });
          if (SFX && typeof SFX.groan === 'function') SFX.groan();
        }
        tx = g.position.x + (g.position.x - player.pos.x);
        tz = g.position.z + (g.position.z - player.pos.z);
        speed = 5.2;
      } else { // vagueia
        a.wander -= dt;
        if (a.wander <= 0) { a.wander = rand(4, 9); a.wyaw = rand(TAU); }
        if (a.wyaw !== undefined && a.wander > 2) {
          tx = g.position.x + Math.sin(a.wyaw) * 10;
          tz = g.position.z + Math.cos(a.wyaw) * 10;
          speed = a.predator ? 1.6 : 1.2;
        }
      }
      a.fleeing = Math.max(0, (a.fleeing || 0) - dt);
      a.biteT = Math.max(0, a.biteT - dt);
      let spd = 0;
      if (tx !== null) {
        const dx = tx - g.position.x, dz = tz - g.position.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.5) {
          spd = speed;
          g.position.x += dx / d * speed * dt;
          g.position.z += dz / d * speed * dt;
          const targetYaw = Math.atan2(dx, dz);
          let dy = targetYaw - a.yaw;
          while (dy > Math.PI) dy -= TAU; while (dy < -Math.PI) dy += TAU;
          a.yaw += dy * Math.min(1, 6 * dt);
        }
      }
      if (typeof obstaclesNear === 'function') for (const o of obstaclesNear(g.position.x, g.position.z)) {
        let ox = g.position.x - o.x, oz = g.position.z - o.z;
        let d = Math.hypot(ox, oz);
        const rr = o.r + 0.28 * a.size;
        if (d >= rr) continue;
        if (d < 1e-4) { ox = a.side; oz = 0; d = 1; }
        const push = rr - d;
        const nx = ox / d, nz = oz / d;
        g.position.x += nx * push - nz * push * a.side * 0.45;
        g.position.z += nz * push + nx * push * a.side * 0.45;
      }
      if (Structures && typeof Structures.collide === 'function') Structures.collide(g.position, 0.28 * a.size, 1.1 * a.size);
      g.position.y = heightAt(g.position.x, g.position.z);
      const movedX = g.position.x - moveStartX, movedZ = g.position.z - moveStartZ;
      if (movedX * movedX + movedZ * movedZ > 1e-8) a.yaw = Math.atan2(movedX, movedZ);
      // A malha foi construída olhando para +X; a IA usa yaw 0 como movimento +Z.
      g.rotation.y = a.yaw - Math.PI / 2;
      a.phase += dt * (2 + spd * 2.6);
      const sw = Math.sin(a.phase * 2.4) * 0.55 * clamp(spd / 4, 0.12, 1);
      a.legs[0].rotation.x = sw; a.legs[3].rotation.x = sw;
      a.legs[1].rotation.x = -sw; a.legs[2].rotation.x = -sw;
    }
  }
  function setEnabled(enabled) {
    const on = !!enabled;
    for (const a of list) {
      a.enabled = on;
      a.group.visible = on && a.alive;
    }
  }
  return { update, list, setEnabled };
}
