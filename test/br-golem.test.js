'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { CHROME, bootGame, startBRMatch } = require('./helpers/harness');

describe('BR — geometria e combate do Golem', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h, host;
  const PORT = 3183;

  before(async () => {
    h = await bootGame({ port: PORT, extraEnv: { COUNTDOWN_S: '1', NEXT_IN_S: '300' } });
    host = await startBRMatch(h, { serverPort: PORT });
    await h.page.waitForFunction('window.__BR_debug && window.__BR_debug.boss', { timeout: 30000 });
  });
  after(async () => {
    if (host) host.close();
    if (!h) return;
    try {
      assert.deepEqual(h.pageErrors, [], `page errors: ${h.pageErrors.join(' | ')}`);
      assert.deepEqual(h.consoleErrors, [], `console errors: ${h.consoleErrors.join(' | ')}`);
      assert.deepEqual(h.requestFailures, [],
        `request failures: ${h.requestFailures.join(' | ')}`);
    } finally {
      await h.close();
    }
  });

  it('frente visual, movimento e hitbox do núcleo coincidem', async () => {
    await new Promise(resolve => setTimeout(resolve, 100));
    const p = await h.play(() => {
      const { boss } = window.__BR_debug;
      const visualForward = new window.__MP.THREE.Vector3(0, 0, -1)
        .applyQuaternion(boss.group.quaternion).normalize();
      const movementForward = new window.__MP.THREE.Vector3(boss.fw.x, 0, boss.fw.z).normalize();
      const visibleCore = new window.__MP.THREE.Vector3();
      boss.core.getWorldPosition(visibleCore);
      const coreHitbox = boss.hitSpheres().find(s => s.part === 'core').c;
      return {
        forwardDotMovement: visualForward.dot(movementForward),
        coreDistance: visibleCore.distanceTo(coreHitbox),
      };
    });
    assert.ok(p.forwardDotMovement > 0.99,
      `Golem anda de costas (dot=${p.forwardDotMovement.toFixed(3)})`);
    assert.ok(p.coreDistance < 0.08,
      `hitbox do core está ${p.coreDistance.toFixed(2)}m fora do modelo`);
  });

  it('a rota de patrulha não atravessa muralhas nem torres do forte', async () => {
    await h.page.waitForFunction(() => window.__MP.scene.children.some(obj => {
      if (!obj.isInstancedMesh || !obj.geometry) return false;
      if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
      const box = obj.geometry.boundingBox;
      return box && Math.abs((box.max.y - box.min.y) - 12) < 0.05;
    }), { timeout: 30000 });
    const route = await h.play(() => {
      const { boss } = window.__BR_debug;
      const QA = window.QA;
      const { G, MP } = QA;
      const F = G.Structures.FORT_POS;
      const castle = G.Structures.castle;
      if (!castle) return { missingCastle: true };
      // O LOD de árvores segue o jogador. Sem mover o foco até o castelo, a
      // inspeção abaixo mede vegetação do spawn e pode declarar a órbita limpa
      // sem observar uma única instância próxima dela.
      QA.reset(F.x, F.z);
      QA.tick(30);
      const radius = Math.hypot(boss.group.position.x - F.x, boss.group.position.z - F.z);
      let minClearance = Infinity, checkedWallPairs = 0, collision = null;
      let finiteRoute = Number.isFinite(radius) && Number.isFinite(castle.guardRadius);
      for (let i = 0; i < 360; i++) {
        const a = i * Math.PI / 180;
        const x = F.x + Math.cos(a) * radius;
        const z = F.z + Math.sin(a) * radius;
        const y = MP.heightAt(x, z);
        finiteRoute = finiteRoute &&
          Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
        for (const w of G.Structures.walls) {
          if (!w.castle || w.noCollide || y >= w.y1 || y + 5.5 < w.y0) continue;
          checkedWallPairs++;
          const nx = Math.max(w.x0, Math.min(w.x1, x));
          const nz = Math.max(w.z0, Math.min(w.z1, z));
          const clearance = Math.hypot(x - nx, z - nz);
          if (clearance < minClearance) {
            minClearance = clearance;
            collision = { angle: i, wall: [w.x0, w.x1, w.z0, w.z1] };
          }
        }
      }

      // Árvores, pedras e cactos são InstancedMesh diretos da cena. Inspecionar
      // as matrizes visuais evita o falso negativo de olhar apenas obstacleGrid
      // (pedras pequenas não têm collider, mas ainda podem atravessar o Golem).
      MP.scene.updateMatrixWorld(true);
      const matrix = new MP.THREE.Matrix4();
      const pos = new MP.THREE.Vector3();
      const quat = new MP.THREE.Quaternion();
      const scale = new MP.THREE.Vector3();
      let checkedVegetationInstances = 0, finiteVegetation = true;
      let maxVisualRadius = 0, maxSupportedVisualRadius = 0;
      let giantAssetDetected = false;
      const vegetationIntrusions = [];
      for (const obj of MP.scene.children) {
        if (!obj.isInstancedMesh || !obj.visible || obj.material === G.Grass.material ||
            obj.name === 'rainFx' || obj.name === 'snowFx') continue;
        if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
        const box = obj.geometry.boundingBox;
        const localHeight = box ? box.max.y - box.min.y : 0;
        const localHalfX = box ? (box.max.x - box.min.x) / 2 : 0;
        const localHalfZ = box ? (box.max.z - box.min.z) / 2 : 0;
        // A árvore gigante é normalizada para 12 m e pode receber escala 1,6.
        // Mesmo que nenhuma de suas instâncias esteja no LOD atual, seu maior
        // envelope possível continua fazendo parte do contrato da clareira.
        if (Math.abs(localHeight - 12) < 0.05) {
          giantAssetDetected = true;
          maxSupportedVisualRadius = Math.max(
            maxSupportedVisualRadius,
            Math.hypot(localHalfX * 1.6, localHalfZ * 1.6),
          );
        }
        for (let i = 0; i < obj.count; i++) {
          obj.getMatrixAt(i, matrix);
          matrix.premultiply(obj.matrixWorld);
          matrix.decompose(pos, quat, scale);
          if (pos.y <= -50 || Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)) <= 0.001)
            continue;
          // Flores são decoração rasteira e não bloqueiam o corpo de 5,5 m.
          if (localHeight * Math.abs(scale.y) < 0.6) continue;
          checkedVegetationInstances++;
          finiteVegetation = finiteVegetation &&
            [pos.x, pos.y, pos.z, scale.x, scale.y, scale.z].every(Number.isFinite);
          // Diagonal horizontal conservadora: continua válida após qualquer
          // rotação Y da instância e impede que uma copa/ilha grande atravesse
          // a rota mesmo quando seu pivô está fora da clareira.
          const visualRadius = Math.hypot(
            localHalfX * Math.abs(scale.x),
            localHalfZ * Math.abs(scale.z),
          );
          maxVisualRadius = Math.max(maxVisualRadius, visualRadius);
          const centerClearance =
            Math.abs(Math.hypot(pos.x - F.x, pos.z - F.z) - radius);
          const surfaceClearance = centerClearance - visualRadius;
          if (surfaceClearance < 1.5 && vegetationIntrusions.length < 12)
            vegetationIntrusions.push({
              x: +pos.x.toFixed(2), y: +pos.y.toFixed(2), z: +pos.z.toFixed(2),
              centerClearance: +centerClearance.toFixed(2),
              visualRadius: +visualRadius.toFixed(2),
              surfaceClearance: +surfaceClearance.toFixed(2),
            });
        }
      }
      const result = {
        radius, expectedRadius: castle.guardRadius, minClearance, checkedWallPairs, collision,
        rigidClearRadius: castle.rigidClearRadius,
        requiredRigidClearRadius:
          radius + Math.max(maxVisualRadius, maxSupportedVisualRadius) + 1.5,
        maxVisualRadius,
        maxSupportedVisualRadius,
        giantAssetDetected,
        finiteRoute, checkedVegetationInstances, finiteVegetation, vegetationIntrusions,
        finiteBoss: [boss.group.position.x, boss.group.position.y, boss.group.position.z]
          .every(Number.isFinite),
      };
      QA.reset(30, 30);
      return result;
    });
    assert.equal(route.missingCastle, undefined, 'contrato Structures.castle ausente');
    assert.equal(route.finiteBoss, true, 'posição do Golem virou NaN/Infinity');
    assert.equal(route.finiteRoute, true, 'amostra da órbita virou NaN/Infinity');
    assert.ok(Math.abs(route.radius - route.expectedRadius) < 0.15,
      `Golem patrulha em r=${route.radius.toFixed(2)}, contrato pede ${route.expectedRadius}`);
    assert.ok(route.checkedWallPairs > 0,
      'pré-condição vazia: a órbita não comparou nenhum collider do castelo');
    assert.ok(Number.isFinite(route.minClearance),
      'pré-condição vazia: clearance das muralhas ficou Infinity');
    assert.ok(route.minClearance >= 2.2,
      `órbita r=${route.radius.toFixed(1)} invade forte por ${route.minClearance.toFixed(2)}m em ${route.collision && route.collision.angle}°`);
    assert.ok(route.checkedVegetationInstances > 0,
      'pré-condição vazia: nenhuma InstancedMesh de vegetação foi inspecionada');
    assert.equal(route.finiteVegetation, true, 'vegetação da órbita contém matriz NaN/Infinity');
    assert.ok(route.maxVisualRadius > 0.2,
      'pré-condição vazia: raio visual da vegetação não foi calculado');
    assert.equal(route.giantAssetDetected, true,
      'pré-condição vazia: asset de árvore gigante não carregou');
    assert.ok(route.maxSupportedVisualRadius > 10,
      `envelope da árvore gigante parece inválido (${route.maxSupportedVisualRadius}m)`);
    assert.ok(route.rigidClearRadius + 0.01 >= route.requiredRigidClearRadius,
      `clareira rígida ${route.rigidClearRadius.toFixed(2)}m não cobre órbita + ` +
      `Golem + maior asset (${route.requiredRigidClearRadius.toFixed(2)}m necessários)`);
    assert.deepEqual(route.vegetationIntrusions, [],
      `vegetação visual invade a órbita do Golem: ${JSON.stringify(route.vegetationIntrusions)}`);
  });

  it('completa uma volta determinística sem atravessar o castelo', async () => {
    const debug = await h.play(() => {
      const d = window.__BR_debug.golemDebug;
      const boss = window.__BR_debug.boss;
      const castle = window.QA.G.Structures.castle;
      if (!d || !boss || !castle) return { exists: !!d, boss: !!boss, castle: !!castle };
      const F = window.QA.G.Structures.FORT_POS;
      const walls = castle.walls.filter(w => !w.noCollide);
      const before = boss.group.position.clone();
      d.resume();
      // Também prova a ponte pública usada pelo cliente de playtest.
      window.advanceTime(100);
      const automaticAfterAdvance = !d.manual;

      let previousAngle = Math.atan2(
        boss.group.position.z - F.z,
        boss.group.position.x - F.x,
      );
      let angleTravel = 0, signedAngleTravel = 0;
      let minAngleStep = Infinity, maxAngleStep = -Infinity;
      let minRadius = Infinity, maxRadius = -Infinity;
      let minWallClearance = Infinity;
      let finite = true;
      for (let i = 0; i < 1200; i++) {
        d.step(0.1);
        const p = boss.group.position;
        const radial = Math.hypot(p.x - F.x, p.z - F.z);
        minRadius = Math.min(minRadius, radial);
        maxRadius = Math.max(maxRadius, radial);
        finite = finite && [p.x, p.y, p.z, radial].every(Number.isFinite);
        const angle = Math.atan2(p.z - F.z, p.x - F.x);
        let delta = angle - previousAngle;
        if (delta > Math.PI) delta -= Math.PI * 2;
        if (delta < -Math.PI) delta += Math.PI * 2;
        angleTravel += Math.abs(delta);
        signedAngleTravel += delta;
        minAngleStep = Math.min(minAngleStep, delta);
        maxAngleStep = Math.max(maxAngleStep, delta);
        previousAngle = angle;
        for (const w of walls) {
          if (p.y >= w.y1 || p.y + 5.5 < w.y0) continue;
          const nx = Math.max(w.x0, Math.min(w.x1, p.x));
          const nz = Math.max(w.z0, Math.min(w.z1, p.z));
          minWallClearance = Math.min(
            minWallClearance,
            Math.hypot(p.x - nx, p.z - nz),
          );
        }
      }
      const moved = before.distanceTo(boss.group.position);
      const manual = d.manual;
      d.resume();
      return {
        exists: true,
        step: typeof d.step === 'function',
        moved,
        manual,
        automaticAfterAdvance,
        finite,
        minRadius,
        maxRadius,
        minWallClearance,
        angleTravel,
        signedAngleTravel,
        minAngleStep,
        maxAngleStep,
        expectedRadius: castle.guardRadius,
      };
    });
    assert.equal(debug.exists, true);
    assert.equal(debug.step, true);
    assert.equal(debug.automaticAfterAdvance, true,
      'advanceTime deixou o Golem congelado em modo manual');
    assert.equal(debug.manual, true, 'advanceTime não assumiu o passo manual do Golem');
    assert.equal(debug.finite, true, 'posição do Golem ficou não finita durante a volta');
    assert.ok(debug.moved > 5, `patrulha quase não se moveu (${debug.moved.toFixed(3)}m)`);
    assert.ok(debug.angleTravel >= Math.PI * 2,
      `patrulha percorreu só ${debug.angleTravel.toFixed(3)} radianos`);
    assert.ok(debug.signedAngleTravel >= Math.PI * 2,
      `patrulha não completou uma volta orientada (${debug.signedAngleTravel.toFixed(3)} rad)`);
    assert.ok(debug.minAngleStep > 0 && debug.maxAngleStep < 0.006,
      `patrulha oscilou/inverteu (${debug.minAngleStep}..${debug.maxAngleStep} rad/passo)`);
    assert.ok(Math.abs(debug.angleTravel - debug.signedAngleTravel) < 1e-6,
      'distância angular foi inflada por inversões de direção');
    assert.ok(Math.abs(debug.minRadius - debug.expectedRadius) < 0.15 &&
      Math.abs(debug.maxRadius - debug.expectedRadius) < 0.15,
    `raio variou de ${debug.minRadius.toFixed(2)} a ${debug.maxRadius.toFixed(2)}m`);
    assert.ok(debug.minWallClearance >= 2.2,
      `Golem chegou a ${debug.minWallClearance.toFixed(2)}m dos colliders do castelo`);
  });

  it('ataca à distância quando o jogador está fora do alcance do soco', async () => {
    const beforeShots = await h.play(() => {
      const { boss, S } = window.__BR_debug;
      const P = window.__MP.player;
      S.phase = 'PLAY';
      P.dead = false;
      P.health = P.maxHealth;
      P.invulnUntil = 0;
      P.pos.set(boss.group.position.x + 24,
        window.__MP.heightAt(boss.group.position.x + 24, boss.group.position.z),
        boss.group.position.z);
      return window.__BR_debug.golemShots || 0;
    });
    await h.page.waitForFunction(n => window.__BR_debug.golemShots > n,
      { timeout: 4000, polling: 20 }, beforeShots);
    const state = await h.play(() => {
      const { boss, golemShots } = window.__BR_debug;
      const toPlayer = window.__MP.player.pos.clone().sub(boss.group.position);
      toPlayer.y = 0; toPlayer.normalize();
      const visualForward = new window.__MP.THREE.Vector3(0, 0, -1)
        .applyQuaternion(boss.group.quaternion).normalize();
      return { shots: golemShots, aimDot: visualForward.dot(toPlayer) };
    });
    assert.ok(state.shots > beforeShots, 'Golem não disparou nenhum ataque à distância');
    assert.ok(state.aimDot > 0.95,
      `Golem disparou de lado/de costas (dot com o alvo=${state.aimDot.toFixed(3)})`);
  });

  it('pisão não acerta jogador muitos metros acima', async () => {
    const before = await h.play(() => {
      const { boss, S } = window.__BR_debug;
      const P = window.__MP.player;
      S.phase = 'PLAY';
      P.dead = false; P.health = P.maxHealth; P.armor = 0; P.invulnUntil = 0;
      // Congela apenas a física do jogador: sem isto ele cai os 30 m antes
      // da próxima janela do pisão e o teste exercita um alvo já no chão.
      window.__BR_freeze = true;
      P.pos.set(boss.group.position.x + 2, boss.group.position.y + 30, boss.group.position.z);
      return P.health;
    });
    await new Promise(resolve => setTimeout(resolve, 2800));
    const after = await h.play(() => {
      window.__BR_freeze = false;
      return window.__MP.player.health;
    });
    assert.equal(after, before, `pisão atravessou 30m verticais (${before} → ${after})`);
  });

  it('o jogador não atravessa o corpo do Golem', async () => {
    await h.play(() => {
      const { boss, S } = window.__BR_debug;
      const P = window.__MP.player;
      S.phase = 'PLAY';
      window.__BR_freeze = false;
      P.dead = false;
      P.pos.copy(boss.group.position);
      P.vel.set(0, 0, 0);
    });
    await new Promise(resolve => setTimeout(resolve, 250));
    const distance = await h.play(() => {
      const bossPos = window.__BR_debug.boss.group.position;
      const P = window.__MP.player.pos;
      return Math.hypot(P.x - bossPos.x, P.z - bossPos.z);
    });
    assert.ok(distance >= 1.9, `jogador ficou dentro do Golem (distância=${distance.toFixed(2)}m)`);
  });
});
