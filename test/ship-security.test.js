/* ================================================================
   QA — segurança do protocolo shipLocal no servidor (node --test).
   O servidor NUNCA confia em d.pos/d.ship/d.shipLocal: valida tipo,
   cabine, piso e velocidade local, e RECONSTRÓI a posição mundial
   com o relógio/rota dele. Pacote rejeitado não propaga nem renova
   lastState. Portas dinâmicas (23xxx) — sem colisão com os demais.
   ================================================================ */
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const { io } = require('socket.io-client');
const ShipProto = require('../ship-protocol.js');

const SERVER = path.join(__dirname, '..', 'server.js');
let nextPort = 23000 + (process.pid % 500) * 10;

function spawnServer(env = {}) {
  const port = nextPort++;
  const rankFile = path.join(os.tmpdir(), `fps-shipsec-rank-${process.pid}-${port}.json`);
  const proc = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: String(port), HOST_CODE: 'QA123', COUNTDOWN_S: '1',
      NEXT_IN_S: '60', GAS_DEFAULT: 'classica', RANK_FILE: rankFile, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('servidor não subiu')), 5000);
    proc.stdout.on('data', d => {
      if (String(d).includes('Servidor BR no ar')) {
        clearTimeout(to);
        res({ port, proc, stop: () => new Promise(r => {
          const done = () => { fs.rmSync(rankFile, { force: true }); r(); };
          if (proc.exitCode !== null) return done();
          proc.once('exit', done); proc.kill();
        }) });
      }
    });
    proc.on('exit', c => rej(new Error('servidor morreu cedo, código ' + c)));
  });
}
const connect = port => {
  const s = io(`http://localhost:${port}`, { transports: ['websocket'] });
  return new Promise(res => s.once('init', init => res({ s, init })));
};
const once = (sock, ev) => new Promise(res => sock.once(ev, res));
const ack = (sock, ev, data) => new Promise((res, rej) =>
  sock.timeout(3000).emit(ev, data, (err, d) => (err ? rej(err) : res(d))));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const collect = (sock, ev) => { const arr = []; sock.on(ev, d => arr.push(d)); return arr; };

/* sobe servidor + n clientes e começa a partida; devolve também o t0 do
   servidor e um offset de relógio pra estimar t da partida daqui */
async function playing(t, n, env = {}) {
  const srv = await spawnServer(env);
  t.after(() => srv.stop());
  const clients = [];
  for (let i = 0; i < n; i++) {
    const c = await connect(srv.port);
    c.s.emit('hello', { nick: 'SEC' + i });
    clients.push(c);
    t.after(() => c.s.close());
  }
  const started = clients.map(c => once(c.s, 'matchStart'));
  await ack(clients[0].s, 'claimHost', { code: 'QA123' });
  clients[0].s.emit('requestStart');
  const ms = await Promise.all(started);
  const clockOffset = ms[0].serverNow - Date.now();
  return { srv, clients, plan: ms[0].plan, t0: ms[0].t0, clockOffset,
    matchT: () => (Date.now() + clockOffset - ms[0].t0) / 1000 };
}

const F = ShipProto.DIMS.floorY;

describe('Slots da nave atribuídos pelo servidor', () => {
  it('matchStart traz plan.shipSlots: um índice único por jogador', async t => {
    const { clients, plan } = await playing(t, 3, { FLY_TIME: '30' });
    assert.ok(plan.shipSlots, 'plan.shipSlots ausente');
    const idx = clients.map(c => plan.shipSlots[c.init.id]);
    for (const i of idx) assert.ok(Number.isInteger(i) && i >= 0, `slot inválido: ${i}`);
    assert.equal(new Set(idx).size, 3, 'slots duplicados');
  });
});

