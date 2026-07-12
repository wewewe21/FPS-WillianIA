/* esqueletos caçadores: vários espalhados pelo mapa, caçam o player
   sem parar, DESVIANDO de árvores, pedras e paredes (têm corpo: a
   colisão empurra pra fora e o excesso vira deslize tangencial, então
   eles contornam e seguem a caça). Batem de perto, morrem com tiro
   (extraTargets) e renascem longe. Modelo GLB com rig — a marcha é
   procedural nos ossos (o GLB não traz ciclo de caminhada). */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneRig } from 'three/addons/utils/SkeletonUtils.js';

export function createSkeletons(deps) {
  const { rand, TAU, heightAt, WATER_LEVEL, SFX, scene, csmMat, addScore, addKillFeed,
    player, playerDamage, extraTargets, Pickups, Structures, obstaclesNear } = deps;

  const COUNT = 7, HP = 90, SPEED = 3.1, MELEE_DMG = 12, MELEE_RANGE = 1.8, MELEE_CD = 1.1;
  const list = [];
  const api = { list, update, modelReady: false };

  // ponto de chão firme (fora de lago) — pra spawn e respawn
  function drySpot(cx, cz, rMin, rMax) {
    for (let i = 0; i < 24; i++) {
      const a = rand(TAU), r = rand(rMin, rMax);
      const x = THREE.MathUtils.clamp(cx + Math.cos(a) * r, -520, 520);
      const z = THREE.MathUtils.clamp(cz + Math.sin(a) * r, -520, 520);
      if (heightAt(x, z) > WATER_LEVEL + 0.5) return { x, z };
    }
    return { x: cx + rMin, z: cz };
  }

  function makeSkeleton() {
    const g = new THREE.Group();
    g.visible = false;
    scene.add(g);
    const sk = {
      group: g, alive: false, hp: 0, yaw: 0, phase: rand(TAU),
      side: list.length % 2 ? 1 : -1, // lado fixo do contorno (metade pra cada)
      hitT: 0, respawnT: 0, groanT: rand(6), bones: null,
      sph: [{ c: new THREE.Vector3(), r: 0.45, part: 'body' }, { c: new THREE.Vector3(), r: 0.28, part: 'head' }],
      pos() { return g.position; },
      hitSpheres() {
        this.sph[0].c.set(g.position.x, g.position.y + 1.05, g.position.z);
        this.sph[1].c.set(g.position.x, g.position.y + 1.7, g.position.z);
        return this.sph;
      },
      damage(dmg) {
        if (!this.alive) return false;
        this.hp -= dmg;
        if (this.hp <= 0) {
          this.alive = false;
          this.group.visible = false;
          this.respawnT = rand(18, 22); // volta pra caça logo, mas longe
          addScore(90, true);
          addKillFeed('<b>Você</b> ▸ Esqueleto');
          if (Math.random() < 0.3) Pickups.drop(g.position);
          return true;
        }
        return false;
      },
    };
    list.push(sk);
    extraTargets.push(sk);
    return sk;
  }
  for (let i = 0; i < COUNT; i++) makeSkeleton();

  new GLTFLoader().load('/assets/models/skeleton.v1.glb', gltf => {
    const proto = gltf.scene;
    const box = new THREE.Box3().setFromObject(proto);
    const size = box.getSize(new THREE.Vector3());
    const s = 2.25 / size.y; // esqueleto de 2,25m — maior que o player: dá medo
    for (const sk of list) {
      const root = cloneRig(proto); // rig compartilhado quebra com .clone() comum
      root.scale.setScalar(s);
      root.position.y = -box.min.y * s; // pés no chão do grupo
      root.traverse(o => {
        if (o.isMesh || o.isSkinnedMesh) {
          o.castShadow = true;
          o.frustumCulled = false; // skinned: bbox estático erra e some da tela
          if (o.material) csmMat(o.material);
        }
      });
      sk.bones = {
        thL: root.getObjectByName('ThighL_Armature') || root.getObjectByName('Thigh.L_Armature'),
        thR: root.getObjectByName('ThighR_Armature') || root.getObjectByName('Thigh.R_Armature'),
        armL: root.getObjectByName('UpperarmL_Armature') || root.getObjectByName('Upperarm.L_Armature'),
        armR: root.getObjectByName('UpperarmR_Armature') || root.getObjectByName('Upperarm.R_Armature'),
        jaw: root.getObjectByName('Jaw2_Armature'),
      };
      for (const b of Object.values(sk.bones)) if (b) b.userData.rest = b.rotation.clone();
      sk.group.add(root);
      // nasce espalhado pelo mapa, longe do acampamento inicial
      const p = drySpot(player.pos.x, player.pos.z, 90, 460);
      sk.group.position.set(p.x, heightAt(p.x, p.z), p.z);
      sk.hp = HP;
      sk.alive = true;
      sk.group.visible = true;
    }
    api.modelReady = true;
  }, undefined, e => console.warn('[esqueletos] modelo não carregou', e));

  function update(dt, t) {
    for (const sk of list) {
      const g = sk.group;
      if (!sk.alive) {
        if (!api.modelReady) continue;
        sk.respawnT -= dt;
        if (sk.respawnT <= 0 && !player.dead) {
          const p = drySpot(player.pos.x, player.pos.z, 60, 140);
          g.position.set(p.x, heightAt(p.x, p.z), p.z);
          sk.hp = HP;
          sk.alive = true;
          g.visible = true;
        }
        continue;
      }
      // caça eterna: anda na direção do player...
      const dx = player.pos.x - g.position.x, dz = player.pos.z - g.position.z;
      const dP = Math.hypot(dx, dz);
      if (dP > 1.5 && !player.dead) {
        g.position.x += dx / dP * SPEED * dt;
        g.position.z += dz / dP * SPEED * dt;
        sk.yaw = Math.atan2(dx, dz);
      }
      // ...mas tem corpo: árvore/pedra empurra pra fora, com deslize
      // tangencial pra contornar (sem ele, rota alinhada ao centro trava)
      for (const o of obstaclesNear(g.position.x, g.position.z)) {
        const ox = g.position.x - o.x, oz = g.position.z - o.z;
        const d = Math.hypot(ox, oz), rr = o.r + 0.35;
        if (d >= rr || d < 1e-4) continue;
        const push = rr - d;
        g.position.x += (ox / d) * push + (-oz / d) * push * sk.side;
        g.position.z += (oz / d) * push + (ox / d) * push * sk.side;
      }
      Structures.collide(g.position, 0.35, 1.8); // paredes/ruínas também seguram
      g.position.y = heightAt(g.position.x, g.position.z);
      g.rotation.y = sk.yaw;
      // marcha procedural: coxas alternam, braços apontam pro player, queixo bate
      // (eixo z = frente/trás neste rig — validado por foto nos três eixos)
      sk.phase += dt * 5.2;
      const sw = Math.sin(sk.phase);
      const b = sk.bones;
      if (b) {
        if (b.thL) b.thL.rotation.z = b.thL.userData.rest.z + sw * 0.5;
        if (b.thR) b.thR.rotation.z = b.thR.userData.rest.z - sw * 0.5;
        if (b.armL) b.armL.rotation.z = b.armL.userData.rest.z - 1.15 + sw * 0.18;
        if (b.armR) b.armR.rotation.z = b.armR.userData.rest.z + 1.15 - sw * 0.18;
        if (b.jaw && dP < 12) b.jaw.rotation.x = b.jaw.userData.rest.x + Math.max(0, Math.sin(t * 9)) * 0.35;
      }
      g.rotation.z = sw * 0.05; // gingado
      // porrada de osso
      sk.hitT = Math.max(0, sk.hitT - dt);
      if (dP < MELEE_RANGE && sk.hitT <= 0 && !player.dead) {
        sk.hitT = MELEE_CD;
        playerDamage(MELEE_DMG, g.position);
      }
      sk.groanT -= dt;
      if (sk.groanT <= 0 && dP < 28) {
        sk.groanT = rand(5, 11);
        SFX.groan();
      }
    }
  }

  return api;
}
