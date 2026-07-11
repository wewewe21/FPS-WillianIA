/* animais (veados, lobos) — extraído de game.js; deps explícitas */
import * as THREE from 'three';

export function createAnimals(deps) {
  const { clamp, rand, TAU, heightAt, slopeAt, WATER_LEVEL, CITY, scene, csmMat, addScore, player, playerDamage, extraTargets, Pickups } = deps;
  const list = [];
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
      alive: true, hp: predator ? 70 : 40,
      yaw: rand(TAU), phase: rand(TAU), speedF: 0,
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
        if (!this.alive) return false;
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
      if (!a.alive) { // tomba de lado e some
        a.deadT += dt;
        g.rotation.z = Math.min(Math.PI / 2, a.deadT * 3);
        if (a.deadT > 5) {
          const s = spawnPos();
          g.position.set(s.x, heightAt(s.x, s.z), s.z);
          g.rotation.z = 0;
          a.hp = a.predator ? 70 : 40;
          a.alive = true;
        }
        continue;
      }
      const dP = g.position.distanceTo(player.pos);
      let tx = null, tz = null, speed = 0;
      if (a.predator && dP < 24 && !player.dead) { // lobo caça
        tx = player.pos.x; tz = player.pos.z; speed = 4.4;
        if (dP < 1.7 && a.biteT <= 0) {
          a.biteT = 1.2;
          playerDamage(8 + (Math.random() * 5 | 0), g.position);
        }
      } else if (!a.predator && (dP < 12 || a.fleeing > 0)) { // cervo foge
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
      g.position.y = heightAt(g.position.x, g.position.z);
      g.rotation.y = a.yaw;
      a.phase += dt * (2 + spd * 2.6);
      const sw = Math.sin(a.phase * 2.4) * 0.55 * clamp(spd / 4, 0.12, 1);
      a.legs[0].rotation.x = sw; a.legs[3].rotation.x = sw;
      a.legs[1].rotation.x = -sw; a.legs[2].rotation.x = -sw;
    }
  }
  return { update, list };
}
