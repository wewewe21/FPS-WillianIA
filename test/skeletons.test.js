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
    await h.page.evaluate(() => {
      window.__makeSkeletonTestSystem = async (overrides = {}) => {
        const { createSkeletons } = await import('/js/skeletons.js');
        const THREE = window.__MP.THREE;
        const player = overrides.player || { pos: new THREE.Vector3(), dead: false };
        const S = createSkeletons({
          rand: (a, b) => b === undefined ? a / 2 : (a + b) / 2,
          TAU: Math.PI * 2,
          heightAt: () => 0,
          WATER_LEVEL: -10,
          SFX: { groan() {} },
          scene: new THREE.Scene(),
          csmMat: material => material,
          addScore() {},
          addKillFeed() {},
          player,
          playerDamage: overrides.playerDamage || (() => {}),
          extraTargets: [],
          Pickups: { drop() {} },
          Structures: { collide() {} },
          obstaclesNear: () => [],
        });
        return { S, player };
      };
    });
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
    // espalhados: nenhum par nasce a menos de 24m de outro
    for (let i = 0; i < r.pos.length; i++) for (let j = i + 1; j < r.pos.length; j++) {
      const d = Math.hypot(r.pos[i][0] - r.pos[j][0], r.pos[i][1] - r.pos[j][1]);
      assert.ok(d >= 24, `esqueletos ${i} e ${j} separados por só ${d.toFixed(1)}m`);
    }
  });

  it('dado RNG repetido, então o fallback também preserva 24m entre spawns', async () => {
    const pos = await play(async () => {
      const { S } = await window.__makeSkeletonTestSystem();
      const deadline = performance.now() + 10000;
      while (!S.modelReady && performance.now() < deadline)
        await new Promise(resolve => setTimeout(resolve, 20));
      return S.list.map(sk => [sk.pos().x, sk.pos().z]);
    });
    for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++) {
      const d = Math.hypot(pos[i][0] - pos[j][0], pos[i][1] - pos[j][1]);
      assert.ok(d >= 24, `fallback sobrepôs esqueletos ${i} e ${j} (${d.toFixed(1)}m)`);
    }
  });

  it('dado setEnabled, então visibilidade muda sem alterar vida ou morte', async () => {
    const type = await play(() => typeof window.__game.Skeletons.setEnabled);
    assert.equal(type, 'function', 'API setEnabled(boolean) ausente');

    const r = await play(() => {
      const S = window.__game.Skeletons;
      const vivo = S.list[0], morto = S.list[1];
      const prev = [vivo, morto].map(sk => ({ alive: sk.alive, visible: sk.group.visible }));
      vivo.alive = true; vivo.hp = 90; vivo.group.visible = true;
      morto.alive = false; morto.group.visible = false;

      S.setEnabled(false);
      const hpBefore = vivo.hp;
      vivo.damage(10);
      const disabled = {
        vivoAlive: vivo.alive, vivoVisible: vivo.group.visible,
        vivoEnabled: vivo.enabled, hpBefore, hpAfter: vivo.hp,
        mortoAlive: morto.alive, mortoVisible: morto.group.visible,
      };
      S.setEnabled(true);
      const enabled = {
        vivoAlive: vivo.alive, vivoVisible: vivo.group.visible,
        mortoAlive: morto.alive, mortoVisible: morto.group.visible,
      };

      [vivo, morto].forEach((sk, i) => {
        sk.alive = prev[i].alive;
        sk.group.visible = prev[i].visible;
      });
      return { disabled, enabled };
    });
    assert.deepEqual(r.disabled,
      { vivoAlive: true, vivoVisible: false, vivoEnabled: false, hpBefore: 90, hpAfter: 90,
        mortoAlive: false, mortoVisible: false });
    assert.deepEqual(r.enabled,
      { vivoAlive: true, vivoVisible: true, mortoAlive: false, mortoVisible: false });
  });

  it('dado o módulo desabilitado, então update não move os esqueletos', async () => {
    const r = await play(() => {
      const QA = window.QA, G = window.__game, S = G.Skeletons;
      QA.reset(30, 30);
      const saved = S.list.map(sk => sk.pos().clone());
      const sk = S.list[0];
      sk.alive = true;
      sk.pos().set(80, G.heightAt(80, 80), 80);
      const before = sk.pos().clone();

      S.setEnabled(false);
      S.update(1, 1);
      const moved = sk.pos().distanceTo(before);
      const aliveWhileDisabled = sk.alive;
      S.setEnabled(true);
      S.list.forEach((item, i) => item.pos().copy(saved[i]));
      return { moved, aliveWhileDisabled };
    });
    assert.equal(r.moved, 0, `esqueleto oculto ainda andou ${r.moved.toFixed(2)}m`);
    assert.equal(r.aliveWhileDisabled, true, 'desabilitar matou o esqueleto');
  });

  it('não acerta jogador muitos metros acima do alcance vertical', async () => {
    const r = await play(() => {
      const QA = window.QA, S = window.__game.Skeletons, P = QA.MP.player;
      QA.reset(30, 30);
      for (const item of S.list) item.alive = false;
      const sk = S.list[0];
      sk.alive = true; sk.hp = 90; sk.hitT = 0;
      sk.pos().set(P.pos.x + 0.5, window.__game.heightAt(P.pos.x + 0.5, P.pos.z), P.pos.z);
      P.pos.y += 30;
      const before = P.health;
      S.update(0.1, 0.1);
      const after = P.health;
      QA.reset();
      return { before, after };
    });
    assert.equal(r.after, r.before, `esqueleto acertou através de ${30}m verticais`);
  });

  it('dado desabilitado durante o carregamento, então o modelo nasce vivo mas oculto', async () => {
    const r = await play(async () => {
      const { S } = await window.__makeSkeletonTestSystem();
      S.setEnabled(false);
      const deadline = performance.now() + 10000;
      while (!S.modelReady && performance.now() < deadline)
        await new Promise(resolve => setTimeout(resolve, 20));
      return {
        modelReady: S.modelReady,
        allAlive: S.list.every(sk => sk.alive),
        anyVisible: S.list.some(sk => sk.group.visible),
      };
    });
    assert.equal(r.modelReady, true, 'modelo não terminou de carregar');
    assert.equal(r.allAlive, true, 'ocultar foi confundido com matar');
    assert.equal(r.anyVisible, false, 'loader reexibiu esqueletos desabilitados');
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

  it('dada fase PLAY do BR, então o loop continua atualizando os esqueletos', async () => {
    const r = await play(() => {
      const QA = window.QA, G = window.__game, sk = G.Skeletons.list[0];
      QA.reset(30, 30);
      sk.pos().set(70, G.heightAt(70, 70), 70);
      sk.alive = true;
      sk.group.visible = true;
      const antes = sk.pos().distanceTo(QA.MP.player.pos);
      window.__BR_active = true;
      window.__BR_debug = { S: { phase: 'PLAY' } };
      QA.tick(30);
      delete window.__BR_debug;
      return { antes, depois: sk.pos().distanceTo(QA.MP.player.pos) };
    });
    assert.ok(r.depois < r.antes - 0.8,
      `BR PLAY congelou o esqueleto: ${r.antes.toFixed(1)}m → ${r.depois.toFixed(1)}m`);
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

  it('dado melee do esqueleto, então o dano identifica a causa skeleton', async () => {
    const cause = await play(async () => {
      let receivedCause = null;
      const { S } = await window.__makeSkeletonTestSystem({
        playerDamage(_damage, _from, damageCause) { receivedCause = damageCause; },
      });
      const sk = S.list[0];
      sk.alive = true;
      sk.pos().set(1, 0, 0);
      // o dano do melee é gated pelo frame de STRIKE do swing da espada
      // (animação procedural) — ticka até o golpe conectar, teto de 2 s
      for (let i = 0; i < 120 && !receivedCause; i++) S.update(1 / 60, i / 60);
      return receivedCause;
    });
    assert.deepEqual(cause, { type: 'skeleton' });
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
    const os = require('node:os');
    const path = require('node:path');
    srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')],
      { env: { ...process.env, PORT: String(PORT),
        RANK_FILE: path.join(os.tmpdir(), `fps-skeleton-rank-${process.pid}.json`) }, stdio: 'ignore' });
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
