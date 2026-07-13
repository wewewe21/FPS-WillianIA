/* Campo de Tiro: integração real no navegador (menu, isolamento e combate). */
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { CHROME, bootGame } = require('./helpers/harness');

describe('Campo de Tiro local', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h;
  before(async () => { h = await bootGame({ port: 3210 }); });
  after(async () => { if (h) await h.close(); });

  it('entra pelo fluxo local, desconecta o BR e monta todas as baias', async () => {
    await h.page.waitForSelector('#brTrainingBtn', { timeout: 15000 });
    // O botão também pode ser acionado pelo menu de pausa enquanto dirige.
    await h.play(() => { window.__game.state.driving = true; });
    await h.page.click('#brTrainingBtn');
    await h.page.waitForFunction('window.__game.Training.active', { timeout: 10000 });
    const result = await h.play(() => {
      const G = window.__game;
      G.tick(1 / 60);
      const d = G.Training.debugState();
      const text = JSON.parse(window.render_game_to_text());
      return {
        debug: d,
        mode: text.mode,
        trainingText: text.training && text.training.active,
        unlocked: G.arsenal.every(w => !w.locked),
        stocked: G.arsenal.filter(w => !w.melee).every(w => w.reserve >= w.magSize * 4),
        inventory: { ...G.inventory },
        br: !!window.__BR_active,
        mp: !!window.__MP_active,
        driving: G.state.driving,
        flying: G.state.flying,
        brDisposed: !!(window.__BR_debug && window.__BR_debug.disposed),
        remoteCount: window.__MP_remotePlayers.length,
        matchStartListeners: typeof window.__MP.socket.listeners === 'function'
          ? window.__MP.socket.listeners('matchStart').length
          : (window.__MP.socket._callbacks?.$matchStart || []).length,
        bodyClass: document.body.classList.contains('training-mode'),
        exitVisible: getComputedStyle(document.getElementById('btnExitTraining')).display !== 'none',
      };
    });

    assert.equal(result.mode, 'TRAINING');
    assert.equal(result.trainingText, true);
    assert.equal(result.debug.active, true);
    assert.equal(result.debug.socketConnected, false, 'socket online continuou conectado');
    assert.equal(result.br, false, 'zona/BR continuou ativo');
    assert.equal(result.mp, false, 'multiplayer continuou ativo');
    assert.equal(result.driving, false, 'treino preservou o carro ativo');
    assert.equal(result.flying, false, 'treino preservou o helicóptero ativo');
    assert.equal(result.brDisposed, true, 'loops da sessão BR não foram encerrados');
    assert.equal(result.remoteCount, 0, 'avatares remotos ficaram residentes');
    assert.equal(result.matchStartListeners, 0, 'matchStart atrasado ainda pode reabrir o BR');
    assert.equal(result.unlocked, true, 'nem todas as armas foram liberadas');
    assert.equal(result.stocked, true, 'arsenal entrou sem munição de treino');
    assert.equal(result.inventory.nades, result.inventory.nadesMax);
    assert.equal(result.inventory.medkits, result.inventory.medkitsMax);
    assert.equal(result.inventory.meat, result.inventory.meatMax);
    assert.deepEqual(result.debug.layout.targetDistances, [10, 25, 50, 80]);
    assert.equal(result.debug.targets.length, 5, 'faltou alvo de distância ou corpo a corpo');
    assert.ok(result.debug.enemies.length >= 3, 'baia de inimigos incompleta');
    assert.equal(result.debug.alien.name, 'VISITANTE');
    assert.ok(result.debug.vehicles.length >= 3, 'baia de veículos incompleta');
    assert.ok(result.debug.vehicles.every(v => Math.abs(v.y - result.debug.floorY) < 4), 'veículo caiu da plataforma');
    assert.deepEqual(result.debug.items.map(i => i.type), ['ammo', 'med', 'nade', 'meat', 'armor']);
    assert.ok(result.debug.items.every(i => i.live && Math.abs(i.y - result.debug.floorY) < 1), 'item ficou sob a plataforma');
    assert.equal(result.bodyClass, true);
    assert.equal(result.exitVisible, true, 'saída ao menu não ficou acessível');
  });

  it('faz divisórias sólidas e a bazuca colidir com alvo e piso elevado', async () => {
    const result = await h.play(() => {
      const G = window.__game, T = G.Training, THREE = window.__MP.THREE;
      const d = T.debugState();

      G.state.driving = false; G.state.flying = false;
      G.player.pos.set(d.layout.centerX + 45, d.floorY, d.layout.centerZ + 22);
      G.tick(1 / 60);
      const barrierDistance = Math.abs(G.player.pos.z - (d.layout.centerZ + 22));

      const target = T.debugState().targets.find(t => t.distance === 10);
      const beforeHits = T.debugState().stats.hits;
      G.Rockets.fire(
        new THREE.Vector3(target.x - 5, target.y, target.z),
        new THREE.Vector3(1, 0, 0),
      );
      for (let i = 0; i < 25; i++) G.tick(1 / 60);
      const afterTarget = T.debugState();

      G.Rockets.fire(
        new THREE.Vector3(d.layout.centerX - 45, d.floorY + 5, d.layout.centerZ + 7),
        new THREE.Vector3(0, -1, 0),
      );
      for (let i = 0; i < 20; i++) G.tick(1 / 60);
      return {
        barriers: d.solidBarriers,
        barrierDistance,
        hitGain: afterTarget.stats.hits - beforeHits,
        targetAlive: afterTarget.targets.find(t => t.distance === 10).alive,
        rocketsAlive: G.Rockets.activeCount,
      };
    });

    assert.equal(result.barriers, 3);
    assert.ok(result.barrierDistance > 0.65, `jogador atravessou divisória (${result.barrierDistance})`);
    assert.ok(result.hitGain >= 1, 'explosão da bazuca não atingiu o alvo');
    assert.equal(result.targetAlive, false, 'bazuca não derrubou o alvo direto');
    assert.equal(result.rocketsAlive, 0, 'foguete atravessou o piso elevado');
  });

  it('aplica dano radial decrescente da bazuca e mostra o total causado', async () => {
    const result = await h.play(() => {
      const G = window.__game, T = G.Training, MP = window.__MP, THREE = MP.THREE;
      const d = T.debugState();
      const live = T.targets.filter(t => !t.melee && !t.moving);
      const near = live[0], far = live[1];
      const center = new THREE.Vector3(d.layout.centerX - 22, d.floorY, d.layout.centerZ + 31);

      for (const target of T.targets) {
        target.alive = true; target.hp = target.maxHp;
        target.group.position.set(center.x + 35 + target.distance, d.floorY, center.z + 35);
      }
      near.hp = near.maxHp = 1000;
      far.hp = far.maxHp = 1000;
      near.group.position.set(center.x + 1, d.floorY, center.z);
      far.group.position.set(center.x + 7, d.floorY, center.z);

      const damageNumbers = [];
      const oldSpawn = MP.DmgNums.spawn;
      MP.DmgNums.spawn = (_p, amount) => damageNumbers.push(amount);
      G.Rockets.fire(
        new THREE.Vector3(center.x, center.y + 1.1, center.z),
        new THREE.Vector3(0, -1, 0),
        G.arsenal[3].rocketSplash,
      );
      for (let i = 0; i < 12; i++) G.tick(1 / 60);
      MP.DmgNums.spawn = oldSpawn;
      return {
        nearDamage: 1000 - near.hp,
        farDamage: 1000 - far.hp,
        indicator: damageNumbers,
        explosion: G.Rockets.lastExplosion,
        active: G.Rockets.activeCount,
      };
    });

    assert.ok(result.nearDamage > result.farDamage,
      `falloff invertido: perto=${result.nearDamage}, longe=${result.farDamage}`);
    assert.ok(result.farDamage > 0, 'alvo distante dentro do raio não recebeu dano');
    assert.ok(result.explosion && result.explosion.hitAny, 'explosão não registrou acerto');
    assert.equal(result.explosion.totalDamage, result.nearDamage + result.farDamage);
    assert.ok(result.indicator.includes(result.explosion.totalDamage),
      'indicador não mostrou o dano total da explosão');
    assert.equal(result.active, 0);
  });

  it('seleciona a arma 8 e o machado derruba/resetta o alvo próximo', async () => {
    const result = await h.play(() => {
      const G = window.__game, T = G.Training, THREE = window.__MP.THREE;
      T.selectByDigit('Digit8');
      const selected = G.arsenal.indexOf(G.gun);
      const meleeTarget = T.debugState().targets.find(t => t.melee);
      const origin = new THREE.Vector3(meleeTarget.x - 2, meleeTarget.y, meleeTarget.z);
      const dir = new THREE.Vector3(1, 0, 0);
      const hit1 = T.melee(origin, dir, 34);
      const hit2 = T.melee(origin, dir, 34);
      const knocked = T.debugState();
      for (let i = 0; i < 100; i++) G.tick(1 / 60);
      const reset = T.debugState();
      return {
        selected, hit1, hit2,
        knockedAlive: knocked.targets.find(t => t.melee).alive,
        resetAlive: reset.targets.find(t => t.melee).alive,
        meleeHits: reset.stats.meleeHits,
        knocked: reset.stats.knocked,
      };
    });

    assert.equal(result.selected, 7, 'tecla 8 não selecionou a oitava arma');
    assert.equal(result.hit1, true);
    assert.equal(result.hit2, true);
    assert.equal(result.knockedAlive, false, 'alvo não tombou com o machado');
    assert.equal(result.resetAlive, true, 'alvo não voltou automaticamente');
    assert.ok(result.meleeHits >= 2);
    assert.ok(result.knocked >= 1);
  });

  it('não gera erro de runtime durante a sessão', () => {
    assert.deepEqual(h.pageErrors, []);
  });
});
