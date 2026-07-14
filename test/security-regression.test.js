/* ================================================================
   QA — regressão de robustez do servidor (autoridade e limites).
   Cada teste fixa uma INVARIANTE do modelo cliente↔servidor: o
   servidor não confia em estado que o cliente afirma, e impõe seus
   próprios limites. Se um destes ficar vermelho, uma dessas garantias
   foi enfraquecida — não relaxe o teste, entenda a mudança primeiro.
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
let nextPort = 33000 + (process.pid % 400) * 10;

function spawnServer(env = {}) {
  const port = nextPort++;
  const rankFile = env.RANK_FILE || path.join(os.tmpdir(),
    `fps-sec-rank-${process.pid}-${port}-${Date.now()}.json`);
  const removeRankFile = !env.RANK_FILE;
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
            const done = () => { if (removeRankFile) fs.rmSync(rankFile, { force: true }); resolve(); };
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
  const s = io(`http://localhost:${port}`, { transports: ['websocket'], reconnection: false });
  return new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('sem init')), 4000);
    s.once('init', init => { clearTimeout(to); res({ s, init }); });
  });
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
  const ms = await Promise.all(started);
  return { srv, clients, plan: ms[0].plan };
}

/* =============== teto de conexões por IP =============== */
describe('Conexões — teto por IP', () => {
  it('dado um IP acima do teto, então as conexões excedentes são recusadas', async t => {
    // IP_LIMIT_ALL=1 aplica o teto também a loopback (em produção loopback é
    // isento — ver o teste seguinte).
    const srv = await spawnServer({ MAX_CONN_PER_IP: '3', IP_LIMIT_ALL: '1' });
    t.after(() => srv.stop());
    const live = [];
    t.after(() => live.forEach(s => s.close()));
    for (let i = 0; i < 3; i++) {
      const c = await connect(srv.port);
      live.push(c.s);
    }
    const s4 = io(`http://localhost:${srv.port}`, { transports: ['websocket'], reconnection: false });
    live.push(s4);
    const verdict = await new Promise(res => {
      const to = setTimeout(() => res('timeout'), 3000);
      s4.once('init', () => { clearTimeout(to); res('aceito'); });
      s4.once('disconnect', () => { clearTimeout(to); res('recusado'); });
      s4.once('rejected', () => { clearTimeout(to); res('recusado'); });
    });
    assert.equal(verdict, 'recusado', 'a conexão acima do teto do IP deveria ser recusada');
  });

  it('dado loopback (bots e host de teste), então o teto por IP é isento', async t => {
    // Invariante de gameplay: os bots e o host de teste conectam de localhost;
    // sem a isenção de loopback a lobby esvaziaria.
    const srv = await spawnServer({ MAX_CONN_PER_IP: '2' });
    t.after(() => srv.stop());
    const live = [];
    t.after(() => live.forEach(s => s.close()));
    for (let i = 0; i < 5; i++) {
      const c = await connect(srv.port);
      live.push(c.s);
    }
    assert.equal(live.length, 5, 'loopback deveria ser isento do teto por IP');
  });
});

/* =============== loot só de quem participa =============== */
describe('Loot — só de participantes vivos da partida', () => {
  it('dado um espectador (entrou no meio), então o deathDrop dele é ignorado', async t => {
    // Só quem participa da partida solta loot; um espectador não injeta itens.
    const { srv, clients } = await playing(t, 2);
    const spec = await connect(srv.port);
    t.after(() => spec.s.close());
    spec.s.emit('hello', { nick: 'ESPEC' });
    await sleep(200);
    const drops = collect(clients[1].s, 'dropSpawn');
    spec.s.emit('deathDrop', {
      pos: [0, 2, 0],
      items: [{ type: 'weapon', weapon: 4, ammo: 999 }, { type: 'armor', amount: 200 }],
    });
    await sleep(350);
    assert.equal(drops.length, 0, 'espectador não deveria conseguir soltar loot');
  });

  it('dado um jogador que morreu na partida, então o deathDrop legítimo dele sai', async t => {
    // Invariante de gameplay: o loot de morte precisa continuar caindo.
    const { clients } = await playing(t, 2);
    const [a, b] = clients;
    const drops = collect(b.s, 'dropSpawn');
    a.s.emit('deathDrop', { pos: [1, 2, 3], items: [{ type: 'armor', amount: 50 }, { type: 'ammo', amount: 60 }] });
    await sleep(300);
    assert.equal(drops.length, 1, 'o loot de morte legítimo não pode sumir');
  });
});

