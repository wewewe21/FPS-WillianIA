/* Modelos 3D reais das armas em primeira pessoa.
   Segue o padrão de js/car.js: cache por URL, normalização por bounding box,
   fallback no modelo procedural se a rede falhar. Além da troca visual:
   - religa parts.mag/parts.bolt nos nós do GLB quando o modelo os tem
     (a coreografia de recarga existente passa a mover geometria real);
   - toca animações embutidas do GLB ("reload"/"bolt_slide" da sniper leve),
     encaixadas na duração de recarga/ciclo da arma;
   - reposiciona o muzzleAnchor pra boca real do cano. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export function createWeaponModels(deps) {
  const { arsenal } = deps;
  const loader = new GLTFLoader();
  const cache = new Map();
  const live = []; // { gun, mixer?, actions?, prevReloading, prevCycle }

  function cached(url) {
    if (!cache.has(url)) cache.set(url, loader.loadAsync(url));
    return cache.get(url);
  }

  /* Calibracao por arma, sempre no espaco LOCAL de gun.group depois que o GLB
     foi normalizado. `sight.point` e o centro optico/linha de ferro; `eye`
     define a distancia dele ate a camera em ADS. Assim a mira e centralizada
     geometricamente, sem offsets dependentes da resolucao. Os grips sao os
     centros das palmas no modelo importado e continuam usando as ancoras
     procedurais para preservar bomba, pente e coreografia de recarga. */
  const DEFS = [
    { idx: 0, url: './assets/models/Armas/low_poly_m4_rifle.glb',
      len: 0.98, pos: [0, -0.012, 0.02], muzzle: [0, 0.033, -0.47],
      // centro vazado da ocular (o centro da malha inteira fica mais baixo)
      sight: { point: [0, 0.126, 0.11], eye: -0.31 },
      grips: {
        r: { pos: [0.018, -0.115, 0.17], fingers: [-0.82, -0.25, -0.45], roll: 1.36 },
        l: { pos: [-0.006, -0.055, -0.25], fingers: [0.78, 0.28, -0.42], roll: -1.5 },
      } },
    { idx: 1, url: './assets/models/Armas/shotgun_Shotgun_lenta_forte.glb',
      len: 1.06, pos: [0, 0.01, 0.04], muzzle: [0, 0.045, -0.5],
      // A malha inteira e uma peca alta. A linha de mira precisa ficar na
      // crista e junto da extremidade traseira; usar o centro da arma punha a
      // camera diante da coronha e ela virava um retangulo preto na tela.
      sight: { point: [0, 0.235, 0.54], eye: -0.42 },
      grips: {
        r: { pos: [0.015, -0.13, 0.2], fingers: [-0.78, -0.3, -0.5], roll: 1.3 },
        l: { pos: [0, -0.052, -0.27], fingers: [0.82, 0.2, -0.45], roll: -1.48 },
      },
      strip: /^(Light|Camera)$/ },
    { idx: 2, url: './assets/models/Armas/low-poly_Sniper_lenta_forte.glb',
      len: 1.28, pos: [0, -0.005, 0.06], muzzle: [0, 0.03, -0.6],
      sight: { point: [0, 0.105, 0.2], eye: -0.27 },
      grips: {
        r: { pos: [0.015, -0.095, 0.22], fingers: [-0.8, -0.25, -0.45], roll: 1.35 },
        l: { pos: [0, -0.045, -0.33], fingers: [0.82, 0.24, -0.43], roll: -1.5 },
      },
      flip: false, gold: true,
      visibleBolt: { pos: [0.066, 0.045, 0.14], travel: 0.075 } },
    { idx: 3, url: './assets/models/Armas/bazooka.optimized.glb',
      len: 1.3, pos: [0, 0.02, 0.05], muzzle: [0, 0.02, -0.62],
      sight: { point: [-0.058, 0.155, 0.2], eye: -0.34 },
      grips: {
        r: { pos: [-0.045, -0.075, 0.16], fingers: [-0.4, -0.72, -0.25], roll: 1.08 },
        l: { pos: [-0.04, -0.075, -0.16], fingers: [0.45, -0.65, -0.3], roll: -1.15 },
      } },
    { idx: 4, url: './assets/models/Armas/low-poly_Arma_do_Alien.glb',
      len: 0.78, pos: [0, -0.01, 0.02], muzzle: [0, 0, -0.36],
      // Mira virtual acima da crista: a esfera ciano e o acumulador traseiro,
      // nao uma ocular. Centraliza-la punha a esfera inteira sobre o alvo.
      sight: { point: [0, 0.25, 0.38], eye: -0.5 },
      grips: {
        r: { pos: [-0.12, -0.105, 0.14], fingers: [-0.7, -0.45, -0.4], roll: 1.22 },
        l: { pos: [0.04, -0.08, -0.1], fingers: [0.7, -0.35, -0.45], roll: -1.28 },
      },
      glow: 0x2ee6c8 },
    { idx: 5, url: './assets/models/Armas/low_poly_axe.glb',
      // O machado nasce em +Y. -90 graus em X poe a cabeca para -Z e o cabo
      // junto da mao, em vez de escalar o eixo estreito do arquivo.
      pre: 0, pitch: -Math.PI / 2, len: 0.78, pos: [0.09, -0.035, 0.03],
      muzzle: [0.09, 0, -0.38], sight: { point: [0.09, 0, 0.25], eye: -0.42 },
      grips: {
        r: { pos: [0.105, -0.02, 0.31], fingers: [-0.55, -0.62, -0.3], roll: 1.05 },
        l: { pos: [-0.08, -0.05, 0.1], fingers: [0.6, -0.2, -0.55], roll: -1.1 },
      } },
    // armas NOVAS (índices 6/7 do arsenal): sniper leve com animações embutidas
    // e escopeta de rajada — os modelos "rápida fraca" da pasta de assets
    { idx: 6, url: './assets/models/Armas/low-poly_sniper_Rápida_Fraca.glb',
      len: 1.16, pos: [0, -0.005, 0.04], muzzle: [0, 0.028, -0.55],
      sight: { point: [-0.015, 0.078, 0.2], eye: -0.27 },
      grips: {
        r: { pos: [-0.012, -0.08, 0.28], fingers: [-0.8, -0.25, -0.45], roll: 1.34 },
        l: { pos: [-0.012, -0.042, -0.28], fingers: [0.82, 0.24, -0.43], roll: -1.5 },
      },
      bind: { mag: /^(mag_4|magazine)/i, bolt: /^bolt/i }, anims: true },
    { idx: 7, url: './assets/models/Armas/low-poly_Shotgun_rápida_fraca.glb',
      len: 0.96, pos: [0, 0.005, 0.03], muzzle: [0, 0.03, -0.45],
      sight: { point: [0, 0.111, -0.054], eye: -0.32 },
      grips: {
        r: { pos: [0, -0.035, 0.085], fingers: [-0.74, -0.38, -0.48], roll: 1.24 },
        l: { pos: [0, -0.035, -0.27], fingers: [0.8, 0.18, -0.48], roll: -1.42 },
      }, forceColor: 0x30363f,
      strip: /^Lamp/ },
  ];

  function moveHandAnchor(gun, key, grip) {
    const anchor = gun.parts && gun.parts[key];
    if (!anchor || !anchor.parent || !grip) return;
    // grip.pos esta em gun.group; converte para o espaco do pai (a mao
    // esquerda da escopeta, por exemplo, e filha da bomba animada).
    gun.group.updateWorldMatrix(true, true);
    const p = new THREE.Vector3(...grip.pos);
    gun.group.localToWorld(p);
    anchor.parent.worldToLocal(p);
    anchor.position.copy(p);
    if (anchor.userData.base && anchor.userData.base.p)
      anchor.userData.base.p.copy(p);
    anchor.userData.importedGripSocket = true;
  }

  function calibrateSockets(gun, def) {
    if (def.sight) {
      const sight = new THREE.Group();
      sight.name = `SightAnchor_${def.idx}`;
      sight.position.set(...def.sight.point);
      gun.group.add(sight);
      gun.sightAnchor = sight;

      // Quando weaponRoot recebe adsV, o ponto optico termina exatamente em
      // (0, 0, eye) no espaco da camera. X/Y zero e a propriedade verificavel.
      const [x, y, z] = def.sight.point;
      gun.adsV.set(-x, -y, def.sight.eye - z);
      gun.adsCalibration = {
        point: [...def.sight.point], eye: def.sight.eye,
        ads: gun.adsV.toArray(),
      };
      // O M4 permite alternar o FOV com T. O GLB tem uma unica optica fixa;
      // todos os niveis mantem a mesma linha geometrica em vez de voltar aos
      // offsets das miras procedurais escondidas.
      if (gun.parts && gun.parts.sights) {
        for (const s of gun.parts.sights) s.ads = gun.adsV.toArray();
      }
    }
    if (def.grips) {
      moveHandAnchor(gun, 'handR', def.grips.r);
      moveHandAnchor(gun, 'handL', def.grips.l);
      gun.handPose = {
        r: { fingers: [...def.grips.r.fingers], roll: def.grips.r.roll },
        l: { fingers: [...def.grips.l.fingers], roll: def.grips.l.roll },
      };
    }
  }

  function tuneMaterials(root, def) {
    root.traverse(obj => {
      if (!obj.isMesh) return;
      obj.castShadow = false;
      obj.receiveShadow = false;
      obj.frustumCulled = false; // arma na câmera: culling erra com bounding do modelo
      obj.userData.importedWeaponModel = true;
      for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) {
        if (!m || !m.isMeshStandardMaterial) continue;
        if (def.forceColor !== undefined) {
          // Texturas brancas continuam aceitando multiplicacao pela cor;
          // detalhes emissivos do asset sao preservados.
          m.color.setHex(def.forceColor);
          m.metalness = Math.max(m.metalness, 0.38);
          m.roughness = Math.max(m.roughness, 0.5);
        } else if (def.gold) {
          m.color.lerp(new THREE.Color(0xc99632), 0.72);
          m.metalness = Math.max(m.metalness, 0.62);
          m.roughness = Math.min(Math.max(m.roughness, 0.24), 0.44);
        }
        if (!m.map) {
          m.roughness = Math.max(m.roughness, 0.55);
          const l = m.color.r * 0.299 + m.color.g * 0.587 + m.color.b * 0.114;
          if (l > 0.72) m.color.multiplyScalar(0.72 / l); // evita clarão no bloom
        }
        if (def.glow && m.emissive && m.emissive.getHex() === 0)
          m.emissiveIntensity = 0;
      }
    });
  }

  function normalized(gltf, def) {
    const imported = gltf.scene.clone(true);
    const doomed = [];
    imported.traverse(o => {
      if (o.isLight || o.isCamera || (def.strip && def.strip.test(o.name))) doomed.push(o);
    });
    for (const o of doomed) o.parent && o.parent.remove(o);
    tuneMaterials(imported, def);

    // auto-orientação: deita o eixo mais COMPRIDO do modelo em Z (cano no eixo
    // da mira); def.flip resolve o 180° (modelos que nascem de costas)
    const rawBox = new THREE.Box3().setFromObject(imported);
    const rs = rawBox.getSize(new THREE.Vector3());
    const pre = def.pre !== undefined ? def.pre : (rs.x >= rs.z ? Math.PI / 2 : 0);
    const oriented = new THREE.Group();
    oriented.rotation.y = pre + (def.flip ? Math.PI : 0) + (def.yaw || 0);
    if (def.pitch) oriented.rotation.x = def.pitch;
    if (def.roll) oriented.rotation.z = def.roll;
    oriented.add(imported);
    oriented.updateMatrixWorld(true);
    const raw = new THREE.Box3().setFromObject(oriented);
    const size = raw.getSize(new THREE.Vector3());
    if (size.z < 1e-4) throw new Error('modelo de arma sem volume: ' + def.url);
    const s = def.len / size.z;
    const scaled = new THREE.Group();
    scaled.scale.setScalar(s);
    scaled.add(oriented);
    scaled.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scaled);
    // centraliza X/Y na empunhadura e recua o corpo: a origem do grupo da arma
    // é onde a mão direita segura (mesma convenção dos modelos procedurais)
    scaled.position.set(
      -(box.min.x + box.max.x) * 0.5 + (def.pos ? def.pos[0] : 0),
      -(box.min.y + box.max.y) * 0.5 + (def.pos ? def.pos[1] : 0),
      -(box.min.z + box.max.z) * 0.5 + (def.pos ? def.pos[2] : 0),
    );
    return scaled;
  }

  function findNode(root, re) {
    let hit = null;
    root.traverse(o => { if (!hit && re.test(o.name)) hit = o; });
    return hit;
  }

  function addVisibleBolt(gun, spec) {
    if (!spec) return;
    const bolt = new THREE.Group();
    bolt.name = 'BoltActionVisual';
    bolt.position.set(...spec.pos);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x9c7431, metalness: 0.82, roughness: 0.28,
    });
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.085, 8), mat);
    stem.rotation.z = Math.PI / 2;
    stem.position.x = 0.035;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), mat);
    knob.position.x = 0.078;
    bolt.add(stem, knob);
    bolt.userData.z0 = bolt.position.z;
    bolt.userData.travel = spec.travel || 0.06;
    gun.group.add(bolt);
    gun.parts.boltVisual = bolt;
  }

  async function attach(def) {
    const gun = arsenal[def.idx];
    if (!gun) return;
    try {
      const gltf = await cached(def.url);
      const root = normalized(gltf, def);

      // esconde só a geometria procedural da ARMA — âncoras (mag/pump/bolt) e
      // mãos continuam existindo e animando (viram alvos invisíveis do rig FP)
      const keep = new Set();
      for (const k of ['handL', 'handR']) if (gun.parts[k]) gun.parts[k].traverse(o => keep.add(o));
      gun.group.traverse(o => { if (o.isMesh && !keep.has(o)) o.visible = false; });

      gun.group.add(root);
      gun.modelRoot = root;
      gun.modelStatus = 'ready';

      calibrateSockets(gun, def);
      addVisibleBolt(gun, def.visibleBolt);

      // religa nós reais do GLB nas âncoras animadas (pente sai de verdade)
      if (def.bind) {
        for (const [part, re] of Object.entries(def.bind)) {
          const anchor = gun.parts[part];
          const node = findNode(root, re);
          if (anchor && node) {
            anchor.attach(node); // preserva a pose mundial
            node.visible = true;
          }
        }
      }
      // boca do cano na ponta real do modelo
      if (def.muzzle) gun.muzzleAnchor.position.set(...def.muzzle);

      // animações embutidas (sniper leve): recarga e ferrolho do próprio GLB
      if (def.anims && gltf.animations && gltf.animations.length) {
        const mixer = new THREE.AnimationMixer(root);
        const actions = {};
        for (const clip of gltf.animations) {
          const a = mixer.clipAction(clip);
          a.setLoop(THREE.LoopOnce);
          a.clampWhenFinished = false;
          actions[clip.name] = { action: a, dur: clip.duration };
        }
        live.push({ gun, mixer, actions, prevReloading: false, prevCycle: 0 });
      }
    } catch (err) {
      gun.modelStatus = 'fallback';
      gun.modelError = err instanceof Error ? err.message : String(err);
      console.error('Arma GLB falhou, mantendo procedural:', def.url, err);
    }
  }

  const ready = Promise.all(DEFS.map(attach));

  function update(dt) {
    for (const w of live) {
      const { gun, mixer, actions } = w;
      // recarga: encaixa o clipe "reload" na duração real da arma
      if (gun.reloading && !w.prevReloading && actions.reload) {
        const { action, dur } = actions.reload;
        action.reset();
        action.timeScale = dur / Math.max(gun.reloadTime, 0.1);
        action.play();
      }
      // pós-tiro: ferrolho
      if (gun.cycleT > w.prevCycle && actions.bolt_slide) {
        const { action, dur } = actions.bolt_slide;
        action.reset();
        action.timeScale = dur / Math.max(gun.cycleDuration || 0.32, 0.1);
        action.play();
      }
      w.prevReloading = gun.reloading;
      w.prevCycle = gun.cycleT;
      if (gun.group.visible) mixer.update(dt);
    }
  }

  function status() {
    return DEFS.map(d => {
      const gun = arsenal[d.idx];
      return {
        idx: d.idx, url: d.url,
        status: gun ? gun.modelStatus || 'loading' : 'sem-arma',
        calibrated: !!(gun && gun.sightAnchor && gun.handPose),
      };
    });
  }

  return { ready, update, status };
}
