/* ================================================================
   Servidor multiplayer — Express (arquivos estáticos) + Socket.io.
   Uma sala global: todo mundo que abrir o link cai na mesma sessão.
   ================================================================ */
'use strict';
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
// serve só o que o navegador precisa — nada de server.js, package.json,
// node_modules ou os scripts de teste ficarem baixáveis por qualquer um
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/multiplayer-client.js', (req, res) => res.sendFile(path.join(__dirname, 'multiplayer-client.js')));
const server = http.createServer(app);
const io = new Server(server);

/* seed da sala: gerada uma vez por processo — todo cliente recebe a mesma,
   então todo mundo gera exatamente o mesmo mapa */
const worldSeed = (Math.random() * 0xFFFFFFFF) >>> 0;

/* 8 pontos de spawn em círculo (raio 380m), todos olhando pro centro do mapa —
   assim os jogadores nascem espalhados e de frente uns pros outros */
const SPAWN_RADIUS = 380, SPAWN_COUNT = 8;
const spawns = Array.from({ length: SPAWN_COUNT }, (_, i) => {
  const a = (i / SPAWN_COUNT) * Math.PI * 2;
  const x = Math.cos(a) * SPAWN_RADIUS, z = Math.sin(a) * SPAWN_RADIUS;
  return { x, z, face: Math.atan2(x, z) }; // yaw que aponta pro (0,0)
});
let spawnIdx = 0;
const nextSpawn = () => spawns[spawnIdx++ % spawns.length];

const players = new Map(); // id -> { nick, kills, pos }

const cleanNick = n => String(n || '').replace(/[<>&"']/g, '').trim().slice(0, 14) || 'Recruta';
const roster = () => [...players.entries()].map(([id, p]) => ({ id, nick: p.nick, kills: p.kills }));
const broadcastRoster = () => io.emit('roster', roster());

io.on('connection', socket => {
  const spawn = nextSpawn();
  players.set(socket.id, { nick: 'Recruta', kills: 0, pos: [spawn.x, 0, spawn.z] });

  socket.emit('init', {
    id: socket.id,
    worldSeed,
    spawn,
    players: [...players.entries()]
      .filter(([id]) => id !== socket.id)
      .map(([id, p]) => ({ id, nick: p.nick, kills: p.kills, pos: p.pos })),
  });
  broadcastRoster();
  console.log(`[+] ${socket.id} entrou (${players.size} online)`);

  socket.on('hello', d => {
    const p = players.get(socket.id);
    if (!p) return;
    p.nick = cleanNick(d && d.nick);
    broadcastRoster();
  });

  /* posição/direção do jogador (~12x/s) — só repassa pros outros */
  socket.on('state', d => {
    const p = players.get(socket.id);
    if (!p || !d || !Array.isArray(d.pos)) return;
    p.pos = d.pos;
    if (d.nick) p.nick = cleanNick(d.nick);
    socket.volatile.broadcast.emit('playerUpdate', {
      id: socket.id, pos: d.pos, rotY: +d.rotY || 0, nick: p.nick,
    });
  });

  /* quem atirou avisa; o dano é aplicado pelo cliente da vítima (que tem armadura etc.) */
  socket.on('shotHit', d => {
    if (!d || !players.has(d.targetId)) return;
    const shooter = players.get(socket.id);
    io.to(d.targetId).emit('youWereHit', {
      dmg: Math.min(Math.max(+d.dmg || 0, 0), 250),
      fromPos: Array.isArray(d.fromPos) ? d.fromPos : [0, 0, 0],
      shooterId: socket.id,
      shooterNick: shooter ? shooter.nick : '???',
    });
  });

  /* a vítima confirma a própria morte; o servidor credita o abate e devolve novo spawn */
  socket.on('died', (d, cb) => {
    const victim = players.get(socket.id);
    if (!victim) return;
    const killer = d && d.killerId ? players.get(d.killerId) : null;
    if (killer) killer.kills++;
    io.emit('playerKilled', {
      victimId: socket.id, victimNick: victim.nick,
      killerId: killer ? d.killerId : null, killerNick: killer ? killer.nick : null,
    });
    broadcastRoster();
    if (typeof cb === 'function') cb(nextSpawn());
  });

  socket.on('disconnect', () => {
    players.delete(socket.id);
    io.emit('playerLeft', { id: socket.id });
    broadcastRoster();
    console.log(`[-] ${socket.id} saiu (${players.size} online)`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor no ar em http://localhost:${PORT} · seed do mundo: ${worldSeed}`);
});
