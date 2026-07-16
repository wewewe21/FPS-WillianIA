/* ================================================================
   Servidor BATTLE ROYALE — Express (estáticos) + Socket.io.
   Uma sala global com máquina de estados:
     LOBBY → (host inicia) → PLAYING (nave→queda→combate) → ENDED → LOBBY
   Cada partida usa uma seed nova (mapa/loot/zona/rota da nave mudam).
   O servidor é dono de: fase, posições aceitas, HP/armadura, arsenal/munição,
   cadência/dano, loot, GOLEM, kills/colocação, vencedor, chat e ranking.
   ================================================================ */
'use strict';
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const CityProto = require('./city-destruction-protocol.js');
const MultiplayerRules = require('./multiplayer-rules.js');

const app = express();
/* cache: código do jogo REVALIDA sempre (no-cache + ETag = 304 barato) —
   sem isto o Cloudflare/navegador seguravam js antigo por 4h e o jogador
   via a versão velha mesmo com o deploy no ar. Modelos 3D são pesados e
   têm nome próprio versionado: podem cachear por 1 dia. */
app.use((req, res, next) => {
  if (req.path.startsWith('/assets/models/') || req.path.startsWith('/assets/animations/'))
    res.set('Cache-Control', 'public, max-age=86400');
  else res.set('Cache-Control', 'no-cache');
  next();
});
// whitelist explícita: nada de server.js/node_modules baixável por qualquer um
const PUBLIC = ['index.html', 'style.css', 'game.js', 'multiplayer-client.js', 'br-game.js', 'arena-game.js', 'multiplayer-rules.js',
  'city-destruction-client.js', 'city-destruction-protocol.js'];
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
for (const f of PUBLIC) app.get('/' + f, (req, res) => res.sendFile(path.join(__dirname, f)));
// modelos 3D: static restrito à pasta (o express.static bloqueia path traversal);
// a pasta agora tem subdiretórios (Armas/, Cenários/, Personagens/, Veículos/)
app.use('/assets/models', express.static(path.join(__dirname, 'assets', 'models')));
app.use('/assets/animations', express.static(path.join(__dirname, 'assets', 'Animações')));
app.use('/js', express.static(path.join(__dirname, 'js'))); // módulos ES do jogo
const server = http.createServer(app);
// QA pode bloquear o event loop do Chrome por vários segundos ao avançar
// centenas de ticks. Produção mantém o default do Socket.IO; o harness sobe
// somente seu servidor com uma tolerância maior para não trocar a identidade.
const socketPingTimeout = Math.max(5000, +process.env.SOCKET_PING_TIMEOUT_MS || 20000);
const io = new Server(server, { pingTimeout: socketPingTimeout });

