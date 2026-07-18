/* esqueletos caçadores: vários espalhados pelo mapa, caçam o player
   sem parar, DESVIANDO de árvores, pedras e paredes (têm corpo: a
   colisão empurra pra fora e o excesso vira deslize tangencial, então
   eles contornam e seguem a caça). Batem de perto, morrem com tiro
   (extraTargets) e renascem longe. Modelo GLB com rig — caminhada,
   empunhadura e ataque são animados proceduralmente nos ossos. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneRig } from 'three/addons/utils/SkeletonUtils.js';
import { meleeBlocked } from './aihelpers.js';

const _poseEuler = new THREE.Euler(0, 0, 0, 'XYZ');
const _poseQuat = new THREE.Quaternion();
const _handWorld = new THREE.Vector3();
const _handLocal = new THREE.Vector3();
const _swordDir = new THREE.Vector3();
const _swordCarry = new THREE.Vector3(0.2, -0.94, 0.27).normalize();
const _swordRaised = new THREE.Vector3(0.38, 0.84, -0.38).normalize();
const _swordStrike = new THREE.Vector3(-0.48, -0.18, 0.86).normalize();
const _up = new THREE.Vector3(0, 1, 0);

function smooth01(v) {
  const x = THREE.MathUtils.clamp(v, 0, 1);
  return x * x * (3 - 2 * x);
}

function canonicalBoneName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function collectBones(root) {
  const byName = new Map();
  root.traverse(o => {
    if (o.isBone) byName.set(canonicalBoneName(o.name), o);
  });
  const pick = (...candidates) => {
    for (const candidate of candidates) {
      const exact = byName.get(canonicalBoneName(candidate));
      if (exact) return exact;
    }
    const normalized = candidates.map(canonicalBoneName);
    for (const [name, bone] of byName) {
      if (normalized.some(candidate => name.includes(candidate))) return bone;
    }
    return null;
  };
  return {
    hips: pick('Hips_Armature', 'Pelvis_Armature', 'Root_Armature'),
    spine: pick('Spine_Armature', 'Spine1_Armature'),
    chest: pick('Spine2_Armature', 'Chest_Armature', 'UpperSpine_Armature'),
    neck: pick('Neck_Armature'),
    head: pick('Head_Armature'),
    jaw: pick('Jaw2_Armature', 'Jaw_Armature'),
    shoulderL: pick('Shoulder.L_Armature', 'ShoulderL_Armature', 'Clavicle.L_Armature'),
    shoulderR: pick('Shoulder.R_Armature', 'ShoulderR_Armature', 'Clavicle.R_Armature'),
    armL: pick('Upperarm.L_Armature', 'UpperarmL_Armature'),
    armR: pick('Upperarm.R_Armature', 'UpperarmR_Armature'),
    foreL: pick('Forearm.L_Armature', 'Lowerarm.L_Armature', 'ForearmL_Armature'),
    foreR: pick('Forearm.R_Armature', 'Lowerarm.R_Armature', 'ForearmR_Armature'),
    handL: pick('Hand.L_Armature', 'HandL_Armature'),
    handR: pick('Hand.R_Armature', 'HandR_Armature'),
    thL: pick('Thigh.L_Armature', 'ThighL_Armature'),
    thR: pick('Thigh.R_Armature', 'ThighR_Armature'),
    calfL: pick('Calf.L_Armature', 'Shin.L_Armature', 'Lowerleg.L_Armature'),
    calfR: pick('Calf.R_Armature', 'Shin.R_Armature', 'Lowerleg.R_Armature'),
    footL: pick('Foot.L_Armature', 'FootL_Armature'),
    footR: pick('Foot.R_Armature', 'FootR_Armature'),
    toeL: pick('Toe.L_Armature', 'ToeL_Armature'),
    toeR: pick('Toe.R_Armature', 'ToeR_Armature'),
  };
}

function rememberRestPose(sk) {
  sk.rest = new Map();
  for (const bone of Object.values(sk.bones)) {
    if (bone && !sk.rest.has(bone)) {
      sk.rest.set(bone, {
        quaternion: bone.quaternion.clone(),
        position: bone.position.clone(),
      });
    }
  }
}

function poseBone(sk, bone, x = 0, y = 0, z = 0) {
  if (!bone) return;
  const rest = sk.rest.get(bone);
  if (!rest) return;
  _poseEuler.set(x, y, z, 'XYZ');
  _poseQuat.setFromEuler(_poseEuler);
  bone.quaternion.copy(rest.quaternion).multiply(_poseQuat);
}

function makeSword(materials) {
  const sword = new THREE.Group();
  sword.name = 'SkeletonSword';

  const bladeGeo = new THREE.BoxGeometry(0.085, 0.92, 0.035);
  bladeGeo.translate(0, 0.56, 0);
  const blade = new THREE.Mesh(bladeGeo, materials.blade);

  const tipGeo = new THREE.ConeGeometry(0.047, 0.13, 4);
  tipGeo.rotateY(Math.PI / 4);
  tipGeo.translate(0, 1.085, 0);
  const tip = new THREE.Mesh(tipGeo, materials.blade);

  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.055, 0.07), materials.guard);
  guard.position.y = 0.085;

  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.042, 0.25, 8), materials.grip);
  grip.position.y = -0.06;

  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), materials.guard);
  pommel.position.y = -0.21;

  for (const mesh of [blade, tip, guard, grip, pommel]) {
    mesh.castShadow = true;
    sword.add(mesh);
  }
  return sword;
}

function updateSword(sk, attackP) {
  if (!sk.sword) return;
  const g = sk.group;
  const hand = sk.bones && sk.bones.handR;

  if (hand) {
    g.updateMatrixWorld(true);
    hand.getWorldPosition(_handWorld);
    _handLocal.copy(_handWorld);
    g.worldToLocal(_handLocal);
    sk.sword.position.copy(_handLocal);
  } else {
    sk.sword.position.set(0.48, 1.2, 0.08);
  }

  if (attackP < 0) {
    _swordDir.copy(_swordCarry);
  } else {
    const wind = smooth01(attackP / 0.32);
    const cut = smooth01((attackP - 0.32) / 0.27);
    const recover = smooth01((attackP - 0.59) / 0.41);
    _swordDir.lerpVectors(_swordCarry, _swordRaised, wind);
    _swordDir.lerp(_swordStrike, cut).lerp(_swordCarry, recover).normalize();
  }

  sk.sword.quaternion.setFromUnitVectors(_up, _swordDir);
  sk.sword.position.addScaledVector(_swordDir, 0.015);
}

function animateSkeleton(sk, dt, t, moving) {
  if (!sk.bones || !sk.rest) return;
  const b = sk.bones;
  const targetMove = moving && !sk.attacking ? 1 : 0;
  sk.moveBlend += (targetMove - sk.moveBlend) * (1 - Math.exp(-10 * dt));
  if (moving && !sk.attacking) sk.phase += dt * 7.2;

  const walk = sk.moveBlend;
  const stride = Math.sin(sk.phase);
  const step = Math.cos(sk.phase);
  const liftL = Math.max(0, -stride);
  const liftR = Math.max(0, stride);
  const idle = Math.sin(t * 1.55 + sk.idlePhase);
  const carryR = 0.42 + stride * 0.1 * walk;

  let attackP = -1;
  let wind = 0, cut = 0, recover = 0;
  if (sk.attacking) {
    attackP = THREE.MathUtils.clamp(sk.attackT / sk.attackDuration, 0, 1);
    wind = smooth01(attackP / 0.32);
    cut = smooth01((attackP - 0.32) / 0.27);
    recover = smooth01((attackP - 0.59) / 0.41);
  }

  const attackValue = (carry, raised, strike) => {
    if (attackP < 0) return carry;
    return THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(THREE.MathUtils.lerp(carry, raised, wind), strike, cut),
      carry,
      recover
    );
  };

  const chestTwist = attackValue(-stride * 0.045 * walk, -0.34, 0.42);
  const bodyLean = 0.04 * walk + attackValue(0, -0.08, 0.13);
  const bob = Math.abs(step) * 0.035 * walk + idle * 0.006;
  sk.model.position.y = sk.modelBaseY + bob;
  sk.model.quaternion.copy(sk.modelBaseQuaternion);
  _poseEuler.set(bodyLean, 0, -stride * 0.018 * walk, 'XYZ');
  sk.model.quaternion.multiply(_poseQuat.setFromEuler(_poseEuler));

  poseBone(sk, b.hips,
    0,
    -chestTwist * 0.25 + stride * 0.035 * walk,
    -stride * 0.055 * walk);
  poseBone(sk, b.spine,
    bodyLean * 0.35,
    chestTwist * 0.55,
    stride * 0.035 * walk);
  poseBone(sk, b.chest,
    bodyLean * 0.55,
    chestTwist,
    -stride * 0.04 * walk);
  poseBone(sk, b.neck,
    -bodyLean * 0.3 + idle * 0.01,
    -chestTwist * 0.22,
    -stride * 0.015 * walk);
  poseBone(sk, b.head,
    idle * 0.018 + (cut - recover) * 0.04,
    -chestTwist * 0.18,
    -stride * 0.012 * walk);

  poseBone(sk, b.thL, 0, 0, stride * 0.58 * walk);
  poseBone(sk, b.thR, 0, 0, -stride * 0.58 * walk);
  poseBone(sk, b.calfL, 0, 0, -liftL * 0.72 * walk);
  poseBone(sk, b.calfR, 0, 0, liftR * 0.72 * walk);
  poseBone(sk, b.footL, 0, 0, (-stride * 0.16 + liftL * 0.2) * walk);
  poseBone(sk, b.footR, 0, 0, (stride * 0.16 - liftR * 0.2) * walk);
  poseBone(sk, b.toeL, 0, 0, Math.max(0, step) * 0.09 * walk);
  poseBone(sk, b.toeR, 0, 0, Math.max(0, -step) * 0.09 * walk);

  poseBone(sk, b.shoulderL, 0, -chestTwist * 0.18, 0);
  poseBone(sk, b.shoulderR, 0, -chestTwist * 0.12, 0);
  poseBone(sk, b.armL,
    attackValue(0, -0.1, 0.18),
    attackValue(0, 0.08, -0.12),
    attackValue(-stride * 0.42 * walk, -0.42, -0.18));
  poseBone(sk, b.foreL,
    attackValue(0, 0.08, -0.08),
    0,
    attackValue(-0.08 - liftR * 0.16 * walk, -0.28, -0.42));
  poseBone(sk, b.handL, 0, 0, attackValue(0, -0.08, 0.12));

  poseBone(sk, b.armR,
    attackValue(0.08, -0.58, 0.38),
    attackValue(0, -0.2, 0.28),
    attackValue(carryR, 1.26, -0.72));
  poseBone(sk, b.foreR,
    attackValue(0.08, -0.35, 0.18),
    attackValue(0, 0.12, -0.18),
    attackValue(0.62, 1.05, 0.12));
  poseBone(sk, b.handR,
    attackValue(0, -0.14, 0.08),
    attackValue(0, 0.1, -0.12),
    attackValue(0.08, 0.22, -0.18));

  const jawOpen = Math.max(
    sk.targetDistance < 12 ? Math.max(0, Math.sin(t * 9 + sk.idlePhase)) * 0.2 : 0,
    sk.attacking ? Math.sin(Math.min(1, attackP / 0.45) * Math.PI) * 0.32 : 0
  );
  poseBone(sk, b.jaw, jawOpen, 0, 0);
  updateSword(sk, attackP);
}

export function createSkeletons(deps) {
  const { rand, TAU, heightAt, WATER_LEVEL, SFX, scene, csmMat, addScore, addKillFeed,
    player, playerDamage, extraTargets, Pickups, Structures, obstaclesNear } = deps;

  const COUNT = 7, HP = 90, SPEED = 3.1, MELEE_DMG = 12, MELEE_RANGE = 1.8, MELEE_CD = 1.15;
  const ATTACK_DURATION = 0.9, HIT_AT = 0.48;
  const MIN_SPAWN_SEPARATION = 24;
  const list = [];
  let enabled = true;
  const api = { list, update, setEnabled, modelReady: false };

  const swordMaterials = {
    blade: csmMat(new THREE.MeshStandardMaterial({ color: 0xb9c2cc, metalness: 0.88, roughness: 0.24 })),
    guard: csmMat(new THREE.MeshStandardMaterial({ color: 0x6d5840, metalness: 0.72, roughness: 0.34 })),
    grip: csmMat(new THREE.MeshStandardMaterial({ color: 0x261912, roughness: 0.78 })),
  };

  function setEnabled(value) {
    enabled = !!value;
    for (const sk of list) {
      sk.enabled = enabled;
      sk.group.visible = enabled && sk.alive;
    }
  }

  // ponto de chão firme (fora de lago) — pra spawn e respawn
  function drySpot(cx, cz, rMin, rMax) {
    const valid = (x, z) => heightAt(x, z) > WATER_LEVEL + 0.5 && list.every(sk =>
      !sk.alive || Math.hypot(x - sk.group.position.x, z - sk.group.position.z) >= MIN_SPAWN_SEPARATION);
    for (let i = 0; i < 24; i++) {
      const a = rand(TAU), r = rand(rMin, rMax);
      const x = THREE.MathUtils.clamp(cx + Math.cos(a) * r, -520, 520);
      const z = THREE.MathUtils.clamp(cz + Math.sin(a) * r, -520, 520);
      if (valid(x, z)) return { x, z };
    }
    // RNG pode repetir a mesma amostra; varredura determinística mantém a separação.
    for (const r of [rMin, (rMin + rMax) / 2, rMax]) {
      for (let i = 0; i < 48; i++) {
        const a = i / 48 * TAU;
        const x = THREE.MathUtils.clamp(cx + Math.cos(a) * r, -520, 520);
        const z = THREE.MathUtils.clamp(cz + Math.sin(a) * r, -520, 520);
        if (valid(x, z)) return { x, z };
      }
    }
    return { x: cx + rMin, z: cz };
  }

  function makeSkeleton() {
    const g = new THREE.Group();
    g.visible = false;
    scene.add(g);
    const sk = {
      group: g, alive: false, enabled, hp: 0, yaw: 0, phase: rand(TAU), idlePhase: rand(TAU),
      side: list.length % 2 ? 1 : -1, // lado fixo do contorno (metade pra cada)
      hitT: 0, respawnT: 0, groanT: rand(6), bones: null, rest: null,
      model: null, modelBaseY: 0, modelBaseQuaternion: new THREE.Quaternion(), sword: null,
      moveBlend: 0, attacking: false, attackT: 0, attackHit: false,
      attackDuration: ATTACK_DURATION, targetDistance: Infinity,
      sph: [{ c: new THREE.Vector3(), r: 0.45, part: 'body' }, { c: new THREE.Vector3(), r: 0.28, part: 'head' }],
      pos() { return g.position; },
      hitSpheres() {
        this.sph[0].c.set(g.position.x, g.position.y + 1.05, g.position.z);
        this.sph[1].c.set(g.position.x, g.position.y + 1.7, g.position.z);
        return this.sph;
      },
      damage(dmg) {
        if (!this.alive || !this.enabled) return false;
        this.hp -= dmg;
        if (this.hp <= 0) {
          this.alive = false;
          this.attacking = false;
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
    const preparedMaterials = new Set();
    for (const sk of list) {
      const root = cloneRig(proto); // rig compartilhado quebra com .clone() comum
      root.scale.setScalar(s);
      root.position.y = -box.min.y * s; // pés no chão do grupo
      root.traverse(o => {
        if (o.isMesh || o.isSkinnedMesh) {
          o.castShadow = true;
          o.frustumCulled = false; // skinned: bbox estático erra e some da tela
          const materials = Array.isArray(o.material) ? o.material : [o.material];
          for (const material of materials) {
            if (material && !preparedMaterials.has(material)) {
              preparedMaterials.add(material);
              csmMat(material);
            }
          }
        }
      });
      sk.model = root;
      sk.modelBaseY = root.position.y;
      sk.modelBaseQuaternion.copy(root.quaternion);
      sk.bones = collectBones(root);
      rememberRestPose(sk);
      sk.sword = makeSword(swordMaterials);
      sk.group.add(root, sk.sword);
      updateSword(sk, -1);

      if (sk === list[0]) {
        const required = ['thL', 'thR', 'calfL', 'calfR', 'armR', 'foreR', 'handR', 'head'];
        const missing = required.filter(name => !sk.bones[name]);
        if (missing.length) console.warn('[esqueletos] ossos não encontrados:', missing.join(', '));
      }

      // nasce espalhado pelo mapa, longe do acampamento inicial
      const p = drySpot(player.pos.x, player.pos.z, 90, 460);
      sk.group.position.set(p.x, heightAt(p.x, p.z), p.z);
      sk.hp = HP;
      sk.alive = true;
      sk.group.visible = enabled && sk.alive;
    }
    api.modelReady = true;
  }, undefined, e => console.warn('[esqueletos] modelo não carregou', e));

  function update(dt, t) {
    if (!enabled) return;
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
          sk.attacking = false;
          sk.attackT = 0;
          sk.attackHit = false;
          sk.moveBlend = 0;
          g.visible = true;
        }
        continue;
      }

      const dx = player.pos.x - g.position.x, dz = player.pos.z - g.position.z;
      const dP = Math.hypot(dx, dz);
      sk.targetDistance = dP;
      const moveStartX = g.position.x, moveStartZ = g.position.z;
      if (dP > 1.5 && !player.dead && !sk.attacking) {
        g.position.x += dx / dP * SPEED * dt;
        g.position.z += dz / dP * SPEED * dt;
        sk.yaw = Math.atan2(dx, dz);
      }

      // árvore/pedra empurra pra fora, com deslize tangencial pra contornar.
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
      const movedX = g.position.x - moveStartX, movedZ = g.position.z - moveStartZ;
      const movedSq = movedX * movedX + movedZ * movedZ;
      if (movedSq > 1e-8) sk.yaw = Math.atan2(movedX, movedZ);
      else if (dP > 1e-4) sk.yaw = Math.atan2(dx, dz);
      g.rotation.y = sk.yaw;

      sk.hitT = Math.max(0, sk.hitT - dt);
      if (sk.attacking) {
        sk.attackT += dt;
        const attackP = sk.attackT / ATTACK_DURATION;
        if (!sk.attackHit && attackP >= HIT_AT) {
          sk.attackHit = true;
          const hitDx = player.pos.x - g.position.x, hitDz = player.pos.z - g.position.z;
          const hitDistance = Math.hypot(hitDx, hitDz);
          if (!player.dead && hitDistance < MELEE_RANGE + 0.25 &&
              !meleeBlocked(sk.group, player.pos, Structures, obstaclesNear)) {
            playerDamage(MELEE_DMG, g.position, { type: 'skeleton' });
          }
        }
        if (attackP >= 1) {
          sk.attacking = false;
          sk.attackT = 0;
          sk.attackHit = false;
        }
      } else if (dP < MELEE_RANGE && sk.hitT <= 0 && !player.dead &&
                 !meleeBlocked(sk.group, player.pos, Structures, obstaclesNear)) {
        sk.attacking = true;
        sk.attackT = 0;
        sk.attackHit = false;
        sk.hitT = MELEE_CD;
      }

      animateSkeleton(sk, dt, t, movedSq > 1e-7);
      sk.groanT -= dt;
      if (sk.groanT <= 0 && dP < 28) {
        sk.groanT = rand(5, 11);
        SFX.groan();
      }
    }
  }

  return api;
}
