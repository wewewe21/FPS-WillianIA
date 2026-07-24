/* ================================================================
   Canhão de Circo 🎪 — atração física num ponto vazio do mapa.
   Chegue na clareira deserta, mire virando o corpo, aperte E e seja
   CUSPIDO num arco gigante rumo à cidade. Sem dano de queda: errar é
   engraçado. Solo: brinquedo + viagem rápida + recorde de distância.
   Grupo: entrada dramática no tiroteio + disputa de recorde.

   100% client-side: nenhum evento de rede, nenhum consumo do rand
   seedado do worldgen (geometria criada em noSeed, no FIM do init),
   velocidade dentro dos tetos do anti-cheat (ver js/cannon-core.js).
   ================================================================ */
import * as THREE from 'three';
import {
  LAUNCH, launchVelocity, pickSpot, betterRecord, horizontalSpeed,
} from './cannon-core.js';

const BEST_KEY = 'callofai_cannonBest';
const CHARGE_T = 0.5;      // s de pré-rolagem (assobio sobe, canhão recua)
const RANGE = 4.6;         // raio do prompt "SER DISPARADO"
const _f = new THREE.Vector3();

export function createCannon(deps) {
  const {
    scene, camera, player, SFX, FX, csmMat, Structures, heightAt, slopeAt,
    WATER_LEVEL, CITY, centerMsg,
  } = deps;

  // PRNG seedado do worldgen mora em Math.random durante a sessão inteira
  // (game.js:64). A geometria é criada em noSeed pra NUNCA deslocar o layout,
  // exatamente como o interior da Torre Nexus (js/structures.js:247).
  let _us = 0x1B0B15 >>> 0;
  const noSeed = (fn) => {
    const _R = Math.random;
    Math.random = () => (_us = (_us * 1664525 + 1013904223) >>> 0) / 4294967296;
    try { return fn(); } finally { Math.random = _R; }
  };

  // ---- ponto: o lugar mais vazio, seco e plano num anel ao redor da cidade
  const cx = (CITY && CITY.x) || 0, cz = (CITY && CITY.z) || 0;
  const sampler = (x, z) => ({ h: heightAt(x, z), slope: slopeAt ? slopeAt(x, z) : 0 });
  const picked = pickSpot({
    sites: Structures.sites, cx, cz, sampler, waterLevel: WATER_LEVEL,
  });
  // fallback determinístico: se nada no anel serviu, planta a 220 m a leste da
  // cidade, no chão (raro; pickSpot só falha em mapas quase todos água/serra).
  const spot = picked || { x: cx + 220, z: cz };
  const baseY = heightAt(spot.x, spot.z);

  // ---- malhas (todas em noSeed) --------------------------------------------
  const group = new THREE.Group();
  const barrelPivot = new THREE.Group();   // gira no eixo Y pra mirar
  const tilt = new THREE.Group();          // inclina o cano pra cima (pitch fixo)
  let muzzle = null;                        // referência pro bocal (confete/recuo)

  noSeed(() => {
    const red   = csmMat(new THREE.MeshStandardMaterial({ color: 0xd7343a, roughness: 0.55, metalness: 0.15 }));
    const white = csmMat(new THREE.MeshStandardMaterial({ color: 0xf4f1e8, roughness: 0.6 }));
    const gold  = csmMat(new THREE.MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.3, metalness: 0.8 }));
    const dark  = csmMat(new THREE.MeshStandardMaterial({ color: 0x2b2b33, roughness: 0.7 }));
    const blue  = csmMat(new THREE.MeshStandardMaterial({ color: 0x3aa0e0, roughness: 0.5 }));

    // carreta (base)
    const carriage = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.75, 0.7, 20), red);
    carriage.position.y = 0.55; carriage.castShadow = carriage.receiveShadow = true;
    group.add(carriage);
    // rodas de circo
    for (const sx of [-1, 1]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.26, 16), dark);
      wheel.rotation.z = Math.PI / 2; wheel.position.set(sx * 1.55, 0.72, 0);
      wheel.castShadow = true; group.add(wheel);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.09, 8, 18), gold);
      rim.rotation.y = Math.PI / 2; rim.position.set(sx * 1.68, 0.72, 0); group.add(rim);
    }

    // cano: cilindro ao longo de +Z (rotaciona a geometria), listras brancas + bocal dourado
    const barrelGeo = new THREE.CylinderGeometry(0.6, 0.78, 4.0, 22);
    barrelGeo.rotateX(Math.PI / 2);               // eixo Y → Z
    const barrel = new THREE.Mesh(barrelGeo, red);
    barrel.position.z = 1.15; barrel.castShadow = true;
    tilt.add(barrel);
    for (const z of [0.15, 1.15, 2.15]) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.24, 22), white);
      band.rotation.x = Math.PI / 2; band.position.z = z; tilt.add(band);
    }
    muzzle = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.12, 10, 22), gold);
    muzzle.position.z = 3.05; tilt.add(muzzle);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.58, 20),
      new THREE.MeshBasicMaterial({ color: 0xffe9a8 }));
    glow.position.z = 3.08; tilt.add(glow);

    tilt.rotation.x = -LAUNCH.pitch;              // aponta pra cima no pitch de lançamento
    barrelPivot.position.y = 1.05;
    barrelPivot.add(tilt);
    group.add(barrelPivot);

    // bandeirinhas de feira (leitura "circo alegre", não sombrio)
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.4, 6), dark);
    pole.position.set(1.9, 1.7, -0.2); group.add(pole);
    const flagMats = [red, blue, gold];
    for (let i = 0; i < 3; i++) {
      const pen = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.5, 4), flagMats[i]);
      pen.rotation.z = -Math.PI / 2; pen.position.set(2.2, 3.1 - i * 0.5, -0.2);
      group.add(pen);
    }
  });

  group.position.set(spot.x, baseY, spot.z);
  scene.add(group);

  // ---- estado do lançamento ------------------------------------------------
  let state = 'idle';        // 'idle' | 'charge' | 'flying'
  let chargeT = 0;
  let recoil = 0;            // recuo visual do cano (0..1)
  let originX = 0, originZ = 0, flewT = 0, lastDist = 0;
  let best = 0;
  try { best = Number(localStorage.getItem(BEST_KEY)) || 0; } catch (e) { best = 0; }

  function nearPlayer(pos, r = RANGE) {
    return Math.hypot(pos.x - spot.x, pos.z - spot.z) < r;
  }

  // direção horizontal pra onde o jogador olha (mesma extração do playerUpdate)
  function aimDir() {
    _f.set(0, 0, -1).applyQuaternion(camera.quaternion); _f.y = 0;
    if (_f.lengthSq() < 1e-6) _f.set(0, 0, -1);
    _f.normalize();
    return _f;
  }

  function fire() {
    if (state !== 'idle') return false;
    if (player.dead || !player.onGround) return false;
    if (!nearPlayer(player.pos, RANGE + 1.5)) return false;
    state = 'charge'; chargeT = CHARGE_T;
    if (SFX.cannonWind) SFX.cannonWind();
    return true;
  }

  function doLaunch() {
    const d = aimDir();
    barrelPivot.rotation.y = Math.atan2(d.x, d.z);   // trava a mira no visual
    const v = launchVelocity(d.x, d.z);
    player.vel.set(v.x, v.y, v.z);
    player.pos.y += 0.35;            // descola do chão pra não re-grudar no mesmo frame
    player.onGround = false;
    player.launchT = LAUNCH.maxAir;  // playerUpdate entra em modo balístico
    originX = player.pos.x; originZ = player.pos.z;
    recoil = 1; flewT = 0;
    state = 'flying';
    // bocal no mundo pro confete
    muzzle.getWorldPosition(_f);
    if (FX.confetti) FX.confetti(_f, 18);
    if (SFX.cannonFire) SFX.cannonFire();
  }

  function land() {
    const dist = Math.hypot(player.pos.x - originX, player.pos.z - originZ);
    lastDist = dist;
    const isRecord = dist > best + 0.5;
    best = betterRecord(best, dist);
    try { localStorage.setItem(BEST_KEY, String(Math.round(best))); } catch (e) { /* privado/off */ }
    if (centerMsg) {
      centerMsg(isRecord
        ? `🎪 VOOU ${Math.round(dist)} m — NOVO RECORDE!`
        : `🎪 VOOU ${Math.round(dist)} m · recorde ${Math.round(best)} m`, 2400);
    }
    if (SFX.cannonLand) SFX.cannonLand();
    player.launchT = 0;
    state = 'idle';
  }

  function update(dt) {
    if (window.__BR_freeze) return;   // na nave/queda não existe atração
    // recuo do cano volta suave
    if (recoil > 0) { recoil = Math.max(0, recoil - dt * 3.2); tilt.position.z = -recoil * 0.6; }

    if (state === 'flying') {
      flewT += dt;
      // pousou de verdade? exige tempo de voo (passou do transiente do bocal)
      // E estar descendo — senão um toque de rampa na subida encerra cedo.
      if (player.onGround && flewT > 0.3 && player.vel.y <= 0.05) land();
      return;
    }
    // idle/charge: o cano acompanha pra onde o jogador olha quando está perto
    if (nearPlayer(player.pos, RANGE + 2)) {
      const d = aimDir();
      const target = Math.atan2(d.x, d.z);
      let cur = barrelPivot.rotation.y;
      let diff = ((target - cur + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      barrelPivot.rotation.y = cur + diff * Math.min(1, dt * 8);
    }
    if (state === 'charge') {
      chargeT -= dt;
      recoil = Math.min(1, recoil + dt * 2); // recua carregando
      tilt.position.z = -recoil * 0.6;
      if (chargeT <= 0) doLaunch();
    }
  }

  // prompt pro Interact (funciona no solo E no BR)
  function prompt(pos) {
    if (state !== 'idle') return null;
    if (!nearPlayer(pos, RANGE)) return null;
    return { txt: 'SER DISPARADO 🎪', fn: fire };
  }

  return {
    group, update, prompt, fire,
    get pos() { return { x: spot.x, y: baseY, z: spot.z }; },
    get state() { return state; },
    get best() { return best; },
    get lastFlightDist() { return lastDist; }, // QA: distância do último voo medida pelo módulo
    get spot() { return { x: spot.x, z: spot.z, clearance: picked ? picked.clearance : 0 }; },
    // hook de QA: velocidade horizontal teórica do lançamento
    get launchHSpeed() { return horizontalSpeed(); },
  };
}
