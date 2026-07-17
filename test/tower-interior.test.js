/* ================================================================
   QA — INTERIOR da Torre Nexus (escada dog-leg, poço, patamares,
   corrimãos, heliponto e integração ao evento de destruição).
   Chrome headless + controlador REAL do jogador (tick determinístico).
   O jogador sobe e desce os 10 andares andando de verdade — sem pulo,
   sem teleporte, sem mexer em pos.y depois do início.
   ================================================================ */
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { CHROME, bootGame } = require('./helpers/harness');

const PORT = 3178;

/* Piloto automático da escada (definido como STRING e reidratado com
   Function() dentro da página): caminha o zigue-zague do dog-leg. Cada volta
   sobe/desce um andar. Aponta a câmera pro waypoint a cada tick (a direção do
   movimento vem do yaw da câmera) e segura KeyW — sem pulo, sem teleporte. */
function autopilot() {
  const QA = window.QA, MP = QA.MP, G = QA.G, P = MP.player, S = G.Structures;
  const NI = S.NEXUS_INTERIOR, C = S.city.center;
  const xA = C.x + (NI.xA0 + NI.xA1) / 2, xB = C.x + (NI.xB0 + NI.xB1) / 2;
  const zApron = C.z + NI.zBot + 0.55;             // apron (piso), ao sul do poço
  const zLand = C.z + (NI.well.z0 + NI.zMid) / 2;  // patamar intermediário (norte)
  const walkTo = (tx, tz, maxTicks, dt) => {
    let stuck = 0, last = 1e9;
    for (let i = 0; i < maxTicks; i++) {
      const dx = tx - P.pos.x, dz = tz - P.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.45) return true;
      MP.camera.lookAt(P.pos.x + dx, P.pos.y + 1.4, P.pos.z + dz);
      G.keys.KeyW = true; G.tick(dt || 1 / 60);
      if (d > last - 0.002) { if (++stuck > 90) return false; } else stuck = 0;
      last = d;
    }
    return false;
  };
  const climbLap = (dt) => { const ok = walkTo(xA, zLand, 600, dt) && walkTo(xB, zLand, 400, dt) &&
    walkTo(xB, zApron, 600, dt) && walkTo(xA, zApron, 400, dt); G.keys.KeyW = false; return ok; };
  const descendLap = (dt) => { const ok = walkTo(xB, zApron, 400, dt) && walkTo(xB, zLand, 600, dt) &&
    walkTo(xA, zLand, 400, dt) && walkTo(xA, zApron, 600, dt); G.keys.KeyW = false; return ok; };
  const startLobby = () => { QA.clearInput(); P.pos.set(xA, NI.gy, zApron); P.vel.set(0, 0, 0);
    P.onGround = true; P.dead = false; QA.tick(3); };
  return { QA, MP, G, P, S, NI, xA, xB, zApron, zLand, walkTo, climbLap, descendLap, startLobby };
}
// injeta autopilot() na página e roda `body` (recebe o objeto do autopilot)
const drive = (h, body) => h.play((src, bodySrc) => {
  const AP = new Function('return (' + src + ')')()();
  return new Function('AP', 'return (' + bodySrc + ')(AP)')(AP);
}, autopilot.toString(), body.toString());