describe('shipLocal: aceitação e reconstrução autoritativa', () => {
  it('local válido é aceito, repassado, e a posição mundial vem da ROTA (pos lixo ignorada)', async t => {
    const { clients, plan, matchT } = await playing(t, 2, { FLY_TIME: '30' });
    const [a, b] = clients;
    const upds = collect(b.s, 'playerUpdate');
    const slot = ShipProto.slotLocal(plan.shipSlots[a.init.id]);
    const local = [slot[0], F, slot[1]]; // cliente legítimo nasce no slot atribuído
    for (let i = 0; i < 4; i++) {
      a.s.emit('state', { pos: [7, 7, 7], rotY: 0, ship: true, shipLocal: local });
      await sleep(120);
    }
    const mine = upds.filter(u => u.id === a.init.id && u.ship);
    assert.ok(mine.length >= 2, 'estado válido não propagou');
    const u = mine[mine.length - 1];
    assert.deepEqual(u.shipLocal, local, 'shipLocal não repassado aos clientes');
    const pose = ShipProto.poseAt(plan.ship, matchT());
    const esperado = ShipProto.localToWorld(pose, local);
    assert.ok(Math.hypot(u.pos[0] - esperado[0], u.pos[2] - esperado[2]) < 25,
      `pos não reconstruída da rota: ${u.pos} vs ${esperado}`);
    assert.ok(Math.abs(u.pos[1] - (plan.ship.alt + F)) <= ShipProto.DIMS.bobAmp + 0.01,
      `altitude não é a da nave: ${u.pos[1]}`);
  });

  it('campos extras (timestamp/slot do cliente) são ignorados', async t => {
    const { clients, plan, matchT } = await playing(t, 2, { FLY_TIME: '30' });
    const [a, b] = clients;
    const upds = collect(b.s, 'playerUpdate');
    const slot = ShipProto.slotLocal(plan.shipSlots[a.init.id]);
    const local = [slot[0], F, slot[1]];
    for (let i = 0; i < 3; i++) {
      a.s.emit('state', { pos: [7, 7, 7], rotY: 0, ship: true, shipLocal: local,
        t: 999999, slot: 63, shipSlot: 63, timestamp: 1 });
      await sleep(120);
    }
    const mine = upds.filter(u => u.id === a.init.id && u.ship);
    assert.ok(mine.length >= 1, 'estado com campos extras foi rejeitado inteiro');
    const u = mine[mine.length - 1];
    // se o servidor tivesse aceitado t=999999, k clamparia em 1.18 (fim da rota)
    const fimDaRota = ShipProto.poseAt(plan.ship, 999999);
    assert.ok(Math.hypot(u.pos[0] - fimDaRota.x, u.pos[2] - fimDaRota.z) > 100,
      'timestamp do cliente moveu a nave!');
    const pose = ShipProto.poseAt(plan.ship, matchT());
    assert.ok(Math.hypot(u.pos[0] - pose.x, u.pos[2] - pose.z) < 25, 'pos fora do relógio do servidor');
  });
});

describe('shipLocal: pacotes forjados são rejeitados sem propagar', () => {
  const casos = [
    ['NaN', [NaN, F, 0]],
    ['Infinity', [0, Infinity, 0]],
    ['-Infinity', [0, F, -Infinity]],
    ['array curto', [1, 2]],
    ['array longo', [1, 2, 3, 4]],
    ['array enorme', new Array(50000).fill(0)],
    ['strings', ['0', String(F), '0']],
    ['objeto no lugar de número', [{}, F, 0]],
    ['raio além da parede', [ShipProto.DIMS.cabinRadius + 0.5, F, 0]],
    ['fora do walkRadius', [ShipProto.walkRadius() + 0.3, F, 0]],
    ['abaixo do piso', [0, F - 1, 0]],
    ['acima do teto', [0, ShipProto.DIMS.ceilingY, 0]],
  ];
  it('nenhum dos formatos/posições ilegais gera playerUpdate', async t => {
    const { clients } = await playing(t, 2, { FLY_TIME: '30' });
    const [a, b] = clients;
    const upds = collect(b.s, 'playerUpdate');
    for (const [, local] of casos) {
      a.s.emit('state', { pos: [7, 250, 7], rotY: 0, ship: true, shipLocal: local });
      await sleep(60);
    }
    await sleep(300);
    const mine = upds.filter(u => u.id === a.init.id);
    assert.equal(mine.length, 0,
      `pacote forjado propagou: ${String(JSON.stringify(mine[0] && mine[0].shipLocal)).slice(0, 60)}`);
  });

  it('local inválido não é salvo: o último estado VÁLIDO permanece', async t => {
    const { clients, plan } = await playing(t, 2, { FLY_TIME: '30' });
    const [a, b] = clients;
    const upds = collect(b.s, 'playerUpdate');
    const slot = ShipProto.slotLocal(plan.shipSlots[a.init.id]);
    const valido = [slot[0], F, slot[1]];
    a.s.emit('state', { pos: [0, 0, 0], rotY: 0, ship: true, shipLocal: valido });
    await sleep(150);
    a.s.emit('state', { pos: [0, 0, 0], rotY: 0, ship: true, shipLocal: [50, F, 50] });
    await sleep(300);
    const mine = upds.filter(u => u.id === a.init.id && u.shipLocal);
    assert.ok(mine.length >= 1);
    assert.deepEqual(mine[mine.length - 1].shipLocal, valido, 'estado inválido sobrescreveu o válido');
  });
});

