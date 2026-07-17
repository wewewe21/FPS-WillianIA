/* ================================================================
   QA — nave de entrada remodelada (Chrome headless, porta fixa 3167).
   Referencial móvel LOCAL: dimensões/semântica da cabine, transformações
   local<->mundo iguais às do three, caminhada WASD (pitch extremo incluso),
   colisão analítica em todas as bordas, deslizamento, sync de remoto no
   referencial da nave, pulo sem teleporte e higiene de memória.
   FLY_TIME=300 mantém a nave no ar durante o teste inteiro.
   ================================================================ */
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { CHROME, bootGame, startBRMatchInShip } = require('./helpers/harness.js');
const ShipProto = require('../ship-protocol.js');

const F = ShipProto.DIMS.floorY;

describe('Nave — cabine caminhável (browser)', { skip: !CHROME && 'sem Chrome' }, () => {
  let h, bot, peer, peerSlot;
  before(async () => {
    h = await bootGame({ port: 3167, extraEnv: { COUNTDOWN_S: '1', NEXT_IN_S: '120', FLY_TIME: '300' } });
    // peer real (socket) entra ANTES do início: vira remoto dentro da nave
    const { io } = require('socket.io-client');
    peer = io('http://localhost:3167', { transports: ['websocket'] });
    await new Promise(r => peer.once('init', d => { peer.__id = d.id; r(); }));
    peer.emit('hello', { nick: 'PeerNave' });
    const gotPlan = new Promise(r => peer.once('matchStart', d => r(d.plan)));
    bot = await startBRMatchInShip(h);
    const plan = await gotPlan;
    peerSlot = ShipProto.slotLocal(plan.shipSlots[peer.__id]);
  });
  after(async () => {
    if (peer) peer.close();
    if (bot) bot.close();
    if (h) await h.close();
  });

  it('16.1 — grupos semânticos, dimensões e casco envolvendo a cabine', async () => {
    const r = await h.play(() => {
      const dbg = window.__BR_debug, THREE = window.QA.MP.THREE;
      const g = dbg.ship.g;
      const nomes = ['shipExterior', 'shipInterior', 'cabinePiso', 'cabineTeto', 'cabineParede', 'cabineJanela'];
      const achados = {};
      for (const n of nomes) achados[n] = !!g.getObjectByName(n);
      const dims = dbg.shipDebug.dims;
      const ext = g.getObjectByName('shipExterior');
      // o QA anula o render: matrizes de mundo precisam ser atualizadas À MÃO
      g.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(ext); // só inspeção — nunca collider
      const centro = g.position;
      const piso = g.getObjectByName('cabinePiso'), janela = g.getObjectByName('cabineJanela');
      return {
        achados, dims: JSON.parse(JSON.stringify(dims)), walkRadius: dbg.shipDebug.walkRadius,
        hull: {
          rx: (box.max.x - box.min.x) / 2, rz: (box.max.z - box.min.z) / 2,
          yMin: box.min.y - centro.y, yMax: box.max.y - centro.y,
        },
        pisoY: piso.position.y, janelaY: janela.position.y,
      };
    });
    for (const [n, ok] of Object.entries(r.achados)) assert.ok(ok, `grupo/mesh ${n} não existe`);
    assert.ok(r.dims.outerRadius * 2 >= 34 && r.dims.outerRadius * 2 <= 38, 'diâmetro externo fora da faixa');
    assert.ok(r.dims.cabinRadius * 2 >= 25, 'cabine útil < 25 m');
    assert.ok(r.dims.ceilingY - r.dims.floorY >= 4.2, 'pé-direito < 4.2 m');
    for (const v of Object.values(r.hull)) assert.ok(Number.isFinite(v), 'NaN no casco');
    // casco envolve piso, teto e parede
    assert.ok(r.hull.rx >= r.dims.cabinRadius && r.hull.rz >= r.dims.cabinRadius, 'casco mais estreito que a cabine');
    assert.ok(r.hull.yMin <= r.dims.floorY && r.hull.yMax >= r.dims.ceilingY, 'casco não cobre piso..teto');
    // vidro e piso na MESMA altura de caminhada (delta só anti z-fight)
    assert.ok(Math.abs(r.pisoY - r.janelaY) <= 0.05, `janela ${r.janelaY} vs piso ${r.pisoY}`);
  });

  it('16.2 — protocolo e three.js concordam no local<->mundo (mesmo yaw da rota)', async () => {
    const r = await h.play(() => {
      const dbg = window.__BR_debug, THREE = window.QA.MP.THREE, proto = dbg.shipDebug.proto;
      const g = dbg.ship.g;
      g.updateWorldMatrix(true, false);
      const pose = { x: g.position.x, y: g.position.y, z: g.position.z, yaw: g.rotation.y };
      const pontos = [[0, proto.DIMS.floorY, 0], [5.5, proto.DIMS.floorY, -8], [-12, 0, 3], [11, 2, 11]];
      const erros = [];
      for (const l of pontos) {
        const meu = proto.localToWorld(pose, l);
        const v = new THREE.Vector3(l[0], l[1], l[2]);
        g.localToWorld(v);
        erros.push(Math.hypot(meu[0] - v.x, meu[1] - v.y, meu[2] - v.z));
        const volta = proto.worldToLocal(pose, meu);
        erros.push(Math.hypot(volta[0] - l[0], volta[1] - l[1], volta[2] - l[2]));
      }
      return { erros, finito: erros.every(Number.isFinite) };
    });
    assert.ok(r.finito, 'NaN nas transformações');
    for (const e of r.erros) assert.ok(e < 1e-6, `protocolo divergiu do three: ${e}`);
  });

  it('16.3 — sem input a posição LOCAL fica constante e o mundo acompanha a nave', async () => {
    const r = await h.play(async () => {
      const dbg = window.__BR_debug, MP = window.QA.MP;
      window.__BR_shipManual = true; // ninguém anda sozinho
      const l0 = dbg.shipDebug.local.slice();
      const w0 = [MP.player.pos.x, MP.player.pos.y, MP.player.pos.z];
      await new Promise(r2 => setTimeout(r2, 700));
      const l1 = dbg.shipDebug.local.slice();
      // leitura SÍNCRONA: pose do grupo + posição no mesmo tique
      const g = dbg.ship.g, proto = dbg.shipDebug.proto;
      const pose = { x: g.position.x, y: g.position.y, z: g.position.z, yaw: g.rotation.y };
      const esperado = proto.localToWorld(pose, l1);
      const w1 = [MP.player.pos.x, MP.player.pos.y, MP.player.pos.z];
      return { l0, l1, w0, w1, esperado };
    });
    assert.deepEqual(r.l1, r.l0, 'posição local mudou sem input');
    const moveu = Math.hypot(r.w1[0] - r.w0[0], r.w1[2] - r.w0[2]);
    assert.ok(moveu > 0.8, `mundo não acompanhou a nave (${moveu.toFixed(2)} m em 0.7 s)`);
    for (let i = 0; i < 3; i++)
      assert.ok(Math.abs(r.w1[i] - r.esperado[i]) < 0.6, `atraso acumulado no eixo ${i}: ${r.w1[i]} vs ${r.esperado[i]}`);
  });

  it('16.4 — WASD anda certo, diagonal não acelera, pitch ±1.55 não quebra', async () => {
    const r = await h.play(() => {
      const dbg = window.__BR_debug, MP = window.QA.MP, THREE = MP.THREE, G = window.QA.G;
      window.__BR_shipManual = true;
      const sd = dbg.shipDebug, proto = sd.proto;
      const solta = () => { for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) G.keys[k] = false; };
      const eul = new THREE.Euler(0, 0, 0, 'YXZ');
      const anda = (keys, pitch, yaw, passos) => {
        solta();
        sd.setLocal(0, 0);
        eul.set(pitch, yaw, 0); MP.camera.quaternion.setFromEuler(eul);
        for (const k of keys) G.keys[k] = true;
        for (let i = 0; i < passos; i++) sd.step(1 / 60);
        solta();
        const l = sd.local;
        const pose0 = { x: 0, y: 0, z: 0, yaw: sd.pose().yaw };
        const w = proto.localToWorld(pose0, [l[0], 0, l[2]]); // só rotação: direção MUNDIAL
        return { dist: Math.hypot(l[0], l[2]), dirW: [w[0], w[2]], y: l[1] };
      };
      const esperada = 60 * (1 / 60) * proto.DIMS.walkSpeed; // 60 passos = 1 s
      const casos = {
        W: anda(['KeyW'], 0, 0, 60),
        S: anda(['KeyS'], 0, 0, 60),
        D: anda(['KeyD'], 0, 0, 60),
        A: anda(['KeyA'], 0, 0, 60),
        diag: anda(['KeyW', 'KeyD'], 0, 0, 60),
        cima: anda(['KeyW'], 1.55, 0.8, 60),
        baixo: anda(['KeyW'], -1.55, 0.8, 60),
        diagCima: anda(['KeyW', 'KeyD'], 1.55, 2.4, 60),
      };
      return { casos, esperada };
    });
    const { casos, esperada } = r;
    for (const [nome, c] of Object.entries(casos)) {
      assert.ok(Number.isFinite(c.dist) && Number.isFinite(c.y), `NaN no caso ${nome}`);
      assert.ok(Math.abs(c.dist - esperada) < 1e-6, `${nome}: andou ${c.dist} (esperado ${esperada})`);
      assert.ok(Math.abs(c.y - F) < 1e-9, `${nome}: saiu do piso (y=${c.y}) — "nadou"`);
    }
    const n = v => { const d = Math.hypot(v[0], v[1]); return [v[0] / d, v[1] / d]; };
    const dirs = { W: [0, -1], S: [0, 1], D: [1, 0], A: [-1, 0] };
    for (const [k, exp] of Object.entries(dirs)) {
      const got = n(casos[k].dirW);
      assert.ok(Math.hypot(got[0] - exp[0], got[1] - exp[1]) < 1e-6, `${k} andou pra ${got}`);
    }
    // pitch extremo: direção continua a horizontal do yaw 0.8
    const expCima = n([-Math.sin(0.8), -Math.cos(0.8)]);
    const gotCima = n(casos.cima.dirW);
    assert.ok(Math.hypot(gotCima[0] - expCima[0], gotCima[1] - expCima[1]) < 1e-6, 'olhar pra cima mudou a direção');
  });

  it('16.5/16.6 — todas as bordas seguram, em qualquer framerate (frame atrasado incluso)', async () => {
    const r = await h.play(() => {
      const dbg = window.__BR_debug, MP = window.QA.MP, THREE = MP.THREE, G = window.QA.G;
      window.__BR_shipManual = true;
      const sd = dbg.shipDebug;
      const eul = new THREE.Euler(0, 0, 0, 'YXZ');
      const out = [];
      const solta = () => { for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) G.keys[k] = false; };
      for (let d8 = 0; d8 < 8; d8++) {
        for (const dt of [1 / 30, 1 / 60, 1 / 144, 0.25]) {
          solta(); sd.setLocal(0, 0);
          eul.set(0, d8 * Math.PI / 4, 0); MP.camera.quaternion.setFromEuler(eul);
          G.keys.KeyW = true;
          const passos = Math.ceil(30 / (Math.min(dt, 0.1) * sd.dims.walkSpeed)); // ~30 m: bate e insiste
          let max = 0;
          for (let i = 0; i < passos; i++) {
            sd.step(dt);
            const l = sd.local;
            max = Math.max(max, Math.hypot(l[0], l[2]));
            if (!Number.isFinite(max)) break;
          }
          out.push({ d8, dt, max, y: sd.local[1] });
          solta();
        }
      }
      return { out, walkRadius: sd.walkRadius };
    });
    for (const c of r.out) {
      assert.ok(Number.isFinite(c.max), `NaN na direção ${c.d8} dt=${c.dt}`);
      assert.ok(c.max <= r.walkRadius + 1e-3, `atravessou a borda: dir ${c.d8} dt=${c.dt} r=${c.max}`);
      assert.ok(Math.abs(c.y - F) < 1e-9, 'saiu do piso na parede');
    }
  });

  it('16.7 — na parede o movimento diagonal desliza tangencialmente (sem grudar)', async () => {
    const r = await h.play(() => {
      const dbg = window.__BR_debug, MP = window.QA.MP, THREE = MP.THREE, G = window.QA.G;
      window.__BR_shipManual = true;
      const sd = dbg.shipDebug, proto = sd.proto;
      const maxR = sd.walkRadius;
      const a0 = 0.85; // faixa sem console (arcos ficam em 30°±9.2° etc.)
      sd.setLocal(Math.cos(a0) * maxR, Math.sin(a0) * maxR);
      // frente da câmera = 45° entre radial (pra fora) e tangencial, em MUNDO
      const yawNave = sd.pose().yaw;
      const rad = [Math.cos(a0), Math.sin(a0)], tan = [-Math.sin(a0), Math.cos(a0)];
      const lx = (rad[0] + tan[0]) * 0.7071, lz = (rad[1] + tan[1]) * 0.7071;
      const w = proto.localToWorld({ x: 0, y: 0, z: 0, yaw: yawNave }, [lx, 0, lz]);
      const eul = new THREE.Euler(0, Math.atan2(-w[0], -w[2]), 0, 'YXZ');
      MP.camera.quaternion.setFromEuler(eul);
      G.keys.KeyW = true;
      const rs = [], angs = [];
      for (let i = 0; i < 90; i++) {
        sd.step(1 / 60);
        const l = sd.local;
        rs.push(Math.hypot(l[0], l[2]));
        angs.push(Math.atan2(l[2], l[0]));
      }
      G.keys.KeyW = false;
      return { rs, angs, maxR, a0 };
    });
    for (const rr of r.rs) assert.ok(rr <= r.maxR + 1e-3, 'passou da parede no deslize');
    const avancou = r.angs[r.angs.length - 1] - r.a0;
    assert.ok(avancou > 0.15, `grudou na parede (avanço angular ${avancou.toFixed(3)} rad)`);
    for (let i = 1; i < r.angs.length; i++)
      assert.ok(r.angs[i] >= r.angs[i - 1] - 1e-6, 'jitter angular no deslize');
  });

  it('16.9 — remoto na nave acompanha a pose (sem rastro), pés no piso, nome sob o teto', async () => {
    // peer manda a posição local dele (slot) — o avatar na página deve
    // aparecer EXATAMENTE na pose atual da nave + local, sem atraso
    const send = local => peer.volatile.emit('state',
      { pos: [0, 0, 0], rotY: 1.1, ship: true, shipLocal: local, heldWeapon: 'FACA', car: -1 });
    const local = [peerSlot[0], F, peerSlot[1]];
    const iv = setInterval(() => send(local), 100);
    await new Promise(r2 => setTimeout(r2, 1200)); // converge o lerp
    const r = await h.play((peerId, esperadoLocal) => {
      const dbg = window.__BR_debug, proto = dbg.shipDebug.proto;
      const rp = dbg.remotes.get(peerId);
      if (!rp) return { semRemoto: true };
      const g = dbg.ship.g;
      const pose = { x: g.position.x, y: g.position.y, z: g.position.z, yaw: g.rotation.y };
      const esperado = proto.localToWorld(pose, esperadoLocal);
      const p = rp.group.position;
      // nome: sprite filho direto do avatar
      let spr = null;
      for (const c of rp.group.children) if (c.isSprite) spr = c;
      const tetoWorldY = pose.y + proto.DIMS.ceilingY;
      return {
        erro: Math.hypot(p.x - esperado[0], p.y - esperado[1], p.z - esperado[2]),
        pesY: p.y, pisoWorldY: pose.y + proto.DIMS.floorY,
        nomeDepth: spr ? spr.material.depthTest : null,
        nomeWorldY: spr ? p.y + spr.position.y : null,
        tetoWorldY,
      };
    }, peer.__id, local);
    clearInterval(iv);
    assert.ok(!r.semRemoto, 'avatar do peer não apareceu');
    assert.ok(r.erro < 0.35, `remoto fora da pose da nave (erro ${r.erro.toFixed(2)} m)`);
    assert.ok(Math.abs(r.pesY - r.pisoWorldY) < 0.05, 'pés do remoto fora do piso');
    assert.equal(r.nomeDepth, true, 'nick sem depthTest (vaza pelo casco)');
    assert.ok(r.nomeWorldY < r.tetoWorldY - 0.5, 'nick acima/na altura do teto');
  });

  it('16.9b — sobreposição exata com remoto separa determinístico (sem NaN)', async () => {
    const send = local => peer.volatile.emit('state',
      { pos: [0, 0, 0], rotY: 0, ship: true, shipLocal: local, heldWeapon: 'FACA', car: -1 });
    const local = [peerSlot[0], F, peerSlot[1]];
    const iv = setInterval(() => send(local), 100);
    await new Promise(r2 => setTimeout(r2, 500));
    const r = await h.play((esperadoLocal) => {
      const dbg = window.__BR_debug;
      window.__BR_shipManual = true;
      const sd = dbg.shipDebug;
      sd.setLocal(esperadoLocal[0], esperadoLocal[2]); // em cima do peer
      sd.step(1 / 60);
      const l = sd.local;
      return { d: Math.hypot(l[0] - esperadoLocal[0], l[2] - esperadoLocal[2]), finito: l.every(Number.isFinite) };
    }, local);
    clearInterval(iv);
    assert.ok(r.finito, 'NaN na separação');
    assert.ok(r.d >= 2 * ShipProto.DIMS.playerRadius, `não separou (d=${r.d.toFixed(2)})`);
  });

  it('16.13 — voo não vaza geometria; contagens documentadas', async () => {
    const r = await h.play(async () => {
      const dbg = window.__BR_debug, MP = window.QA.MP, G = window.QA.G;
      window.__BR_shipManual = false; // caminhada automática de verdade
      G.keys.KeyW = true;
      const g0 = MP.renderer.info.memory.geometries;
      await new Promise(r2 => setTimeout(r2, 2000)); // ~120 frames voando/andando
      G.keys.KeyW = false;
      const g1 = MP.renderer.info.memory.geometries;
      let meshes = 0, instanced = 0;
      const geos = new Set(), mats = new Set();
      dbg.ship.g.traverse(o => {
        if (o.isMesh) { meshes++; geos.add(o.geometry.uuid); mats.add(Array.isArray(o.material) ? o.material[0].uuid : o.material.uuid); }
        if (o.isInstancedMesh) instanced++;
      });
      // um render de verdade só pra medir draw calls (o QA anula o composer)
      MP.renderer.render(MP.scene, MP.camera);
      const calls = MP.renderer.info.render.calls;
      return { g0, g1, meshes, instanced, geometrias: geos.size, materiais: mats.size, calls };
    });
    assert.equal(r.g1, r.g0, `geometrias vazando no voo: ${r.g0} -> ${r.g1}`);
    assert.ok(r.meshes <= 40, `nave pesada demais (${r.meshes} meshes)`);
    console.log(`  [nave] meshes=${r.meshes} (instanciados=${r.instanced}) geometrias=${r.geometrias} ` +
      `materiais=${r.materiais} drawCalls cena=${r.calls}`);
  });

  it('16.11/16.12 — Espaço pula SEM teleporte, ship:false vai pro servidor, freeze ligado antes', async () => {
    // ship:false do MEU estado observado pelo peer depois do pulo
    const updates = [];
    const onUpd = d => updates.push(d);
    peer.on('playerUpdate', onUpd);
    const r = await h.play(() => {
      const dbg = window.__BR_debug, MP = window.QA.MP;
      const freezeAntes = window.__BR_freeze === true;
      const antes = [MP.player.pos.x, MP.player.pos.y, MP.player.pos.z];
      dbg.jump(); // mesma rotina do Espaço (S.phase==='SHIP' garantido)
      const depois = [MP.player.pos.x, MP.player.pos.y, MP.player.pos.z];
      return { freezeAntes, antes, depois, fase: dbg.S.phase };
    });
    assert.equal(r.freezeAntes, true, '__BR_freeze desligado durante SHIP');
    assert.equal(r.fase, 'FALL', 'Espaço não pulou');
    assert.deepEqual(r.depois, r.antes, 'pulo teleportou o jogador');
    await new Promise(r2 => setTimeout(r2, 700));
    const meu = updates.filter(u => u.pos && !u.ship && u.fall !== undefined && !u.bot);
    peer.off('playerUpdate', onUpd);
    assert.ok(meu.length >= 1, 'estado pós-pulo (ship:false) não chegou no peer');
    const caiu = await h.play(() => window.QA.MP.player.pos.y);
    assert.ok(caiu < r.antes[1] - 2, 'não está caindo depois do pulo');
    assert.equal(h.pageErrors.length, 0, `pageerror: ${h.pageErrors[0] || ''}`);
  });
});