/* ---------------- utilidades ---------------- */
const clean = s => String(s == null ? '' : s).replace(/[<>&"']/g, '').trim();
// versão leve: preserva aspas (nomes de arma, chat) — o cliente escapa antes de renderizar
const cleanSoft = s => String(s == null ? '' : s).replace(/[<>&]/g, '').trim();
const cleanNick = n => clean(n).slice(0, 14) || 'Recruta';
function cleanPlayerAnimation(d) {
  const velY = Number(d && d.velY);
  const weapon = d && Number.isInteger(d.weapon) && d.weapon >= 0 && d.weapon <= 3 ? d.weapon : 0;
  const shotSeq = d && Number.isInteger(d.shotSeq)
    ? Math.max(0, Math.min(0x7fffffff, d.shotSeq)) : 0;
  return {
    grounded: !d || d.grounded !== false,
    crouch: !!(d && d.crouch),
    velY: Number.isFinite(velY) ? Math.max(-80, Math.min(40, velY)) : 0,
    weapon,
    shotSeq,
  };
}
function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------- ranking global (best-effort em disco) ----------------
   AVISO: no free tier do Render o disco é efêmero — o arquivo zera quando
   o serviço dorme/redeploya. Cada navegador também guarda as próprias
   estatísticas em localStorage como espelho. */
// RANK_FILE por env: no deploy Docker o ranking vive num volume (/data)
const RANK_FILE = process.env.RANK_FILE || path.join(__dirname, 'br-rank.json');
let globalRank = {};
try { globalRank = JSON.parse(fs.readFileSync(RANK_FILE, 'utf8')); } catch (e) { globalRank = {}; }
let rankDirty = false;
function pruneRank(max = 500) { // sem teto, nicks aleatórios inflariam memória/disco pra sempre
  const keys = Object.keys(globalRank);
  if (keys.length <= max) return keys.length;
  keys.sort((a, b) => globalRank[b].points - globalRank[a].points);
  for (const k of keys.slice(max)) delete globalRank[k];
  return max;
}
setInterval(() => {
  if (!rankDirty) return;
  rankDirty = false;
  pruneRank();
  fs.writeFile(RANK_FILE, JSON.stringify(globalRank), () => {});
}, 5000).unref(); // unref: testes que dão require() conseguem encerrar
function saveRankNow() { // usado por testes/desligamento: grava sem esperar o intervalo
  pruneRank();
  fs.writeFileSync(RANK_FILE, JSON.stringify(globalRank));
}
function rankEntry(nick) {
  const key = nick.toLowerCase();
  if (!globalRank[key]) globalRank[key] = { nick, points: 0, wins: 0, kills: 0, matches: 0, sumPlace: 0 };
  globalRank[key].nick = nick;
  return globalRank[key];
}
function topRank(n = 10) {
  return Object.values(globalRank)
    .sort((a, b) => b.points - a.points).slice(0, n)
    .map(r => ({ nick: r.nick, points: r.points, wins: r.wins, kills: r.kills,
      matches: r.matches, avgPlace: r.matches ? +(r.sumPlace / r.matches).toFixed(1) : 0 }));
}

/* ---------------- estado da sala/partida ---------------- */
const WORLD = 1100, LIM = WORLD / 2 - 60; // limites úteis do mapa
const players = new Map(); // id -> { nick, colors, kills, alive, spectator, placement, pos, lastChat, lastHits: [] }
const BR_MAX_HEALTH = 100;
const POSITION_HORIZONTAL_LIMIT = WORLD / 2 + 100; // inclui as extremidades da rota da nave
const POSITION_MIN_Y = -20;
const POSITION_MAX_Y = 600;
const SHOT_SEQUENCE_MAX = 0x7fffffff;
const SECURITY_SIGNAL_WINDOW_MS = 3000;
const SECURITY_ENFORCEMENT_SCORE = 12;

/* anfitrião: SÓ quem digitar o código vira host (nada de host aleatório).
   Código fixo abaixo; a variável de ambiente HOST_CODE sobrescreve se quiser trocar. */
const HOST_CODE = String(process.env.HOST_CODE || 'QUEDALIVRE').toUpperCase();
let hostId = null;

/* knobs de teste (QA) — em produção ficam nos padrões */
const COUNTDOWN_S = Math.max(1, +process.env.COUNTDOWN_S || 10);
const NEXT_IN_S = Math.max(1, +process.env.NEXT_IN_S || 14);
const FLY_TIME = Math.max(1, +process.env.FLY_TIME || 55);
const BR_FAST = !!process.env.BR_FAST; // acelera o backstop da zona nos testes
const ZONE_GRACE_S = BR_FAST ? 2 : 25;   // pós-voo: janela de queda sem punição
const FLOAT_AFTER_S = BR_FAST ? 3 : 60;  // "nunca pousou" vale a partir daqui
const AFK_MS = BR_FAST ? 4000 : 45000;
const ZONE_DRAIN_X = BR_FAST ? 50 : 1;
const CLAIM_COOLDOWN_MS = Math.max(500, +process.env.CLAIM_COOLDOWN_MS || 30000);
const BOSS_HP = Math.max(1, +process.env.BOSS_HP || 3600);
const CITY_DELAY_MS = Math.max(500, +process.env.CITY_DESTRUCTION_DELAY_MS || CityProto.DELAY_DEFAULT);
const CITY_IMPACT_MS = Math.max(300, +process.env.CITY_DESTRUCTION_IMPACT_DELAY_MS || CityProto.IMPACT_DELAY_DEFAULT);

const match = {
  phase: 'LOBBY',            // LOBBY | COUNTDOWN | PLAYING | ENDED
  // WORLD_SEED fixa o mapa (QA/depuração); sem ela, seed aleatória por processo
  seed: process.env.WORLD_SEED ? (+process.env.WORLD_SEED >>> 0) : (Math.random() * 0xFFFFFFFF) >>> 0,
  num: 0,
  t0: 0,                     // Date.now() do início (nave decola)
  plan: null,                // { ship, zone, boss } enviado a todos
  aliveCount: 0,
  openedChests: new Set(),
  drops: new Map(),          // dropId -> { pos, items, taken }
  dropSeq: 0,
  bossHp: 0, bossMaxHp: 0, bossDead: false,
  carOwners: {},             // idx do veículo -> socket.id (posse arbitrada aqui)
  heliOwner: null,
  flags: { golem: true, animais: true, zumbis: false, bots: 0, ciclo: 'auto', cidade: true }, // regras da sala (só o host altera)
  cityDestruction: { eventId: null, seed: null, state: 'intact', cinematicStartedAt: null, impactAt: null },
  countdownTimer: null, endTimer: null,
};

function resetRoundState() {
  match.openedChests.clear();
  match.drops.clear();
  match.dropSeq = 0;
  match.carOwners = {};
  match.heliOwner = null;
}

function validChestKey(key) {
  if (key === 'boss') return true;
  const matchKey = /^([cs])(\d{1,3})$/.exec(key);
  if (!matchKey) return false;
  const index = Number(matchKey[2]);
  return matchKey[1] === 'c' ? index < 34 : index < 128;
}

function createCombatState(arena = false) {
  return {
    weapons: MultiplayerRules.WEAPONS.map(weapon => ({
      unlocked: arena || weapon.id === MultiplayerRules.BR_START_WEAPON,
      mag: weapon.melee ? 0 : weapon.magSize,
      reserve: arena ? Number.POSITIVE_INFINITY : 0,
      reloadUntil: 0,
    })),
    equipped: arena ? 0 : MultiplayerRules.BR_START_WEAPON,
    lastSeq: -1,
    nextFireAt: 0,
    currentShot: null,
  };
}

function createSecurityState() {
  return { score: 0, lastSignalAt: 0, enforced: false };
}

function combatPublic(combat) {
  if (!combat) return null;
  const now = Date.now();
  return {
    equipped: combat.equipped,
    weapons: combat.weapons.map((slot, id) => ({
      id,
      unlocked: !!slot.unlocked,
      mag: Number.isFinite(slot.mag) ? slot.mag : MultiplayerRules.WEAPONS[id].magSize,
      reserve: Number.isFinite(slot.reserve) ? slot.reserve : 999,
      reloadingMs: Math.max(0, slot.reloadUntil - now),
    })),
  };
}

function emitCombatState(id, combat) {
  io.to(id).emit('combatState', combatPublic(combat));
}

function completeReload(slot, weapon, now) {
  if (!slot.reloadUntil || now < slot.reloadUntil) return;
  const needed = Math.max(0, weapon.magSize - slot.mag);
  const available = Number.isFinite(slot.reserve) ? slot.reserve : needed;
  const amount = Math.min(needed, available);
  slot.mag += amount;
  if (Number.isFinite(slot.reserve)) slot.reserve -= amount;
  slot.reloadUntil = 0;
}

function startCombatReload(combat, weaponId, now = Date.now()) {
  const weapon = MultiplayerRules.weaponById(weaponId);
  const slot = weapon && combat && combat.weapons[weaponId];
  if (!weapon || !slot || !slot.unlocked || weapon.melee) return false;
  completeReload(slot, weapon, now);
  if (slot.reloadUntil || slot.mag >= weapon.magSize || slot.reserve <= 0) return false;
  slot.reloadUntil = now + weapon.reloadTime * 1000;
  return true;
}

function isNewShotSequence(seq, previous) {
  if (previous < 0) return true;
  if (seq > previous) return true;
  return previous > SHOT_SEQUENCE_MAX - 1024 && seq < 1024;
}

function authorizeShot(combat, raw, targetKey, consumeAmmo) {
  if (!combat || !raw) return null;
  const weapon = MultiplayerRules.weaponById(raw.weaponId);
  const seq = Number(raw.shotSeq);
  if (!weapon || !Number.isInteger(seq) || seq < 0 || seq > SHOT_SEQUENCE_MAX) return null;
  const now = Date.now();
  const current = combat.currentShot;
  if (current && current.seq === seq) {
    if (current.weaponId !== weapon.id || now - current.at > 350 || current.targets.has(targetKey)) return null;
    const counts = MultiplayerRules.hitCounts(weapon, raw.hits, raw.headshots);
    if (weapon.rocket) {
      if (current.targets.size >= 16) return null;
    } else {
      if (current.remainingHits <= 0) return null;
      counts.hits = Math.min(counts.hits, current.remainingHits);
      counts.headshots = Math.min(counts.headshots, counts.hits);
      current.remainingHits -= counts.hits;
    }
    current.targets.add(targetKey);
    return { weapon, damage: MultiplayerRules.damageForHit(weapon, counts.hits, counts.headshots) };
  }
  if (!isNewShotSequence(seq, combat.lastSeq) || now + 12 < combat.nextFireAt) return null;
  const slot = combat.weapons[weapon.id];
  if (!slot || !slot.unlocked) return null;
  completeReload(slot, weapon, now);
  if (slot.reloadUntil) return null;
  if (consumeAmmo && !weapon.melee) {
    if (slot.mag <= 0) {
      startCombatReload(combat, weapon.id, now);
      return null;
    }
    slot.mag--;
    if (slot.mag === 0 && slot.reserve > 0) slot.reloadUntil = now + weapon.reloadTime * 1000;
  }
  combat.equipped = weapon.id;
  combat.lastSeq = seq;
  combat.nextFireAt = now + MultiplayerRules.fireIntervalMs(weapon);
  const counts = MultiplayerRules.hitCounts(weapon, raw.hits, raw.headshots);
  combat.currentShot = {
    seq, weaponId: weapon.id, at: now, targets: new Set([targetKey]),
    remainingHits: weapon.rocket ? Number.POSITIVE_INFINITY : weapon.pellets - counts.hits,
  };
  return { weapon, damage: MultiplayerRules.damageForHit(weapon, counts.hits, counts.headshots) };
}

function impossibleShotReuse(combat, raw, targetKey) {
  if (!combat || !raw) return null;
  const weapon = MultiplayerRules.weaponById(raw.weaponId);
  const seq = Number(raw.shotSeq);
  const current = combat.currentShot;
  if (!weapon || !Number.isInteger(seq) || !current || current.seq !== seq ||
      current.weaponId !== weapon.id || Date.now() - current.at > 350) return null;
  if (current.targets.has(targetKey)) return 'duplicate-shot-target';
  if (!weapon.rocket && current.remainingHits <= 0) return 'shot-hit-budget-exceeded';
  return null;
}

function grantCombatItems(player, items) {
  if (!player || !player.combat || !Array.isArray(items)) return;
  for (const item of items) {
    if (item.type === 'weapon') {
      const weapon = MultiplayerRules.weaponById(item.weapon);
      const slot = weapon && player.combat.weapons[weapon.id];
      if (!weapon || !slot) continue;
      slot.unlocked = true;
      if (!weapon.melee) {
        slot.mag = Math.max(slot.mag, weapon.magSize);
        slot.reserve = Math.min(999, slot.reserve + Math.max(0, Math.round(+item.ammo || 0)));
      }
    } else if (item.type === 'ammo') {
      let id = player.combat.equipped;
      let slot = player.combat.weapons[id];
      if (!slot || !slot.unlocked || MultiplayerRules.WEAPONS[id].melee) {
        id = player.combat.weapons.findIndex((candidate, index) => candidate.unlocked && !MultiplayerRules.WEAPONS[index].melee);
        slot = player.combat.weapons[id];
      }
      if (slot) slot.reserve = Math.min(999, slot.reserve + Math.max(0, Math.round(+item.amount || 0)));
    } else if (item.type === 'armor') {
      player.armor = Math.min(100, (player.armor || 0) + Math.max(0, Math.round(+item.amount || 0)));
    }
  }
}

function serverDeathDrop(player) {
  if (!player || !player.canDrop || !player.combat) return;
  player.canDrop = false;
  const items = [];
  for (const weapon of MultiplayerRules.WEAPONS) {
    const slot = player.combat.weapons[weapon.id];
    if (!slot.unlocked || weapon.melee) continue;
    items.push({
      type: 'weapon', weapon: weapon.id,
      ammo: Math.min(999, Math.max(0, slot.mag + slot.reserve)), rarity: 'raro',
    });
  }
  if (!items.length) return;
  const dropId = 'drop' + (++match.dropSeq);
  const pos = player.pos.slice(0, 3);
  match.drops.set(dropId, { pos, items, taken: false });
  io.to('br').emit('dropSpawn', { id: dropId, pos, items });
}

function killBrPlayer(victimId, options = {}) {
  const victim = players.get(victimId);
  if (!victim || !victim.alive || victim.spectator || match.phase !== 'PLAYING') return false;
  const killerId = options.killerId && options.killerId !== victimId ? options.killerId : null;
  const killer = killerId ? players.get(killerId) : null;
  const validKiller = killer && killer.alive && !killer.spectator && !killer.arenaRoom ? killer : null;
  const aliveBefore = [...players.values()].filter(player => player.alive && !player.spectator && !player.arenaRoom).length;
  victim.alive = false;
  victim.health = 0;
  victim.placement = Math.max(1, aliveBefore);
  match.lastDead = victimId;
  if (validKiller) validKiller.kills++;
  serverDeathDrop(victim);
  freeCarsOf(victimId);
  if (match.heliOwner === victimId) match.heliOwner = null;
  io.to('br').emit('playerKilled', {
    victimId, victimNick: victim.nick,
    killerId: validKiller ? killerId : null,
    killerNick: validKiller ? validKiller.nick : null,
    killerKills: validKiller ? validKiller.kills : 0,
    weapon: options.weapon || '???',
    byZone: !!options.byZone,
    byCity: !!options.byCity,
    bySecurity: !!options.bySecurity,
    placement: victim.placement,
  });
  if (!options.deferVictory) {
    broadcastRoster();
    checkVictory();
  }
  return true;
}

function enforceSecurityPenalty(playerId, code) {
  const player = players.get(playerId);
  if (!player || player.security.enforced) return false;
  const room = player.arenaRoom ? arenaRooms.get(player.arenaRoom) : null;
  const canEnforceArena = room && room.phase === 'PLAYING' && player.arena && player.arena.alive;
  const canEnforceBr = !player.arenaRoom && match.phase === 'PLAYING' && player.alive && !player.spectator;
  if (!canEnforceArena && !canEnforceBr) return false;

  player.security.enforced = true;
  io.to(playerId).emit('securityEnforcement', {
    action: 'spectate',
    reason: 'integrity-violation',
  });
  const enforced = canEnforceArena
    ? arenaKill(room, playerId, null, 'ANTI-CHEAT', { spectator: true })
    : killBrPlayer(playerId, { weapon: 'ANTI-CHEAT', bySecurity: true });
  if (!enforced) player.security.enforced = false;
  else console.warn(`[SECURITY] ${player.nick} (${playerId}) removido da rodada: ${code}`);
  return enforced;
}

function recordSecuritySignal(playerId, code, points) {
  const player = players.get(playerId);
  if (!player || player.security.enforced) return false;
  const now = Date.now();
  if (now - player.security.lastSignalAt > SECURITY_SIGNAL_WINDOW_MS) player.security.score = 0;
  player.security.lastSignalAt = now;
  player.security.score += points;
  if (player.security.score < SECURITY_ENFORCEMENT_SCORE) return false;
  return enforceSecurityPenalty(playerId, code);
}

function finiteVector(value) {
  if (!Array.isArray(value) || value.length < 3) return null;
  const vector = value.slice(0, 3).map(Number);
  return vector.every(Number.isFinite) ? vector : null;
}

function resetMovementBudget(player, now = Date.now()) {
  player.movementBudget = { at: now, horizontal: 4, vertical: 5 };
}

function acceptsMovement(player, horizontal, vertical, horizontalSpeed, verticalSpeed, now) {
  if (!player.movementBudget) resetMovementBudget(player, now);
  const budget = player.movementBudget;
  const elapsed = Math.max(0, Math.min(1, (now - budget.at) / 1000));
  budget.at = now;
  budget.horizontal = Math.min(horizontalSpeed * 0.75 + 4, budget.horizontal + horizontalSpeed * elapsed);
  budget.vertical = Math.min(verticalSpeed * 0.75 + 5, budget.vertical + verticalSpeed * elapsed);
  if (horizontal > budget.horizontal || vertical > budget.vertical) return false;
  budget.horizontal -= horizontal;
  budget.vertical -= vertical;
  return true;
}

function validatesAim(shooter, victim, weapon, raw) {
  const dx = victim.pos[0] - shooter.pos[0];
  const dy = victim.pos[1] + 1 - (shooter.pos[1] + 1.4);
  const dz = victim.pos[2] - shooter.pos[2];
  const distance = Math.hypot(dx, dy, dz);
  if (distance > weapon.maxRange + 3) return false;
  if (distance < 2) return true;
  const aim = finiteVector(raw.aim);
  if (!aim) return false;
  const aimLength = Math.hypot(aim[0], aim[1], aim[2]);
  if (aimLength < 0.5 || aimLength > 1.5) return false;
  const dot = (aim[0] * dx + aim[1] * dy + aim[2] * dz) / (aimLength * distance);
  const allowance = Math.min(0.45, Math.atan2(1.15, distance) + weapon.spreadHip * 2 + 0.035);
  return dot >= Math.cos(allowance);
}

function rejectMovement(playerId, player, now, reason, points = 1) {
  player.lastPosT = now;
  player.strikes = (player.strikes || 0) + 1;
  if (player.strikes === 20) console.log(`[CHEAT] ${player.nick} movimento rejeitado: ${reason}`);
  recordSecuritySignal(playerId, 'movement:' + reason, points);
  return false;
}

function brRecipientCanSee(sourceId, source, recipientId, recipient) {
  if (recipient.arenaRoom || source.arenaRoom || recipientId === sourceId) return false;
  if (match.phase !== 'PLAYING') return true;
  if (!recipient.alive || recipient.spectator) {
    const spectateTarget = [...players.entries()].find(([id, player]) =>
      id !== recipientId && player.alive && !player.spectator && !player.arenaRoom);
    return !!spectateTarget && spectateTarget[0] === sourceId;
  }
  return Math.hypot(
    source.pos[0] - recipient.pos[0],
    source.pos[1] - recipient.pos[1],
    source.pos[2] - recipient.pos[2],
  ) <= MultiplayerRules.BR_INTEREST_RADIUS;
}

function broadcastBrPosition(sourceId, source, payload) {
  if (!(source.relevantTo instanceof Set)) source.relevantTo = new Set();
  for (const [recipientId, recipient] of players) {
    const recipientSocket = io.sockets.sockets.get(recipientId);
    if (!recipientSocket) continue;
    const relevant = brRecipientCanSee(sourceId, source, recipientId, recipient);
    if (relevant) {
      recipientSocket.volatile.emit('playerUpdate', payload);
      source.relevantTo.add(recipientId);
    } else if (source.relevantTo.delete(recipientId)) {
      recipientSocket.emit('playerHidden', { id: sourceId });
    }
  }
}

function broadcastArenaPosition(room, sourceId, source, payload) {
  if (!(source.arenaRelevantTo instanceof Set)) source.arenaRelevantTo = new Set();
  for (const recipientId of room.members) {
    if (recipientId === sourceId) continue;
    const recipient = players.get(recipientId);
    const recipientSocket = io.sockets.sockets.get(recipientId);
    if (!recipient || !recipientSocket) continue;
    const relevant = !!recipient.arena && recipient.arena.alive && Math.hypot(
      source.pos[0] - recipient.pos[0],
      source.pos[1] - recipient.pos[1],
      source.pos[2] - recipient.pos[2],
    ) <= MultiplayerRules.ARENA_INTEREST_RADIUS;
    if (relevant) {
      recipientSocket.volatile.emit('arenaPlayerUpdate', payload);
      source.arenaRelevantTo.add(recipientId);
    } else if (source.arenaRelevantTo.delete(recipientId)) {
      recipientSocket.emit('arenaPlayerHidden', { id: sourceId });
    }
  }
}

function freeCarsOf(id) {
  for (const k of Object.keys(match.carOwners)) {
    if (match.carOwners[k] === id) {
      delete match.carOwners[k];
      io.to('br').emit('carFree', { idx: +k });
    }
  }
}

function buildPlan(seed) {
  const rng = mulberry32(seed ^ 0x9E3779B9);
  // nave: atravessa o mapa passando perto do centro
  const a = rng() * Math.PI * 2;
  const ship = {
    from: [Math.cos(a) * 620, Math.sin(a) * 620],
    to: [-Math.cos(a) * 620 + (rng() - 0.5) * 300, -Math.sin(a) * 620 + (rng() - 0.5) * 300],
    alt: 250, flyTime: FLY_TIME,
  };
  const boss = { hp: BOSS_HP, x: Math.cos(a) * 400, z: Math.sin(a) * 400 };
  // zona: 5 fases encolhendo; cada centro cabe dentro do círculo anterior
  const radii = [560, 340, 200, 110, 55, 24];
  const waits = [50, 45, 40, 35, 30];   // s parado antes de encolher
  const shrinks = [30, 28, 24, 20, 16]; // s encolhendo
  const dps = [1, 2, 4, 7, 12];
  let cx = (rng() - 0.5) * 300, cz = (rng() - 0.5) * 300;
  const phases = [];
  let t = ship.flyTime + 20; // gás só começa a contar depois da queda
  for (let i = 0; i < 5; i++) {
    const r0 = radii[i], r1 = radii[i + 1];
    const ang = rng() * Math.PI * 2, d = rng() * Math.max(0, r0 - r1) * 0.8;
    const nx = Math.max(-LIM, Math.min(LIM, cx + Math.cos(ang) * d));
    const nz = Math.max(-LIM, Math.min(LIM, cz + Math.sin(ang) * d));
    phases.push({ cx, cz, r0, nx, nz, r1, tWaitEnd: t + waits[i], tShrinkEnd: t + waits[i] + shrinks[i], dps: dps[i] });
    t += waits[i] + shrinks[i];
    cx = nx; cz = nz;
  }
  return { ship, zone: phases, boss };
}

function bossPositionAt(t, plan = match.plan) {
  if (!plan || !plan.boss) return null;
  const angle = t * 0.055;
  return [plan.boss.x + Math.cos(angle) * 26, plan.boss.z + Math.sin(angle) * 26];
}

/* loot dos baús — rolado e concedido no servidor */
const WEAPON_TIERS = [ // idx do arsenal: 1=escopeta 0=fuzil 2=DMR 3=bazuca 4=plasma 6=sniper leve 7=escopeta rajada
  { rarity: 'incomum',  weapon: 1, ammo: 18 },
  { rarity: 'incomum',  weapon: 7, ammo: 27 },
  { rarity: 'raro',     weapon: 0, ammo: 90 },
  { rarity: 'raro',     weapon: 6, ammo: 30 },
  { rarity: 'épico',    weapon: 2, ammo: 24 },
  { rarity: 'lendário', weapon: 3, ammo: 3 },
];
function rollChest(rng, luck = 0) {
  const items = [];
  const r = rng() + luck;
  if (r < 0.38) items.push({ type: 'ammo', amount: 40 + Math.floor(rng() * 50) });
  else if (r < 0.62) items.push({ type: 'weapon', ...WEAPON_TIERS[rng() < 0.5 ? 0 : 1] }); // incomum: escopeta clássica ou rajada
  else if (r < 0.82) items.push({ type: 'weapon', ...WEAPON_TIERS[rng() < 0.55 ? 2 : 3] }); // raro: fuzil ou sniper leve
  else if (r < 0.94) items.push({ type: 'weapon', ...WEAPON_TIERS[4] });
  else items.push({ type: 'weapon', ...WEAPON_TIERS[5] });
  if (rng() < 0.55) items.push({ type: 'med' });
  if (rng() < 0.3) items.push({ type: 'armor', amount: 50 });
  if (rng() < 0.22) items.push({ type: 'ammo', amount: 24 });
  return items;
}

/* ---------------- ciclo da partida ---------------- */
function roster() {
  return [...players.entries()].filter(([, p]) => !p.arenaRoom).map(([id, p]) => ({
    id, nick: p.nick, colors: p.colors, kills: p.kills,
    alive: p.alive, spectator: p.spectator,
  }));
}
const sysChat = msg => io.emit('chat', { sys: true, msg });
const broadcastRoster = () => io.to('br').emit('roster', { phase: match.phase, players: roster(), aliveCount: match.aliveCount, hostId });

function startCountdown() {
  if (match.phase !== 'LOBBY') return;
  match.phase = 'COUNTDOWN';
  let n = COUNTDOWN_S;
  sysChat(`Partida começando em ${n}s — se prepara!`);
  io.to('br').emit('countdown', { n });
  match.countdownTimer = setInterval(() => {
    n--;
    io.to('br').emit('countdown', { n });
    if (n <= 0) { clearInterval(match.countdownTimer); startMatch(); }
  }, 1000);
  broadcastRoster();
}

function startMatch() {
  // sala esvaziou durante a contagem: volta pro lobby em vez de rodar partida vazia
  if (![...players.values()].some(p => !p.spectator)) {
    match.phase = 'LOBBY';
    broadcastRoster();
    return;
  }
  match.phase = 'PLAYING';
  match.num++;
  match.t0 = Date.now();
  match.plan = buildPlan(match.seed);
  resetRoundState();
  match.plan.flags = { ...match.flags }; // congela as regras da partida
  // destruição da cidade: timestamps ABSOLUTOS do servidor (fonte de verdade)
  if (match.flags.cidade) {
    const seed = (match.seed ^ 0xC17DE57) >>> 0;
    match.cityDestruction = {
      eventId: 'city-' + (match.num) + '-' + seed,
      seed,
      state: 'intact',
      cinematicStartedAt: match.t0 + CITY_DELAY_MS,
      impactAt: match.t0 + CITY_DELAY_MS + CITY_IMPACT_MS,
    };
  } else {
    match.cityDestruction = { eventId: null, seed: null, state: 'intact', cinematicStartedAt: null, impactAt: null };
  }
  match.plan.city = match.flags.cidade ? { ...match.cityDestruction } : null;
  match.bossMaxHp = match.plan.boss.hp;
  match.bossHp = match.bossMaxHp;
  match.bossDead = !match.flags.golem; // GOLEM desligado = já "morto" pro servidor
  match.aliveCount = 0;
  for (const p of players.values()) {
    if (p.spectator) continue; // quem entrou tarde continua espectador
    p.alive = true; p.kills = 0; p.placement = 0;
    p.health = BR_MAX_HEALTH;
    p.armor = 0;
    p.combat = createCombatState(false);
    p.security = createSecurityState();
    p.lastBossDamageAt = 0;
    p.lastState = Date.now(); p.canDrop = true;
    p.pos = shipPosAt(0, match.plan);
    p.lastPos = p.pos.slice(); p.lastPosT = Date.now();
    p.onShip = true; resetMovementBudget(p, p.lastPosT);
    p.relevantTo = new Set();
    match.aliveCount++;
  }
  io.to('br').emit('matchStart', { t0: match.t0, serverNow: Date.now(), plan: match.plan, num: match.num });
  for (const [id, p] of players) if (!p.spectator && !p.arenaRoom) emitCombatState(id, p.combat);
  broadcastRoster();
  sysChat(`Partida #${match.num} começou — ${match.aliveCount} na nave. Boa sorte!`);
  console.log(`[MATCH ${match.num}] começou com ${match.aliveCount} jogadores · seed ${match.seed}`);
}

function endMatch(winnerId) {
  if (match.phase !== 'PLAYING') return;
  match.phase = 'ENDED';
  const w = winnerId ? players.get(winnerId) : null;
  if (w) { w.placement = 1; }
  // ranking da partida: colocação crescente
  const ranking = [...players.values()]
    .filter(p => !p.spectator && p.placement > 0)
    .sort((a, b) => a.placement - b.placement)
    .map(p => ({ nick: p.nick, kills: p.kills, placement: p.placement }));
  // pontos globais
  const total = ranking.length;
  for (const p of players.values()) {
    if (p.spectator || !p.placement) continue;
    const e = rankEntry(p.nick);
    e.matches++; e.kills += p.kills; e.sumPlace += p.placement;
    e.points += 5 + p.kills * 25 + (p.placement === 1 ? 100 : 0) +
      (p.placement <= Math.ceil(total / 2) ? 20 : 0);
    if (p.placement === 1) e.wins++;
  }
  rankDirty = true;
  io.to('br').emit('matchEnd', {
    winner: w ? { id: winnerId, nick: w.nick, kills: w.kills } : null,
    ranking, globalTop: topRank(), nextIn: NEXT_IN_S,
  });
  sysChat(w ? `🏆 ${w.nick} VENCEU a partida #${match.num} com ${w.kills} kills!` : 'Partida encerrada sem sobreviventes.');
  console.log(`[MATCH ${match.num}] vencedor: ${w ? w.nick : '(ninguém)'}`);
  // evento consumado morre com a partida: init do lobby seguinte não pode
  // carregar 'destroyed' antigo (cliente recarrega e nasceria em ruínas)
  match.cityDestruction = { eventId: null, seed: null, state: 'intact', cinematicStartedAt: null, impactAt: null };
  match.endTimer = setTimeout(() => {
    match.seed = (Math.random() * 0xFFFFFFFF) >>> 0; // MAPA NOVO
    // O cliente recarrega assim que recebe nextMatch. Limpe ANTES de publicar
    // o lobby, senão o init dessa recarga ainda contém os baús da rodada velha.
    resetRoundState();
    match.phase = 'LOBBY';
    for (const p of players.values()) { p.spectator = false; p.alive = false; p.placement = 0; }
    io.to('br').emit('nextMatch', {}); // clientes recarregam e voltam pro lobby com a seed nova
  }, NEXT_IN_S * 1000);
}

function checkVictory() {
  if (match.phase !== 'PLAYING') return;
  const alive = [...players.entries()].filter(([, p]) => !p.spectator && p.alive);
  match.aliveCount = alive.length;
  if (alive.length === 1) endMatch(alive[0][0]);
  else if (alive.length === 0) endMatch(match.lastDead || null); // morte mútua: último a cair vence
}

/* ---------------- destruição da cidade (relógio do servidor) ----------------
   ticker curto em vez de setTimeout único: sobrevive a ajustes de relógio e
   garante transições exatamente-uma-vez por eventId. */
let cityFired = { cinematic: null, impact: null }; // eventIds já disparados
function cityBroadcast() { io.emit('cityDestruction', { ...match.cityDestruction }); }
setInterval(() => {
  const cd = match.cityDestruction;
  if (match.phase !== 'PLAYING' || !cd || !cd.eventId) return;
  const now = Date.now();
  if (cd.state === 'intact' && now >= cd.cinematicStartedAt && cityFired.cinematic !== cd.eventId) {
    cityFired.cinematic = cd.eventId;
    cd.state = 'cinematic';
    cityBroadcast();
    sysChat('⚠ ALERTA: mísseis se aproximando da cidade!');
  }
  if (cd.state === 'cinematic' && now >= cd.impactAt && cityFired.impact !== cd.eventId) {
    cityFired.impact = cd.eventId;
    cd.state = 'destroyed';
    // mortes autoritativas: última posição válida vs raio letal do centro da cidade
    const C = CityProto.CITY_CENTER, R = CityProto.CITY_KILL_RADIUS;
    for (const [id, p] of players) {
      if (p.spectator || !p.alive) continue;
      if (Math.hypot(p.pos[0] - C.x, p.pos[2] - C.z) > R) continue;
      killBrPlayer(id, { weapon: 'MÍSSEIS', byCity: true, deferVictory: true });
      console.log(`[CIDADE] ${p.nick} morreu no ataque de mísseis`);
    }
    cityBroadcast();
    broadcastRoster();
    checkVictory();
  }
}, 250).unref();

/* ---------------- zona autoritativa ----------------
   O servidor espelha o círculo, mantém o HP oficial e elimina quem fica fora,
   flutuando na altitude da nave ou AFK sem mandar estado. */
/* posição esperada da nave em t (valida o flag ship dos clientes) */
function shipPosAt(t, plan = match.plan) {
  const sp = plan.ship;
  const k = Math.min(Math.max(t / sp.flyTime, 0), 1.18);
  return [sp.from[0] + (sp.to[0] - sp.from[0]) * k, sp.alt, sp.from[1] + (sp.to[1] - sp.from[1]) * k];
}

function zoneAt(t, plan = match.plan) {
  const ph = plan.zone;
  let cur = null, shrinking = false, k = 0;
  for (const p of ph) {
    if (t < p.tWaitEnd) { cur = p; break; }
    if (t < p.tShrinkEnd) { cur = p; shrinking = true; k = (t - p.tWaitEnd) / (p.tShrinkEnd - p.tWaitEnd); break; }
  }
  if (!cur) {
    const last = ph[ph.length - 1];
    return { x: last.nx, z: last.nz, r: last.r1, dps: last.dps + 3 };
  }
  if (shrinking) return {
    x: cur.cx + (cur.nx - cur.cx) * k, z: cur.cz + (cur.nz - cur.cz) * k,
    r: cur.r0 + (cur.r1 - cur.r0) * k, dps: cur.dps,
  };
  return { x: cur.cx, z: cur.cz, r: cur.r0, dps: cur.dps };
}
setInterval(() => {
  if (match.phase !== 'PLAYING' || !match.plan) return;
  const t = (Date.now() - match.t0) / 1000;
  const flyT = match.plan.ship.flyTime;
  if (t < flyT + ZONE_GRACE_S) return; // janela de queda: ninguém é punido ainda
  const zone = zoneAt(t);
  const now = Date.now();
  for (const [id, p] of players) {
    if (p.spectator || !p.alive) continue;
    const outside = Math.hypot(p.pos[0] - zone.x, p.pos[2] - zone.z) > zone.r + 1;
    const floating = p.pos[1] > 120 && t > flyT + FLOAT_AFTER_S; // nunca pousou
    const afk = now - (p.lastState || match.t0) > AFK_MS;        // parou de mandar estado
    const damage = outside || floating
      ? zone.dps * ZONE_DRAIN_X + (floating ? 6 : 0)
      : afk ? 25 : 0;
    if (damage > 0) {
      p.health = Math.max(0, p.health - damage);
      io.to(id).emit('healthSync', { health: p.health, armor: p.armor, source: 'zone' });
    }
    if (p.health <= 0) {
      killBrPlayer(id, { weapon: 'ZONA', byZone: true });
      console.log(`[ZONA] servidor eliminou ${p.nick} (fora=${outside} voando=${floating} afk=${afk})`);
      if (match.phase !== 'PLAYING') break; // partida acabou dentro do loop
    }
  }
}, 1000).unref(); // unref: só relevante pros testes de unidade (listen mantém o processo vivo)

/* O GOLEM é determinístico e seu dano também pertence ao servidor. O cliente
   só anima o golpe; ignorar playerDamage no DevTools não altera o HP oficial. */
setInterval(() => {
  if (match.phase !== 'PLAYING' || !match.plan || match.bossDead || !match.flags.golem) return;
  const now = Date.now();
  const bossPos = bossPositionAt((now - match.t0) / 1000);
  if (!bossPos) return;
  for (const [id, player] of players) {
    if (!player.alive || player.spectator || player.arenaRoom || player.pos[1] > 50) continue;
    if (Math.hypot(player.pos[0] - bossPos[0], player.pos[2] - bossPos[1]) >= 8) continue;
    if (now - (player.lastBossDamageAt || 0) < 2200) continue;
    player.lastBossDamageAt = now;
    player.health = Math.max(0, player.health - 16);
    io.to(id).emit('healthSync', {
      health: player.health, armor: player.armor, source: 'boss',
      fromPos: [bossPos[0], player.pos[1], bossPos[1]],
    });
    if (player.health <= 0) {
      killBrPlayer(id, { weapon: 'GOLEM' });
      if (match.phase !== 'PLAYING') break;
    }
  }
}, 250).unref();

/* ---------------- conexões ---------------- */
/* ---------------- arenas: 1v1 e mata-mata ----------------
   Salas independentes do Battle Royale. O servidor decide HP, kills, placar,
   cronometro e respawn; o cliente so informa movimento e acertos candidatos. */
const ARENA_COUNTDOWN_S = Math.max(1, +process.env.ARENA_COUNTDOWN_S || 4);
const ARENA_RETURN_S = Math.max(2, +process.env.ARENA_RETURN_S || 7);
const ARENA_INVULN_MS = Math.max(0, +process.env.ARENA_INVULN_MS || 1400);
const arenaRooms = new Map();
const ARENA_MAPS = {
  CAMP: {
    label: 'Campo aberto', center: [0, 0], radius: 105,
    spawns: [[-24, 1, 0], [24, 1, 0], [0, 1, -25], [0, 1, 25], [-18, 1, -18], [18, 1, 18], [-18, 1, 18], [18, 1, -18]],
  },
  CITY: {
    label: 'Distrito urbano', center: [-338, 132], radius: 115,
    spawns: [[-374, 1, 112], [-302, 1, 152], [-360, 1, 169], [-316, 1, 95], [-384, 1, 150], [-292, 1, 116]],
  },
  WILDERNESS: {
    label: 'Fronteira', center: [205, -175], radius: 115,
    spawns: [[170, 1, -175], [240, 1, -175], [205, 1, -210], [205, 1, -140], [179, 1, -201], [231, 1, -149]],
  },
};

function arenaConfig(raw, previous) {
  const d = raw || {};
  const prev = previous || {};
  const modeRaw = String(d.mode || prev.mode || 'DEATHMATCH').toUpperCase();
  const mode = ['DUEL', '1V1', '1X1'].includes(modeRaw) ? 'DUEL' : 'DEATHMATCH';
  const requestedMax = Number.isFinite(+d.maxPlayers) ? Math.round(+d.maxPlayers) : (+prev.maxPlayers || 8);
  const privateRoom = d.private == null && d.privacy == null
    ? !!prev.private : (d.private === true || String(d.privacy).toUpperCase() === 'PRIVATE');
  const incomingPassword = clean(d.password).slice(0, 20);
  const password = privateRoom ? (incomingPassword || prev.password || '') : '';
  const mapRaw = String(d.map || prev.map || 'CAMP').toUpperCase();
  return {
    name: cleanSoft(d.name == null ? prev.name : d.name).slice(0, 28) || (mode === 'DUEL' ? 'Duelo 1v1' : 'Mata-Mata'),
    mode,
    maxPlayers: mode === 'DUEL' ? 2 : Math.max(2, Math.min(16, requestedMax)),
    private: privateRoom,
    password,
    map: ARENA_MAPS[mapRaw] ? mapRaw : 'CAMP',
    scoreLimit: Math.max(3, Math.min(50, Math.round(Number.isFinite(+d.scoreLimit) ? +d.scoreLimit : (+prev.scoreLimit || 10)))),
    timeLimit: Math.max(3, Math.min(30, Math.round(Number.isFinite(+d.timeLimit) ? +d.timeLimit : (+prev.timeLimit || 10)))),
    respawn: Math.max(1, Math.min(10, Math.round(Number.isFinite(+d.respawn) ? +d.respawn : (+prev.respawn || 4)))),
  };
}

function arenaPlayerPublic(id) {
  const p = players.get(id);
  if (!p) return null;
  const a = p.arena || {};
  return {
    id, nick: p.nick, colors: p.colors,
    score: a.score || 0, deaths: a.deaths || 0,
    health: Number.isFinite(a.health) ? a.health : 100,
    alive: !!a.alive,
  };
}

function arenaRoomPublic(room) {
  const cfg = room.config;
  return {
    id: room.id, name: cfg.name, mode: cfg.mode, maxPlayers: cfg.maxPlayers,
    locked: cfg.private, map: cfg.map, mapLabel: ARENA_MAPS[cfg.map].label,
    scoreLimit: cfg.scoreLimit, timeLimit: cfg.timeLimit, respawn: cfg.respawn,
    phase: room.phase, hostId: room.hostId, round: room.round,
    playerCount: room.members.size,
    players: [...room.members].map(arenaPlayerPublic).filter(Boolean),
    remaining: room.phase === 'PLAYING' ? Math.max(0, Math.ceil((room.endsAt - Date.now()) / 1000)) : cfg.timeLimit * 60,
  };
}

function emitArenaList() {
  io.emit('arenaRooms', [...arenaRooms.values()].map(arenaRoomPublic));
}

function emitArenaRoom(room) {
  io.to('arena:' + room.id).emit('arenaRoomState', arenaRoomPublic(room));
  emitArenaList();
}

function arenaRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id;
  do {
    id = '';
    for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  } while (arenaRooms.has(id));
  return id;
}

function arenaSpawn(room, id) {
  const ids = [...room.members];
  const p = players.get(id);
  const deaths = p && p.arena ? p.arena.deaths : 0;
  const points = ARENA_MAPS[room.config.map].spawns;
  const idx = Math.max(0, ids.indexOf(id));
  return points[(idx + deaths * 3 + room.round) % points.length].slice();
}

function clearArenaTimers(room) {
  if (room.countdownTimer) clearInterval(room.countdownTimer);
  if (room.resetTimer) clearTimeout(room.resetTimer);
  room.countdownTimer = null;
  room.resetTimer = null;
}

function deleteArenaRoom(room) {
  clearArenaTimers(room);
  arenaRooms.delete(room.id);
  emitArenaList();
}

function arenaLeavePlayer(id, disconnected) {
  const p = players.get(id);
  if (!p || !p.arenaRoom) return;
  const room = arenaRooms.get(p.arenaRoom);
  const roomId = p.arenaRoom;
  p.arenaRoom = null;
  p.arena = null;
  p.spectator = match.phase === 'PLAYING' || match.phase === 'ENDED';
  p.alive = false;
  const sock = io.sockets.sockets.get(id);
  if (sock) {
    sock.leave('arena:' + roomId);
    if (!disconnected) sock.join('br');
  }
  if (!room) return;
  room.members.delete(id);
  if (room.hostId === id) room.hostId = room.members.values().next().value || null;
  if (!disconnected && sock) sock.emit('arenaLeft', { id: roomId });
  if (!room.members.size) {
    deleteArenaRoom(room);
  } else if ((room.phase === 'COUNTDOWN' || room.phase === 'PLAYING') && room.members.size < 2) {
    if (room.phase === 'PLAYING') arenaEndMatch(room, 'opponent-left');
    else {
      clearArenaTimers(room);
      room.phase = 'LOBBY';
      emitArenaRoom(room);
    }
  } else {
    emitArenaRoom(room);
  }
  broadcastRoster();
}

function arenaJoinPlayer(socket, room, password) {
  const p = players.get(socket.id);
  if (!p) return { ok: false, error: 'Jogador desconectado.' };
  if (room.phase !== 'LOBBY') return { ok: false, error: 'A partida desta sala ja comecou.' };
  if (room.members.size >= room.config.maxPlayers) return { ok: false, error: 'A sala esta lotada.' };
  if (room.config.private && clean(password) !== room.config.password) return { ok: false, error: 'Senha incorreta.' };
  if (p.alive && match.phase === 'PLAYING') return { ok: false, error: 'Termine sua partida de Battle Royale primeiro.' };
  if (p.arenaRoom && p.arenaRoom !== room.id) arenaLeavePlayer(socket.id, false);
  if (!room.members.has(socket.id)) room.members.add(socket.id);
  p.arenaRoom = room.id;
  p.arena = { score: 0, deaths: 0, health: 100, alive: false, combat: createCombatState(true) };
  p.security = createSecurityState();
  p.spectator = true;
  p.alive = false;
  if (hostId === socket.id) hostId = null;
  socket.leave('br');
  socket.join('arena:' + room.id);
  const publicRoom = arenaRoomPublic(room);
  socket.emit('arenaJoined', publicRoom);
  emitArenaRoom(room);
  broadcastRoster();
  return { ok: true, room: publicRoom };
}

function arenaStartMatch(room) {
  if (!room || room.members.size < 2) {
    if (room) { room.phase = 'LOBBY'; emitArenaRoom(room); }
    return;
  }
  clearArenaTimers(room);
  room.phase = 'PLAYING';
  room.round++;
  room.startedAt = Date.now();
  room.endsAt = room.startedAt + room.config.timeLimit * 60 * 1000;
  for (const id of room.members) {
    const p = players.get(id);
    if (!p) continue;
    p.arena = { score: 0, deaths: 0, health: 100, alive: true, combat: createCombatState(true),
      invulnerableUntil: Date.now() + ARENA_INVULN_MS };
    p.security = createSecurityState();
    p.arenaRelevantTo = new Set();
    const spawn = arenaSpawn(room, id);
    p.pos = spawn.slice();
    p.lastArenaState = Date.now();
    resetMovementBudget(p, p.lastArenaState);
    io.to(id).emit('arenaMatchStart', {
      room: arenaRoomPublic(room), spawn, serverNow: Date.now(), combat: combatPublic(p.arena.combat),
    });
  }
  emitArenaRoom(room);
}

function arenaCountdown(room) {
  if (!room || room.phase !== 'LOBBY' || room.members.size < 2) return false;
  room.phase = 'COUNTDOWN';
  let n = ARENA_COUNTDOWN_S;
  io.to('arena:' + room.id).emit('arenaCountdown', { n });
  room.countdownTimer = setInterval(() => {
    n--;
    io.to('arena:' + room.id).emit('arenaCountdown', { n });
    if (n <= 0) arenaStartMatch(room);
  }, 1000);
  emitArenaRoom(room);
  return true;
}

function arenaEndMatch(room, reason) {
  if (!room || room.phase !== 'PLAYING') return;
  room.phase = 'ENDED';
  const ranking = [...room.members].map(arenaPlayerPublic).filter(Boolean)
    .sort((a, b) => b.score - a.score || a.deaths - b.deaths || a.nick.localeCompare(b.nick));
  io.to('arena:' + room.id).emit('arenaMatchEnd', {
    reason: reason || 'score', ranking, winner: ranking[0] || null,
    nextIn: ARENA_RETURN_S, room: arenaRoomPublic(room),
  });
  emitArenaRoom(room);
  room.resetTimer = setTimeout(() => {
    if (!arenaRooms.has(room.id) || room.phase !== 'ENDED') return;
    room.phase = 'LOBBY';
    for (const id of room.members) {
      const p = players.get(id);
      if (p) p.arena = { score: 0, deaths: 0, health: 100, alive: false, combat: createCombatState(true) };
    }
    emitArenaRoom(room);
  }, ARENA_RETURN_S * 1000);
  if (room.resetTimer.unref) room.resetTimer.unref();
}

function arenaRespawn(room, id) {
  const p = players.get(id);
  if (!p || p.arenaRoom !== room.id || room.phase !== 'PLAYING' || !p.arena || p.security.enforced) return;
  p.arena.health = 100;
  p.arena.alive = true;
  p.arena.combat = createCombatState(true);
  p.arenaRelevantTo = new Set();
  p.arena.invulnerableUntil = Date.now() + ARENA_INVULN_MS;
  const spawn = arenaSpawn(room, id);
  p.pos = spawn.slice();
  p.lastArenaState = Date.now();
  resetMovementBudget(p, p.lastArenaState);
  io.to(id).emit('arenaRespawn', {
    spawn, health: 100, invulnerableMs: ARENA_INVULN_MS, combat: combatPublic(p.arena.combat),
  });
  emitArenaRoom(room);
}

function arenaKill(room, victimId, killerId, weapon, options = {}) {
  const victim = players.get(victimId);
  if (!victim || !victim.arena || !victim.arena.alive || room.phase !== 'PLAYING') return false;
  const killer = killerId && killerId !== victimId ? players.get(killerId) : null;
  victim.arena.alive = false;
  victim.arena.health = 0;
  victim.arena.deaths++;
  if (killer && killer.arenaRoom === room.id && killer.arena && killer.arena.alive) killer.arena.score++;
  const killerScore = killer && killer.arena ? killer.arena.score : 0;
  io.to('arena:' + room.id).emit('arenaKilled', {
    victimId, victimNick: victim.nick,
    killerId: killer ? killerId : null, killerNick: killer ? killer.nick : null,
    killerScore, weapon: cleanSoft(weapon).slice(0, 24) || 'ARMA',
    respawnIn: options.spectator ? null : room.config.respawn,
    spectator: !!options.spectator,
  });
  emitArenaRoom(room);
  if (killerScore >= room.config.scoreLimit) {
    arenaEndMatch(room, 'score');
    return true;
  }
  if (options.spectator) return true;
  const round = room.round;
  const timer = setTimeout(() => {
    if (room.round === round) arenaRespawn(room, victimId);
  }, room.config.respawn * 1000);
  if (timer.unref) timer.unref();
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const room of arenaRooms.values()) {
    if (room.phase !== 'PLAYING') continue;
    const remaining = Math.max(0, Math.ceil((room.endsAt - now) / 1000));
    io.to('arena:' + room.id).emit('arenaTime', { remaining });
    if (remaining <= 0) arenaEndMatch(room, 'time');
  }
}, 1000).unref();

