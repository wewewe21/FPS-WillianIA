/* ================================================================
   QA — ESQUELETOS caçadores.
   Vários espalhados pelo mapa, caçam o player sem parar, DESVIAM
   de árvores/pedras/paredes (são esqueletos, não fantasmas), batem
   de perto e morrem com tiro (extraTargets). Renascem longe.
   Os testes de comportamento dirigem Skeletons.update() direto —
   QA.tick com __BR_active=false acordaria os 12 soldados de IA e
   eles matam o player no meio da medição.
   ================================================================ */
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { CHROME, bootGame } = require('./helpers/harness');

describe('Esqueletos (caçadores que atravessam tudo)', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h;
  before(async () => {
    h = await bootGame({ port: 3172 });
    // esqueletos só nascem com o modelo carregado (inimigo invisível é injusto)
    await h.page.waitForFunction('window.__game.Skeletons && window.__game.Skeletons.modelReady',
      { timeout: 30000, polling: 200 });
  });
  after(async () => { if (h) await h.close(); });
  const play = (fn, ...args) => h.play(fn, ...args);

  it('dado o mundo, então vários esqueletos vivos espalhados pelo mapa', async () => {
    const r = await play(() => {
      const S = window.__game.Skeletons;
      const vivos = S.list.filter(s => s.alive);
      return {
        total: S.list.length, vivos: vivos.length,
        pos: vivos.map(s => [s.pos().x, s.pos().z]),
      };
    });
    assert.ok(r.total >= 5, `poucos esqueletos: ${r.total}`);
    assert.equal(r.vivos, r.total, 'nem todos nasceram vivos');
    // espalhados: nenhum par grudado
    for (let i = 0; i < r.pos.length; i++) for (let j = i + 1; j < r.pos.length; j++) {
      const d = Math.hypot(r.pos[i][0] - r.pos[j][0], r.pos[i][1] - r.pos[j][1]);
      assert.ok(d > 15, `esqueletos ${i} e ${j} grudados (${d.toFixed(1)}m)`);
    }
  });

  it('dado o loop do jogo (fora do BR), então os esqueletos andam sozinhos', async () => {
    const r = await play(() => {
      const QA = window.QA, sk = window.__game.Skeletons.list[0];
      QA.reset(30, 30);
      sk.pos().set(90, window.__game.heightAt(90, 90), 90);
      const antes = sk.pos().distanceTo(QA.MP.player.pos);
      window.__BR_active = false; // gate real do jogo solo
      QA.tick(30); // meio segundo basta pra provar a fiação
      window.__BR_active = true;
      return { antes, depois: sk.pos().distanceTo(QA.MP.player.pos) };
    });
    assert.ok(r.depois < r.antes - 0.8,
      `tick do jogo não move esqueleto: ${r.antes.toFixed(1)}m → ${r.depois.toFixed(1)}m`);
  });

  it('dado um esqueleto longe, então ele caça o player sem desistir', async () => {
    const r = await play(() => {
      const QA = window.QA, S = window.__game.Skeletons, sk = S.list[0];
      QA.reset(30, 30);
      sk.pos().set(110, window.__game.heightAt(110, 110), 110); // ~113m do player
      const antes = sk.pos().distanceTo(QA.MP.player.pos);
      for (let i = 0; i < 240; i++) S.update(1 / 60, i / 60); // 4 s
      return { antes, depois: sk.pos().distanceTo(QA.MP.player.pos) };
    });
    assert.ok(r.depois < r.antes - 8,
      `não caçou: ${r.antes.toFixed(1)}m → ${r.depois.toFixed(1)}m`);
  });

  it('dado um obstáculo no caminho, então o esqueleto DESVIA e continua a caça', async () => {
    const r = await play(() => {
      const QA = window.QA, G = window.__game, S = G.Skeletons, sk = S.list[1];
      QA.reset(30, 30);
      // acha uma árvore/pedra de verdade perto do player
      let obst = null;
      for (let ang = 0; ang < 6.28 && !obst; ang += 0.3) {
        for (let rr = 10; rr < 60 && !obst; rr += 8) {
          const ox = 30 + Math.cos(ang) * rr, oz = 30 + Math.sin(ang) * rr;
          const os = G.obstaclesNear(ox, oz).filter(o => o.r > 0.5);
          if (os.length) obst = os[0];
        }
      }
      if (!obst) return { semObstaculo: true };
      // esqueleto do lado oposto do obstáculo: a rota reta passa por dentro
      const dx = obst.x - 30, dz = obst.z - 30, d = Math.hypot(dx, dz);
      const sx = obst.x + dx / d * 6, sz = obst.z + dz / d * 6;
      sk.pos().set(sx, G.heightAt(sx, sz), sz);
      const dInicio = sk.pos().distanceTo(QA.MP.player.pos);
      let minDistObst = 1e9;
      for (let i = 0; i < 300; i++) { // 5 s
        S.update(1 / 60, i / 60);
        minDistObst = Math.min(minDistObst, Math.hypot(sk.pos().x - obst.x, sk.pos().z - obst.z));
      }
      const dFinal = sk.pos().distanceTo(QA.MP.player.pos);
      return { r: obst.r, minDistObst, dInicio, dFinal };
    });
    if (r.semObstaculo) return; // mundo sem obstáculo perto neste seed — nada a validar
    // esqueleto tem corpo: não entra no miolo da árvore/pedra
    assert.ok(r.minDistObst > r.r * 0.55,
      `atravessou o obstáculo (r=${r.r.toFixed(1)}m, chegou a ${r.minDistObst.toFixed(1)}m do centro)`);
    // ...mas contorna e segue a caça (5s a 3,1m/s ≈ 15m em linha reta)
    assert.ok(r.dFinal < r.dInicio - 8,
      `travou no obstáculo: ${r.dInicio.toFixed(1)}m → ${r.dFinal.toFixed(1)}m`);
  });

  it('dado um esqueleto colado, então ele bate e o player perde vida', async () => {
    const r = await play(() => {
      const QA = window.QA, S = window.__game.Skeletons, sk = S.list[2];
      QA.reset(30, 30);
      const P = QA.MP.player.pos;
      sk.pos().set(P.x + 1.2, P.y, P.z);
      const antes = QA.MP.player.health;
      for (let i = 0; i < 120; i++) S.update(1 / 60, i / 60); // 2 s apanhando
      return { antes, depois: QA.MP.player.health };
    });
    assert.ok(r.depois < r.antes - 10,
      `esqueleto não bateu: ${r.antes} → ${r.depois}`);
  });

  it('dado tiro suficiente, então o esqueleto morre — e renasce longe depois', async () => {
    const r = await play(() => {
      const QA = window.QA, S = window.__game.Skeletons, sk = S.list[3];
      QA.reset(30, 30);
      // os outros vão pra longe: 25s de caça não pode virar surra no player
      for (const o of S.list) if (o !== sk && o.alive) o.pos().set(480, 0, 480);
      const morreu = sk.damage(999);
      const viveDepoisDeMorto = sk.alive;
      for (let i = 0; i < 25 * 60; i++) S.update(1 / 60, i / 60); // 25 s: janela de respawn
      const P = QA.MP.player.pos;
      return {
        morreu, viveDepoisDeMorto, renasceu: sk.alive,
        dRespawn: Math.hypot(sk.pos().x - P.x, sk.pos().z - P.z),
      };
    });
    assert.equal(r.morreu, true, 'damage(999) não matou');
    assert.equal(r.viveDepoisDeMorto, false, 'continuou vivo depois de morrer');
    assert.equal(r.renasceu, true, 'não renasceu em 25s');
    assert.ok(r.dRespawn > 35, `renasceu em cima do player (${r.dRespawn.toFixed(1)}m)`);
  });
});

describe('Esqueletos — servidor serve e cacheia o modelo', () => {
  let srv;
  const PORT = 3171;
  before(async () => {
    const { spawn } = require('node:child_process');
    const path = require('node:path');
    srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')],
      { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 700));
  });
  after(() => { if (srv) srv.kill(); });

  it('dado /assets/models/skeleton.v1.glb, então responde 200 com cache de 1 dia', async () => {
    const res = await fetch(`http://localhost:${PORT}/assets/models/skeleton.v1.glb`);
    assert.equal(res.status, 200, 'modelo não está na whitelist do servidor');
    const cc = res.headers.get('cache-control') || '';
    assert.match(cc, /max-age=[1-9]/, `modelo pesado sem cache longo: "${cc}"`);
  });
});