describe('Teleporte e speedhack DENTRO da cabine', () => {
  it('atravessar a cabine num pacote é rejeitado; caminhada normal passa', async t => {
    const { clients, plan } = await playing(t, 2, { FLY_TIME: '30' });
    const [a, b] = clients;
    const upds = collect(b.s, 'playerUpdate');
    const slot = ShipProto.slotLocal(plan.shipSlots[a.init.id]);
    const inicio = [slot[0], F, slot[1]];
    a.s.emit('state', { pos: [0, 0, 0], rotY: 0, ship: true, shipLocal: inicio });
    await sleep(150);
    // teleporte: lado oposto da cabine (≥11.6 m) em ~150 ms (>> maxLocalSpeed)
    a.s.emit('state', { pos: [0, 0, 0], rotY: 0, ship: true, shipLocal: [-slot[0], F, -slot[1]] });
    await sleep(250);
    let mine = upds.filter(u => u.id === a.init.id && u.shipLocal);
    assert.deepEqual(mine[mine.length - 1].shipLocal, inicio, 'teleporte local aceito');
    // caminhada legítima: ~0.35 m a cada ~120 ms (~3 m/s)
    let x = slot[0];
    for (let i = 0; i < 4; i++) {
      x -= 0.35;
      a.s.emit('state', { pos: [0, 0, 0], rotY: 0, ship: true, shipLocal: [x, F, slot[1]] });
      await sleep(120);
    }
    mine = upds.filter(u => u.id === a.init.id && u.shipLocal);
    assert.ok(Math.abs(mine[mine.length - 1].shipLocal[0] - x) < 1e-9, 'caminhada legítima rejeitada');
  });

  it('o primeiro pacote também tem âncora: spawn longe do slot é speedhack', async t => {
    const { clients, plan } = await playing(t, 2, { FLY_TIME: '30' });
    const [a, b] = clients;
    const upds = collect(b.s, 'playerUpdate');
    const slot = ShipProto.slotLocal(plan.shipSlots[a.init.id]);
    // ponto válido na cabine, mas a >10 m do slot atribuído — logo no 1º pacote
    const longe = [-slot[0], F, -slot[1]];
    if (Math.hypot(longe[0] - slot[0], longe[2] - slot[1]) > 10) {
      a.s.emit('state', { pos: [0, 0, 0], rotY: 0, ship: true, shipLocal: longe });
      await sleep(250);
      const mine = upds.filter(u => u.id === a.init.id && u.shipLocal);
      assert.equal(mine.length, 0, 'primeiro pacote longe do slot foi aceito sem âncora');
    }
  });
});

