'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { io } = require('socket.io-client');

const SERVER = path.join(__dirname, '..', 'server.js');
let nextPort = 25000 + (process.pid % 500) * 10;

function spawnServer() {
  const port = nextPort++;
  const rankFile = path.join(os.tmpdir(), `fps-arena-rank-${process.pid}-${port}.json`);
  const proc = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env, PORT: String(port), RANK_FILE: rankFile,
      HOST_CODE: 'QA123', COUNTDOWN_S: '1', ARENA_COUNTDOWN_S: '1', ARENA_RETURN_S: '2', ARENA_INVULN_MS: '10',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('servidor de arena nao subiu')), 5000);
    proc.stdout.on('data', data => {
      if (!String(data).includes('Servidor BR no ar')) return;
      clearTimeout(timeout);
      resolve({
        port,
        stop() {
          proc.kill();
          try { fs.rmSync(rankFile, { force: true }); } catch {}
        },
      });
    });
    proc.once('exit', code => {
      if (code && code !== 0) reject(new Error('servidor morreu cedo: ' + code));
    });
  });
}

function connect(port, nick) {
  const socket = io(`http://localhost:${port}`, { transports: ['websocket'] });
  return new Promise(resolve => socket.once('init', init => {
    socket.emit('hello', { nick });
    resolve({ socket, init });
  }));
}

const ack = (socket, event, data) => new Promise((resolve, reject) =>
  socket.timeout(4000).emit(event, data, (error, result) => error ? reject(error) : resolve(result)));
const once = (socket, event) => new Promise(resolve => socket.once(event, resolve));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function clientsFor(t, count) {
  const server = await spawnServer();
  t.after(() => server.stop());
  const clients = [];
  for (let i = 0; i < count; i++) {
    const client = await connect(server.port, 'Arena' + (i + 1));
    clients.push(client);
    t.after(() => client.socket.close());
  }
  return clients;
}

describe('Salas 1v1 e Mata-Mata', () => {
  it('mantem a senha privada, recusa senha errada e respeita a lotacao do 1v1', async t => {
    const [host, guest, third] = await clientsFor(t, 3);
    const made = await ack(host.socket, 'arenaCreate', {
      name: '<b>Duelo secreto</b>', mode: 'DUEL', private: true, password: 'alvo123',
      map: 'CITY', scoreLimit: 7, timeLimit: 8, respawn: 2, maxPlayers: 16,
    });
    assert.equal(made.ok, true);
    assert.equal(made.room.mode, 'DUEL');
    assert.equal(made.room.maxPlayers, 2);
    assert.equal(made.room.locked, true);
    assert.equal(Object.hasOwn(made.room, 'password'), false);
    assert.equal(made.room.name.includes('<'), false);

    const list = await ack(guest.socket, 'arenaList', {});
    const listed = list.rooms.find(room => room.id === made.room.id);
    assert.ok(listed);
    assert.equal(listed.locked, true);
    assert.equal(Object.hasOwn(listed, 'password'), false);

    const wrong = await ack(guest.socket, 'arenaJoin', { id: made.room.id, password: 'errada' });
    assert.equal(wrong.ok, false);
    assert.match(wrong.error, /Senha/);
    const joined = await ack(guest.socket, 'arenaJoin', { id: made.room.id, password: 'alvo123' });
    assert.equal(joined.ok, true);
    assert.equal(joined.room.playerCount, 2);
    const full = await ack(third.socket, 'arenaJoin', { id: made.room.id, password: 'alvo123' });
    assert.equal(full.ok, false);
    assert.match(full.error, /lotada/);
  });

  it('aplica HP, kills, placar, respawn e fim da partida no servidor', async t => {
    const [host, guest] = await clientsFor(t, 2);
    const made = await ack(host.socket, 'arenaCreate', {
      name: 'QA Mata-Mata', mode: 'DEATHMATCH', maxPlayers: 6,
      map: 'CAMP', scoreLimit: 3, timeLimit: 3, respawn: 1,
    });
    assert.equal(made.ok, true);
    assert.equal((await ack(guest.socket, 'arenaJoin', { id: made.room.id })).ok, true);

    const hostStarted = once(host.socket, 'arenaMatchStart');
    const guestStarted = once(guest.socket, 'arenaMatchStart');
    assert.equal((await ack(host.socket, 'arenaStart', {})).ok, true);
    const [hostMatch, guestMatch] = await Promise.all([hostStarted, guestStarted]);
    assert.equal(hostMatch.room.phase, 'PLAYING');
    assert.ok(Array.isArray(guestMatch.spawn));
    await sleep(25);

    let matchEnded;
    for (let score = 1; score <= 3; score++) {
      const killed = once(guest.socket, 'arenaKilled');
      const respawned = score < 3 ? once(guest.socket, 'arenaRespawn') : null;
      if (score === 3) matchEnded = once(host.socket, 'arenaMatchEnd');
      const first = await ack(host.socket, 'arenaHit', { targetId: guest.init.id, dmg: 60, weapon: 'FUZIL' });
      const second = await ack(host.socket, 'arenaHit', { targetId: guest.init.id, dmg: 60, weapon: 'FUZIL' });
      assert.equal(first.health, 40);
      assert.equal(second.killed, true);
      const death = await killed;
      assert.equal(death.killerScore, score);
      if (respawned) {
        const respawn = await respawned;
        assert.equal(respawn.health, 100);
        await sleep(25);
      }
    }

    const end = await matchEnded;
    assert.equal(end.reason, 'score');
    assert.equal(end.winner.id, host.init.id);
    assert.equal(end.winner.score, 3);
    assert.equal(end.ranking.find(p => p.id === guest.init.id).deaths, 3);
  });

  it('transfere o dono quando ele sai e remove a sala quando ela esvazia', async t => {
    const [host, guest] = await clientsFor(t, 2);
    const made = await ack(host.socket, 'arenaCreate', { mode: 'DEATHMATCH', name: 'Migracao' });
    await ack(guest.socket, 'arenaJoin', { id: made.room.id });
    const states = [];
    guest.socket.on('arenaRoomState', room => states.push(room));
    host.socket.close();
    await sleep(250);
    assert.equal(states.at(-1).hostId, guest.init.id);
    await ack(guest.socket, 'arenaLeave');
    const list = await ack(guest.socket, 'arenaList', {});
    assert.equal(list.rooms.some(room => room.id === made.room.id), false);
  });

  it('isola jogadores da arena dos eventos e do roster do Battle Royale', async t => {
    const [arenaHost, arenaGuest, brHost] = await clientsFor(t, 3);
    const made = await ack(arenaHost.socket, 'arenaCreate', { mode: 'DUEL', name: 'Arena isolada' });
    await ack(arenaGuest.socket, 'arenaJoin', { id: made.room.id });
    const leakedStarts = [];
    arenaHost.socket.on('matchStart', data => leakedStarts.push(data));
    arenaGuest.socket.on('matchStart', data => leakedStarts.push(data));
    const brRosters = [];
    brHost.socket.on('roster', data => brRosters.push(data));
    assert.equal((await ack(brHost.socket, 'claimHost', { code: 'QA123' })).ok, true);
    const started = once(brHost.socket, 'matchStart');
    brHost.socket.emit('requestStart');
    await started;
    await sleep(100);
    assert.equal(leakedStarts.length, 0);
    const ids = brRosters.at(-1).players.map(player => player.id);
    assert.equal(ids.includes(arenaHost.init.id), false);
    assert.equal(ids.includes(arenaGuest.init.id), false);
    assert.equal(ids.includes(brHost.init.id), true);
  });
});
