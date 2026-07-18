import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildCarRig } from './carwheels.js';

export function createCar(deps) {
  const { damp, rand, _v1, _v2, heightAt, SFX, FX, scene, world, csmMat, Structures, ui, state, keys, stampTrack = null } = deps;
  const DRIVE_SIGN = 1; // sinal do engineForce p/ andar pra frente (validado em teste)
  /* REST longo: o raio da roda no cannon nasce no ponto de conexão e mede
     rest+raio. Com rest curto a conexão ficava ~0,4 m do chão e AFUNDAVA no
     barranco em rampas laterais — raio nascia DENTRO do terreno, o contato
     sumia e o carro encalhava na diagonal (medido em QA). Rest 0,55 sobe a
     origem do raio (~0,65 m) mantendo a roda em repouso no MESMO lugar. */
  const SUSP_REST = 0.55;
  // deflexão estática: o cannon escala a força da mola pela massa do chassi,
  // então ela é g/(4k) pra qualquer veículo — e o comprimento em repouso da
  // suspensão é SUSP_REST - g/(4k)
  const suspStatic = stiff => SUSP_REST - 9.82 / (4 * stiff);
  const _cv1 = new CANNON.Vec3();
  const _rayFrom = new CANNON.Vec3(), _rayTo = new CANNON.Vec3();
  const _wq = new THREE.Quaternion(), _wq2 = new THREE.Quaternion(), _wv = new THREE.Vector3();
  const modelLoader = new GLTFLoader();
  const templateCache = new Map(); // por URL: rig + métricas prontos (1x por GLB)
  const wheelRadius = (cfg, i) => Array.isArray(cfg.wheelRVis) ? cfg.wheelRVis[i] : cfg.wheelRVis;

  /* apoio estático real sob (x,z): terreno físico E lajes/asfalto/telhado —
     heightAt sozinho não enxerga as ruas elevadas da cidade */
  function staticGroundY(x, z) {
    const base = heightAt(x, z);
    _rayFrom.set(x, base + 6, z);
    _rayTo.set(x, base - 8, z);
    let best = -Infinity;
    world.raycastAll(_rayFrom, _rayTo, {}, res => {
      if (res.body.mass === 0 && res.hitPointWorld.y > best) best = res.hitPointWorld.y;
    });
    return best > -1e8 ? best : base;
  }

  /* ---- fábrica de veículos (RaycastVehicle) ---- */
  function createPhysics(cfg, x, z, ry = 0) {
    /* nasce APOIADO: altura por roda (com o yaw do spawn), pela relação real
       chassisY = apoio + raio - centroVisualY — nada de cair de alto nem de
       nascer enterrado numa laje/encosta */
    const cy = Math.cos(ry), sy = Math.sin(ry);
    let spawnY = -Infinity;
    for (let i = 0; i < 4; i++) {
      const [wx, wyC, wz] = cfg.wheelsVis[i];
      const sup = staticGroundY(x + wx * cy + wz * sy, z - wx * sy + wz * cy);
      spawnY = Math.max(spawnY, sup + wheelRadius(cfg, i) - wyC + 0.03);
    }
    /* CG BAIXO: a origem do corpo (= centro de massa no cannon) fica perto da
       altura dos eixos e a caixa do collider sobe +comDrop pra continuar
       envolvendo a lataria. Com o CG no centro geométrico (~1,2 m acima do
       contato) e o eixo traseiro REAL dos modelos (bem perto do CG), o torque
       do motor empinava o carro no arranque (medido em QA). */
    const drop = cfg.comDrop || 0;
    const chassisBody = new CANNON.Body({
      mass: cfg.mass,
      position: new CANNON.Vec3(x, spawnY - drop, z),
    });
    chassisBody.addShape(new CANNON.Box(new CANNON.Vec3(...cfg.half)), new CANNON.Vec3(0, drop, 0));
    if (ry) chassisBody.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), ry);
    chassisBody.angularDamping = 0.42;
    chassisBody.linearDamping = 0.02;
    // PERF: carro parado dorme (o solver pula o corpo); acorda ao entrar/colidir.
    // Limite BAIXO: com 0.4 ele dormia no meio da gangorra de assentamento e
    // congelava apoiado só na diagonal (2 rodas no ar).
    chassisBody.allowSleep = true;
    chassisBody.sleepSpeedLimit = 0.15;
    chassisBody.sleepTimeLimit = 1.2;
    const vehicle = new CANNON.RaycastVehicle({ chassisBody, indexRightAxis: 2, indexForwardAxis: 0, indexUpAxis: 1 });
    const stiff = cfg.suspStiff || 22;
    for (let i = 0; i < 4; i++) {
      const [wx, wyC, wz] = cfg.wheelsVis[i];
      vehicle.addWheel({
        radius: wheelRadius(cfg, i),
        directionLocal: new CANNON.Vec3(0, -1, 0),
        suspensionStiffness: stiff,
        suspensionRestLength: SUSP_REST,
        frictionSlip: cfg.grip || 1.4,
        // amortecimento maior que o histórico (2.3): com molas mais macias o
        // carro parado ficava quicando micro-oscilações sem nunca dormir
        dampingRelaxation: 3.5,
        dampingCompression: 4.4,
        maxSuspensionForce: 100000,
        rollInfluence: 0.01,
        axleLocal: new CANNON.Vec3(0, 0, 1),
        // conexão = centro visual da roda + suspensão estática: em repouso a
        // roda física cai EXATAMENTE no centro da roda do modelo
        chassisConnectionPointLocal: new CANNON.Vec3(wx, wyC + drop + suspStatic(stiff), wz),
        maxSuspensionTravel: 0.3,
        customSlidingRotationalSpeed: -30,
        useCustomSlidingRotationalSpeed: true,
      });
    }
    vehicle.addToWorld(world);
    return { chassisBody, vehicle };
  }

  // Visual barato enquanto o GLB chega (e fallback se houver erro de rede).
  function buildPlaceholder(half, color) {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(half[0] * 2, half[1] * 2, half[2] * 2),
      csmMat(new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.5 })),
    );
    mesh.castShadow = true;
    group.add(mesh);
    scene.add(group);
    return group;
  }

  function removeAuxiliaryNodes(root) {
    const remove = [];
    root.traverse(obj => {
      if (/^floor$/i.test(obj.name)) remove.push(obj);
    });
    for (const obj of remove) if (obj.parent) obj.parent.remove(obj);
  }

  /* Clona e normaliza o GLB pro espaço do chassi (frente +X, escala do
     collider, fundo do modelo em cfg.groundOffset). Materiais tratados aqui;
     o TINT de lataria fica pra instanciação (é por veículo). */
  function normalizedModel(source, cfg) {
    const imported = source.clone(true);
    removeAuxiliaryNodes(imported);
    imported.traverse(obj => {
      if (!obj.isMesh) return;
      // pintura fosca nos materiais sem textura: com o sol do deserto + bloom,
      // lataria clara e lisa estourava num clarão branco
      for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) {
        if (m && m.isMeshStandardMaterial && !m.map) {
          m.roughness = 0.85; m.metalness = 0.05;
          // albedo 1.0 sob o sol estoura o limiar do bloom (carro vira clarão):
          // rebaixa só os tons quase-brancos pra um branco de tinta
          const l = m.color.r * 0.299 + m.color.g * 0.587 + m.color.b * 0.114;
          if (l > 0.72) m.color.multiplyScalar(0.72 / l);
        }
      }
    });

    // O jogo usa +X como frente. Alguns Sketchfab vêm com o comprimento em Z.
    const oriented = new THREE.Group();
    oriented.rotation.y = cfg.modelYaw || 0;
    oriented.add(imported);
    oriented.updateMatrixWorld(true);
    const raw = new THREE.Box3().setFromObject(oriented);
    const rawSize = raw.getSize(new THREE.Vector3());
    if (rawSize.x < 1e-4 || rawSize.y < 1e-4 || rawSize.z < 1e-4)
      throw new Error(`Modelo de veículo sem volume: ${cfg.modelUrl}`);

    // X/Z acompanham exatamente o collider; Y preserva a proporção longitudinal.
    const targetX = cfg.half[0] * 2 * 0.98;
    const targetZ = cfg.half[2] * 2 * 0.98;
    const scaled = new THREE.Group();
    scaled.scale.set(targetX / rawSize.x, targetX / rawSize.x, targetZ / rawSize.z);
    scaled.add(oriented);
    scaled.updateMatrixWorld(true);

    let box = new THREE.Box3().setFromObject(scaled);
    scaled.position.set(
      -(box.min.x + box.max.x) * 0.5,
      cfg.groundOffset - box.min.y,
      -(box.min.z + box.max.z) * 0.5,
    );
    scaled.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(scaled);
    const size = box.getSize(new THREE.Vector3());
    return {
      root: scaled,
      metrics: { sizeX: size.x, sizeY: size.y, sizeZ: size.z, minY: box.min.y, maxY: box.max.y },
    };
  }

  /* Preparação por URL (1x por GLB): normaliza + recorta o rig de rodas.
     A geometria preparada é COMPARTILHADA entre instâncias do mesmo modelo. */
  function prepareTemplate(cfg) {
    const url = cfg.modelUrl;
    if (!templateCache.has(url)) {
      templateCache.set(url, modelLoader.loadAsync(url).then(gltf => {
        const { root, metrics } = normalizedModel(gltf.scene, cfg);
        try {
          const rig = buildCarRig(root, cfg);
          return { rig, metrics, fallbackRoot: null, rigError: null };
        } catch (err) {
          console.error(`Rig de rodas indisponível pra ${url}:`, err);
          return { rig: null, metrics, fallbackRoot: root, rigError: err.message || String(err) };
        }
      }));
    }
    return templateCache.get(url);
  }

  const WHEEL_NAMES = ['Wheel_FR', 'Wheel_FL', 'Wheel_RR', 'Wheel_RL']; // ordem de cfg.wheelsVis (+Z = direita)

  function instantiateMesh(part, cfg) {
    let material = part.material;
    // cor por veículo SÓ na lataria (material nomeado no cfg): o template é
    // compartilhado entre os carros, então o clone é obrigatório
    if (cfg.bodyTint != null && material && !Array.isArray(material) && material.name === cfg.bodyMaterial) {
      material = material.clone();
      material.color.setHex(cfg.bodyTint);
    }
    const mesh = new THREE.Mesh(part.geometry, material);
    mesh.castShadow = false; // CSM tem 4 cascatas: sombra por submalha quadruplicaria draw calls.
    mesh.receiveShadow = false;
    mesh.userData.importedCarModel = true;
    return mesh;
  }

  async function attachModel(v) {
    try {
      const tpl = await prepareTemplate(v.cfg);
      // Remove só o placeholder; o grupo é a identidade usada pela física/multiplayer.
      v.group.traverse(obj => { if (obj.isMesh && !obj.userData.importedCarModel) obj.geometry.dispose(); });
      v.group.clear();
      v.modelMetrics = tpl.metrics;
      if (tpl.rig) {
        const bodyRoot = new THREE.Group();
        bodyRoot.name = 'CarBody';
        // offset CONSTANTE carroceria–chassi: a geometria foi calibrada com a
        // origem no centro do collider; a origem física fica comDrop abaixo (CG)
        bodyRoot.position.y = v.cfg.comDrop || 0;
        for (const p of tpl.rig.bodyParts) bodyRoot.add(instantiateMesh(p, v.cfg));
        v.group.add(bodyRoot);
        v.bodyRoot = bodyRoot;
        v.visualWheels = tpl.rig.wheels.map((wr, i) => {
          const pivot = new THREE.Group();
          pivot.name = WHEEL_NAMES[i];
          pivot.position.copy(wr.center);
          for (const p of wr.parts) pivot.add(instantiateMesh(p, v.cfg));
          v.group.add(pivot);
          return pivot;
        });
        v.wheelRig = tpl.rig.wheels.map(wr => ({
          center: wr.center.clone(), radius: wr.radius, width: wr.width,
          bakedSteer: wr.bakedSteer, tris: wr.tris, islands: wr.islands,
        }));
        v.wheelRigStatus = 'ready';
      } else {
        // fallback: GLB inteiro parado (rodas fundidas, sem duplicata) — o
        // veículo continua jogável e NENHUM hack move o visual pro terreno
        const root = tpl.fallbackRoot.clone(true);
        root.position.y += v.cfg.comDrop || 0; // mesmo referencial do rig
        root.traverse(obj => {
          if (!obj.isMesh) return;
          obj.userData.importedCarModel = true;
          if (v.cfg.bodyTint != null && obj.material && !Array.isArray(obj.material) &&
              obj.material.name === v.cfg.bodyMaterial) {
            obj.material = obj.material.clone();
            obj.material.color.setHex(v.cfg.bodyTint);
          }
        });
        v.group.add(root);
        v.bodyRoot = root;
        v.wheelRigStatus = 'fallback';
        v.wheelRigError = tpl.rigError;
      }
      v.modelStatus = 'ready';
    } catch (err) {
      v.modelStatus = 'fallback';
      v.wheelRigStatus = 'error';
      v.modelError = err instanceof Error ? err.message : String(err);
      console.error(`Falha ao carregar ${v.cfg.modelUrl}:`, err);
    }
  }
  /* ---- frota ---- */
  const vehicles = [];
  function makeVehicle(cfg, x, z, ry) {
    const { chassisBody, vehicle } = createPhysics(cfg, x, z, ry || 0);
    const v = {
      cfg, chassisBody, vehicle, group: cfg.build(),
      bodyRoot: null, visualWheels: null, wheelRig: null, wheelRigStatus: 'loading',
      remoteHint: null, // dica visual de rede (nunca autoridade): giro/esterço
      steerCur: 0, lastThrottle: 0, modelStatus: 'loading', modelUrl: cfg.modelUrl, modelMetrics: null,
    };
    vehicles.push(v);
    return v;
  }
  /* wheelsVis: centros VISUAIS das rodas no espaço do chassi (calibrados por
     ativo a partir da geometria real do GLB — ver js/carwheels.js). A física
     nasce dela: conexão da suspensão, raio da roda e altura de spawn.
     groundOffset: fundo do modelo no espaço do chassi (referencial da
     calibração; era derivado do antigo wheelR ilustrativo). */
  const CFG_BUGGY = { name: 'BUGGY', mass: 280, half: [1.8, 0.38, 0.85],
    wheelsVis: [[1.147, -0.993, 0.612], [1.147, -0.993, -0.612], [-0.814, -0.993, 0.612], [-0.814, -0.993, -0.612]],
    wheelRVis: 0.207, wheelWVis: 0.16, groundOffset: -1.2, suspStiff: 24, comDrop: 0.65,
    // grip 1.9: com 1.4 o círculo de fricção (maxImpulse = grip×suspensão×dt)
    // era consumido pelo LATERAL em rampas ≥12° e o forward saturava em ~zero —
    // buggy estolava parado em corredor dirigível (test/car-terrain-traversal)
    force: 1650, steer: 0.55, brake: 32, maxKmh: 72, grip: 1.9, engine: 'normal',
    modelUrl: '/assets/models/Veículos/gumball-car.optimized.glb', modelYaw: Math.PI / 2,
    build: () => buildPlaceholder([1.8, 0.38, 0.85], 0xe8562a) };
  const CFG_TRUCK = { name: 'CAMINHÃO MILITAR', mass: 680, half: [2.7, 0.55, 1.05],
    wheelsVis: [[1.673, -0.387, 0.916], [1.673, -0.387, -0.916], [-0.812, -0.343, 0.916], [-0.812, -0.343, -0.916]],
    wheelRVis: [0.437, 0.437, 0.481, 0.481], wheelWVis: 0.22, groundOffset: -1.47, suspStiff: 20, comDrop: 0.3,
    force: 3600, steer: 0.45, brake: 55, maxKmh: 84, grip: 2.0, engine: 'truck', // idem buggy: 1.6 estolava em hill-start ≥14°
    modelUrl: '/assets/models/Veículos/truck-drifter.optimized.glb', modelYaw: 0,
    build: () => buildPlaceholder([2.7, 0.55, 1.05], 0x46523a) };
  const mkSport = c => ({ name: 'ESPORTIVO GT', mass: 420, half: [1.9, 0.32, 0.88],
    wheelsVis: [[1.14, -0.745, 0.61], [1.14, -0.745, -0.61], [-0.985, -0.744, 0.6], [-0.985, -0.744, -0.6]],
    wheelRVis: 0.28, wheelWVis: 0.24, groundOffset: -1.06, suspStiff: 26, comDrop: 0.5,
    force: 5200, steer: 0.5, brake: 60, maxKmh: 118, grip: 2.2, awd: true, engine: 'sport',
    modelUrl: '/assets/models/Veículos/mazda-rx7.v2.glb', modelYaw: Math.PI,
    bodyTint: c, bodyMaterial: '02_-_Default', // pinta a carroceria, preserva o resto
    build: () => buildPlaceholder([1.9, 0.32, 0.88], c) });
  let cur = makeVehicle(CFG_BUGGY, 7.5, -6);
  for (const s of Structures.carSpots) {
    if (s.type === 'truck') makeVehicle(CFG_TRUCK, s.x, s.z, s.ry);
    else makeVehicle(mkSport(s.type === 'sport2' ? 0x2a6de8 : 0xd61f30), s.x, s.z, s.ry);
  }
  const ready = Promise.all(vehicles.map(attachModel));
  let dustAcc = 0;

  function update(dt) {
    for (const v of vehicles) {
      const driven = state.driving && v === cur && !state.paused;
      if (driven) {
        const fwdIn = (keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0);
        const steerIn = (keys['KeyA'] ? 1 : 0) - (keys['KeyD'] ? 1 : 0); // +steer vira à esquerda
        v.chassisBody.quaternion.vmult(_cv1.set(1, 0, 0), _cv1);
        const fwdSpeed = v.chassisBody.velocity.dot(_cv1);
        const kmh = Math.abs(fwdSpeed) * 3.6;
        // direção sensível à velocidade: esterço cheio parado, ~40% no talo —
        // sem isto o carro rodopiava em alta e "não virava" (esterço saturado)
        const steerK = 1 / (1 + kmh / 75);
        v.steerCur = damp(v.steerCur, steerIn * v.cfg.steer * steerK, 6, dt);
        v.vehicle.setSteeringValue(v.steerCur, 0);
        v.vehicle.setSteeringValue(v.steerCur, 1);
        let force = 0, brake = 0;
        if (fwdIn > 0 && kmh < (v.cfg.maxKmh || 100)) force = v.cfg.force;
        else if (fwdIn < 0) {
          if (fwdSpeed > 2) brake = v.cfg.brake;       // freia antes de dar ré
          else force = -v.cfg.force * 0.55;
        }
        if (keys['Space']) { brake = v.cfg.brake; force = 0; } // freio de mão
        for (let i = 0; i < 4; i++) v.vehicle.setBrake(brake, i);
        if (v.cfg.awd) { // tração integral: divide a força nas 4 rodas
          for (let i = 0; i < 4; i++) v.vehicle.applyEngineForce(DRIVE_SIGN * force * 0.5, i);
        } else {
          v.vehicle.applyEngineForce(DRIVE_SIGN * force, 2);
          v.vehicle.applyEngineForce(DRIVE_SIGN * force, 3);
        }
        /* trilha na grama: segmento anterior→atual de cada roda TRASEIRA em
           contato real, só em movimento (>2 m/s). Onde não há lâmina
           (asfalto/água/deserto: escala ~0 na geração) a marca é inócua. */
        if (stampTrack && Math.abs(fwdSpeed) > 2) {
          if (!v._trk) v._trk = [null, null];
          for (let k = 0; k < 2; k++) {
            const info = v.vehicle.wheelInfos[2 + k];
            if (!info.isInContact) { v._trk[k] = null; continue; }
            const hp = info.raycastResult.hitPointWorld;
            const prev = v._trk[k];
            if (!prev) { v._trk[k] = { x: hp.x, z: hp.z }; continue; }
            const ddx = hp.x - prev.x, ddz = hp.z - prev.z;
            if (ddx * ddx + ddz * ddz > 0.16) {          // passo de 0,4 m
              stampTrack(prev.x, prev.z, hp.x, hp.z);
              prev.x = hp.x; prev.z = hp.z;
            }
          }
        } else if (v._trk) v._trk = null;
      } else {
        /* freio de estacionamento: 12 segura ladeira sem o jitter do impulso
           de atrito do cannon (com 30 o carro vibrava a ~0,25 m/s e nunca
           dormia; com 8 escorregava com o limite de sono baixo) */
        for (let i = 0; i < 4; i++) { v.vehicle.setBrake(12, i); v.vehicle.applyEngineForce(0, i); }
        /* carro pilotado por REMOTO: a pose vem da rede com velocidade zerada
           (br-game.js), então o cannon não gira as rodas sozinho. A dica
           visual (validada/clampada lá) alimenta o MESMO pipeline visual —
           wheelInfo.rotation/steering — sem nenhuma autoridade física. */
        const h = v.remoteHint;
        if (h && h.ttl > 0) {
          h.ttl -= dt;
          v.vehicle.setSteeringValue(h.steer, 0);
          v.vehicle.setSteeringValue(h.steer, 1);
          const dtc = Math.min(dt, 0.1);
          // convenção do cannon (indexUpAxis 1): frente = rotation NEGATIVA
          for (let i = 0; i < 4; i++)
            v.vehicle.wheelInfos[i].rotation -= h.speed * dtc / v.vehicle.wheelInfos[i].radius;
        }
      }
      /* visual = física, sem retoque: o grupo segue o chassi e cada pivô de
         roda segue o worldTransform do RaycastVehicle (suspensão + esterço +
         giro), convertido pro espaço local do grupo (escala unitária). */
      v.group.position.copy(v.chassisBody.position);
      v.group.quaternion.copy(v.chassisBody.quaternion);
      _wq.copy(v.group.quaternion).invert();
      for (let i = 0; i < 4; i++) {
        v.vehicle.updateWheelTransform(i);
        if (!v.visualWheels) continue;
        const wt = v.vehicle.wheelInfos[i].worldTransform;
        const pivot = v.visualWheels[i];
        _wv.set(wt.position.x - v.group.position.x,
          wt.position.y - v.group.position.y,
          wt.position.z - v.group.position.z).applyQuaternion(_wq);
        pivot.position.copy(_wv);
        _wq2.set(wt.quaternion.x, wt.quaternion.y, wt.quaternion.z, wt.quaternion.w);
        pivot.quaternion.copy(_wq).multiply(_wq2);
      }
    }
    // poeira + áudio do veículo atual
    const kmh = speedKmh();
    if (state.driving && kmh > 24) {
      dustAcc += dt;
      if (dustAcc > 0.06) {
        dustAcc = 0;
        const wi = 2 + ((Math.random() * 2) | 0);
        const wt = cur.vehicle.wheelInfos[wi].worldTransform;
        _v1.set(wt.position.x, wt.position.y - 0.3, wt.position.z);
        _v2.set(rand(-1, 1), rand(2, 3.4), rand(-1, 1));
        FX.spawnParticle(_v1, _v2, 0xb9a77c, rand(0.25, 0.5), rand(0.5, 0.9), 3.2);
      }
    }
    const throttle = state.driving && (keys['KeyW'] || keys['KeyS']) ? 1 : 0;
    if (state.driving && cur.cfg.engine === 'sport' && cur.lastThrottle && !throttle && kmh > 40) {
      setTimeout(() => SFX.pop(), 50);  // pipoco do escapamento
      setTimeout(() => SFX.pop(), 170);
      if (Math.random() < 0.5) setTimeout(() => SFX.pop(), 300);
    }
    cur.lastThrottle = throttle;
    SFX.engineUpdate(kmh, state.driving, throttle, cur.cfg.engine);
    if (state.driving) ui.speedVal.textContent = Math.round(kmh);
  }

  function speedKmh() { return cur.chassisBody.velocity.length() * 3.6; }
  function nearest(p) {
    let best = vehicles[0], bd = 1e9;
    for (const v of vehicles) {
      const d = p.distanceTo(v.group.position);
      if (d < bd) { bd = d; best = v; }
    }
    return { v: best, d: bd };
  }

  return {
    vehicles, nearest, update, speedKmh, ready,
    setCur(v) { cur = v; v.chassisBody.wakeUp(); },
    get cfg() { return cur.cfg; },
    get vehicle() { return cur.vehicle; },
    get chassisBody() { return cur.chassisBody; },
    get group() { return cur.group; },
  };
}
