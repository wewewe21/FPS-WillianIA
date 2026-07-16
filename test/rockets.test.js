/* Foguetes da bazuca (js/rockets.js) — colisão segmentada, explosão no ponto de
   impacto, sem tunneling, estabilidade entre FPS e reset do pool. FASE 12.
   THREE roda headless (só matemática/objetos, sem WebGL). Deps mockadas. */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const url = require('node:url');
const path = require('node:path');

let THREE, createRockets;
test.before(async () => {
  THREE = await import('three');
  ({ createRockets } = await import(url.pathToFileURL(path.join(__dirname, '..', 'js', 'rockets.js')).href));
});

// slab test mínimo (mesmo espírito do Structures.rayHit) sobre uma lista de AABBs
function makeStructures(walls) {
  function rayHit(o, d, maxDist) {
    let best = maxDist;
    for (const b of walls) {
      let t0 = 0, t1 = best, ta, tb;
      if (Math.abs(d.x) < 1e-8) { if (o.x < b.x0 || o.x > b.x1) continue; }
      else { ta = (b.x0 - o.x) / d.x; tb = (b.x1 - o.x) / d.x; if (ta > tb) { [ta, tb] = [tb, ta]; } t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) continue; }
      if (Math.abs(d.y) < 1e-8) { if (o.y < b.y0 || o.y > b.y1) continue; }
      else { ta = (b.y0 - o.y) / d.y; tb = (b.y1 - o.y) / d.y; if (ta > tb) { [ta, tb] = [tb, ta]; } t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) continue; }
      if (Math.abs(d.z) < 1e-8) { if (o.z < b.z0 || o.z > b.z1) continue; }
      else { ta = (b.z0 - o.z) / d.z; tb = (b.z1 - o.z) / d.z; if (ta > tb) { [ta, tb] = [tb, ta]; } t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) continue; }
      if (t0 > 0 && t0 < best) best = t0;
    }
    return best === maxDist ? Infinity : best;
  }
  const _sd = new THREE.Vector3();
  function segBlocked(from, to) {
    _sd.copy(to).sub(from); const len = _sd.length();
    if (len < 1e-4) return false;
    _sd.multiplyScalar(1 / len);
    return rayHit(from, _sd, len) < len;
  }
  return { rayHit, segBlocked };
}

function makeRockets({ walls = [], terrainY = -999 } = {}) {
  const booms = [];
  const spawned = [];
  const deps = {
    rand: (a = 1, b) => (b === undefined ? a / 2 : (a + b) / 2), // determinístico (sem aleatório)
    _v1: new THREE.Vector3(), _v2: new THREE.Vector3(),
    heightAt: () => terrainY,
    FX: { spawnParticle: (p) => spawned.push([p.x, p.y, p.z]) },
    scene: { add() {} },
    Structures: makeStructures(walls),
    player: { pos: new THREE.Vector3(0, 1, 0) },
    Enemies: { list: [] },
    Grenades: { explode: (pos, tag) => booms.push({ x: pos.x, y: pos.y, z: pos.z, tag }) },
    Boss: { alive: false, pos: () => new THREE.Vector3(1e9, 0, 0) },
    Bosses: [], extraTargets: [],
  };
  return { R: createRockets(deps), booms, spawned, deps };
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);

test('foguete contra fachada explode NA fachada (não atrás)', () => {
  const { R, booms } = makeRockets({ walls: [{ x0: 4.75, x1: 5.25, y0: 0, y1: 6, z0: -5, z1: 5 }] });
  R.fire(V(0, 1, 0), V(1, 0, 0));
  for (let i = 0; i < 40 && booms.length === 0; i++) R.update(1 / 60);
  assert.strictEqual(booms.length, 1, 'uma explosão');
  assert.ok(booms[0].x > 4.4 && booms[0].x < 5.1, `explosão em x=${booms[0].x} (esperado ~5, na fachada)`);
});

test('foguete contra terreno explode no terreno', () => {
  const { R, booms } = makeRockets({ terrainY: 0 });
  R.fire(V(0, 1.2, 0), V(0.2, -1, 0).normalize()); // mergulha no chão
  for (let i = 0; i < 120 && booms.length === 0; i++) R.update(1 / 60);
  assert.strictEqual(booms.length, 1);
  assert.ok(Math.abs(booms[0].y) < 0.6, `explosão perto de y=0, veio y=${booms[0].y}`);
});

