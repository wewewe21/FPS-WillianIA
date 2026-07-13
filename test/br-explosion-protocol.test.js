/* ================================================================
   QA — protocolo dedicado de dano explosivo no BR (explosionHit).
   Antes, granada/bazuca viajavam por shotHit com a arma EQUIPADA e a
   posição do atirador: granada com FACA era rejeitada pelo alcance de
   4 m e a vítima checava cobertura do atirador (falso bloqueio).
   O evento de destruição da cidade (MÍSSEIS/cause "city") é do
   SERVIDOR e nunca entra por este canal — cliente não forja mísseis.
   ================================================================ */
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const { io } = require('socket.io-client');

const SERVER = path.join(__dirname, '..', 'server.js');
let nextPort = 31000 + (process.pid % 400) * 10;

function spawnServer(env = {}) {
  const port = nextPort++;
  const rankFile = path.join(os.tmpdir(),
    `fps-explosion-rank-${process.pid}-${port}-${Date.now()}.json`);
  const proc = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env, PORT: String(port), HOST_CODE: 'QA123',
      COUNTDOWN_S: '1', NEXT_IN_S: '60', GAS_DEFAULT: 'classica',
      RANK_FILE: rankFile, ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('servidor não subiu')), 5000);
    proc.stdout.on('data', d => {
      if (String(d).includes('Servidor BR no ar')) {
        clearTimeout(to);
        res({
          port, proc,
          stop: () => new Promise(resolve => {
            const done = () => { fs.rmSync(rankFile, { force: true }); resolve(); };
            if (proc.exitCode !== null) return done();
            proc.once('exit', done);
            proc.kill();
          }),
        });
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

async function playing(t, n, env = {}) {
  const srv = await spawnServer(env);
  t.after(() => srv.stop());
  const clients = [];
  for (let i = 0; i < n; i++) {
    const c = await connect(srv.port);
    c.s.emit('hello', { nick: 'QA' + i });
    clients.push(c);
    t.after(() => c.s.close());
  }
  const started = clients.map(c => once(c.s, 'matchStart'));
  await ack(clients[0].s, 'claimHost', { code: 'QA123' });
  clients[0].s.emit('requestStart');
  await Promise.all(started);
  return { srv, clients };
}

/* posiciona atirador e vítima no chão do mundo autoritativo */
async function posicionar(a, b, ax, bx) {
  a.s.emit('state', { pos: [ax, 2, 0], rotY: 0, heldWeapon: 'FACA' });
  b.s.emit('state', { pos: [bx, 2, 0], rotY: 0 });
  await sleep(250);
}

describe('Explosivos — protocolo dedicado (explosionHit)', () => {
  it('dada granada com FACA equipada, então o splash fere além do alcance corpo a corpo', async t => {
    const { clients } = await playing(t, 2);
    const [a, b] = clients;
    await posicionar(a, b, 0, 30);
    const hit = once(b.s, 'youWereHit');
    a.s.emit('explosionHit', {
      targetId: b.init.id, dmg: 80, kind: 'GRANADA', impactPos: [28, 2, 0],
    });
    const d = await hit;
    assert.equal(d.dmg, 80);
    assert.equal(d.weapon, 'GRANADA', 'feed deve mostrar a granada, não a arma equipada');
    assert.deepEqual(d.fromPos, [28, 2, 0], 'cobertura da vítima deve partir do IMPACTO');
    assert.equal(d.shooterId, a.init.id, 'kill de explosivo continua creditada ao atirador');
  });

  it('dada bazuca de longo alcance, então o impacto distante do atirador é aceito', async t => {
    const { clients } = await playing(t, 2);
    const [a, b] = clients;
    await posicionar(a, b, 0, 252);
    const hit = once(b.s, 'youWereHit');
    a.s.emit('explosionHit', {
      targetId: b.init.id, dmg: 60, kind: 'BAZUCA', impactPos: [250, 2, 0],
    });
    const d = await hit;
    assert.equal(d.weapon, 'BAZUCA');
  });

  it('dada vítima fora do raio do splash, então o servidor rejeita o dano', async t => {
    const { clients } = await playing(t, 2);
    const [a, b] = clients;
    await posicionar(a, b, 0, 30);
    const hits = collect(b.s, 'youWereHit');
    a.s.emit('explosionHit', {
      targetId: b.init.id, dmg: 80, kind: 'GRANADA', impactPos: [0, 2, 0],
    });
    await sleep(350);
    assert.equal(hits.length, 0, 'splash feriu a 30m do impacto');
  });

  it('dado impacto de granada forjado longe do atirador, então o servidor rejeita', async t => {
    const { clients } = await playing(t, 2);
    const [a, b] = clients;
    await posicionar(a, b, 0, 200);
    const hits = collect(b.s, 'youWereHit');
    a.s.emit('explosionHit', {
      targetId: b.init.id, dmg: 80, kind: 'GRANADA', impactPos: [200, 2, 0],
    });
    await sleep(350);
    assert.equal(hits.length, 0, 'granada "voou" 200m');
  });

  it('dado tipo desconhecido (ex.: MÍSSEIS do evento da cidade), então o servidor rejeita', async t => {
    const { clients } = await playing(t, 2);
    const [a, b] = clients;
    await posicionar(a, b, 0, 5);
    const hits = collect(b.s, 'youWereHit');
    for (const kind of ['MÍSSEIS', 'city', 'NUKE', '', null]) {
      a.s.emit('explosionHit', { targetId: b.init.id, dmg: 80, kind, impactPos: [4, 2, 0] });
    }
    await sleep(350);
    assert.equal(hits.length, 0, 'cliente forjou explosão que não é granada/bazuca');
  });

  it('dado dano explosivo acima do teto, então o servidor limita a 130', async t => {
    const { clients } = await playing(t, 2);
    const [a, b] = clients;
    await posicionar(a, b, 0, 6);
    const hit = once(b.s, 'youWereHit');
    a.s.emit('explosionHit', {
      targetId: b.init.id, dmg: 9999, kind: 'GRANADA', impactPos: [5, 2, 0],
    });
    const d = await hit;
    assert.equal(d.dmg, 130);
  });

  it('dado atirador morto, então a explosão dele é ignorada', async t => {
    const { clients } = await playing(t, 3);
    const [a, b] = clients;
    await posicionar(a, b, 0, 6);
    await ack(a.s, 'died', {});
    const hits = collect(b.s, 'youWereHit');
    a.s.emit('explosionHit', {
      targetId: b.init.id, dmg: 80, kind: 'GRANADA', impactPos: [5, 2, 0],
    });
    await sleep(350);
    assert.equal(hits.length, 0, 'morto explodiu granada');
  });
});