io.on('connection', socket => {
  socket.join('br');
  const isMidMatch = match.phase === 'PLAYING' || match.phase === 'ENDED';
  players.set(socket.id, {
    nick: 'Recruta', colors: null, kills: 0,
    alive: false, spectator: isMidMatch, placement: 0,
    pos: [0, 0, 0], lastChat: 0, lastState: Date.now(), health: BR_MAX_HEALTH, armor: 0,
    combat: createCombatState(false), canDrop: true, relevantTo: new Set(),
    security: createSecurityState(),
    onShip: false, movementBudget: null, arenaRelevantTo: new Set(),
    arenaRoom: null, arena: null,
  });

  socket.emit('init', {
    id: socket.id,
    mode: 'br',
    worldSeed: match.seed,
    phase: match.phase,
    matchNum: match.num,
    t0: match.t0, serverNow: Date.now(),
    plan: match.phase === 'PLAYING' || match.phase === 'ENDED' ? match.plan : null,
    bossHp: match.bossHp, bossMaxHp: match.bossMaxHp, bossDead: match.bossDead,
    openedChests: [...match.openedChests],
    drops: [...match.drops.entries()].filter(([, d]) => !d.taken).map(([id, d]) => ({ id, pos: d.pos, items: d.items.length })),
    hostId,
    flags: match.flags,
    cityDestruction: match.cityDestruction,
    players: roster().filter(p => p.id !== socket.id),
    combat: combatPublic(players.get(socket.id).combat),
    health: players.get(socket.id).health,
    armor: players.get(socket.id).armor,
    globalTop: topRank(),
    arenaRooms: [...arenaRooms.values()].map(arenaRoomPublic),
  });
  broadcastRoster();
  console.log(`[+] ${socket.id} (${players.size} online, fase ${match.phase})`);

  socket.on('hello', d => {
    const p = players.get(socket.id); if (!p) return;
    p.nick = cleanNick(d && d.nick);
    if (d && Array.isArray(d.colors)) p.colors = d.colors.slice(0, 4).map(c => clean(c).slice(0, 9));
    broadcastRoster();
    if (p.arenaRoom) {
      const room = arenaRooms.get(p.arenaRoom);
      if (room) emitArenaRoom(room);
    }
    // o lobby emite hello a cada tecla digitada no nick — só anuncia UMA vez
    if (!p.greeted) {
      p.greeted = true;
      sysChat(`${p.nick} entrou${p.spectator ? ' (espectador até a próxima partida)' : ''}`);
    }
  });

  socket.on('requestStart', () => {
    if (socket.id === hostId && (match.phase === 'LOBBY')) startCountdown();
  });

  /* vira anfitrião apresentando o código (impresso no console do servidor) */
  socket.on('claimHost', (d, cb) => {
    const p = players.get(socket.id);
    if (!p) { if (typeof cb === 'function') cb({ ok: false }); return; }
    // anti força-bruta: 5 tentativas erradas por janela e o socket esfria
    const nowH = Date.now();
    p.claimT = (p.claimT || []).filter(t => nowH - t < CLAIM_COOLDOWN_MS);
    if (p.claimT.length >= 5) { if (typeof cb === 'function') cb({ ok: false }); return; }
    const ok = clean(d && d.code).toUpperCase() === HOST_CODE;
    if (!ok) p.claimT.push(nowH);
    if (ok && hostId !== socket.id) {
      hostId = socket.id;
      sysChat(`👑 ${p.nick} agora é o anfitrião`);
      broadcastRoster();
    }
    if (typeof cb === 'function') cb({ ok });
  });

  /* latência: o cliente mede o RTT deste ack */
  // Timestamp no ACK para uma amostra NTP simples no cliente. Assim uma
  // mensagem represada durante o carregamento de GLBs nao desloca a zona.
  socket.on('pingx', cb => {
    if (typeof cb === 'function') cb({ serverNow: Date.now() });
  });

  socket.on('combatReload', d => {
    const p = players.get(socket.id);
    const combat = p && p.arenaRoom && p.arena ? p.arena.combat : p && p.combat;
    if (!combat || !d || !Number.isInteger(d.weaponId)) return;
    startCombatReload(combat, d.weaponId);
    emitCombatState(socket.id, combat);
  });

  /* salas competitivas: descoberta, criacao, configuracao e ciclo */
  socket.on('arenaList', (d, cb) => {
    if (typeof d === 'function') cb = d;
    if (typeof cb === 'function') cb({ ok: true, rooms: [...arenaRooms.values()].map(arenaRoomPublic) });
  });

  socket.on('arenaCreate', (d, cb) => {
    const p = players.get(socket.id);
    if (!p || (p.alive && match.phase === 'PLAYING')) {
      if (typeof cb === 'function') cb({ ok: false, error: 'Termine sua partida atual primeiro.' });
      return;
    }
    const config = arenaConfig(d);
    if (config.private && config.password.length < 4) {
      if (typeof cb === 'function') cb({ ok: false, error: 'A senha precisa ter pelo menos 4 caracteres.' });
      return;
    }
    if (p.arenaRoom) arenaLeavePlayer(socket.id, false);
    const id = arenaRoomId();
    const room = {
      id, config, hostId: socket.id, members: new Set(), phase: 'LOBBY', round: 0,
      startedAt: 0, endsAt: 0, countdownTimer: null, resetTimer: null,
    };
    arenaRooms.set(id, room);
    const result = arenaJoinPlayer(socket, room, config.password);
    if (!result.ok) deleteArenaRoom(room);
    if (typeof cb === 'function') cb(result);
  });

  socket.on('arenaJoin', (d, cb) => {
    const id = clean(d && (d.id || d.code)).toUpperCase().slice(0, 6);
    const room = arenaRooms.get(id);
    const result = room ? arenaJoinPlayer(socket, room, d && d.password)
      : { ok: false, error: 'Sala nao encontrada.' };
    if (typeof cb === 'function') cb(result);
  });

  socket.on('arenaLeave', (d, cb) => {
    if (typeof d === 'function') cb = d;
    arenaLeavePlayer(socket.id, false);
    if (typeof cb === 'function') cb({ ok: true });
  });

  socket.on('arenaUpdateRoom', (d, cb) => {
    const p = players.get(socket.id);
    const room = p && p.arenaRoom ? arenaRooms.get(p.arenaRoom) : null;
    if (!room || room.hostId !== socket.id || room.phase !== 'LOBBY') {
      if (typeof cb === 'function') cb({ ok: false, error: 'Somente o dono altera a sala no lobby.' });
      return;
    }
    const next = arenaConfig(d, room.config);
    if (next.private && next.password.length < 4) {
      if (typeof cb === 'function') cb({ ok: false, error: 'A senha precisa ter pelo menos 4 caracteres.' });
      return;
    }
    if (next.maxPlayers < room.members.size) {
      if (typeof cb === 'function') cb({ ok: false, error: 'O limite nao pode ser menor que a quantidade atual.' });
      return;
    }
    room.config = next;
    emitArenaRoom(room);
    if (typeof cb === 'function') cb({ ok: true, room: arenaRoomPublic(room) });
  });

  socket.on('arenaStart', (d, cb) => {
    const p = players.get(socket.id);
    const room = p && p.arenaRoom ? arenaRooms.get(p.arenaRoom) : null;
    const ok = !!room && room.hostId === socket.id && arenaCountdown(room);
    if (typeof cb === 'function') cb(ok
      ? { ok: true }
      : { ok: false, error: room && room.members.size < 2 ? 'Sao necessarios pelo menos 2 jogadores.' : 'Apenas o dono pode iniciar.' });
  });

  socket.on('arenaState', d => {
    const p = players.get(socket.id);
    const room = p && p.arenaRoom ? arenaRooms.get(p.arenaRoom) : null;
    if (!room || room.phase !== 'PLAYING' || !p.arena || !p.arena.alive || !d || !Array.isArray(d.pos)) return;
    const pos = finiteVector(d.pos);
    if (!pos) return;
    const preset = ARENA_MAPS[room.config.map];
    const now = Date.now();
    p.lastArenaState = now;
    if (Math.hypot(pos[0] - preset.center[0], pos[2] - preset.center[1]) > preset.radius + 5 ||
        pos[1] < -10 || pos[1] > 150) {
      rejectMovement(socket.id, p, now, 'arena-out-of-bounds', 3);
      return;
    }
    const horizontal = Math.hypot(pos[0] - p.pos[0], pos[2] - p.pos[2]);
    const vertical = Math.abs(pos[1] - p.pos[1]);
    if (!acceptsMovement(p, horizontal, vertical, 18, 55, now)) {
      rejectMovement(socket.id, p, now, 'arena-impossible-speed');
      return;
    }
    p.pos = pos;
    if (Number.isInteger(d.weaponId) && MultiplayerRules.weaponById(d.weaponId)) p.arena.combat.equipped = d.weaponId;
    broadcastArenaPosition(room, socket.id, p, {
      id: socket.id, pos, rotY: +d.rotY || 0,
      nick: p.nick, colors: p.colors, alive: true,
      ...cleanPlayerAnimation(d),
    });
  });

  socket.on('arenaHit', (d, cb) => {
    const shooter = players.get(socket.id);
    const room = shooter && shooter.arenaRoom ? arenaRooms.get(shooter.arenaRoom) : null;
    const victim = d && players.get(d.targetId);
    if (!room || room.phase !== 'PLAYING' || !shooter.arena || !shooter.arena.alive ||
        !victim || victim.arenaRoom !== room.id || !victim.arena || !victim.arena.alive) {
      if (typeof cb === 'function') cb({ ok: false });
      return;
    }
    const now = Date.now();
    if (now < (victim.arena.invulnerableUntil || 0)) {
      if (typeof cb === 'function') cb({ ok: false, protected: true });
      return;
    }
    if (Math.hypot(
      shooter.pos[0] - victim.pos[0],
      shooter.pos[1] - victim.pos[1],
      shooter.pos[2] - victim.pos[2],
    ) > MultiplayerRules.ARENA_INTEREST_RADIUS) {
      if (typeof cb === 'function') cb({ ok: false });
      return;
    }
    const targetKey = 'player:' + d.targetId;
    const reuse = impossibleShotReuse(shooter.arena.combat, d, targetKey);
    if (reuse && recordSecuritySignal(socket.id, reuse, 6)) {
      if (typeof cb === 'function') cb({ ok: false, enforced: true });
      return;
    }
    const shot = authorizeShot(shooter.arena.combat, d, targetKey, false);
    if (!shot || !validatesAim(shooter, victim, shot.weapon, d)) {
      if (typeof cb === 'function') cb({ ok: false });
      return;
    }
    const dmg = shot.damage;
    victim.arena.health = Math.max(0, victim.arena.health - dmg);
    io.to(d.targetId).emit('arenaDamaged', {
      dmg, health: victim.arena.health, shooterId: socket.id, shooterNick: shooter.nick,
      weapon: shot.weapon.name, fromPos: shooter.pos,
    });
    io.to(socket.id).emit('arenaHitConfirmed', { targetId: d.targetId, health: victim.arena.health });
    const killed = victim.arena.health <= 0;
    if (killed) arenaKill(room, d.targetId, socket.id, shot.weapon.name);
    if (typeof cb === 'function') cb({ ok: true, health: victim.arena.health, killed });
  });

  socket.on('arenaSuicide', d => {
    const p = players.get(socket.id);
    const room = p && p.arenaRoom ? arenaRooms.get(p.arenaRoom) : null;
    if (room) arenaKill(room, socket.id, null, d && d.weapon || 'QUEDA');
  });

  socket.on('arenaChat', d => {
    const p = players.get(socket.id);
    const room = p && p.arenaRoom ? arenaRooms.get(p.arenaRoom) : null;
    if (!room) return;
    const now = Date.now();
    if (now - p.lastChat < 1200) return;
    const msg = cleanSoft(d && d.msg).slice(0, 120);
    if (!msg) return;
    p.lastChat = now;
    io.to('arena:' + room.id).emit('arenaChat', { nick: p.nick, msg });
  });

  /* regras da sala: só o anfitrião altera (GOLEM, animais, ciclo dia/noite) */
  socket.on('setFlags', d => {
    if (socket.id !== hostId || !d) return;
    if (typeof d.golem === 'boolean') match.flags.golem = d.golem;
    if (typeof d.animais === 'boolean') match.flags.animais = d.animais;
    if (typeof d.zumbis === 'boolean') match.flags.zumbis = d.zumbis;
    if (typeof d.cidade === 'boolean') match.flags.cidade = d.cidade;
    if (['auto', 'dia', 'noite'].includes(d.ciclo)) match.flags.ciclo = d.ciclo;
    if (Number.isInteger(d.bots)) {
      const n = Math.max(0, Math.min(8, d.bots));
      if (n !== match.flags.bots) { match.flags.bots = n; syncBots(); }
    }
    io.emit('flags', match.flags);
  });

  /* posse de veículo: o PRIMEIRO pedido leva (arbitragem do servidor mata a
     corrida de dois jogadores entrando no mesmo carro na mesma janela) */
  socket.on('enterCar', (d, cb) => {
    if (typeof cb !== 'function') return;
    const p = players.get(socket.id);
    const idx = d && Number.isInteger(d.idx) ? d.idx : -1;
    if (!p || !p.alive || match.phase !== 'PLAYING' || idx < 0 || idx > 31) return cb({ ok: false });
    const owner = match.carOwners[idx];
    if (owner && owner !== socket.id && players.has(owner)) return cb({ ok: false });
    match.carOwners[idx] = socket.id;
    socket.broadcast.emit('carTaken', { idx, id: socket.id });
    cb({ ok: true });
  });
  socket.on('leaveCar', d => {
    const idx = d && Number.isInteger(d.idx) ? d.idx : -1;
    if (match.carOwners[idx] === socket.id) {
      delete match.carOwners[idx];
      io.to('br').emit('carFree', { idx });
    }
  });
  socket.on('enterHeli', (d, cb) => {
    if (typeof d === 'function') cb = d;
    if (typeof cb !== 'function') return;
    const p = players.get(socket.id);
    if (!p || !p.alive || match.phase !== 'PLAYING') return cb({ ok: false });
    if (match.heliOwner && match.heliOwner !== socket.id && players.has(match.heliOwner)) return cb({ ok: false });
    match.heliOwner = socket.id;
    socket.to('br').emit('heliTaken', { id: socket.id });
    cb({ ok: true });
  });
  socket.on('leaveHeli', () => {
    if (match.heliOwner !== socket.id) return;
    match.heliOwner = null;
    io.to('br').emit('heliFree', {});
  });

  socket.on('state', d => {
    const p = players.get(socket.id);
    if (!p || !d || !Array.isArray(d.pos) || d.pos.length < 3) return;
    // morto/espectador não publica avatar durante nem depois da rodada.
    if ((match.phase === 'PLAYING' || match.phase === 'ENDED') && !p.alive) return;
    const pos = finiteVector(d.pos);
    // NaN/Infinity envenenava a interpolação dos outros clientes e cegava a zona
    if (!pos) return;
    const now = Date.now();

    /* Snapshots do cliente são candidatos. A âncora, o relógio, a posse de
       veículo e os limites usados para publicar a posição pertencem ao servidor. */
    if (match.phase === 'PLAYING' && p.alive && !p.spectator && match.plan) {
      const t = (now - match.t0) / 1000;
      if (d.ship) {
        // diz estar na nave: precisa estar NA nave (rota conhecida) e no tempo dela
        if (!p.onShip || t > match.plan.ship.flyTime + 8) {
          rejectMovement(socket.id, p, now, 'invalid-ship-state', 3);
          return;
        }
        const sp = shipPosAt(t);
        if (Math.hypot(pos[0] - sp[0], pos[2] - sp[2]) > 8 || Math.abs(pos[1] - sp[1]) > 5) {
          rejectMovement(socket.id, p, now, 'invalid-ship-position', 3);
          return;
        }
      } else {
        if (Math.abs(pos[0]) > POSITION_HORIZONTAL_LIMIT || Math.abs(pos[2]) > POSITION_HORIZONTAL_LIMIT ||
            pos[1] < POSITION_MIN_Y || pos[1] > POSITION_MAX_Y) {
          rejectMovement(socket.id, p, now, 'world-out-of-bounds', 3);
          return;
        }
        const car = Number.isInteger(d.car) ? d.car : -1;
        const ownsCar = car >= 0 && match.carOwners[car] === socket.id;
        const ownsHeli = d.heli === true && match.heliOwner === socket.id;
        if ((car >= 0 && !ownsCar) || (d.heli && !ownsHeli)) {
          rejectMovement(socket.id, p, now, 'unauthorized-vehicle', 3);
          return;
        }
        const horizontal = Math.hypot(pos[0] - p.lastPos[0], pos[2] - p.lastPos[2]);
        const vertical = Math.abs(pos[1] - p.lastPos[1]);
        const maxHorizontal = ownsCar ? 70 : ownsHeli ? 80 : d.chute ? 32 : 18;
        const maxVertical = ownsHeli ? 55 : d.chute ? 65 : 125;
        if (!acceptsMovement(p, horizontal, vertical, maxHorizontal, maxVertical, now)) {
          rejectMovement(socket.id, p, now, 'impossible-speed');
          if (p.strikes > 120) socket.disconnect(true);
          return;
        }
        p.onShip = false;
      }
      p.lastPos = pos;
      p.lastPosT = now;
    } else {
      p.lastPos = pos;
      p.lastPosT = now;
    }

    p.pos = pos;
    p.lastState = now;
    if (Number.isInteger(d.weaponId)) {
      const slot = p.combat && p.combat.weapons[d.weaponId];
      if (slot && slot.unlocked) p.combat.equipped = d.weaponId;
    }
    broadcastBrPosition(socket.id, p, {
      id: socket.id, pos: p.pos, rotY: +d.rotY || 0,
      ship: !!d.ship, chute: !!d.chute,
      car: Number.isInteger(d.car) && match.carOwners[d.car] === socket.id ? d.car : -1,
      heli: !!d.heli && match.heliOwner === socket.id,
      nick: p.nick, colors: p.colors,
      ...cleanPlayerAnimation(d),
    });
  });

  socket.on('shotHit', (d, cb) => {
    const p = players.get(socket.id);
    if (!p || !d || d.targetId === socket.id || !players.has(d.targetId)) {
      if (typeof cb === 'function') cb({ ok: false });
      return;
    }
    // morto/espectador não atira; fora de partida não existe dano
    if (match.phase !== 'PLAYING' || !p.alive) {
      if (typeof cb === 'function') cb({ ok: false });
      return;
    }
    const victim = players.get(d.targetId);
    if (!victim.alive || victim.arenaRoom) {
      if (typeof cb === 'function') cb({ ok: false });
      return;
    }
    const targetKey = 'player:' + d.targetId;
    const reuse = impossibleShotReuse(p.combat, d, targetKey);
    if (reuse && recordSecuritySignal(socket.id, reuse, 6)) {
      if (typeof cb === 'function') cb({ ok: false, enforced: true });
      return;
    }
    const shot = authorizeShot(p.combat, d, targetKey, true);
    if (!shot || !validatesAim(p, victim, shot.weapon, d)) {
      emitCombatState(socket.id, p.combat);
      if (typeof cb === 'function') cb({ ok: false });
      return;
    }
    const absorbed = Math.min(victim.armor || 0, shot.damage * 0.7);
    victim.armor = Math.max(0, (victim.armor || 0) - absorbed);
    const damage = Math.min(victim.health, shot.damage - absorbed);
    victim.health = Math.max(0, victim.health - damage);
    victim.lastAttacker = { id: socket.id, at: Date.now(), weapon: shot.weapon.name };
    io.to(d.targetId).emit('youWereHit', {
      dmg: damage,
      health: victim.health,
      armor: victim.armor,
      fromPos: p.pos,
      shooterId: socket.id, shooterNick: p.nick,
      weapon: shot.weapon.name,
    });
    emitCombatState(socket.id, p.combat);
    if (victim.health <= 0) killBrPlayer(d.targetId, { killerId: socket.id, weapon: shot.weapon.name });
    if (typeof cb === 'function') cb({
      ok: true, damage, health: victim.health, armor: victim.armor, killed: victim.health <= 0,
    });
  });

  socket.on('reportDeath', (d, cb) => {
    const victim = players.get(socket.id);
    if (!victim || !victim.alive) { if (typeof cb === 'function') cb({}); return; }
    const recent = victim.lastAttacker && Date.now() - victim.lastAttacker.at <= 10000 ? victim.lastAttacker : null;
    killBrPlayer(socket.id, {
      killerId: recent && recent.id,
      weapon: recent ? recent.weapon : cleanSoft(d && d.cause).slice(0, 24) || 'AMBIENTE',
    });
    if (typeof cb === 'function') cb({ placement: victim.placement });
  });

  /* baús: primeiro a abrir leva; o servidor rola o loot */
  socket.on('openChest', (d, cb) => {
    if (typeof cb !== 'function') return;
    const p = players.get(socket.id);
    // espectador/morto abrindo baú = grief (queima o loot dos vivos)
    if (!p || !p.alive) return cb({ ok: false });
    if (match.phase !== 'PLAYING' || !d || !d.key) return cb({ ok: false });
    const key = String(d.key).slice(0, 32);
    if (!validChestKey(key)) return cb({ ok: false });
    // anti-cheat: ninguém abre 2 baús em menos de 300ms (varredura automatizada)
    const nowC = Date.now();
    if (nowC - (p.lastChest || 0) < 300) return cb({ ok: false });
    p.lastChest = nowC;
    if (match.openedChests.has(key)) return cb({ ok: false, opened: true });
    match.openedChests.add(key);
    // baú lendário só existe depois do GOLEM cair — e só se o GOLEM existe na sala
    if (key === 'boss' && (!match.bossDead || !match.flags.golem)) { match.openedChests.delete(key); return cb({ ok: false }); }
    const rng = mulberry32((match.seed ^ [...key].reduce((a, c) => a * 31 + c.charCodeAt(0) | 0, 7)) >>> 0);
    const items = key === 'boss'
      ? [{ type: 'weapon', rarity: 'lendário', weapon: 4, ammo: 160 }, { type: 'armor', amount: 100 }, { type: 'med' }, { type: 'med' }]
      : rollChest(rng);
    grantCombatItems(p, items);
    io.to(socket.id).emit('healthSync', { health: p.health, armor: p.armor, source: 'loot' });
    socket.to('br').emit('chestOpened', { key });
    cb({ ok: true, items });
  });

  socket.on('takeDrop', (d, cb) => {
    if (typeof cb !== 'function') return;
    const p = players.get(socket.id);
    const drop = d && match.drops.get(d.id);
    if (!p || !p.alive || !drop || drop.taken) return cb({ ok: false });
    // só pega se está perto de verdade (anti "aspirador" de loot à distância)
    const dx = p.pos[0] - drop.pos[0], dz = p.pos[2] - drop.pos[2];
    if (dx * dx + dz * dz > 12 * 12) return cb({ ok: false });
    drop.taken = true;
    grantCombatItems(p, drop.items);
    io.to(socket.id).emit('healthSync', { health: p.health, armor: p.armor, source: 'loot' });
    io.to('br').emit('dropTaken', { id: d.id });
    cb({ ok: true, items: drop.items });
  });

  /* boss sincronizado: HP mora aqui */
  socket.on('bossHit', (d, cb) => {
    const p = players.get(socket.id);
    if (!p || !p.alive || match.phase !== 'PLAYING' || match.bossDead) {
      if (typeof cb === 'function') cb({ ok: false });
      return;
    }
    const shot = authorizeShot(p.combat, d, 'boss', true);
    if (!shot) {
      emitCombatState(socket.id, p.combat);
      if (typeof cb === 'function') cb({ ok: false });
      return;
    }
    const bossPos = finiteVector(d && d.bossPos);
    const expectedBossPos = bossPositionAt((Date.now() - match.t0) / 1000);
    const claimError = bossPos && expectedBossPos
      ? Math.hypot(bossPos[0] - expectedBossPos[0], bossPos[2] - expectedBossPos[1]) : Infinity;
    const bossDistance = expectedBossPos
      ? Math.hypot(p.pos[0] - expectedBossPos[0], p.pos[2] - expectedBossPos[1]) : Infinity;
    if (!bossPos || claimError > 8 || bossDistance > shot.weapon.maxRange + 12) {
      emitCombatState(socket.id, p.combat);
      if (typeof cb === 'function') cb({ ok: false });
      return;
    }
    const baseDamage = shot.weapon.rocket ? shot.weapon.rocketSplash.bossMax : shot.weapon.dmg * Math.max(1, shot.weapon.pellets);
    const dmg = Math.min(150, Math.round(baseDamage));
    match.bossHp = Math.max(0, match.bossHp - dmg);
    emitCombatState(socket.id, p.combat);
    if (match.bossHp <= 0) {
      match.bossDead = true;
      const p = players.get(socket.id);
      io.to('br').emit('bossDead', { by: p ? p.nick : '???', tMatch: (Date.now() - match.t0) / 1000 });
      sysChat(`💀 O GOLEM caiu para ${p ? p.nick : '???'} — loot lendário no local!`);
    } else {
      io.to('br').volatile.emit('bossHp', { hp: match.bossHp, max: match.bossMaxHp });
    }
    if (typeof cb === 'function') cb({ ok: true, damage: dmg, health: match.bossHp });
  });

  socket.on('chat', d => {
    const p = players.get(socket.id); if (!p) return;
    const now = Date.now();
    if (now - p.lastChat < 1200) return; // anti-spam
    const msg = cleanSoft(d && d.msg).slice(0, 120);
    if (!msg) return;
    p.lastChat = now;
    io.emit('chat', { nick: p.nick, msg });
  });

  socket.on('disconnect', () => {
    const p = players.get(socket.id);
    if (p && p.arenaRoom) arenaLeavePlayer(socket.id, true);
    players.delete(socket.id);
    // host não migra pra gente aleatória: fica vago até alguém dar o código de novo
    if (hostId === socket.id) hostId = null;
    freeCarsOf(socket.id);
    if (match.heliOwner === socket.id) match.heliOwner = null;
    for (const player of players.values()) if (player.relevantTo instanceof Set) player.relevantTo.delete(socket.id);
    if (players.size === 0) { // sala vazia: sessão volta ao estado de fábrica
      match.flags = { golem: true, animais: true, zumbis: false, bots: 0, ciclo: 'auto', cidade: true };
      match.cityDestruction = { eventId: null, seed: null, state: 'intact', cinematicStartedAt: null, impactAt: null };
      if (match.phase === 'COUNTDOWN' && match.countdownTimer) clearInterval(match.countdownTimer);
      if (match.phase !== 'PLAYING' && match.phase !== 'ENDED') match.phase = 'LOBBY';
      syncBots(); // flags.bots voltou a 0
    }
    io.emit('playerLeft', { id: socket.id });
    if (p) sysChat(`${p.nick} saiu`);
    if (p && p.alive) { p.alive = false; checkVictory(); }
    broadcastRoster();
    console.log(`[-] ${socket.id} (${players.size} online)`);
  });
});

