'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { CHROME, bootGame } = require('./helpers/harness');

describe('Animais — orientação, lifecycle e mordida física',
  { skip: !CHROME && 'Chrome não encontrado' }, () => {
    let h;

    before(async () => { h = await bootGame({ port: 3197 }); });
    after(async () => { if (h) await h.close(); });

    const play = fn => h.play(fn);

    it('alinha frente visual, deslocamento e hitbox da cabeça', async () => {
      const result = await play(async () => {
        const { createAnimals } = await import('/js/animals.js');
        const THREE = window.__MP.THREE;
        const player = { pos: new THREE.Vector3(0, 0, 10), dead: false };
        const scene = new THREE.Scene();
        const rand = (a = 1, b) => b === undefined ? a * 0.5 : (a + b) * 0.5;
        const animals = createAnimals({
          clamp: THREE.MathUtils.clamp, rand, TAU: Math.PI * 2,
          heightAt: () => 0, slopeAt: () => 0, WATER_LEVEL: -10,
          CITY: { x: 9999, z: 9999 }, scene, csmMat: m => m,
          addScore() {}, player, playerDamage() {}, extraTargets: [],
          Pickups: { spawn() {} },
        });
        const wolf = animals.list.find(a => a.predator);
        wolf.group.position.set(0, 0, 0);
        wolf.yaw = 0;
        wolf.biteT = 99;
        const before = wolf.group.position.clone();

        animals.update(0.1, 0.1);
        wolf.group.updateMatrixWorld(true);

        const movement = wolf.group.position.clone().sub(before).setY(0).normalize();
        const visualHead = new THREE.Vector3();
        wolf.group.children[1].getWorldPosition(visualHead);
        const visualForward = visualHead.sub(wolf.group.position).setY(0).normalize();
        const headSphere = wolf.hitSpheres().find(s => s.part === 'head');
        const hitboxForward = headSphere.c.clone().sub(wolf.group.position).setY(0).normalize();
        return {
          forwardDotMovement: visualForward.dot(movement),
          headDotForward: hitboxForward.dot(visualForward),
        };
      });

      assert.ok(result.forwardDotMovement > 0.99,
        `frente visual não acompanha movimento: dot=${result.forwardDotMovement}`);
      assert.ok(result.headDotForward > 0.99,
        `hitbox da cabeça não acompanha cabeça visual: dot=${result.headDotForward}`);
    });

    it('setEnabled preserva vida e restaura somente animais vivos visíveis', async () => {
      const result = await play(async () => {
        const { createAnimals } = await import('/js/animals.js');
        const THREE = window.__MP.THREE;
        const player = { pos: new THREE.Vector3(999, 0, 999), dead: false };
        const rand = (a = 1, b) => b === undefined ? a * 0.5 : (a + b) * 0.5;
        const animals = createAnimals({
          clamp: THREE.MathUtils.clamp, rand, TAU: Math.PI * 2,
          heightAt: () => 0, slopeAt: () => 0, WATER_LEVEL: -10,
          CITY: { x: 9999, z: 9999 }, scene: new THREE.Scene(), csmMat: m => m,
          addScore() {}, player, playerDamage() {}, extraTargets: [],
          Pickups: { spawn() {} },
        });
        if (typeof animals.setEnabled !== 'function') return { hasApi: false };
        animals.setEnabled(false);
        for (let i = 0; i < 6 * 60; i++) animals.update(1 / 60, i / 60);
        const disabled = animals.list.every(a => a.alive && !a.group.visible);
        animals.setEnabled(true);
        const enabled = animals.list.every(a => a.alive && a.group.visible);
        return { hasApi: true, disabled, enabled };
      });

      assert.deepEqual(result, { hasApi: true, disabled: true, enabled: true });
    });

    it('lobo não morde através de parede nem obstáculo circular', async () => {
      const result = await play(async () => {
        const { createAnimals } = await import('/js/animals.js');
        const THREE = window.__MP.THREE;
        const rand = (a = 1, b) => b === undefined ? a * 0.5 : (a + b) * 0.5;

        async function probe({ wall, circles }) {
          let damage = 0;
          let cause = null;
          const player = { pos: new THREE.Vector3(0, 0, 1.2), dead: false };
          const animals = createAnimals({
            clamp: THREE.MathUtils.clamp, rand, TAU: Math.PI * 2,
            heightAt: () => 0, slopeAt: () => 0, WATER_LEVEL: -10,
            CITY: { x: 9999, z: 9999 }, scene: new THREE.Scene(), csmMat: m => m,
            addScore() {}, player, playerDamage(dmg, from, damageCause) {
              damage += dmg;
              cause = damageCause;
            }, extraTargets: [],
            Pickups: { spawn() {} },
            Structures: { segBlocked: () => wall },
            obstaclesNear: () => circles,
            SFX: { groan() {} },
          });
          const wolf = animals.list.find(a => a.predator);
          wolf.group.position.set(0, 0, 0);
          wolf.biteT = 0;
          animals.update(1 / 60, 0);
          return { damage, cause };
        }

        return {
          wall: await probe({ wall: true, circles: [] }),
          tree: await probe({ wall: false, circles: [{ x: 0, z: 0.6, r: 0.28 }] }),
          clear: await probe({ wall: false, circles: [] }),
        };
      });

      assert.equal(result.wall.damage, 0, 'mordeu através de parede');
      assert.equal(result.tree.damage, 0, 'mordeu através de árvore/pedra');
      assert.ok(result.clear.damage > 0, 'linha livre não produziu mordida de controle');
      assert.deepEqual(result.clear.cause, { type: 'animal' });
    });

    it('animal contorna obstáculo em vez de atravessar o tronco', async () => {
      const result = await play(async () => {
        const { createAnimals } = await import('/js/animals.js');
        const THREE = window.__MP.THREE;
        const player = { pos: new THREE.Vector3(0, 0, 10), dead: false };
        const obstacle = { x: 0, z: 2, r: 1 };
        const rand = (a = 1, b) => b === undefined ? a * 0.5 : (a + b) * 0.5;
        const animals = createAnimals({
          clamp: THREE.MathUtils.clamp, rand, TAU: Math.PI * 2,
          heightAt: () => 0, slopeAt: () => 0, WATER_LEVEL: -10,
          CITY: { x: 9999, z: 9999 }, scene: new THREE.Scene(), csmMat: m => m,
          addScore() {}, player, playerDamage() {}, extraTargets: [], Pickups: { spawn() {} },
          Structures: { segBlocked: () => false, collide() {} },
          obstaclesNear: () => [obstacle], SFX: { groan() {} },
        });
        const wolf = animals.list.find(a => a.predator);
        wolf.group.position.set(0, 0, 0);
        wolf.biteT = 99;
        let minDistance = Infinity;
        let minForwardDot = 1;
        for (let i = 0; i < 120; i++) {
          const before = wolf.group.position.clone();
          animals.update(1 / 60, i / 60);
          minDistance = Math.min(minDistance,
            Math.hypot(wolf.group.position.x - obstacle.x, wolf.group.position.z - obstacle.z));
          const dx = wolf.group.position.x - before.x, dz = wolf.group.position.z - before.z;
          const dl = Math.hypot(dx, dz);
          if (dl > 1e-5) {
            const fwX = Math.cos(wolf.group.rotation.y), fwZ = -Math.sin(wolf.group.rotation.y);
            minForwardDot = Math.min(minForwardDot, (fwX * dx + fwZ * dz) / dl);
          }
        }
        return { minDistance, minForwardDot, x: wolf.group.position.x, z: wolf.group.position.z };
      });
      assert.ok(result.minDistance > 0.8,
        `animal entrou no obstáculo: distância mínima ${result.minDistance.toFixed(2)}m`);
      assert.ok(result.z > 2 || Math.abs(result.x) > 1,
        `animal travou sem contornar: (${result.x.toFixed(2)}, ${result.z.toFixed(2)})`);
      assert.ok(result.minForwardDot > 0.98,
        `animal andou de lado/de costas no desvio: dot mínimo ${result.minForwardDot.toFixed(3)}`);
    });

    it('cervo ameaçado muito perto ataca uma vez, com causa animal, e respeita bloqueio', async () => {
      const result = await play(async () => {
        const { createAnimals } = await import('/js/animals.js');
        const THREE = window.__MP.THREE;
        const rand = (a = 1, b) => b === undefined ? a * 0.5 : (a + b) * 0.5;

        function probe({ wall, circles }) {
          let damage = 0;
          let cause = null;
          const player = { pos: new THREE.Vector3(0, 0, 1.2), dead: false };
          const animals = createAnimals({
            clamp: THREE.MathUtils.clamp, rand, TAU: Math.PI * 2,
            heightAt: () => 0, slopeAt: () => 0, WATER_LEVEL: -10,
            CITY: { x: 9999, z: 9999 }, scene: new THREE.Scene(), csmMat: m => m,
            addScore() {}, player, playerDamage(dmg, from, damageCause) {
              damage += dmg;
              cause = damageCause;
            }, extraTargets: [], Pickups: { spawn() {} },
            Structures: { segBlocked: () => wall },
            obstaclesNear: () => circles,
            SFX: { groan() {} },
          });
          const deer = animals.list.find(a => !a.predator);
          deer.group.position.set(0, 0, 0);
          deer.biteT = 0;
          animals.update(1 / 60, 0);
          const firstDamage = damage;
          animals.update(1 / 60, 1 / 60);
          return { firstDamage, secondDamage: damage, cause };
        }

        return {
          clear: probe({ wall: false, circles: [] }),
          wall: probe({ wall: true, circles: [] }),
          tree: probe({ wall: false, circles: [{ x: 0, z: 0.6, r: 0.28 }] }),
        };
      });

      assert.ok(result.clear.firstDamage > 0, 'cervo encurralado não causou dano');
      assert.equal(result.clear.secondDamage, result.clear.firstDamage,
        'cervo ignorou cooldown e atacou em frames consecutivos');
      assert.deepEqual(result.clear.cause, { type: 'animal' });
      assert.equal(result.wall.firstDamage, 0, 'cervo atacou através de parede');
      assert.equal(result.tree.firstDamage, 0, 'cervo atacou através de árvore/pedra');
    });

    it('cervo deixa de reagir ao player quando a ameaça sai do raio de fuga', async () => {
      const result = await play(async () => {
        const { createAnimals } = await import('/js/animals.js');
        const THREE = window.__MP.THREE;
        const rand = (a = 1, b) => b === undefined ? a * 0.5 : (a + b) * 0.5;
        const player = { pos: new THREE.Vector3(0, 0, 1.2), dead: false };
        const animals = createAnimals({
          clamp: THREE.MathUtils.clamp, rand, TAU: Math.PI * 2,
          heightAt: () => 0, slopeAt: () => 0, WATER_LEVEL: -10,
          CITY: { x: 9999, z: 9999 }, scene: new THREE.Scene(), csmMat: m => m,
          addScore() {}, player, playerDamage() {}, extraTargets: [],
          Pickups: { spawn() {} }, Structures: { segBlocked: () => false },
          obstaclesNear: () => [], SFX: { groan() {} },
        });
        const deer = animals.list.find(a => !a.predator);
        deer.group.position.set(0, 0, 0);
        deer.biteT = 0;
        animals.update(1 / 60, 0); // reage à ameaça curta

        player.pos.set(0, 0, 30);
        deer.group.position.set(0, 0, 0);
        deer.fleeing = 0;
        deer.wander = 4;
        deer.wyaw = Math.PI; // vagueia para -Z, sem mirar no player em +Z
        const before = deer.group.position.distanceTo(player.pos);
        animals.update(0.5, 0.5);
        return { before, after: deer.group.position.distanceTo(player.pos) };
      });

      assert.ok(result.after >= result.before,
        `cervo virou perseguidor permanente: ${result.before} -> ${result.after}`);
    });
  });
