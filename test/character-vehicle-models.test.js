/* Regressões dos visuais de jogador remoto e helicóptero. As regras,
   hitboxes e física continuam procedurais; estes testes garantem que o GLB
   substitui apenas a camada visual e que sair da sala não destrói o cache. */
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { CHROME, bootGame, startBRMatch } = require('./helpers/harness.js');

function glbJson(file) {
  const buf = fs.readFileSync(file);
  assert.equal(buf.readUInt32LE(0), 0x46546c67, file + ' não é GLB');
  const jsonLength = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8'));
}

describe('Assets dos personagens e veículos esquecidos', () => {
  it('dado o helicóptero, então o GLB possui fuselagem, dois rotores e animação', () => {
    const file = path.join(__dirname, '..', 'assets', 'models', 'Veículos', 'low_poly_helicopter.glb');
    const glb = glbJson(file);
    const names = glb.nodes.map(n => n.name || '');
    for (const part of ['Copter_Body', 'Propeller', 'Propeller_2', 'Legs'])
      assert.ok(names.some(name => name.includes(part)), 'parte ausente: ' + part);
    const main = (glb.animations || []).find(a => a.name === 'Main');
    assert.ok(main, 'clip Main ausente');
    const animated = main.channels.map(c => names[c.target.node]);
    assert.ok(animated.some(name => name.includes('Propeller')));
    assert.ok(animated.some(name => name.includes('Propeller_2')));
  });
});

describe('Integração viva de avatar remoto e helicóptero', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h;
  let bot;
  before(async () => { h = await bootGame({ port: 3234 }); });
  after(async () => {
    if (bot) bot.close();
    if (h) await h.close();
  });

  it('dado o heli no telhado, então troca o fallback pelo GLB sem animar o root de física', async () => {
    const result = await h.play(async () => {
      const H = window.__game.Heli;
      await H.ready;
      return {
        status: H.modelStatus,
        error: H.modelError,
        fallbackVisible: H.group.getObjectByName('HeliFallback').visible,
        modelVisible: !!H.group.getObjectByName('HeliGLB'),
        metrics: H.modelMetrics,
        tracks: H.modelAction ? H.modelAction.getClip().tracks.map(track => track.name) : [],
      };
    });
    assert.equal(result.status, 'ready', result.error);
    assert.equal(result.fallbackVisible, false);
    assert.equal(result.modelVisible, true);
    assert.ok(result.metrics.sizeX > 6 && result.metrics.sizeX < 9, 'escala longitudinal inesperada');
    assert.ok(result.metrics.sizeY > 2 && result.metrics.sizeY < 4, 'altura inesperada');
    assert.ok(Math.abs(result.metrics.minY - 0.05) < 0.02, 'helicóptero não assentou nos esquis');
    assert.deepEqual(result.tracks.sort(), ['Propeller.quaternion', 'Propeller_2.quaternion']);
  });

  it('dado outro jogador, então usa Helldiver de 1,9m e preserva nick, paraquedas e cache ao sair', async () => {
    bot = await startBRMatch(h);
    const ship = bot.matchStart.plan.ship;
    const elapsed = (Date.now() - bot.matchStart.t0) / 1000;
    const progress = Math.min(Math.max(elapsed / ship.flyTime, 0), 1.18);
    const pos = [ship.from[0] + (ship.to[0] - ship.from[0]) * progress, ship.alt,
      ship.from[1] + (ship.to[1] - ship.from[1]) * progress];
    bot.emit('state', { pos, rotY: 0.4, car: -1, heli: false, ship: true, chute: false });
    await h.page.waitForFunction(
      '[...window.__BR_debug.remotes.values()].some(r => r.modelStatus === "ready")',
      { timeout: 20000 },
    );

    const mounted = await h.play(() => {
      const THREE = window.__MP.THREE;
      const remote = [...window.__BR_debug.remotes.values()][0];
      const box = new THREE.Box3().setFromObject(remote.rig.root);
      const arm = remote.rig.findNode('Arm_1.L');
      const before = arm.quaternion.clone();
      remote.rigAnimator.update(0.2, 5, 1);
      const armDelta = before.angleTo(arm.quaternion);
      window.__remoteDisposeEvents = { geometry: 0, material: 0 };
      remote.rig.root.traverse(o => {
        if (o.geometry) o.geometry.addEventListener('dispose', () => window.__remoteDisposeEvents.geometry++);
      });
      for (const material of remote.rig.materials)
        material.addEventListener('dispose', () => window.__remoteDisposeEvents.material++);
      return {
        status: remote.modelStatus,
        fallbackVisible: remote.body.visual.visible,
        hasNick: remote.group.children.some(o => o.isSprite),
        chuteKept: remote.body.chute.parent === remote.body.g,
        height: box.max.y - box.min.y,
        skinnedMeshes: (() => {
          let count = 0;
          remote.rig.root.traverse(o => { if (o.isSkinnedMesh) count++; });
          return count;
        })(),
        sharedGeometryMarked: (() => {
          let all = true;
          remote.rig.root.traverse(o => { if (o.isMesh) all = all && !!o.userData.sharedCharacterGeometry; });
          return all;
        })(),
        armDelta,
        materials: remote.rig.materials.length,
      };
    });
    assert.equal(mounted.status, 'ready');
    assert.equal(mounted.fallbackVisible, false);
    assert.equal(mounted.hasNick, true);
    assert.equal(mounted.chuteKept, true);
    assert.ok(Math.abs(mounted.height - 1.9) < 0.03, `altura veio ${mounted.height}`);
    assert.ok(mounted.skinnedMeshes >= 4, 'malhas rigadas ausentes');
    assert.equal(mounted.sharedGeometryMarked, true);
    assert.ok(mounted.armDelta > 0.01, 'rig não recebeu passada procedural');

    bot.close();
    bot = null;
    await h.page.waitForFunction('window.__BR_debug.remotes.size === 0', { timeout: 10000 });
    const disposed = await h.play(() => window.__remoteDisposeEvents);
    assert.equal(disposed.geometry, 0, 'geometria compartilhada do molde foi destruída');
    assert.equal(disposed.material, mounted.materials, 'materiais privados da instância vazaram');
    assert.deepEqual(h.pageErrors, [], 'erros de página: ' + h.pageErrors.join(' | '));
  });
});