describe('Torre Nexus — interior', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h;
  before(async () => { h = await bootGame({ port: PORT }); });
  after(async () => { if (h) await h.close(); });
  const play = (fn, ...args) => h.play(fn, ...args);

  it('1 — contrato estrutural: 10 andares, 2 lances/patamar, plataformas city sem NaN', async () => {
    const r = await play(() => {
      const S = window.QA.G.Structures, NI = S.NEXUS_INTERIOR, plats = window.__game.platforms;
      const half = NI.half, cx = S.city.center.x, cz = S.city.center.z;
      const cityRamps = plats.filter(p => p.ramp && p.city);
      // toda plataforma/rampa city sem NaN e com limites coerentes
      let bad = 0, outFoot = 0;
      for (const p of plats.filter(p => p.city)) {
        for (const k of ['x0', 'x1', 'z0', 'z1']) if (!Number.isFinite(p[k])) bad++;
        if (p.x1 <= p.x0 || p.z1 <= p.z0) bad++;
        if (p.ramp && (!Number.isFinite(p.y0) || !Number.isFinite(p.y1))) bad++;
        // dentro do footprint da torre (com folga)
        if (p.x0 < cx - half - 0.3 || p.x1 > cx + half + 0.3 ||
            p.z0 < cz - half - 0.3 || p.z1 > cz + half + 0.3) {
          // só as rampas/escada precisam estar no footprint; o resto pode ser laje inteira
          if (p.ramp) outFoot++;
        }
      }
      return { floors: NI.floors, ramps: cityRamps.length, bad, outFoot,
        towerTopY: S.towerTopY, riser: NI.riserCount, flightW: NI.flightWidth };
    });
    assert.equal(r.floors, 10, 'torre não tem 10 andares');
    assert.equal(r.ramps, 20, `esperado 20 lances (2/andar × 10), veio ${r.ramps}`);
    assert.equal(r.bad, 0, 'plataforma city com NaN ou limites invertidos');
    assert.equal(r.outFoot, 0, 'lance de escada fora do footprint da torre');
    assert.ok(r.towerTopY > 30, 'towerTopY perdido');
    assert.ok(r.flightW >= 1.15, `lance estreito demais (${r.flightW.toFixed(2)}m)`);
  });

  it('2 — progressão geométrica: groundAt sobe monotônico ao longo de cada lance', async () => {
    const r = await play(() => {
      const S = window.QA.G.Structures, NI = S.NEXUS_INTERIOR, G = window.__game;
      const C = S.city.center, xA = C.x + (NI.xA0 + NI.xA1) / 2, xB = C.x + (NI.xB0 + NI.xB1) / 2;
      // amostra threading curY (como um jogador percorrendo de verdade): a janela de
      // 0.65 de groundAt escolhe a plataforma local, não a laje do andar de cima.
      const sample = (x, curStart) => {
        const out = []; let cur = curStart;
        for (let i = 0; i <= 20; i++) {
          const z = C.z + NI.zMid + (NI.zBot - NI.zMid) * (i / 20);
          const g = G.groundAt(x, z, cur);
          out.push(g); cur = g + 0.3;
        }
        return out;
      };
      // lance A do andar 1: patamar(N) -> piso 0(S). lance B: patamar(N) -> piso 1(S).
      const ym = NI.gy + 1.7;
      const A = sample(xA, ym + 0.4);   // desce em z: decresce
      const B = sample(xB, ym + 0.4);   // sobe em z: cresce
      let jumpsA = 0, jumpsB = 0;
      for (let i = 1; i < A.length; i++) { if (Math.abs(A[i] - A[i - 1]) > 0.5) jumpsA++; }
      for (let i = 1; i < B.length; i++) { if (Math.abs(B[i] - B[i - 1]) > 0.5) jumpsB++; }
      // A vai de ym(N) a piso0(S): monotônico DECRESCENTE. B de ym(N) a piso1(S): CRESCENTE.
      const aMono = A[0] > A[A.length - 1] + 1.0;
      const bMono = B[B.length - 1] > B[0] + 1.0;
      return { aStart: A[0], aEnd: A[A.length - 1], bStart: B[0], bEnd: B[B.length - 1],
        jumpsA, jumpsB, aMono, bMono, ym, gy: NI.gy, floor1: NI.gy + NI.fh };
    });
    assert.ok(r.aMono, `lance A não desce continuamente (${r.aStart.toFixed(2)}->${r.aEnd.toFixed(2)})`);
    assert.ok(r.bMono, `lance B não sobe continuamente (${r.bStart.toFixed(2)}->${r.bEnd.toFixed(2)})`);
    assert.equal(r.jumpsA, 0, 'salto vertical inesperado no lance A');
    assert.equal(r.jumpsB, 0, 'salto vertical inesperado no lance B');
    // patamar ~ meio do desnível; base A ~ piso 0; topo B ~ piso 1
    assert.ok(Math.abs(r.aStart - r.ym) < 0.4, 'lance A não começa no patamar');
    assert.ok(Math.abs(r.aEnd - r.gy) < 0.4, 'lance A não termina no piso 0');
    assert.ok(Math.abs(r.bEnd - r.floor1) < 0.4, 'lance B não termina no piso 1');
  });

  it('3 — subida real: do lobby ao heliponto andando, sem pulo nem teleporte', async () => {
    const r = await drive(h, (AP) => {
      AP.startLobby();                               // setup: posiciona no lobby (pos.y só aqui)
      const P = AP.P, S = AP.S;
      const ys = [P.pos.y];
      let fell = false, jumped = false;
      for (let lap = 0; lap < 10; lap++) {
        const before = P.pos.y;
        const ok = AP.climbLap();
        ys.push(P.pos.y);
        if (!ok) return { failLap: lap, y: P.pos.y, ys, reached: false };
        if (P.pos.y < before - 1.0) fell = true;     // caiu no meio da volta
        if (P.vel.y > 6) jumped = true;              // teve impulso de pulo
      }
      return { reached: P.pos.y > S.towerTopY - 0.4, y: P.pos.y, top: S.towerTopY,
        ys, fell, jumped, missionOk: P.pos.y > S.towerTopY - 1.5 };
    });
    assert.ok(!r.fell, `jogador caiu durante a subida (ys=${JSON.stringify(r.ys && r.ys.map(v => +v.toFixed(1)))})`);
    assert.ok(!r.jumped, 'jogador precisou pular (vel.y alta)');
    assert.ok(r.reached, `não chegou no heliponto: y=${r.y && r.y.toFixed(2)} topo=${r.top && r.top.toFixed(2)} ys=${JSON.stringify(r.ys && r.ys.map(v => +v.toFixed(1)))}`);
    assert.ok(r.missionOk, 'missão do topo não concluiria (y <= towerTopY-1.5)');
  });

  it('4 — descida real: do heliponto ao térreo andando, sem cair vários andares', async () => {
    const r = await drive(h, (AP) => {
      const P = AP.P, S = AP.S, gy = AP.NI.gy;
      AP.startLobby();
      for (let lap = 0; lap < 10; lap++) if (!AP.climbLap()) return { setup: false };
      if (P.pos.y < S.towerTopY - 0.6) return { setup: false, y: P.pos.y };
      // agora DESCE andando de verdade
      let maxDrop = 0;
      for (let lap = 0; lap < 10; lap++) {
        const before = P.pos.y;
        const ok = AP.descendLap();
        maxDrop = Math.max(maxDrop, before - P.pos.y);
        if (!ok) return { setup: true, failLap: lap, y: P.pos.y, reachedGround: false };
      }
      return { setup: true, y: P.pos.y, gy, maxDrop, reachedGround: P.pos.y < gy + 0.8 };
    });
    assert.ok(r.setup, `setup (subir até o topo) falhou: y=${r.y && r.y.toFixed(2)}`);
    assert.ok(r.maxDrop < 5.0, `caiu vários andares de uma vez (maxDrop=${r.maxDrop && r.maxDrop.toFixed(2)}m)`);
    assert.ok(r.reachedGround, `não voltou ao térreo: y=${r.y && r.y.toFixed(2)} gy=${r.gy && r.gy.toFixed(2)}`);
  });

  it('5 — estabilidade por FPS: subir 1 andar a 30/60/120 fps dá o mesmo resultado', async () => {
    const r = await drive(h, (AP) => {
      const P = AP.P, NI = AP.NI;
      const runOneFloor = (dt) => { AP.startLobby(); AP.climbLap(dt); return P.pos.y; };
      return { y30: runOneFloor(1 / 30), y60: runOneFloor(1 / 60), y120: runOneFloor(1 / 120), floor1: NI.gy + NI.fh };
    });
    // subiu ~1 andar em todos e as posições finais batem dentro de tolerância
    for (const [k, v] of [['30', r.y30], ['60', r.y60], ['120', r.y120]])
      assert.ok(v > r.floor1 - 0.9, `${k}fps: não subiu o andar (y=${v.toFixed(2)} piso1=${r.floor1.toFixed(2)})`);
    assert.ok(Math.abs(r.y30 - r.y60) < 0.7 && Math.abs(r.y60 - r.y120) < 0.7,
      `posição final varia demais por FPS (30=${r.y30.toFixed(2)} 60=${r.y60.toFixed(2)} 120=${r.y120.toFixed(2)})`);
  });

  it('6 — altura livre: nenhum wall atravessa a cápsula ao longo dos dois lances', async () => {
    const r = await play(() => {
      const S = window.QA.G.Structures, NI = S.NEXUS_INTERIOR, G = window.__game;
      const C = S.city.center, xA = C.x + (NI.xA0 + NI.xA1) / 2, xB = C.x + (NI.xB0 + NI.xB1) / 2;
      const CAP = 1.7; let minClear = 99, clips = 0;
      for (let f = 0; f < 3; f++) {                       // andares 0..2 (base, meio-baixo)
        for (const x of [xA, xB]) {
          for (let i = 1; i < 20; i++) {
            const z = C.z + NI.zMid + (NI.zBot - NI.zMid) * (i / 20);
            const y = G.groundAt(x, z, NI.gy + f * NI.fh + 2) + 0.05;
            const capTop = y + CAP;
            for (const w of S.walls) {
              if (x < w.x0 || x > w.x1 || z < w.z0 || z > w.z1) continue;
              if (w.y1 <= y + 0.12 || w.y0 >= capTop) continue; // acima da cabeça ou abaixo dos pés
              clips++;
            }
            // altura livre até o próximo wall acima
            let ceil = 99;
            for (const w of S.walls) {
              if (x < w.x0 || x > w.x1 || z < w.z0 || z > w.z1) continue;
              if (w.y0 >= capTop - 0.05) ceil = Math.min(ceil, w.y0 - y);
            }
            if (ceil < minClear) minClear = ceil;
          }
        }
      }
      return { clips, minClear };
    });
    assert.equal(r.clips, 0, 'algum wall atravessa a cápsula do jogador na escada');
    assert.ok(r.minClear >= 2.0, `altura livre insuficiente na escada (${r.minClear.toFixed(2)}m < 2.0)`);
  });

  it('7 — proteção contra queda: corrimão barra a borda do poço; entrada/saída livres', async () => {
    const r = await play(() => {
      const QA = window.QA, S = QA.G.Structures, NI = S.NEXUS_INTERIOR, P = QA.MP.player;
      const C = S.city.center;
      // no piso 1, encostado na borda LESTE do poço, andando pro poço (oeste)
      const y1 = NI.gy + NI.fh;
      QA.clearInput();
      P.pos.set(C.x + NI.well.x1 + 0.9, y1, C.z + (NI.well.z0 + NI.zMid) / 2);
      P.vel.set(0, 0, 0); P.onGround = true;
      QA.aimAt(C.x + NI.well.x1 - 6, P.pos.y + 1.4, P.pos.z);
      QA.G.keys.KeyW = true;
      let minY = P.pos.y;
      for (let i = 0; i < 120; i++) { QA.tick(1); if (P.pos.y < minY) minY = P.pos.y; }
      QA.clearInput();
      const guarded = minY > y1 - 1.0;   // não despencou no poço
      // porta sul continua aberta (raio atravessa o vão de entrada)
      const gy = QA.MP.heightAt(C.x, C.z);
      const o = new QA.MP.THREE.Vector3(C.x, gy + 1.2, C.z + 11);
      const d = new QA.MP.THREE.Vector3(0, 0, -1);
      const doorHit = S.rayHit(o, d, 40);
      return { guarded, minY, y1, doorHit };
    });
    assert.ok(r.guarded, `jogador atravessou a proteção e caiu no poço (minY=${r.minY.toFixed(2)} piso=${r.y1.toFixed(2)})`);
    assert.ok(r.doorHit > 10, `entrada da torre bloqueada (rayHit=${r.doorHit.toFixed(1)})`);
  });

  it('8 — inimigos: todos os enemyCamps internos estão sobre piso válido, fora do poço', async () => {
    const r = await play(() => {
      const S = window.QA.G.Structures, NI = S.NEXUS_INTERIOR, G = window.__game;
      const C = S.city.center;
      const inWell = (x, z) => x >= C.x + NI.well.x0 - 0.2 && x <= C.x + NI.well.x1 + 0.2 &&
        z >= C.z + NI.well.z0 - 0.2 && z <= C.z + NI.well.z1 + 0.2;
      const internal = S.enemyCamps.filter(c => c.floorY !== undefined && c.floorY > NI.gy + 1.5);
      let inPoço = 0, badFloor = 0;
      for (const c of internal) {
        if (inWell(c.x, c.z)) inPoço++;
        const g = G.groundAt(c.x, c.z, c.floorY + 0.5);
        if (Math.abs(g - c.floorY) > 0.7) badFloor++;   // não há piso na altura do camp
      }
      return { count: internal.length, inPoço, badFloor };
    });
    assert.ok(r.count > 0, 'nenhum inimigo interno (regressão de spawn)');
    assert.equal(r.inPoço, 0, 'inimigo nascendo dentro do poço da escada');
    assert.equal(r.badFloor, 0, 'inimigo sem piso válido na altura do floorY');
  });

  it('9 — destruição: interior some no destroy e volta idêntico no restore (5 ciclos)', async () => {
    const r = await play(() => {
      const QA = window.QA, S = QA.G.Structures;
      const city = S.city; city.restore();
      // referência (intacta)
      const cityWalls0 = S.walls.filter(w => w.city).length;
      const cityPlats0 = window.__game.platforms.filter(p => p.city).length;
      city.destroy();
      const destroyedWalls = S.walls.filter(w => w.city).length;
      const destroyedPlats = window.__game.platforms.filter(p => p.city).length;
      // 5 ciclos e conferência de contagem
      let leaked = false;
      for (let i = 0; i < 5; i++) {
        city.restore();
        if (S.walls.filter(w => w.city).length !== cityWalls0) leaked = true;
        if (window.__game.platforms.filter(p => p.city).length !== cityPlats0) leaked = true;
        city.destroy();
        if (S.walls.filter(w => w.city).length !== destroyedWalls) leaked = true;
      }
      city.restore();
      return { cityWalls0, cityPlats0, destroyedWalls, destroyedPlats, leaked,
        finalWalls: S.walls.filter(w => w.city).length,
        finalPlats: window.__game.platforms.filter(p => p.city).length };
    });
    assert.ok(r.cityWalls0 > 40, `poucos colisores city (interior não somou): ${r.cityWalls0}`);
    assert.equal(r.destroyedWalls, 0, 'colisores urbanos/internos sobraram após destroy');
    assert.equal(r.destroyedPlats, 0, 'plataformas urbanas/internas sobraram após destroy');
    assert.ok(!r.leaked, 'contagem divergiu ao longo dos 5 ciclos (vazou/duplicou)');
    assert.equal(r.finalWalls, r.cityWalls0, 'restore não devolveu exatamente os colisores');
    assert.equal(r.finalPlats, r.cityPlats0, 'restore não devolveu exatamente as plataformas');
  });

  it('10 — integrações do telhado: heliSpot/bazookaSpot/saída da escada preservados', async () => {
    const r = await play(() => {
      const S = window.QA.G.Structures, NI = S.NEXUS_INTERIOR, G = window.__game;
      const C = S.city.center;
      // heliSpot no centro do topo; bazookaSpot no telhado e acessível (piso lá em cima)
      const heli = S.heliSpot, baz = S.bazookaSpot;
      const heliY = G.groundAt(heli.x, heli.z, S.towerTopY + 1);
      const bazY = G.groundAt(baz.x, baz.z, S.towerTopY + 1);
      // saída da escada (canto SO do poço) tem piso do deck ao redor (apron)
      const exitX = C.x + (NI.xB0 + NI.xB1) / 2, exitZ = C.z + NI.zBot + 0.6;
      const exitY = G.groundAt(exitX, exitZ, S.towerTopY + 1);
      return {
        heliOnTop: Math.abs(heli.y - S.towerTopY) < 0.01,
        heliFloor: Math.abs(heliY - S.towerTopY) < 0.4,
        bazReach: Math.abs(bazY - S.towerTopY) < 0.4,
        exitFloor: Math.abs(exitY - S.towerTopY) < 0.4,
        towerTopY: S.towerTopY,
      };
    });
    assert.ok(r.heliOnTop, 'heliSpot saiu do topo da torre');
    assert.ok(r.heliFloor, 'heliponto sem piso (deck) sob o helicóptero');
    assert.ok(r.bazReach, 'bazooka inacessível (sem piso na altura)');
    assert.ok(r.exitFloor, 'saída da escada no telhado sem piso ao redor');
  });
});