test('foguete NÃO atravessa parede de 0,5 m (sem tunneling, mesmo com dt grande)', () => {
  const { R, booms } = makeRockets({ walls: [{ x0: 5, x1: 5.5, y0: 0, y1: 6, z0: -5, z1: 5 }] });
  R.fire(V(0, 1.5, 0), V(1, 0, 0));
  for (let i = 0; i < 20 && booms.length === 0; i++) R.update(1 / 12); // ~12 FPS: 2.8 m/frame
  assert.strictEqual(booms.length, 1);
  assert.ok(booms[0].x <= 5.6, `explodiu antes/na parede (x=${booms[0].x}), não atrás`);
});

test('foguete sem impacto expira por distância (uma só vez)', () => {
  const { R, booms } = makeRockets({}); // sem paredes, terreno longe
  R.fire(V(0, 200, 0), V(1, 0.02, 0).normalize());
  for (let i = 0; i < 2000 && booms.length === 0; i++) R.update(1 / 60);
  assert.strictEqual(booms.length, 1, 'expira exatamente uma vez ao passar de 340 m');
});

test('um foguete gera SOMENTE uma explosão', () => {
  const { R, booms } = makeRockets({ walls: [{ x0: 4.75, x1: 5.25, y0: 0, y1: 6, z0: -5, z1: 5 }] });
  R.fire(V(0, 1, 0), V(1, 0, 0));
  for (let i = 0; i < 80; i++) R.update(1 / 60); // continua chamando update após explodir
  assert.strictEqual(booms.length, 1);
});

test('reutilização do pool reinicializa smokeAcc e estado', () => {
  const inst = makeRockets({ walls: [{ x0: 4.75, x1: 5.25, y0: 0, y1: 6, z0: -5, z1: 5 }] });
  inst.R.fire(V(0, 1, 0), V(1, 0, 0));
  for (let i = 0; i < 80 && inst.booms.length === 0; i++) inst.R.update(1 / 60);
  const before = inst.spawned.length;
  // dispara de novo o MESMO item do pool (só há 4; o 1º está livre)
  inst.R.fire(V(0, 1, 0), V(1, 0, 0));
  inst.R.update(0.001); // passo minúsculo: NÃO deve cuspir fumaça se smokeAcc reiniciou em 0
  assert.strictEqual(inst.spawned.length, before, 'smokeAcc reiniciado: passo curto não emite fumaça herdada');
});

test('resultado não muda drasticamente entre 30/60/120 FPS', () => {
  const wall = [{ x0: 20, x1: 20.5, y0: 0, y1: 8, z0: -6, z1: 6 }];
  const impactX = (fps) => {
    const { R, booms } = makeRockets({ walls: wall });
    R.fire(V(0, 3, 0), V(1, 0, 0));
    for (let i = 0; i < 400 && booms.length === 0; i++) R.update(1 / fps);
    return booms[0].x;
  };
  const a = impactX(30), b = impactX(60), c = impactX(120);
  assert.ok(Math.abs(a - b) < 0.25 && Math.abs(b - c) < 0.25 && Math.abs(a - c) < 0.25,
    `impacto estável entre FPS: 30=${a} 60=${b} 120=${c}`);
});

test('dois foguetes simultâneos não compartilham posição/alvo', () => {
  const walls = [{ x0: 8, x1: 8.5, y0: 0, y1: 8, z0: -6, z1: 6 },   // parede a +x
    { x0: -6, x1: 6, y0: 0, y1: 8, z0: 8, z1: 8.5 }];               // parede a +z
  const { R, booms } = makeRockets({ walls });
  R.fire(V(0, 2, 0), V(1, 0, 0));   // alvo +x
  R.fire(V(0, 2, 0), V(0, 0, 1));   // alvo +z
  for (let i = 0; i < 120 && booms.length < 2; i++) R.update(1 / 60);
  assert.strictEqual(booms.length, 2, 'as duas explodem');
  const hasX = booms.some(b => b.x > 7.5 && Math.abs(b.z) < 1);
  const hasZ = booms.some(b => b.z > 7.5 && Math.abs(b.x) < 1);
  assert.ok(hasX && hasZ, `cada foguete no seu alvo: ${JSON.stringify(booms)}`);
});
