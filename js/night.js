/* criaturas da noite (zumbis/fantasmas) — extraído de game.js; deps explícitas */
import * as THREE from 'three';

export function createNight(deps) {
  const { rand, TAU, heightAt, WATER_LEVEL, SFX, scene, csmMat, Structures, addScore, addKillFeed, state, player, playerDamage, extraTargets, Pickups, Env, MFlags } = deps;
  const zMat = csmMat(new THREE.MeshStandardMaterial({ color: 0x5a7a3e, roughness: 0.85 }));
  const zRag = csmMat(new THREE.MeshStandardMaterial({ color: 0x3c3a30, roughness: 0.9 }));
  const gMat = new THREE.MeshBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.28, depthWrite: false });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x100000, emissive: 0xff3214, emissiveIntensity: 3 });
  const list = [];
  function makeZombie() {
    const g = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.5, 5, 10), zRag);
    torso.position.y = 1.1; torso.castShadow = true; g.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 9), zMat);
    head.position.y = 1.75; g.add(head);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 5), eyeMat);
      eye.position.set(s * 0.09, 1.78, 0.2); g.add(eye);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.55, 4, 8), zMat);
      arm.position.set(s * 0.38, 1.35, 0.3);
      arm.rotation.x = -Math.PI / 2 + 0.2; g.add(arm); // braços esticados
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.5, 4, 8), zRag);
      leg.position.set(s * 0.16, 0.45, 0); g.add(leg);
    }
    return g;
  }
  function makeGhost() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 10), gMat);
    body.scale.y = 1.3; body.position.y = 1.4; g.add(body);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.9, 10, 1, true), gMat);
    tail.rotation.x = Math.PI; tail.position.y = 0.75; g.add(tail);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), eyeMat);
      eye.position.set(s * 0.13, 1.5, 0.32); g.add(eye);
    }
    return g;
  }
  function makeCreature(ghost) {
    const g = ghost ? makeGhost() : makeZombie();
    g.visible = false;
    scene.add(g);
    const c = {
      ghost, group: g,
      alive: false, hp: 0, yaw: 0, phase: rand(TAU), hitT: 0, groanT: rand(4),
      sph: [{ c: new THREE.Vector3(), r: 0.45, part: 'body' }, { c: new THREE.Vector3(), r: 0.3, part: 'head' }],
      pos() { return g.position; },
      hitSpheres() {
        this.sph[0].c.set(g.position.x, g.position.y + 1.1, g.position.z);
        this.sph[1].c.set(g.position.x, g.position.y + (this.ghost ? 1.4 : 1.75), g.position.z);
        return this.sph;
      },
      damage(dmg) {
        if (!this.alive) return false;
        this.hp -= dmg;
        if (this.hp <= 0) {
          this.alive = false;
          this.group.visible = false;
          addScore(this.ghost ? 120 : 80, true);
          addKillFeed(`<b>Você</b> ▸ ${this.ghost ? 'Fantasma' : 'Zumbi'}`);
          if (!this.ghost && Math.random() < 0.4) Pickups.drop(g.position);
          return true;
        }
        return false;
      },
    };
    list.push(c);
    extraTargets.push(c);
    return c;
  }
  for (let i = 0; i < 9; i++) makeCreature(false);
  for (let i = 0; i < 5; i++) makeCreature(true);
  let wasDeepNight = false;

  function update(dt, t) {
    const nk = Env.nightK;
    if (nk > 0.8) wasDeepNight = true;
    if (wasDeepNight && nk < 0.2 && state.started) { MFlags.night = true; }
    for (const c of list) {
      const g = c.group;
      if (!c.alive) {
        // só nascem na noite fechada, perto do player
        if (nk > 0.65 && Math.random() < dt * 0.25 && !player.dead) {
          const a = rand(TAU), r = rand(26, 55);
          const x = player.pos.x + Math.cos(a) * r, z = player.pos.z + Math.sin(a) * r;
          if (heightAt(x, z) < WATER_LEVEL + 0.5) continue;
          c.alive = true;
          c.hp = c.ghost ? 50 : 70;
          g.position.set(x, heightAt(x, z), z);
          g.visible = true;
          if (c.ghost) SFX.whisper(); else SFX.groan();
        }
        continue;
      }
      if (nk < 0.4) { // amanheceu: derretem
        g.scale.y = Math.max(0.01, g.scale.y - dt * 0.8);
        g.position.y -= dt * 1.2;
        if (g.scale.y <= 0.02) { c.alive = false; g.visible = false; g.scale.y = 1; }
        continue;
      }
      const dP = g.position.distanceTo(player.pos);
      const speed = c.ghost ? 3.6 : 2.3;
      if (dP > 1.4 && !player.dead) {
        const dx = player.pos.x - g.position.x, dz = player.pos.z - g.position.z;
        const d = Math.hypot(dx, dz);
        g.position.x += dx / d * speed * dt;
        g.position.z += dz / d * speed * dt;
        c.yaw = Math.atan2(dx, dz);
      }
      c.hitT = Math.max(0, c.hitT - dt);
      if (dP < 1.6 && c.hitT <= 0 && !player.dead) {
        c.hitT = c.ghost ? 0.8 : 1.2;
        playerDamage(c.ghost ? 7 : 13, g.position);
        if (c.ghost) SFX.whisper();
      }
      c.phase += dt * 4;
      if (c.ghost) {
        g.position.y = heightAt(g.position.x, g.position.z) + 0.5 + Math.sin(c.phase) * 0.25;
        g.children[0].material.opacity = 0.2 + Math.sin(t * 3 + c.phase) * 0.1;
      } else {
        Structures.collide(g.position, 0.4, 1.8); // zumbis respeitam paredes
        g.position.y = heightAt(g.position.x, g.position.z) + Math.abs(Math.sin(c.phase)) * 0.04;
        g.rotation.z = Math.sin(c.phase * 0.7) * 0.08; // cambaleia
      }
      g.rotation.y = c.yaw;
      c.groanT -= dt;
      if (c.groanT <= 0 && dP < 30) {
        c.groanT = rand(4, 9);
        if (c.ghost) SFX.whisper(); else SFX.groan();
      }
    }
  }
  return { update, list };
}