describe('Imunidade da nave não é forjável', () => {
  it('durante o voo, quem está na nave segue imune a PvP', async t => {
    const { clients, plan } = await playing(t, 2, { FLY_TIME: '30' });
    const [a, b] = clients;
    const hits = collect(a.s, 'youWereHit');
    const slot = ShipProto.slotLocal(plan.shipSlots[a.init.id]);
    a.s.emit('state', { pos: [0, 0, 0], rotY: 0, ship: true, shipLocal: [slot[0], F, slot[1]] });
    // b pousa bem embaixo da nave (alcance vertical ~250 < 320 do fuzil)
    const pose = ShipProto.poseAt(plan.ship, 1);
    b.s.emit('state', { pos: [pose.x, 5, pose.z], rotY: 0 });
    await sleep(200);
    b.s.emit('shotHit', { targetId: a.init.id, dmg: 50, weapon: 'FUZIL', fromPos: [pose.x, 5, pose.z] });
    await sleep(300);
    assert.equal(hits.length, 0, 'PvP atravessou a imunidade da nave');
  });

  it('parar de mandar estado com ship=true NÃO deixa imortal depois do voo', async t => {
    const { clients, plan, matchT } = await playing(t, 2, { FLY_TIME: '2' });
    const [a, b] = clients;
    // a manda UM estado válido de nave no início e some (p.ship fica true no servidor)
    const slot = ShipProto.slotLocal(plan.shipSlots[a.init.id]);
    a.s.emit('state', { pos: [0, 0, 0], rotY: 0, ship: true, shipLocal: [slot[0], F, slot[1]] });
    const posA = ShipProto.localToWorld(ShipProto.poseAt(plan.ship, matchT()), [slot[0], F, slot[1]]);
    // b pousa perto da última posição conhecida de a
    b.s.emit('state', { pos: [posA[0], 5, posA[2]], rotY: 0 });
    while (matchT() < plan.ship.flyTime + 8.5) await sleep(200); // janela do voo acabou
    b.s.emit('state', { pos: [posA[0], 5, posA[2]], rotY: 0 });
    const hits = collect(a.s, 'youWereHit');
    await sleep(150);
    b.s.emit('shotHit', { targetId: a.init.id, dmg: 50, weapon: 'FUZIL', fromPos: [posA[0], 5, posA[2]] });
    await sleep(400);
    assert.equal(hits.length, 1, 'ship=true "congelado" ainda dava imunidade após o fim do voo');
  });

  it('forjar ship=true no chão depois do voo não concede imunidade', async t => {
    const { clients, plan, matchT } = await playing(t, 2, { FLY_TIME: '2' });
    const [a, b] = clients;
    // os dois pousam
    for (let i = 0; i < 3; i++) {
      a.s.emit('state', { pos: [10, 5, 10], rotY: 0 });
      b.s.emit('state', { pos: [12, 5, 12], rotY: 0 });
      await sleep(120);
    }
    while (matchT() < plan.ship.flyTime + 8.5) await sleep(200);
    // a tenta virar "nave" no chão — rejeitado, p.ship continua false
    for (let i = 0; i < 3; i++) {
      a.s.emit('state', { pos: [10, 5, 10], rotY: 0, ship: true, shipLocal: [0, F, 0] });
      await sleep(100);
    }
    const hits = collect(a.s, 'youWereHit');
    b.s.emit('shotHit', { targetId: a.init.id, dmg: 50, weapon: 'FUZIL', fromPos: [12, 6, 12] });
    await sleep(400);
    assert.equal(hits.length, 1, 'ship forjado no chão deu imunidade');
  });
});

describe('Cliente legado (sem shipLocal) não ganha caminho menos seguro', () => {
  it('pos mundial na rota é aceita (reconstruída no piso); 20 m fora é rejeitada', async t => {
    const { clients, plan, matchT } = await playing(t, 2, { FLY_TIME: '30' });
    const [a, b] = clients;
    const upds = collect(b.s, 'playerUpdate');
    // espera a âncora de velocidade folgar (dist slot->centro ÷ dt ≤ maxLocalSpeed)
    await sleep(1600);
    const pose = ShipProto.poseAt(plan.ship, matchT());
    a.s.emit('state', { pos: [pose.x, pose.y, pose.z], rotY: 0, ship: true });
    await sleep(250);
    let mine = upds.filter(u => u.id === a.init.id && u.ship);
    assert.ok(mine.length >= 1, 'cliente legado na rota foi rejeitado');
    assert.ok(Math.abs(mine[0].pos[1] - (plan.ship.alt + F)) <= ShipProto.DIMS.bobAmp + 0.01,
      'legado não foi reconstruído no piso da cabine');
    const antes = upds.filter(u => u.id === a.init.id).length;
    a.s.emit('state', { pos: [pose.x + 20, pose.y, pose.z], rotY: 0, ship: true });
    await sleep(250);
    mine = upds.filter(u => u.id === a.init.id);
    assert.equal(mine.length, antes, 'legado 20 m fora da cabine propagou (regra velha era 60 m!)');
  });
});

describe('Rejeição não renova lastState (vira inatividade)', () => {
  it('só pacotes de nave inválidos ⇒ servidor elimina por INATIVIDADE', async t => {
    const { clients } = await playing(t, 2, { BR_FAST: '1', FLY_TIME: '2' });
    const [a, b] = clients;
    const z0 = ShipProto.DIMS.cabinRadius + 5; // sempre fora da cabine
    const iv = setInterval(() => {
      a.s.emit('state', { pos: [0, 5, 0], rotY: 0 });
      b.s.emit('state', { pos: [7, 250, 7], rotY: 0, ship: true, shipLocal: [z0, F, 0] });
    }, 150);
    t.after(() => clearInterval(iv));
    const k = await once(a.s, 'playerKilled');
    assert.equal(k.victimId, b.init.id);
    assert.equal(k.weapon, 'INATIVIDADE', 'estado forjado deveria virar AFK');
  });
});
