/* Personagens 3D rigados (inimigos/boss): carregamento com cache, clone de
   esqueleto por instância (SkeletonUtils) e normalização pé-no-chão.
   Cada build() devolve { root, mixer, actions } — quem chama pendura o root
   no grupo do personagem e dirige o mixer; se a rede falhar, o chamador
   simplesmente continua com o corpo procedural antigo. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

export function createCharModels() {
  const loader = new GLTFLoader();
  const cache = new Map();
  const norm = s => String(s).replace(/[.\s]/g, '');
  const hitColor = new THREE.Color(0xff2020);

  function cached(url) {
    if (!cache.has(url)) cache.set(url, loader.loadAsync(url));
    return cache.get(url);
  }

  /* caixa CIENTE DA POSE: SkinnedMesh.computeBoundingBox usa o esqueleto atual —
     a bbox ingênua mede os vértices sem skinning (e com quantização vem errada:
     o Visitante nascia 2m enterrado) */
  function poseBox(obj, recomputeSkin = true) {
    obj.updateWorldMatrix(true, true);
    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    obj.traverse(o => {
      if (o.isSkinnedMesh) {
        /* computeBoundingBox() depois que um ancestral recebeu scale inclui
           esse scale nas matrizes dos ossos; aplicar matrixWorld em seguida
           escalaria a caixa uma segunda vez. O molde já foi medido em escala
           neutra, e SkeletonUtils preserva essa boundingBox no clone. */
        if (recomputeSkin || !o.boundingBox) o.computeBoundingBox();
        tmp.copy(o.boundingBox).applyMatrix4(o.matrixWorld);
        box.union(tmp);
      } else if (o.isMesh) {
        box.expandByObject(o);
      }
    });
    return box;
  }

  /* prepara um "molde": mede uma vez, cada build() clona esqueleto+malha */
  async function character(url, { height = 1.9, yaw = 0 } = {}) {
    const gltf = await cached(url);
    const proto = gltf.scene;
    const box = poseBox(proto);
    const rawH = Math.max(box.max.y - box.min.y, 1e-3);
    const s = height / rawH;

    function build({ colors = null } = {}) {
      const inst = cloneSkeleton(proto);
      /* SkeletonUtils precisa compartilhar a geometria (e as texturas) do
         molde, mas material compartilhado faria o flash vermelho de um
         jogador aparecer em todos. Cada instância ganha materiais próprios;
         o dispose abaixo jamais toca na geometria/textura do cache. */
      const clonedMaterials = new Map();
      const materialStates = new Map();
      const palette = Array.isArray(colors) && colors.length >= 4
        ? colors.map(color => new THREE.Color(/^#[0-9a-f]{6}$/i.test(String(color)) ? color : '#ffffff')) : null;
      const tintMaterial = material => {
        if (!palette || !material.color) return;
        const name = String(material.name).toLowerCase();
        let idx = -1, strength = 0.42;
        if (name.includes('body')) idx = 0;
        else if (name.includes('cloth')) idx = 1;
        else if (name.includes('armor')) idx = 2;
        else if (name.includes('helmet')) { idx = 3; strength = 0.24; }
        if (idx >= 0) material.color.lerp(palette[idx], strength);
      };
      const ownMaterial = material => {
        if (!material) return material;
        if (!clonedMaterials.has(material)) {
          const copy = material.clone();
          tintMaterial(copy);
          clonedMaterials.set(material, copy);
          materialStates.set(copy, {
            emissive: copy.emissive ? copy.emissive.clone() : null,
            emissiveIntensity: copy.emissiveIntensity || 0,
          });
        }
        return clonedMaterials.get(material);
      };
      inst.traverse(o => {
        if (o.isMesh || o.isSkinnedMesh) {
          o.material = Array.isArray(o.material) ? o.material.map(ownMaterial) : ownMaterial(o.material);
          o.userData.sharedCharacterGeometry = true;
          o.castShadow = false;   // precedente dos carros: CSM 4x multiplicaria draw calls
          o.receiveShadow = false;
          o.frustumCulled = false; // esqueleto animado desloca a malha do bounding original
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            if (m && m.isMeshStandardMaterial && !m.map) {
              const l = m.color.r * 0.299 + m.color.g * 0.587 + m.color.b * 0.114;
              if (l > 0.72) m.color.multiplyScalar(0.72 / l);
            }
          }
        }
      });
      const orient = new THREE.Group();
      orient.rotation.y = yaw;
      orient.scale.setScalar(s);
      orient.add(inst);
      const b = poseBox(orient, false); // bbox do molde, transformada uma única vez
      orient.position.set(-(b.min.x + b.max.x) * 0.5, -b.min.y, -(b.min.z + b.max.z) * 0.5);
      const root = new THREE.Group();
      root.add(orient);

      const mixer = new THREE.AnimationMixer(inst);
      const actions = {};
      for (const clip of gltf.animations) actions[clip.name] = mixer.clipAction(clip);

      const findNode = frag => {
        const f = norm(frag);
        let hit = null;
        inst.traverse(o => { if (!hit && norm(o.name).includes(f)) hit = o; });
        return hit;
      };

      /* Animador leve para avatares online. O Helldiver atual não traz clips,
         portanto movimentamos o rig sem deformar o grupo/hitbox. Se um modelo
         futuro trouxer Idle/Walk/Run, os clips passam a ser usados direto. */
      function humanoidAnimator() {
        const actionEntries = Object.entries(actions);
        const actionLike = pattern => actionEntries.find(([name]) => pattern.test(name))?.[1] || null;
        const idleAction = actionLike(/idle|stand|breath/i);
        const walkAction = actionLike(/walk|run|jog|move/i);
        let activeAction = null;
        const switchAction = next => {
          if (!next || next === activeAction) return;
          next.reset().fadeIn(0.16).play();
          if (activeAction) activeAction.fadeOut(0.16);
          activeAction = next;
        };
        if (idleAction) switchAction(idleAction);

        const bones = {
          chest: findNode('Chest'),
          armL: findNode('Arm_1.L'), armR: findNode('Arm_1.R'),
          thighL: findNode('Pelvis.L'), thighR: findNode('Pelvis.R'),
          kneeL: findNode('Leg_2.L'), kneeR: findNode('Leg_2.R'),
        };
        const cloaks = [];
        inst.traverse(o => { if (o.isBone && norm(o.name).startsWith('Cloak')) cloaks.push(o); });
        const tracked = [...new Set([...Object.values(bones), ...cloaks].filter(Boolean))];
        const bind = new Map(tracked.map(b => [b, b.quaternion.clone()]));
        const axisX = new THREE.Vector3(1, 0, 0);
        const delta = new THREE.Quaternion();
        let phase = 0;
        const bend = (bone, angle) => {
          if (!bone || !bind.has(bone)) return;
          bone.quaternion.copy(bind.get(bone)).multiply(delta.setFromAxisAngle(axisX, angle));
        };

        return {
          update(dt, speed = 0, time = 0) {
            const move = THREE.MathUtils.clamp(speed / 5, 0, 1);
            if (walkAction || idleAction) {
              switchAction(move > 0.08 ? (walkAction || idleAction) : (idleAction || walkAction));
              if (activeAction) activeAction.setEffectiveTimeScale(0.55 + move * 1.25);
              mixer.update(dt);
              return;
            }
            phase += dt * Math.min(speed, 9) * 1.45;
            const swing = Math.sin(phase) * move * 0.58;
            bend(bones.thighL, swing);
            bend(bones.thighR, -swing);
            bend(bones.kneeL, Math.max(0, -swing) * 0.72);
            bend(bones.kneeR, Math.max(0, swing) * 0.72);
            bend(bones.armL, -swing * 0.72);
            bend(bones.armR, swing * 0.72);
            bend(bones.chest, Math.sin(time * 1.6) * 0.012);
            for (let i = 0; i < cloaks.length; i++)
              bend(cloaks[i], Math.sin(time * 2 + i * 0.7) * 0.035 + move * 0.18);
          },
          stop() {
            if (activeAction) activeAction.stop();
            activeAction = null;
          },
        };
      }

      let disposed = false;
      const api = {
        root, mixer, actions, findNode,
        materials: [...materialStates.keys()],
        humanoidAnimator,
        setHitFlash(strength = 0) {
          const k = THREE.MathUtils.clamp(strength, 0, 1);
          for (const [material, base] of materialStates) {
            if (!material.emissive || !base.emissive) continue;
            material.emissive.copy(base.emissive).lerp(hitColor, k);
            material.emissiveIntensity = base.emissiveIntensity + k * 2.5;
          }
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          mixer.stopAllAction();
          mixer.uncacheRoot(inst);
          if (root.parent) root.parent.remove(root);
          for (const material of materialStates.keys()) material.dispose();
        },
        get disposed() { return disposed; },
      };
      root.userData.characterInstance = api;
      return api;
    }
    return { build };
  }

  return { character };
}
