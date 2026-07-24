/* ================================================================
   Atrações do mapa 🎪 — mais entretenimento em pontos vazios, leve e
   client-side (zero servidor, zero worldgen: geometria em noSeed pós-init).
   Cinco brincadeiras que valem SOZINHO e EM GRUPO:
     🤸 Cama Elástica  — quica encadeando pulos
     🎯 Campo de Tiro  — alvos pipocam, você faz pontos (recorde)
     🎆 Totem de Fogos — solta uma salva de fogos coloridos
     💫 Aros de Acrobacia — atravesse o curso contra o relógio (recorde)
     🎹 Xilofone Gigante  — pise nas placas e faça música
   ================================================================ */
import * as THREE from 'three';
import {
  pickSpot, bounceVelocity, passedRing, ringAt, plateAt, XYLO_NOTES,
  betterMax, betterTime,
} from './maptoys-core.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3();
const loadNum = (k) => { try { return Number(localStorage.getItem(k)) || 0; } catch (e) { return 0; } };
const saveNum = (k, v) => { try { localStorage.setItem(k, String(Math.round(v))); } catch (e) { /* off */ } };

export function createMapToys(deps) {
  const {
    scene, player, SFX, FX, csmMat, Structures, heightAt, slopeAt,
    WATER_LEVEL, CITY, centerMsg, showBanner, extraTargets, Car, Heli, state,
    cannonSpot,
  } = deps;

  let _us = 0x5EED42 >>> 0;
  const noSeed = (fn) => {
    const _R = Math.random;
    Math.random = () => (_us = (_us * 1664525 + 1013904223) >>> 0) / 4294967296;
    try { return fn(); } finally { Math.random = _R; }
  };

  const cx = (CITY && CITY.x) || 0, cz = (CITY && CITY.z) || 0;
  const sampler = (x, z) => ({ h: heightAt(x, z), slope: slopeAt ? slopeAt(x, z) : 0 });
  const avoid = [];
  if (cannonSpot) avoid.push({ x: cannonSpot.x, z: cannonSpot.z, r: 40 });
  function place(fallbackAngle) {
    const p = pickSpot({ sites: Structures.sites, avoid: avoid.slice(), cx, cz, sampler, waterLevel: WATER_LEVEL });
    const spot = p || { x: cx + Math.cos(fallbackAngle) * 240, z: cz + Math.sin(fallbackAngle) * 240 };
    avoid.push({ x: spot.x, z: spot.z, r: 46 });
    return { x: spot.x, z: spot.z, y: heightAt(spot.x, spot.z) };
  }

  const MAT = {};
  const mat = (hex, o = {}) => csmMat(new THREE.MeshStandardMaterial({ color: hex, roughness: 0.55, ...o }));
  const RAINBOW = [0xff5d5d, 0xffa23a, 0xffe14a, 0x8ce65a, 0x53c7ff, 0x7b7bff, 0xff8ad4, 0xffffff];

  // ===================================================================== //
  // 🤸 CAMA ELÁSTICA                                                        //
  // ===================================================================== //
  const tramp = { spot: null, pads: [], flash: 0 };
  noSeed(() => {
    tramp.spot = place(0.3);
    MAT.frame = mat(0x8a3ffb, { roughness: 0.5 });
    for (let i = 0; i < 4; i++) {
      const ox = (i % 2 ? 1 : -1) * 2.4, oz = (i < 2 ? 1 : -1) * 2.4;
      const px = tramp.spot.x + ox, pz = tramp.spot.z + oz, py = heightAt(px, pz);
      const frame = new THREE.Mesh(new THREE.CylinderGeometry(2.25, 2.35, 0.5, 20), MAT.frame);
      frame.position.set(px, py + 0.25, pz); frame.receiveShadow = frame.castShadow = true; scene.add(frame);
      const skinMat = new THREE.MeshStandardMaterial({ color: RAINBOW[i * 2], roughness: 0.4, emissive: RAINBOW[i * 2], emissiveIntensity: 0.12 });
      const skin = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.0, 0.1, 20), csmMat(skinMat));
      skin.position.set(px, py + 0.52, pz); scene.add(skin);
      tramp.pads.push({ x: px, z: pz, r: 2.1, mat: skinMat });
    }
  });
  function tryBounce(pl, groundY) {
    if (pl.vel.y >= -3) return false;
    for (const p of tramp.pads) {
      if (Math.hypot(pl.pos.x - p.x, pl.pos.z - p.z) <= p.r) {
        pl.pos.y = groundY; pl.vel.y = bounceVelocity(1); pl.onGround = false;
        tramp.flash = 1; if (SFX.boing) SFX.boing();
        _a.set(pl.pos.x, groundY + 0.3, pl.pos.z); FX.burst(_a, _b.set(0, 1, 0), 'spark');
        return true;
      }
    }
    return false;
  }

  // ===================================================================== //
  // 🎯 CAMPO DE TIRO                                                        //
  // ===================================================================== //
  const gal = { spot: null, targets: [], active: false, endT: 0, score: 0, best: loadNum('callofai_galleryBest') };
  noSeed(() => {
    gal.spot = place(1.4);
    const back = new THREE.Mesh(new THREE.BoxGeometry(9, 3.4, 0.4), mat(0x3a2a5a));
    back.position.set(gal.spot.x, gal.spot.y + 1.7, gal.spot.z - 2); back.castShadow = true; scene.add(back);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.3, 8), mat(0xffe14a, { metalness: 0.5 }));
    post.position.set(gal.spot.x - 4.6, gal.spot.y + 0.65, gal.spot.z + 1.4); scene.add(post);
    gal.leverPos = { x: gal.spot.x - 4.6, z: gal.spot.z + 1.4 };
    for (let i = 0; i < 6; i++) {
      const tx = gal.spot.x - 3.4 + i * 1.36, ty = gal.spot.y + 1.4, tz = gal.spot.z - 1.7;
      const faceMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, emissive: 0xff5d5d, emissiveIntensity: 0.25 });
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.16, 18), csmMat(faceMat));
      disc.rotation.x = Math.PI / 2; disc.position.set(tx, ty, tz); disc.visible = false; scene.add(disc);
      const homeY = ty, downY = ty - 1.3;
      const t = {
        mesh: disc, mat: faceMat, alive: false, enabled: false, homeY, downY, respawn: 0,
        hitSpheres() { return [{ c: disc.position, r: 0.62, part: 'body' }]; },
        pos() { return disc.position; },
        damage() {
          if (!t.alive) return false;
          t.alive = false; disc.visible = false; t.respawn = 0.5 + Math.random() * 0.7;
          gal.score += 1; if (SFX.pop) SFX.pop();
          _a.copy(disc.position); FX.confetti(_a, 8);
          if (centerMsg) centerMsg(`🎯 ${gal.score} — restam ${Math.max(0, Math.ceil(gal.endT - state.gameTime))}s`, 700);
          return true; // "morreu" (pontuação é do próprio alvo, como manda o contrato)
        },
      };
      gal.targets.push(t);
    }
  });
  function galleryStart() {
    if (gal.active) return;
    gal.active = true; gal.score = 0; gal.endT = state.gameTime + 30;
    for (const t of gal.targets) { extraTargets.push(t); popTarget(t, 0); }
    if (showBanner) showBanner('🎯 CAMPO DE TIRO<small>derrube o máximo em 30s!</small>', 2600);
  }
  function popTarget(t, delay) { t.respawn = delay; t.alive = false; t.mesh.visible = false; }
  function galleryEnd() {
    gal.active = false;
    for (const t of gal.targets) { t.alive = false; t.enabled = false; t.mesh.visible = false; const i = extraTargets.indexOf(t); if (i >= 0) extraTargets.splice(i, 1); }
    const rec = gal.score > gal.best;
    gal.best = betterMax(gal.best, gal.score); saveNum('callofai_galleryBest', gal.best);
    if (centerMsg) centerMsg(rec ? `🎯 ${gal.score} ALVOS — NOVO RECORDE!` : `🎯 ${gal.score} alvos · recorde ${gal.best}`, 3200);
  }
  function galleryUpdate(dt, t) {
    if (!gal.active) return;
    if (state.gameTime >= gal.endT) { galleryEnd(); return; }
    for (const tg of gal.targets) {
      if (tg.alive) continue;
      tg.respawn -= dt;
      if (tg.respawn <= 0) { tg.alive = true; tg.enabled = true; tg.mesh.visible = true; tg.mesh.position.y = tg.homeY; }
    }
  }

  // ===================================================================== //
  // 🎆 TOTEM DE FOGOS                                                       //
  // ===================================================================== //
  const fw = { spot: null, shells: [], cd: 0 };
  noSeed(() => {
    fw.spot = place(2.5);
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 1.1), mat(RAINBOW[i * 2 + 1]));
      seg.position.set(fw.spot.x, fw.spot.y + 0.4 + i * 0.7, fw.spot.z); seg.castShadow = true; scene.add(seg);
    }
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.7, 0.9, 4), mat(0xffe14a, { emissive: 0xffe14a, emissiveIntensity: 0.3 }));
    tip.position.set(fw.spot.x, fw.spot.y + 3.4, fw.spot.z); scene.add(tip);
  });
  function fireworksFire() {
    if (fw.cd > 0) return;
    fw.cd = 3.5;
    for (let i = 0; i < 6; i++) {
      setTimeout(() => {
        const x = fw.spot.x + (Math.random() - 0.5) * 3, z = fw.spot.z + (Math.random() - 0.5) * 3;
        fw.shells.push({ x, y: fw.spot.y + 3.6, z, vy: 15 + Math.random() * 5, life: 1.0 + Math.random() * 0.5 });
        if (SFX.cannonWind) SFX.cannonWind();
      }, i * 180);
    }
    if (showBanner) showBanner('🎆 FOGOS!', 1400);
  }
  function fireworksUpdate(dt) {
    if (fw.cd > 0) fw.cd -= dt;
    for (let i = fw.shells.length - 1; i >= 0; i--) {
      const s = fw.shells[i];
      s.life -= dt; s.vy -= 20 * dt; s.y += s.vy * dt;
      if (s.life <= 0 || s.vy <= 0) {
        _a.set(s.x, s.y, s.z); FX.confetti(_a, 14); if (SFX.pop) SFX.pop();
        fw.shells.splice(i, 1);
      }
    }
  }

  // ===================================================================== //
  // 💫 AROS DE ACROBACIA                                                    //
  // ===================================================================== //
  const ring = { spot: null, rings: [], next: 0, running: false, startT: 0, best: loadNum('callofai_ringBest'), prev: new THREE.Vector3() };
  const RING_N = 6, RING_R = 2.0;
  noSeed(() => {
    ring.spot = place(3.9);
    // curso apontando pra cidade (cenográfico); normal = direção do curso
    const dx = cx - ring.spot.x, dz = cz - ring.spot.z, dl = Math.hypot(dx, dz) || 1;
    const dir = { x: dx / dl, z: dz / dl };
    for (let i = 0; i < RING_N; i++) {
      const c = ringAt({ x: ring.spot.x, y: ring.spot.y, z: ring.spot.z }, dir, i, RING_N);
      const torus = new THREE.Mesh(new THREE.TorusGeometry(RING_R, 0.16, 10, 26),
        csmMat(new THREE.MeshStandardMaterial({ color: RAINBOW[i], emissive: RAINBOW[i], emissiveIntensity: 0.3, roughness: 0.4 })));
      torus.position.set(c.x, c.y, c.z);
      torus.lookAt(c.x + dir.x, c.y, c.z + dir.z); // encara a direção do curso
      scene.add(torus);
      ring.rings.push({ mesh: torus, c: new THREE.Vector3(c.x, c.y, c.z), n: new THREE.Vector3(dir.x, 0, dir.z).normalize(), lit: false });
    }
  });
  function activePos(out) {
    if (state.flying && Heli && Heli.group) return out.copy(Heli.group.position);
    if (state.driving && Car && Car.group) return out.copy(Car.group.position);
    return out.copy(player.pos);
  }
  function ringGlow(i, on) {
    const r = ring.rings[i]; if (!r) return; r.lit = on;
    r.mesh.material.emissiveIntensity = on ? 0.9 : 0.3;
  }
  function ringUpdate(dt, t) {
    activePos(_a);
    // teleporte (respawn, pouso do canhão) não conta como atravessar aro
    if (_a.distanceTo(ring.prev) > 25) { ring.prev.copy(_a); return; }
    for (let i = 0; i < ring.rings.length; i++) {
      const r = ring.rings[i];
      if (i !== ring.next) continue; // só o próximo aro conta (ordem do curso)
      if (passedRing(ring.prev, _a, r.c, r.n, RING_R)) {
        if (!ring.running) { ring.running = true; ring.startT = t; }
        ringGlow(i, false); if (SFX.ding) SFX.ding();
        ring.next += 1;
        if (ring.next < ring.rings.length) ringGlow(ring.next, true);
        else {
          const time = t - ring.startT;
          const rec = ring.best === 0 || time < ring.best;
          ring.best = betterTime(ring.best, time); saveNum('callofai_ringBest', ring.best);
          _a.copy(ring.rings[ring.rings.length - 1].c); FX.confetti(_a, 20);
          if (SFX.cannonLand) SFX.cannonLand();
          if (centerMsg) centerMsg(rec ? `💫 CURSO COMPLETO ${time.toFixed(1)}s — RECORDE!` : `💫 ${time.toFixed(1)}s · recorde ${ring.best.toFixed(1)}s`, 3200);
          ring.next = 0; ring.running = false; ringGlow(0, false);
        }
      }
    }
    // desistência: longe do curso reinicia (sem punir)
    if (ring.running && _a.distanceTo(ring.rings[0].c) > 140) { ring.running = false; ring.next = 0; ringGlow(0, false); }
    ring.prev.copy(_a);
  }
  ringGlow(0, true);

  // ===================================================================== //
  // 🎹 XILOFONE GIGANTE                                                     //
  // ===================================================================== //
  const xyl = { spot: null, plates: [], meshes: [], last: -1 };
  noSeed(() => {
    xyl.spot = place(5.2);
    for (let i = 0; i < 8; i++) {
      const w = 1.6, d = 3.0 - i * 0.12;
      const px = xyl.spot.x + (i - 3.5) * (w + 0.14), pz = xyl.spot.z, py = heightAt(px, pz);
      const m = new THREE.MeshStandardMaterial({ color: RAINBOW[i], roughness: 0.5, emissive: RAINBOW[i], emissiveIntensity: 0.1 });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, d), csmMat(m));
      mesh.position.set(px, py + 0.15, pz); mesh.receiveShadow = true; scene.add(mesh);
      xyl.plates.push({ x: px, z: pz, w, d });
      xyl.meshes.push({ mesh, mat: m, flash: 0 });
    }
  });
  function xyloUpdate(dt) {
    const i = plateAt(player.pos.x, player.pos.z, xyl.plates);
    if (i >= 0 && i !== xyl.last && player.onGround) {
      if (SFX.xyloNote) SFX.xyloNote(XYLO_NOTES[i]);
      xyl.meshes[i].flash = 1;
    }
    xyl.last = i;
    for (const mm of xyl.meshes) {
      if (mm.flash > 0) { mm.flash = Math.max(0, mm.flash - dt * 3); mm.mat.emissiveIntensity = 0.1 + mm.flash * 0.8; }
    }
  }

  // ===================================================================== //
  // roteamento                                                            //
  // ===================================================================== //
  function update(dt, t) {
    if (window.__BR_freeze) return;
    galleryUpdate(dt, t);
    fireworksUpdate(dt);
    ringUpdate(dt, t);
    xyloUpdate(dt);
    if (tramp.flash > 0) { tramp.flash = Math.max(0, tramp.flash - dt * 2); for (const p of tramp.pads) p.mat.emissiveIntensity = 0.12 + tramp.flash * 0.5; }
  }
  function near(x, z, ax, az, r) { return Math.hypot(x - ax, z - az) < r; }
  function prompt(pos) {
    if (state.driving || state.flying) return null;
    if (gal.leverPos && !gal.active && near(pos.x, pos.z, gal.leverPos.x, gal.leverPos.z, 2.6))
      return { txt: 'PUXAR A ALAVANCA 🎯', fn: galleryStart };
    if (fw.spot && fw.cd <= 0 && near(pos.x, pos.z, fw.spot.x, fw.spot.z, 3.2))
      return { txt: 'SOLTAR FOGOS 🎆', fn: fireworksFire };
    return null;
  }

  return {
    update, prompt, tryBounce,
    // hooks de QA
    get spots() { return { tramp: tramp.spot, gallery: gal.spot, fireworks: fw.spot, rings: ring.spot, xylo: xyl.spot }; },
    get gallery() { return { active: gal.active, score: gal.score, best: gal.best, targets: gal.targets.length }; },
    get rings() { return { next: ring.next, running: ring.running, total: ring.rings.length, best: ring.best, list: ring.rings.map(r => ({ x: r.c.x, y: r.c.y, z: r.c.z, nx: r.n.x, nz: r.n.z })) }; },
    get fireworks() { return { cd: fw.cd, shells: fw.shells.length, pos: fw.spot }; },
    startGallery: galleryStart, fireFireworks: fireworksFire,
    plates: xyl.plates,
    get lastPlate() { return xyl.last; },
  };
}