/* ---------------- bots gerenciados (flag do anfitrião) ----------------
   sobe/derruba um processo filho rodando scripts/bots.js apontando pra
   este servidor — os bots entram na sala como jogadores de verdade */
const PORT = process.env.PORT || 3000;
let botsProc = null;
function syncBots() {
  if (botsProc) { try { botsProc.kill(); } catch (e) { /* já morto */ } botsProc = null; }
  const n = match.flags.bots | 0;
  if (n > 0 && require.main === module) {
    botsProc = require('child_process').spawn(process.execPath,
      [path.join(__dirname, 'scripts', 'bots.js'), String(n), `http://localhost:${PORT}`],
      { stdio: 'ignore' });
    console.log(`[BOTS] ${n} bots entrando na sala`);
  }
}
process.on('exit', () => { if (botsProc) try { botsProc.kill(); } catch (e) { /* ok */ } });

/* internos expostos pra suite de QA; o listen só roda quando executado
   direto (node server.js) — require() nos testes não abre porta */
module.exports = { saveRankNow, buildPlan, zoneAt, rollChest, mulberry32, LIM, rankEntry, pruneRank, topRank };

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Servidor BR no ar em http://localhost:${PORT} · seed inicial ${match.seed}`);
    console.log('====================================================');
    console.log(`  CÓDIGO DO ANFITRIÃO: ${HOST_CODE}`);
    console.log('  cole no lobby (campo "código do anfitrião") ou');
    console.log(`  abra o jogo com ?host=${HOST_CODE} na URL`);
    console.log('====================================================');
  });
}
