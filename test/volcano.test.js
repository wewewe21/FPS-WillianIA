/* ================================================================
   QA — VULCÃO no canto do mapa.
   Montanha moldada no próprio terreno (perfil radial extraído do
   modelo 3D → encosta caminhável), lago de lava no topo que dá
   dano contínuo em quem pisar, modelo GLB visível e cacheável.
   ================================================================ */
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { CHROME, bootGame } = require('./helpers/harness');

describe('Vulcão (canto do mapa + lava que machuca)', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h;
  before(async () => { h = await bootGame({ port: 3175 }); });
  after(async () => { if (h) await h.close(); });
  const play = (fn, ...args) => h.play(fn, ...args);

  it('dado o mundo, então o vulcão existe num canto, inteiro dentro do mapa', async () => {
    const v = await play(() => window.__game.Volcano && window.__game.Volcano.VOLCANO);
    assert.ok(v, '__game.Volcano.VOLCANO não existe');
    assert.ok(Math.abs(v.x) > 250 && Math.abs(v.z) > 250, `longe do canto: ${v.x},${v.z}`);
    assert.ok(Math.abs(v.x) + v.r < 550 && Math.abs(v.z) + v.r < 550,
      `vaza pra fora do mundo (borda ±550): x=${v.x} z=${v.z} r=${v.r}`);
    // longe da cidade (-340,130) e do spawn (0,0): eventos não se sobrepõem
    assert.ok(Math.hypot(v.x + 340, v.z - 130) > v.r + 130, 'em cima da cidade');
    assert.ok(Math.hypot(v.x, v.z) > v.r + 90, 'em cima do spawn');
  });

  it('dado o terreno, então é montanha de verdade: borda da cratera bem acima do sopé', async () => {
    const r = await play(() => {
      const v = window.__game.Volcano.VOLCANO, MP = window.__MP;
      // borda: ponto mais alto num anel apertado em volta da boca da cratera
      let topo = -1e9;
      for (let a = 0; a < 8; a++)
        topo = Math.max(topo, MP.groundAt(v.lavaX + Math.cos(a / 8 * Math.PI * 2) * 22,
          v.lavaZ + Math.sin(a / 8 * Math.PI * 2) * 22, 9999));
      // sopé medido na direção do centro do mapa (pra não sair do mundo)
      const sx = Math.sign(v.x), sz = Math.sign(v.z);
      const sope = MP.groundAt(v.x - sx * v.r * 1.6, v.z - sz * v.r * 1.6, 9999);
      const meio = MP.groundAt(v.x - sx * v.r * 0.55, v.z - sz * v.r * 0.55, 9999);
      // garganta: o poço da cratera desce bem abaixo da borda
      const poco = MP.groundAt(v.lavaX, v.lavaZ, 9999);
      return { topo, sope, meio, poco };
    });
    assert.ok(r.topo - r.sope > 45, `subida fraca: borda=${r.topo.toFixed(1)} sopé=${r.sope.toFixed(1)}`);
    assert.ok(r.meio > r.sope + 8 && r.meio < r.topo, `encosta sem rampa: meio=${r.meio.toFixed(1)}`);
    assert.ok(r.topo - r.poco > 25, `cratera sem garganta: borda=${r.topo.toFixed(1)} poço=${r.poco.toFixed(1)}`);
  });

  it('dado o player dentro da garganta da cratera, então a lava queima continuamente', async () => {
    const r = await play(() => {
      const QA = window.QA, v = window.__game.Volcano.VOLCANO;
      QA.reset(v.lavaX, v.lavaZ); // teleporta pro fundo do poço de lava
      const antes = QA.MP.player.health;
      QA.tick(180); // 3 s parado na lava
      return { antes, depois: QA.MP.player.health, y: QA.MP.player.pos.y, teto: v.lavaY };
    });
    assert.ok(r.y < r.teto, `reset não caiu no poço: y=${r.y.toFixed(1)} teto=${r.teto.toFixed(1)}`);
    assert.ok(r.depois < r.antes - 30,
      `lava não machucou: ${r.antes} → ${r.depois} (esperava −30+ em 3s)`);
  });

  it('dado o player na encosta (fora da lava), então NÃO perde vida', async () => {
    const r = await play(() => {
      const QA = window.QA, v = window.__game.Volcano.VOLCANO;
      const sx = Math.sign(v.x), sz = Math.sign(v.z);
      QA.reset(v.x - sx * v.r * 0.5, v.z - sz * v.r * 0.5); // meio da encosta
      const antes = QA.MP.player.health;
      QA.tick(180);
      return { antes, depois: QA.MP.player.health };
    });
    assert.equal(r.depois, r.antes, `encosta machucou: ${r.antes} → ${r.depois}`);
  });

  it('dado o carregamento, então o modelo 3D do vulcão aparece na cena', async () => {
    await h.page.waitForFunction('window.__game.Volcano && window.__game.Volcano.modelReady',
      { timeout: 30000, polling: 200 });
    const r = await play(() => {
      const V = window.__game.Volcano, v = V.VOLCANO;
      const box = new window.__MP.THREE.Box3().setFromObject(V.group);
      return {
        cx: (box.min.x + box.max.x) / 2, cz: (box.min.z + box.max.z) / 2,
        alto: box.max.y - box.min.y, largo: box.max.x - box.min.x,
        vx: v.x, vz: v.z, r: v.r,
      };
    });
    assert.ok(Math.hypot(r.cx - r.vx, r.cz - r.vz) < r.r * 0.3,
      `modelo fora do lugar: centro (${r.cx.toFixed(0)},${r.cz.toFixed(0)}) vs (${r.vx},${r.vz})`);
    assert.ok(r.alto > 50 && r.largo > r.r, `modelo pequeno: alto=${r.alto.toFixed(0)} largo=${r.largo.toFixed(0)}`);
  });

  it('dada a grama, então não brota na rocha do vulcão (e segue viva fora dele)', async () => {
    const r = await play(() => {
      const QA = window.QA, G = QA.G, MP = QA.MP, THREE = MP.THREE;
      const v = G.Volcano.VOLCANO;
      const sx = Math.sign(v.x), sz = Math.sign(v.z);
      // observador na borda: a grade de grama cobre dentro E fora do cone
      QA.reset(v.x - sx * v.r * 0.95, v.z - sz * v.r * 0.95);
      for (let i = 0; i < 150; i++) G.Grass.update(MP.player.pos, MP.player.pos, 1); // drena streaming
      const m4 = new THREE.Matrix4(), pos = new THREE.Vector3(),
        q = new THREE.Quaternion(), sc = new THREE.Vector3();
      let dentroAltas = 0, dentroTotal = 0, foraAltas = 0;
      MP.scene.traverse(o => {
        if (!o.isInstancedMesh || !o.geometry.attributes.aPhase) return; // só chunks de grama
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, m4);
          m4.decompose(pos, q, sc);
          const wx = o.position.x + pos.x, wz = o.position.z + pos.z;
          const d = Math.hypot(wx - v.x, wz - v.z);
          if (d < v.r * 0.8) { dentroTotal++; if (sc.y > 0.1) dentroAltas++; }
          else if (d > v.r * 1.15 && d < v.r * 1.6 && sc.y > 0.1) foraAltas++;
        }
      });
      const ox = v.x - sx * v.r * 1.35, oz = v.z - sz * v.r * 1.35;
      return { dentroAltas, dentroTotal, foraAltas, biome: G.biomeAt ? G.biomeAt(ox, oz) : null };
    });
    assert.ok(r.dentroTotal > 30, `amostra pequena no cone (${r.dentroTotal})`);
    assert.equal(r.dentroAltas, 0, `${r.dentroAltas} lâminas brotando na rocha do vulcão`);
    // controle: fora do cone tem que ter grama — a menos que o canto seja deserto neste seed
    if (r.biome === null || r.biome > -0.15)
      assert.ok(r.foraAltas > 5, `controle sem grama fora do vulcão (fora=${r.foraAltas}, biome=${r.biome})`);
  });
});

describe('Vulcão — servidor serve e cacheia o modelo', () => {
  let srv;
  const PORT = 3174;
  before(async () => {
    const { spawn } = require('node:child_process');
    const path = require('node:path');
    srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')],
      { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 700));
  });
  after(() => { if (srv) srv.kill(); });

  it('dado /assets/models/volcano.v1.glb, então responde 200 com cache de 1 dia', async () => {
    const res = await fetch(`http://localhost:${PORT}/assets/models/volcano.v1.glb`);
    assert.equal(res.status, 200, 'modelo não está na whitelist do servidor');
    const cc = res.headers.get('cache-control') || '';
    assert.match(cc, /max-age=[1-9]/, `modelo pesado sem cache longo: "${cc}"`);
  });
});