/* =============== crédito de kill exige acerto validado =============== */
describe('Kill — crédito só com acerto validado', () => {
  it('dado um killer que nunca acertou a vítima, então a kill não é creditada', async t => {
    // O crédito de eliminação depende de um acerto que o servidor validou —
    // não do que a vítima declara.
    const { clients } = await playing(t, 3);
    const [a, b] = clients;
    const killed = once(a.s, 'playerKilled');
    await ack(b.s, 'died', { killerId: a.init.id, weapon: 'FUZIL' });
    const k = await killed;
    assert.equal(k.killerId, null, 'kill creditada sem acerto validado');
    assert.equal(k.killerKills, 0);
  });

  it('dado o killer que acertou a vítima, então a kill é creditada', async t => {
    // Gameplay legítimo: quem de fato atirou leva o crédito.
    const { clients } = await playing(t, 3);
    const [a, b] = clients;
    a.s.emit('shotHit', { targetId: b.init.id, dmg: 40, weapon: 'FUZIL', fromPos: [0, 1.5, 0] });
    await sleep(200);
    const killed = once(a.s, 'playerKilled');
    await ack(b.s, 'died', { killerId: a.init.id, weapon: 'FUZIL' });
    const k = await killed;
    assert.equal(k.killerId, a.init.id);
    assert.equal(k.killerKills, 1);
  });
});

/* =============== cooldown de anfitrião por IP =============== */
describe('Anfitrião — cooldown de tentativas por IP', () => {
  it('dado o teto de tentativas atingido, então reconectar não zera o cooldown', async t => {
    // O cooldown é do IP, não do socket: reconectar não devolve tentativas.
    const srv = await spawnServer();
    t.after(() => srv.stop());
    const c1 = await connect(srv.port);
    t.after(() => c1.s.close());
    for (let i = 0; i < 5; i++) await ack(c1.s, 'claimHost', { code: 'ERRADO' + i });
    const c2 = await connect(srv.port);
    t.after(() => c2.s.close());
    const r = await ack(c2.s, 'claimHost', { code: 'QA123' });
    assert.equal(r.ok, false, 'reconectar não pode zerar o cooldown do IP');
  });
});

/* =============== invulnerabilidade de queda é temporal =============== */
describe('Queda — invulnerabilidade só na janela inicial', () => {
  it('dado o flag de queda fora da janela inicial, então o jogador ainda leva dano', async t => {
    // O flag de queda só protege durante a descida inicial; depois dela não
    // concede mais invulnerabilidade.
    const { clients } = await playing(t, 2, { FLY_TIME: '2', FALL_GRACE_S: '1' });
    const [a, b] = clients;
    await sleep(3500); // passa a janela (flyTime 2 + graça 1)
    a.s.emit('state', { pos: [0, 2, 0], rotY: 0, heldWeapon: 'FUZIL' });
    b.s.emit('state', { pos: [5, 2, 0], rotY: 0, fall: true });
    await sleep(300);
    const hits = collect(b.s, 'youWereHit');
    a.s.emit('shotHit', { targetId: b.init.id, dmg: 40, weapon: 'FUZIL', fromPos: [0, 3.5, 0] });
    await sleep(350);
    assert.equal(hits.length, 1, 'o flag de queda fora da janela não pode dar invulnerabilidade');
  });

  it('dado um jogador realmente em queda no início, então o tiro nele é rejeitado', async t => {
    // Gameplay legítimo: durante a queda de paraquedas o jogador é invulnerável.
    const { clients } = await playing(t, 2, { FLY_TIME: '30' });
    const [a, b] = clients;
    a.s.emit('state', { pos: [0, 2, 0], rotY: 0, heldWeapon: 'FUZIL' });
    b.s.emit('state', { pos: [5, 200, 0], rotY: 0, chute: true });
    await sleep(300);
    const hits = collect(b.s, 'youWereHit');
    a.s.emit('shotHit', { targetId: b.init.id, dmg: 40, weapon: 'FUZIL', fromPos: [0, 3.5, 0] });
    await sleep(350);
    assert.equal(hits.length, 0, 'quem cai de paraquedas no início deve ser invulnerável');
  });
});
