/* Captura visual da animação procedural dos ESQUELETOS (caminhada, ciclo
   completo de ataque, poses paradas) + medição de custo JS de Skeletons.update.
   Sobe servidor + Chrome via harness de testes; dirige S.update(dt,t) direto
   com dt fixo (o __BR_active do harness impede o G.tick de mover esqueletos,
   então cada frame é determinístico). Além dos PNGs, imprime JSON com posição
   dos pés/mão direita/espada por frame — evidência numérica de deslize de pés
   e de espada presa à mão.
   Uso: node scripts/capture-skeletons.js [porta] [outdir]
     porta:  default 3238
     outdir: default output/skel-shots */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { CHROME, bootGame } = require('../test/helpers/harness');

const PORT = +(process.argv[2] || 3238);
const OUT = path.resolve(process.argv[3] || path.join(__dirname, '..', 'output', 'skel-shots'));

(async () => {
  if (!CHROME) throw new Error('Chrome local não encontrado');
  fs.mkdirSync(OUT, { recursive: true });
  const h = await bootGame({ port: PORT });
  const report = { walk: [], attack: [], stills: {}, perf: null, site: null };
  try {
    const { page } = h;
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    await page.waitForFunction('window.__game.Skeletons && window.__game.Skeletons.modelReady',
      { timeout: 30000, polling: 200 });
    await page.addStyleTag({ content: 'body > :not(#game) { display:none !important; }' });

    // palco: meio-dia, área plana longe da cidade, demais esqueletos parqueados longe
    report.site = await page.evaluate(() => {
      const G = window.__game, MP = window.__MP;
      G.Env.tod = 0.5;
      window.QA.tick(2); // assenta luzes do meio-dia
      G.state.cinematic = true; // player/câmera não se mexem sozinhos
      for (const c of MP.camera.children) c.visible = false; // arma/corpo FP fora do quadro
      const C = G.Structures.city && G.Structures.city.center;
      let best = null;
      for (let x = -300; x <= 300; x += 20) for (let z = -300; z <= 300; z += 20) {
        if (C && Math.hypot(x - C.x, z - C.z) < 150) continue;
        const hs = [];
        for (let dx = -6; dx <= 6; dx += 6) for (let dz = -6; dz <= 6; dz += 6)
          hs.push(MP.heightAt(x + dx, z + dz));
        const min = Math.min(...hs), spread = Math.max(...hs) - min;
        if (min < MP.WATER_LEVEL + 1.5) continue;
        if (!best || spread < best.spread) best = { x, z, spread: +spread.toFixed(3) };
      }
      window.QA.reset(best.x, best.z);
      G.state.cinematic = true; // QA.reset tickou; garante câmera manual de novo
      const S = G.Skeletons;
      S.list.forEach((sk, i) => { // longe do palco (não aparecem nos frames)
        const a = i / S.list.length * Math.PI * 2;
        sk.group.position.set(Math.cos(a) * 480, 0, Math.sin(a) * 480);
        sk.group.position.y = MP.heightAt(sk.group.position.x, sk.group.position.z);
      });
      window.QA.tick(30); // grama/LOD assentam em volta do player
      MP.scene.traverse(o => { // grama esconde as pernas — o alvo da análise é o esqueleto
        if (o.isInstancedMesh && o.geometry && o.geometry.attributes.aPhase) o.visible = false;
      });

      window.__cap = {
        t: 1000,
        tick(n, dt = 1 / 60) {
          const Sk = window.__game.Skeletons;
          for (let i = 0; i < n; i++) { this.t += dt; Sk.update(dt, this.t); }
        },
        cam(px, py, pz, lx, ly, lz) {
          MP.camera.position.set(px, py, pz);
          MP.camera.lookAt(lx, ly, lz);
          MP.camera.updateMatrixWorld(true);
        },
        render() { MP.renderer.render(MP.scene, MP.camera); },
        probe() { // métricas do esqueleto 0 pra análise numérica frame a frame
          const THREE = MP.THREE;
          const sk = window.__game.Skeletons.list[0];
          sk.group.updateMatrixWorld(true);
          const r3 = v => [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)];
          const w = bone => {
            if (!bone) return null;
            return r3(bone.getWorldPosition(new THREE.Vector3()));
          };
          return {
            pos: r3(sk.pos()), yaw: +sk.yaw.toFixed(3),
            attacking: sk.attacking, attackT: +sk.attackT.toFixed(3),
            phase: +sk.phase.toFixed(3), moveBlend: +sk.moveBlend.toFixed(3),
            footL: w(sk.bones && sk.bones.footL), footR: w(sk.bones && sk.bones.footR),
            handR: w(sk.bones && sk.bones.handR),
            swordBase: sk.sword ? r3(sk.sword.localToWorld(new THREE.Vector3(0, 0, 0))) : null,
            swordTip: sk.sword ? r3(sk.sword.localToWorld(new THREE.Vector3(0, 1.1, 0))) : null,
            player: r3(MP.player.pos), playerHealth: MP.player.health,
          };
        },
      };
      return best;
    });
    console.log('palco:', JSON.stringify(report.site));

    const canvas = await page.$('#game');
    await page.$eval('#game', c => { c.style.width = '1280px'; c.style.height = '720px'; });
    const shot = async name => {
      const data = await page.evaluate(() => { window.__cap.render(); return window.__cap.probe(); });
      await canvas.screenshot({ path: path.join(OUT, name) });
      console.log(name, JSON.stringify(data));
      return data;
    };

    /* (a) CAMINHADA perseguindo o player: 8 frames a cada ~0,117s (7 ticks) */
    await page.evaluate(() => {
      const G = window.__game, MP = window.__MP, THREE = MP.THREE;
      const sk = G.Skeletons.list[0], P = MP.player.pos;
      sk.group.position.set(P.x + 12, MP.heightAt(P.x + 12, P.z), P.z);
      sk.attacking = false; sk.attackT = 0; sk.hitT = 0; sk.moveBlend = 0; sk.phase = 0;
      window.__cap.tick(30); // 0,5s andando: entra no ciclo de passada
      // câmera ESTÁTICA em 3/4 do lado da espada (mão direita visível)
      const dir = new THREE.Vector3(P.x - sk.pos().x, 0, P.z - sk.pos().z).normalize();
      const side = new THREE.Vector3(dir.z, 0, -dir.x);
      const hr = new THREE.Vector3();
      if (sk.bones && sk.bones.handR) {
        sk.group.updateMatrixWorld(true);
        sk.bones.handR.getWorldPosition(hr).sub(sk.pos());
        if (hr.dot(side) < 0) side.multiplyScalar(-1);
      }
      const mid = sk.pos().clone().addScaledVector(dir, 1.45); // meio do trajeto dos 8 frames
      const cp = mid.clone().addScaledVector(side, 3.0).addScaledVector(dir, 1.2);
      cp.y = Math.max(MP.heightAt(cp.x, cp.z) + 1.25, mid.y + 1.15);
      window.__cap.cam(cp.x, cp.y, cp.z, mid.x, mid.y + 1.0, mid.z);
    });
    for (let i = 0; i < 8; i++) {
      report.walk.push(await shot(`walk-${i}.png`));
      if (i < 7) await page.evaluate(() => window.__cap.tick(7));
    }
    // closeup da empunhadura no fim da caminhada (espada presa? orientação?)
    await page.evaluate(() => {
      const G = window.__game, MP = window.__MP, THREE = MP.THREE;
      const sk = G.Skeletons.list[0];
      sk.group.updateMatrixWorld(true);
      const hr = new THREE.Vector3();
      (sk.bones.handR || sk.group).getWorldPosition(hr);
      const dir = new THREE.Vector3(MP.player.pos.x - sk.pos().x, 0, MP.player.pos.z - sk.pos().z).normalize();
      const side = new THREE.Vector3(dir.z, 0, -dir.x);
      if (hr.clone().sub(sk.pos()).dot(side) < 0) side.multiplyScalar(-1);
      const cp = hr.clone().addScaledVector(side, 1.7).addScaledVector(dir, 0.9);
      window.__cap.cam(cp.x, hr.y + 0.25, cp.z, hr.x, hr.y - 0.15, hr.z);
    });
    report.walkHand = await shot('walk-hand-closeup.png');

    /* (b) ATAQUE completo em melee range: 12 frames a cada ~0,083s (5 ticks) */
    const trig = await page.evaluate(() => {
      const G = window.__game, MP = window.__MP, THREE = MP.THREE;
      const sk = G.Skeletons.list[0], P = MP.player.pos;
      sk.group.position.set(P.x + 1.65, MP.heightAt(P.x + 1.65, P.z), P.z);
      sk.attacking = false; sk.attackT = 0; sk.hitT = 0; sk.attackHit = false;
      MP.player.health = MP.player.maxHealth; // pra ver o dano da janela de impacto
      window.__cap.tick(1); // este tick dispara o ataque (dP < MELEE_RANGE)
      const dir = new THREE.Vector3(P.x - sk.pos().x, 0, P.z - sk.pos().z).normalize();
      const side = new THREE.Vector3(dir.z, 0, -dir.x);
      const hr = new THREE.Vector3();
      if (sk.bones && sk.bones.handR) {
        sk.group.updateMatrixWorld(true);
        sk.bones.handR.getWorldPosition(hr).sub(sk.pos());
        if (hr.dot(side) < 0) side.multiplyScalar(-1);
      }
      const cp = sk.pos().clone().addScaledVector(dir, 2.2).addScaledVector(side, 2.5);
      cp.y = MP.heightAt(cp.x, cp.z) + 1.55;
      window.__cap.cam(cp.x, cp.y, cp.z, sk.pos().x, sk.pos().y + 1.1, sk.pos().z);
      return { attacking: sk.attacking };
    });
    if (!trig.attacking) console.warn('AVISO: ataque não disparou no tick de setup');
    for (let i = 0; i < 12; i++) {
      report.attack.push(await shot(`attack-${String(i).padStart(2, '0')}.png`));
      if (i < 11) await page.evaluate(() => window.__cap.tick(5));
    }
    // segundo ataque visto DE LADO (perpendicular ao eixo esqueleto→player):
    // mostra se o corte avança na direção do player na janela de impacto
    await page.evaluate(() => {
      const G = window.__game, MP = window.__MP, THREE = MP.THREE;
      const sk = G.Skeletons.list[0], P = MP.player.pos;
      sk.hitT = 0; sk.attacking = false; sk.attackT = 0; sk.attackHit = false;
      window.__cap.tick(1); // re-dispara (segue em melee range)
      const dir = new THREE.Vector3(P.x - sk.pos().x, 0, P.z - sk.pos().z).normalize();
      const side = new THREE.Vector3(dir.z, 0, -dir.x);
      const mid = sk.pos().clone().addScaledVector(dir, 0.8);
      const cp = mid.clone().addScaledVector(side, 4.2);
      cp.y = MP.heightAt(cp.x, cp.z) + 1.5;
      window.__cap.cam(cp.x, cp.y, cp.z, mid.x, mid.y + 1.1, mid.z);
      window.__cap.tick(21); // attackT ≈ 0,37 (fim do windup)
    });
    report.attackSide = [];
    for (let i = 0; i < 3; i++) { // 0,37s / 0,45s / 0,53s — janela do impacto (0,432s)
      report.attackSide.push(await shot(`attack-side-${i}.png`));
      if (i < 2) await page.evaluate(() => window.__cap.tick(5));
    }

    /* (c) PARADO: player.dead congela a caça → pose idle; costas e lado */
    await page.evaluate(() => {
      const MP = window.__MP;
      MP.player.dead = true;
      window.__cap.tick(100); // 1,67s: moveBlend assenta em 0
      const sk = window.__game.Skeletons.list[0];
      const f = { x: Math.sin(sk.yaw), z: Math.cos(sk.yaw) }; // facing do modelo (+Z girado)
      const p = sk.pos();
      window.__cap.cam(p.x - f.x * 3.6, p.y + 1.6, p.z - f.z * 3.6, p.x, p.y + 1.1, p.z);
    });
    report.stills.back = await shot('still-back.png');
    await page.evaluate(() => {
      const sk = window.__game.Skeletons.list[0];
      const f = { x: Math.sin(sk.yaw), z: Math.cos(sk.yaw) };
      const p = sk.pos();
      window.__cap.cam(p.x + f.z * 3.6, p.y + 1.6, p.z - f.x * 3.6, p.x, p.y + 1.1, p.z);
    });
    report.stills.side = await shot('still-side.png');

    /* (d) DESEMPENHO: custo JS de S.update — todas próximas vs 1 ativa */
    report.perf = await page.evaluate(() => {
      const G = window.__game, MP = window.__MP, S = G.Skeletons;
      MP.player.dead = false;
      MP.player.health = MP.player.maxHealth;
      MP.player.invulnUntil = Infinity; // swarm não pode matar o player no meio da medição
      const P = MP.player.pos;
      const place = () => S.list.forEach((sk, i) => {
        const a = i / S.list.length * Math.PI * 2, r = 6 + (i % 3) * 2;
        sk.group.position.set(P.x + Math.cos(a) * r, 0, P.z + Math.sin(a) * r);
        sk.group.position.y = MP.heightAt(sk.group.position.x, sk.group.position.z);
        sk.alive = true; sk.hp = 90; sk.attacking = false; sk.attackT = 0;
        sk.hitT = 0; sk.respawnT = 1e9; sk.group.visible = true;
      });
      const measure = () => { // 5 lotes de 200 ticks; reporta cada lote (ms/tick)
        const batches = [];
        for (let b = 0; b < 5; b++) {
          const t0 = performance.now();
          for (let i = 0; i < 200; i++) window.__cap.tick(1);
          batches.push(+((performance.now() - t0) / 200).toFixed(4));
        }
        return batches;
      };
      place();
      window.__cap.tick(30); // warmup (JIT + convergência pro melee)
      const all = measure();
      place();
      for (const sk of S.list.slice(1)) { sk.alive = false; sk.group.visible = false; }
      window.__cap.tick(30);
      const one = measure();
      return { skeletons: S.list.length, all, one };
    });
    console.log('perf:', JSON.stringify(report.perf));

    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    if (h.pageErrors.length) {
      console.error('\nERROS DE PÁGINA:');
      for (const e of h.pageErrors) console.error('  ' + e);
      process.exitCode = 1;
    } else console.log('\nsem erros de página — PNGs e report.json em ' + OUT);
  } finally {
    await h.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
