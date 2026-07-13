/* Campo de Tiro local: arena compacta, alvos, arsenal, inimigos e veiculos.
   O modulo so usa entidades ja criadas pelo jogo e nao depende do servidor. */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export const TRAINING_LAYOUT = Object.freeze({
  centerX: 320,
  centerZ: -350,
  width: 190,
  depth: 120,
  targetDistances: Object.freeze([10, 25, 50, 80]),
});

export function createTraining(deps) {
  const {
    scene, world, platforms, heightAt, player, state, camera, arsenal, inventory,
    Enemies, Alien, Boss, Animals, Night, Car, Pickups, extraTargets, ui,
    switchWeapon, updateHealthHUD, updateArmorHUD, updateAmmoHUD, updateInvHUD,
    updateSlotsHUD, showBanner, centerMsg, showHitmarker, DmgNums, SFX, FX, socket,
    tryToggleCar,
  } = deps;

  const L = TRAINING_LAYOUT;
  const root = new THREE.Group();
  root.name = 'CampoDeTiro';
  root.visible = false;
  scene.add(root);

  const targets = [];
  const selectedEnemies = [];
  const trainingVehicles = [];
  const itemStations = [];
  const colliderBodies = [];
  const walkColliders = [];
  let active = false;
  let built = false;
  let floorY = 0;
  let trainingPlatform = null;
  let restockT = 0;
  let statsEl = null;
  let helpEl = null;
  const stats = { shots: 0, hits: 0, knocked: 0, meleeHits: 0 };

  const mat = {
    floor: new THREE.MeshStandardMaterial({ color: 0x25313a, roughness: 0.88, metalness: 0.08 }),
    lane: new THREE.MeshStandardMaterial({ color: 0x3f4d55, roughness: 0.78 }),
    wall: new THREE.MeshStandardMaterial({ color: 0x18232b, roughness: 0.75, metalness: 0.12 }),
    edge: new THREE.MeshStandardMaterial({ color: 0xe29a35, emissive: 0x5a2705, emissiveIntensity: 0.35, roughness: 0.62 }),
    target: new THREE.MeshStandardMaterial({ color: 0xd8e0e4, roughness: 0.65 }),
    targetHot: new THREE.MeshStandardMaterial({ color: 0xff774d, emissive: 0x8c1d08, emissiveIntensity: 0.8, roughness: 0.55 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x11181d, roughness: 0.8 }),
  };

  function box(sx, sy, sz, x, y, z, material = mat.wall) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  }

  function label(text, x, y, z, color = '#ffd76a', scale = 6) {
    const cv = document.createElement('canvas');
    cv.width = 768; cv.height = 112;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = 'rgba(8,13,18,.82)';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.strokeStyle = color; ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, cv.width - 6, cv.height - 6);
    ctx.fillStyle = color; ctx.font = '700 42px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, cv.width / 2, cv.height / 2);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true }));
    sprite.position.set(x, y, z);
    sprite.scale.set(scale, scale * (cv.height / cv.width), 1);
    root.add(sprite);
    return sprite;
  }

  function addPhysicsBox(x, y, z, hx, hy, hz) {
    const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(hx, hy, hz)) });
    body.position.set(x, y, z);
    world.addBody(body);
    colliderBodies.push(body);
    return body;
  }

  function computeFloor() {
    let highest = -Infinity;
    for (let x = -L.width / 2; x <= L.width / 2; x += 10)
      for (let z = -L.depth / 2; z <= L.depth / 2; z += 10)
        highest = Math.max(highest, heightAt(L.centerX + x, L.centerZ + z));
    return Math.ceil(highest + 4);
  }

  function addTarget({ distance, laneZ, moving = false, melee = false }) {
    const spawnX = L.centerX - 82;
    const g = new THREE.Group();
    const x = spawnX + distance;
    const z = L.centerZ + laneZ;
    g.position.set(x, floorY, z);
    root.add(g);

    const pivot = new THREE.Group();
    g.add(pivot);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, melee ? 0.86 : 0.94, 0.7), mat.target);
    body.position.y = 1.02; body.castShadow = true; pivot.add(body);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.16, 18), mat.targetHot);
    head.rotation.z = Math.PI / 2; head.position.y = 1.74; head.castShadow = true; pivot.add(head);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.72, 0.1), mat.dark);
    post.position.y = 0.36; g.add(post);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.08, 1.05), mat.dark);
    foot.position.y = 0.04; g.add(foot);

    const target = {
      id: melee ? 'melee' : `target-${distance}`,
      distance, moving, melee, group: g, pivot,
      alive: true, hp: melee ? 55 : 100, maxHp: melee ? 55 : 100,
      resetT: 0, flashT: 0, baseZ: z,
      spheres: [
        { c: new THREE.Vector3(), r: 0.46, part: 'body' },
        { c: new THREE.Vector3(), r: 0.29, part: 'head' },
      ],
      hitSpheres() {
        this.spheres[0].c.set(g.position.x, g.position.y + 1.03, g.position.z);
        this.spheres[1].c.set(g.position.x, g.position.y + 1.74, g.position.z);
        return this.spheres;
      },
      pos() { return g.position; },
      damage(dmg, hitPos, dir, headshot) {
        if (!this.alive) return false;
        const dealt = dmg * (headshot ? 1.35 : 1);
        this.hp -= dealt;
        this.flashT = 0.13;
        stats.hits++;
        if (this.melee) stats.meleeHits++;
        if (this.hp <= 0) {
          this.alive = false;
          this.resetT = 1.35;
          stats.knocked++;
          return true;
        }
        return false;
      },
      update(dt, t) {
        if (this.moving && this.alive) g.position.z = this.baseZ + Math.sin(t * 1.25) * 3.8;
        this.flashT = Math.max(0, this.flashT - dt);
        body.material = this.flashT > 0 ? mat.targetHot : mat.target;
        if (!this.alive) {
          this.resetT -= dt;
          pivot.rotation.z = Math.min(Math.PI / 2, pivot.rotation.z + dt * 5.5);
          if (this.resetT <= 0) {
            this.alive = true;
            this.hp = this.maxHp;
            pivot.rotation.z = 0;
          }
        }
      },
    };
    targets.push(target);
    extraTargets.push(target);
    label(melee ? 'CORPO A CORPO' : `${distance} m${moving ? '  MOVEL' : ''}`,
      x, floorY + 2.45, z, melee ? '#ff9a61' : '#8ee9ff', melee ? 4.2 : 3.7);
    return target;
  }

  function buildItemBay() {
    const x0 = L.centerX - 59;
    const z0 = L.centerZ - 43;
    label('ARSENAL COMPLETO  1-8 / SCROLL', x0 + 16, floorY + 3.1, z0, '#ffd76a', 9.5);
    const colors = [0x5d8fbd, 0x8c5e3c, 0xc7a54e, 0x9c4f42, 0x3cd6c0, 0xd7dce0, 0x8667c8, 0xa7643c];
    for (let i = 0; i < arsenal.length; i++) {
      const x = x0 + i * 4.6;
      box(3.8, 0.7, 2.1, x, floorY + 0.35, z0, mat.dark);
      const proxy = box(2.7, 0.28, 0.35, x, floorY + 1.05, z0,
        new THREE.MeshStandardMaterial({ color: colors[i % colors.length], metalness: 0.45, roughness: 0.42 }));
      proxy.rotation.y = -0.16;
      label(`${i + 1}  ${arsenal[i].name.replace(/"/g, '')}`, x, floorY + 1.75, z0, '#f2f5f7', 3.7);
    }
    label('ITENS: MUNICAO / KIT / GRANADA / CARNE / ARMADURA', x0 + 16, floorY + 3.0, z0 + 7, '#9dff9a', 10);
    for (let i = 0; i < 5; i++) box(4.4, 0.8, 3.4, x0 + i * 7.8, floorY + 0.4, z0 + 7, i % 2 ? mat.lane : mat.dark);
  }

  function buildArena() {
    if (built) return;
    built = true;
    floorY = computeFloor();

    box(L.width, 1.2, L.depth, L.centerX, floorY - 0.6, L.centerZ, mat.floor);
    box(95, 0.025, 35, L.centerX - 34, floorY + 0.02, L.centerZ, mat.lane);
    box(95, 0.035, 0.24, L.centerX - 34, floorY + 0.05, L.centerZ - 17.5, mat.edge);
    box(95, 0.035, 0.24, L.centerX - 34, floorY + 0.05, L.centerZ + 17.5, mat.edge);
    box(1.4, 6.5, 37, L.centerX + 8, floorY + 3.25, L.centerZ, mat.wall);
    label('LINHAS DE TIRO', L.centerX - 71, floorY + 3.2, L.centerZ + 17, '#8ee9ff', 7);

    // Divisorias visuais das baias. Aberturas centrais mantem a circulacao rapida.
    box(94, 2.3, 0.7, L.centerX + 45, floorY + 1.15, L.centerZ + 22, mat.wall);
    box(94, 2.3, 0.7, L.centerX + 45, floorY + 1.15, L.centerZ - 25, mat.wall);
    label('BAIA DE INIMIGOS  VISITANTE + GUARDIOES', L.centerX + 48, floorY + 3.2, L.centerZ + 52, '#ff8065', 12);
    label('PISTA DE VEICULOS', L.centerX + 48, floorY + 3.2, L.centerZ - 52, '#72dfff', 8);

    // Bordas fisicas seguram carros; o jogador recebe clamp preciso no update.
    addPhysicsBox(L.centerX, floorY - 0.6, L.centerZ, L.width / 2, 0.6, L.depth / 2);
    addPhysicsBox(L.centerX - L.width / 2, floorY + 1, L.centerZ, 0.5, 1.6, L.depth / 2);
    addPhysicsBox(L.centerX + L.width / 2, floorY + 1, L.centerZ, 0.5, 1.6, L.depth / 2);
    addPhysicsBox(L.centerX, floorY + 1, L.centerZ - L.depth / 2, L.width / 2, 1.6, 0.5);
    addPhysicsBox(L.centerX, floorY + 1, L.centerZ + L.depth / 2, L.width / 2, 1.6, 0.5);
    // As divisórias também são sólidas para carros (Cannon) e para o
    // controlador FPS manual (AABBs resolvidas em update()).
    const solidBarrier = (x, y, z, sx, sy, sz) => {
      addPhysicsBox(x, y, z, sx / 2, sy / 2, sz / 2);
      walkColliders.push({ x, z, hx: sx / 2, hz: sz / 2 });
    };
    solidBarrier(L.centerX + 8, floorY + 3.25, L.centerZ, 1.4, 6.5, 37);
    solidBarrier(L.centerX + 45, floorY + 1.15, L.centerZ + 22, 94, 2.3, 0.7);
    solidBarrier(L.centerX + 45, floorY + 1.15, L.centerZ - 25, 94, 2.3, 0.7);
    trainingPlatform = { x0: L.centerX - L.width / 2, x1: L.centerX + L.width / 2,
      z0: L.centerZ - L.depth / 2, z1: L.centerZ + L.depth / 2, y: floorY, training: true };

    const lanes = [-12, -4, 4, 12];
    for (let i = 0; i < L.targetDistances.length; i++)
      addTarget({ distance: L.targetDistances[i], laneZ: lanes[i], moving: i === L.targetDistances.length - 1 });
    addTarget({ distance: 2.4, laneZ: -17, melee: true });
    buildItemBay();
  }

  function setupLoadout() {
    for (const gun of arsenal) {
      gun.locked = false;
      gun.mag = gun.magSize;
      gun.reserve = Math.max(gun.reserve || 0, gun.magSize * 12);
      gun.reloading = false;
    }
    inventory.nades = inventory.nadesMax;
    inventory.medkits = inventory.medkitsMax;
    inventory.meat = inventory.meatMax;
    player.health = player.maxHealth;
    player.armor = player.armorMax;
    player.dead = false;
    player.healPool = 0;
    player.invulnUntil = Infinity;
    switchWeapon(0);
    updateHealthHUD(); updateArmorHUD(); updateAmmoHUD(); updateInvHUD(); updateSlotsHUD();
  }

  function setupEnemies() {
    const wanted = [];
    const firstNormal = Enemies.list.find(e => !e.heavy && !e.suit);
    const heavy = Enemies.list.find(e => e.heavy);
    const suit = Enemies.list.find(e => e.suit);
    for (const e of [firstNormal, heavy, suit, ...Enemies.list])
      if (e && !wanted.includes(e) && wanted.length < 4) wanted.push(e);

    for (const e of Enemies.list) {
      if (!wanted.includes(e)) {
        e.alive = false; e.respawnT = Infinity; e.group.visible = false;
        continue;
      }
      const i = wanted.indexOf(e);
      const x = L.centerX + 35 + (i % 2) * 15;
      const z = L.centerZ + 36 + Math.floor(i / 2) * 12;
      e.plan = { x, z, floorY, training: true };
      e.respawn();
      e.group.visible = true;
      e.respawnT = 1.2;
      selectedEnemies.push(e);
    }

    Alien.state.alive = true;
    Alien.state.active = false;
    Alien.state.hp = Alien.state.hpMax;
    Alien.state.deadT = -1;
    Alien.state.respawnT = 0;
    Alien.pos().set(L.centerX + 70, floorY, L.centerZ + 43);

    // O Colosso fica fora desta arena: a baia usa o Visitante e quatro tipos
    // de combatentes; manter seu FSM preso ao forte evita leashing inesperado.
    Boss.state.alive = false;
    Boss.pos().set(0, -900, 0);
    for (const a of (Animals && Animals.list) || []) { a.alive = false; if (a.group) a.group.visible = false; }
    for (const c of (Night && Night.list) || []) { c.alive = false; if (c.group) c.group.visible = false; }
  }

  function setupVehicles() {
    const unique = [];
    for (const v of Car.vehicles) {
      if (!unique.some(x => x.cfg.name === v.cfg.name)) unique.push(v);
      if (unique.length >= 3) break;
    }
    const spots = [
      [L.centerX + 24, L.centerZ - 42, 0],
      [L.centerX + 48, L.centerZ - 42, 0],
      [L.centerX + 72, L.centerZ - 42, Math.PI],
    ];
    unique.forEach((v, i) => {
      const [x, z, yaw] = spots[i];
      v.chassisBody.position.set(x, floorY + v.cfg.wheelR + v.cfg.half[1] + 0.8, z);
      v.chassisBody.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), yaw);
      v.chassisBody.velocity.set(0, 0, 0);
      v.chassisBody.angularVelocity.set(0, 0, 0);
      v.chassisBody.wakeUp();
      trainingVehicles.push(v);
      label(v.cfg.name, x, floorY + 2.5, z, '#72dfff', 5.5);
    });
  }

  function spawnStationItem(station) {
    Pickups.spawn({ x: station.x, z: station.z }, station.type);
    station.pickup = Pickups.actives().find(p => p.type === station.type &&
      Math.abs(p.root.position.x - station.x) < 0.1 && Math.abs(p.root.position.z - station.z) < 0.1);
    if (station.pickup) station.pickup.root.position.y = floorY + 0.55;
  }

  function createHud() {
    if (!statsEl) {
      statsEl = document.createElement('div');
      statsEl.id = 'trainingStats';
      document.body.appendChild(statsEl);
    }
    if (!helpEl) {
      helpEl = document.createElement('div');
      helpEl.id = 'trainingHelp';
      helpEl.innerHTML = '<b>CAMPO DE TIRO</b><span>1-8 armas &middot; T mira &middot; G granada &middot; E veiculo &middot; ESC pausar/sair</span>';
      document.body.appendChild(helpEl);
    }
    statsEl.style.display = 'block';
    helpEl.style.display = 'flex';
    refreshStats();
  }

  function refreshStats() {
    if (!statsEl) return;
    statsEl.textContent = `DISPAROS ${stats.shots}  |  IMPACTOS ${stats.hits}  |  ALVOS ${stats.knocked}`;
  }

  function enter() {
    if (active) return;
    // O botão também aparece no menu de pausa; não carregamos para o treino
    // o estado de câmera/controles de um carro ou helicóptero em uso.
    if ((state.driving || state.flying) && tryToggleCar) tryToggleCar();
    // Encerra RAFs, timers, listeners e avatares da sala antes da sessão local.
    if (window.__BR_debug && typeof window.__BR_debug.teardown === 'function')
      window.__BR_debug.teardown();
    buildArena();
    active = true;
    root.visible = true;
    if (!platforms.includes(trainingPlatform)) platforms.push(trainingPlatform);

    window.__TRAINING_active = true;
    window.__BR_active = false;
    window.__MP_active = false;
    window.__BR_freeze = false;
    window.__BR_zumbis = false;
    window.__BR_ballistics = null;
    window.__BR_splash = null;
    if (window.__BR_takenCars && window.__BR_takenCars.clear) window.__BR_takenCars.clear();
    window.__BR_heliTaken = false;
    if (socket && socket.connected) socket.disconnect();
    const lobby = document.getElementById('brLobby');
    if (lobby) lobby.style.display = 'none';
    for (const rp of window.__MP_remotePlayers || []) {
      rp.alive = false;
      if (rp.group) rp.group.visible = false;
    }

    document.body.classList.add('training-mode');
    setupLoadout();
    setupEnemies();
    setupVehicles();
    createHud();
    player.pos.set(L.centerX - 82, floorY, L.centerZ);
    player.vel.set(0, 0, 0);
    player.onGround = true;
    camera.position.set(player.pos.x, floorY + 1.62, player.pos.z);
    camera.rotation.set(0, -Math.PI / 2, 0);
    ui.missionText.textContent = 'Aqueça a mira · teste armas, itens, inimigos e veículos';

    const types = ['ammo', 'med', 'nade', 'meat', 'armor'];
    types.forEach((type, i) => itemStations.push({ type,
      x: L.centerX - 59 + i * 8, z: L.centerZ - 36, pickup: null }));
    for (const station of itemStations) spawnStationItem(station);

    window.__TRAINING_melee = melee;
    showBanner('CAMPO DE TIRO<small>arsenal completo · munição e itens repostos automaticamente</small>', 4600);
    centerMsg('Alvos: 10 m · 25 m · 50 m · 80 m', 2800);
  }

  function recordShot() {
    if (!active) return;
    stats.shots++;
    refreshStats();
  }

  const meleeOrigin = new THREE.Vector3();
  const meleeDir = new THREE.Vector3();
  const meleeDelta = new THREE.Vector3();
  const meleeHit = new THREE.Vector3();
  function melee(origin, dir, damage) {
    if (!active) return false;
    recordShot();
    meleeOrigin.copy(origin);
    meleeDir.copy(dir).normalize();
    let best = null;
    let bestT = 2.9;
    const candidates = [...targets, ...selectedEnemies, Alien];
    for (const candidate of candidates) {
      if (!candidate || !candidate.alive) continue;
      for (const sphere of candidate.hitSpheres()) {
        meleeDelta.copy(sphere.c).sub(meleeOrigin);
        const projection = meleeDelta.dot(meleeDir);
        if (projection < 0 || projection > bestT) continue;
        const side2 = meleeDelta.lengthSq() - projection * projection;
        if (side2 > sphere.r * sphere.r) continue;
        bestT = projection;
        best = { candidate, sphere };
      }
    }
    if (!best) { SFX.melee(); return false; }
    meleeHit.copy(meleeOrigin).addScaledVector(meleeDir, bestT);
    let died;
    if (best.candidate === Alien)
      died = Alien.damage(damage, meleeHit, meleeDir, best.sphere.part);
    else
      died = best.candidate.damage(damage, meleeHit, meleeDir, best.sphere.part === 'head');
    FX.burst(meleeHit, meleeDir.clone().negate(), best.candidate.melee ? 'spark' : 'blood');
    DmgNums.spawn(meleeHit, Math.round(damage), best.sphere.part === 'head');
    showHitmarker(died);
    if (died) SFX.kill(); else SFX.hit();
    refreshStats();
    return true;
  }

  function update(dt, t) {
    if (!active) return;
    for (const target of targets) target.update(dt, t);

    // Campo seguro: nenhuma entidade pode acionar o fluxo de morte/respawn BR.
    player.invulnUntil = Infinity;
    player.dead = false;
    player.health = player.maxHealth;
    if (player.armor < player.armorMax) player.armor = player.armorMax;

    if (!state.driving && !state.flying) {
      const margin = 2.2;
      player.pos.x = THREE.MathUtils.clamp(player.pos.x, trainingPlatform.x0 + margin, trainingPlatform.x1 - margin);
      player.pos.z = THREE.MathUtils.clamp(player.pos.z, trainingPlatform.z0 + margin, trainingPlatform.z1 - margin);
      const radius = player.radius || 0.38;
      for (const c of walkColliders) {
        const nearestX = THREE.MathUtils.clamp(player.pos.x, c.x - c.hx, c.x + c.hx);
        const nearestZ = THREE.MathUtils.clamp(player.pos.z, c.z - c.hz, c.z + c.hz);
        let dx = player.pos.x - nearestX, dz = player.pos.z - nearestZ;
        const d2 = dx * dx + dz * dz;
        if (d2 > 1e-8 && d2 < radius * radius) {
          const push = radius / Math.sqrt(d2) - 1;
          player.pos.x += dx * push;
          player.pos.z += dz * push;
        } else if (d2 <= 1e-8 && player.pos.x >= c.x - c.hx && player.pos.x <= c.x + c.hx &&
                   player.pos.z >= c.z - c.hz && player.pos.z <= c.z + c.hz) {
          const edges = [
            { d: player.pos.x - (c.x - c.hx), axis: 'x', v: c.x - c.hx - radius },
            { d: c.x + c.hx - player.pos.x, axis: 'x', v: c.x + c.hx + radius },
            { d: player.pos.z - (c.z - c.hz), axis: 'z', v: c.z - c.hz - radius },
            { d: c.z + c.hz - player.pos.z, axis: 'z', v: c.z + c.hz + radius },
          ];
          const edge = edges.reduce((best, candidate) => candidate.d < best.d ? candidate : best);
          player.pos[edge.axis] = edge.v;
        }
      }
    }

    for (const e of selectedEnemies) {
      if (!e.alive) { e.respawnT = Math.min(e.respawnT, 1.2); continue; }
      e.group.position.x = THREE.MathUtils.clamp(e.group.position.x, L.centerX + 14, L.centerX + 62);
      e.group.position.z = THREE.MathUtils.clamp(e.group.position.z, L.centerZ + 27, L.centerZ + 56);
      e.group.position.y = floorY;
    }
    if (!Alien.alive) {
      Alien.state.alive = true;
      Alien.state.active = false;
      Alien.state.hp = Alien.state.hpMax;
      Alien.state.deadT = -1;
      Alien.state.respawnT = 0;
      Alien.pos().set(L.centerX + 70, floorY, L.centerZ + 43);
    }
    const alienPos = Alien.pos();
    alienPos.x = THREE.MathUtils.clamp(alienPos.x, L.centerX + 14, L.centerX + 90);
    alienPos.z = THREE.MathUtils.clamp(alienPos.z, L.centerZ + 27, L.centerZ + 56);
    alienPos.y = floorY + 0.25 + Math.sin(t * 2) * 0.15;

    restockT -= dt;
    if (restockT <= 0) {
      restockT = 1;
      for (const gun of arsenal) {
        if (!gun.melee && gun.reserve < gun.magSize * 4) gun.reserve = gun.magSize * 12;
      }
      if (inventory.nades <= 1) inventory.nades = inventory.nadesMax;
      if (inventory.medkits <= 1) inventory.medkits = inventory.medkitsMax;
      if (inventory.meat <= 1) inventory.meat = inventory.meatMax;
      for (const station of itemStations) {
        if (!station.pickup || !station.pickup.live || station.pickup.type !== station.type)
          spawnStationItem(station);
        else station.pickup.root.position.y = floorY + 0.55;
      }
      updateHealthHUD(); updateArmorHUD(); updateAmmoHUD(); updateInvHUD();
    }
  }

  function selectByDigit(code) {
    if (!active || !/^Digit[1-8]$/.test(code)) return false;
    const idx = Number(code.slice(-1)) - 1;
    if (arsenal[idx]) switchWeapon(idx);
    return true;
  }

  function exitToMenu() {
    if (!active) return;
    window.__TRAINING_melee = null;
    // Recarregar e a unica saida que tambem restaura socket, seed, IA e fisica
    // originais sem deixar entidades duplicadas ou estado da arena no BR.
    location.reload();
  }

  function debugState() {
    return {
      active, floorY,
      layout: { ...L, targetDistances: [...L.targetDistances] },
      spawn: { x: L.centerX - 82, y: floorY, z: L.centerZ },
      stats: { ...stats },
      targets: targets.map(t => ({ id: t.id, distance: t.distance, moving: t.moving,
        melee: t.melee, alive: t.alive, hp: +t.hp.toFixed(1),
        x: +t.group.position.x.toFixed(1), y: +(t.group.position.y + 1.1).toFixed(1), z: +t.group.position.z.toFixed(1) })),
      enemies: selectedEnemies.map(e => ({ id: e.id, name: e.name, alive: e.alive })),
      alien: { name: Alien.name, alive: Alien.alive, hp: Alien.state.hp },
      vehicles: trainingVehicles.map(v => ({ name: v.cfg.name,
        x: +v.group.position.x.toFixed(1), y: +v.group.position.y.toFixed(1), z: +v.group.position.z.toFixed(1) })),
      items: itemStations.map(s => ({ type: s.type, live: !!(s.pickup && s.pickup.live),
        y: s.pickup ? +s.pickup.root.position.y.toFixed(1) : null })),
      solidBarriers: walkColliders.length,
      socketConnected: !!(socket && socket.connected),
    };
  }

  window.addEventListener('keydown', e => { if (selectByDigit(e.code)) e.preventDefault(); });

  return {
    enter, update, recordShot, melee, selectByDigit, exitToMenu, debugState,
    get active() { return active; },
    get floorY() { return floorY; },
    get targets() { return targets; },
  };
}
