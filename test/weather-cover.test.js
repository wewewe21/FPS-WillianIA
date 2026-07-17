/* ================================================================
   QA — cobertura de chuva e mixagem (js/cover.js + env + sfx).
   Chuva forte lá fora; DENTRO de prédio/torre/nave: zero gotas
   observáveis, som −70%+ e abafado; transição suave ao sair; cidade
   destruída perde o telhado climático. Mutações que este teste pega:
   restaurar rainAmt*0.13, ignorar covered, chover na cabine.
   ================================================================ */
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { CHROME, bootGame } = require('./helpers/harness.js');

describe('Cobertura de chuva (Chrome headless)', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h;
  before(async () => { h = await bootGame({ port: 3234 }); });
  after(async () => { if (h) await h.close(); });

  /* conta gotas visíveis (escala>0.01) num raio da câmera, ao longo de N frames */
  const countScript = () => {
    const G = window.QA.G, MP = window.QA.MP, THREE = MP.THREE;
    const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    window.__QA_countDrops = (frames, radius) => {
      let seen = 0;
      const rain = MP.scene.getObjectByName('rainFx');
      for (let f = 0; f < frames; f++) {
        window.QA.tick(1);
        if (!rain || !rain.visible) continue;
        const cam = G.camera.getWorldPosition(new THREE.Vector3());
        for (let i = 0; i < rain.count; i++) {
          rain.getMatrixAt(i, m4);
          m4.decompose(p, q, s);
          if (s.y > 0.01 && p.distanceTo(cam) < radius) seen++;
        }
      }
      return seen;
    };
  };

  it('dada chuva forte na pradaria, então gotas visíveis e som no teto correto', async () => {
    const r = await h.play((src) => {
      eval(src)();
      const G = window.QA.G;
      window.QA.reset();
      G.Env.weather = 'chuva';
      window.QA.tick(400); // weatherK + exposure assentam
      const fora = window.__QA_countDrops(60, 40);
      return { fora, nivel: G.SFX ? null : null,
        rainLevel: window.QA.MP.SFX ? window.QA.MP.SFX.rainLevel() : null,
        exposure: G.Env.camExposure, weatherK: G.Env.weatherK };
    }, `(${countScript})`);
    assert.ok(r.weatherK > 0.85, `chuva não engatou (weatherK ${r.weatherK})`);
    assert.ok(r.exposure > 0.9, `exposure baixo a céu aberto: ${r.exposure}`);
    assert.ok(r.fora > 500, `poucas gotas visíveis lá fora: ${r.fora}`);
    assert.ok(r.rainLevel !== null && r.rainLevel <= 0.07 + 1e-9,
      `nível de chuva acima do teto: ${r.rainLevel}`);
    assert.ok(r.rainLevel > 0.03, `chuva externa inaudível: ${r.rainLevel}`);
  });

  it('dado o interior de um prédio da cidade, então ZERO gotas por 300 frames e som ≥70% menor', async () => {
    const r = await h.play(() => {
      const G = window.QA.G, MP = window.QA.MP;
      // térreo da TORRE NEXUS: interior real (lotes são caixas sólidas
      // que expulsam o player — lá o exposure 1 é CORRETO)
      const x = -340, z = 130;
      MP.player.pos.set(x, G.groundAt(x, z, 5) + 0.1, z);
      MP.player.vel.set(0, 0, 0);
      G.Env.weather = 'chuva';
      window.QA.tick(400);
      const dentro = window.__QA_countDrops(300, 30);
      return { dentro, exposure: G.Env.camExposure, nivel: MP.SFX.rainLevel(),
        cobertura: G.Cover.coverAt(x, G.groundAt(x, z, 5) + 1.6, z) };
    });
    assert.equal(r.cobertura.covered, true, 'coverAt não detecta o prédio: ' + JSON.stringify(r.cobertura));
    assert.ok(r.exposure < 0.1, `exposure alto dentro do prédio: ${r.exposure}`);
    assert.equal(r.dentro, 0, `${r.dentro} gotas observáveis DENTRO do prédio`);
    assert.ok(r.nivel <= 0.05 * 0.3 + 1e-9, `som interno alto: ${r.nivel} (externo ~0.05)`);
  });

  it('dado o interior da torre, então coberto andar a andar', async () => {
    const r = await h.play(() => {
      const G = window.QA.G;
      // térreo da torre (centro da cidade)
      const c = G.Cover.coverAt(-340, 4.5, 130);
      return { c };
    });
    assert.equal(r.c.covered, true, 'térreo da torre sem cobertura: ' + JSON.stringify(r.c));
  });

  it('dada a cabine da nave (provider dinâmico), então coberta na fase SHIP e só nela', async () => {
    const r = await h.play(() => {
      const G = window.QA.G;
      // contrato do provider: registrado pelo BR quando fase SHIP + shipLocalPos.
      // Fora do BR, o provider não cobre nada; um provider fake prova o contrato.
      const antes = G.Cover.coverAt(0, 100, 0).covered;
      G.Cover.setDynamicProvider(() => ({ covered: true, sourceId: 'ship' }));
      const durante = G.Cover.coverAt(0, 100, 0);
      G.Cover.setDynamicProvider(null);
      const depois = G.Cover.coverAt(0, 100, 0).covered;
      return { antes, durante, depois };
    });
    assert.equal(r.antes, false);
    assert.equal(r.durante.covered, true);
    assert.equal(r.durante.sourceId, 'ship');
    assert.equal(r.depois, false);
  });

  it('dada a saída do prédio, então exposure sobe SUAVE (sem pop)', async () => {
    const r = await h.play(() => {
      const G = window.QA.G, MP = window.QA.MP;
      const x = -340, z = 130; // torre
      MP.player.pos.set(x, G.groundAt(x, z, 5) + 0.1, z);
      window.QA.tick(300); // exposure → ~0
      // teleporta pra fora (céu aberto)
      MP.player.pos.set(-340 + 90, G.heightAt(-340 + 90, 130) + 0.1, 130);
      const series = [];
      for (let k = 0; k < 40; k++) { window.QA.tick(3); series.push(G.Env.camExposure); }
      let maxDelta = 0;
      for (let i = 1; i < series.length; i++) maxDelta = Math.max(maxDelta, Math.abs(series[i] - series[i - 1]));
      return { start: series[0], end: series[series.length - 1], maxDelta };
    });
    assert.ok(r.start < 0.35, `exposure não estava baixo dentro: ${r.start}`);
    assert.ok(r.end > 0.9, `exposure não recuperou fora: ${r.end}`);
    assert.ok(r.maxDelta < 0.3, `pop de exposure: Δ${r.maxDelta} num passo`);
  });

  it('dada a cidade destruída, então o telhado climático some — e volta no restore', async () => {
    const r = await h.play(() => {
      const G = window.QA.G;
      const x = -340 + -34, z = 130 + -28, y = 4.5;
      const antes = G.Cover.coverAt(x, y, z).covered;
      G.Structures.city.destroy();
      const destruida = G.Cover.coverAt(x, y, z).covered;
      G.Structures.city.restore();
      const depois = G.Cover.coverAt(x, y, z).covered;
      return { antes, destruida, depois };
    });
    assert.equal(r.antes, true, 'sem cobertura antes da destruição');
    assert.equal(r.destruida, false, 'telhado climático fantasma após destruir');
    assert.equal(r.depois, true, 'cobertura não voltou no restore');
  });

  it('rede de segurança: nenhum pageerror nos cenários de clima', () => {
    assert.deepEqual(h.pageErrors, [], 'erros: ' + h.pageErrors.join(' | '));
  });
});
