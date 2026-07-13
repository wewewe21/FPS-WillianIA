/* ================================================================
   BOTS DE PARTIDA — conecta N bots num servidor JÁ RODANDO e espera
   o anfitrião (você) iniciar. Eles caem da nave, andam pela zona e
   trocam tiro entre si (e com você!).
   Uso: node scripts/bots.js [n=8] [url=http://localhost:3000]
   Ctrl+C derruba todos.
   ================================================================ */
'use strict';
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { io } = require('socket.io-client');
const { zoneAt, mulberry32 } = require(path.join(__dirname, '..', 'server.js'));

const NICKS = ['Zumbi', 'Falcao', 'Vaga-Lume', 'Trovao', 'Golem Jr', 'Coiote', 'Visitante', 'Sombra',
  'Pantera', 'Cacto', 'Urubu', 'Lagarto', 'Tempestade', 'Neve', 'Fumaca', 'Raio'];
// posicional com o arsenal do jogo: 6=sniper leve, 7=escopeta de rajada
// (a rajada usa o código/perfil ESCOPETA — o servidor valida por código)
const WEAPONS = ['FUZIL', 'ESCOPETA', 'DMR', 'BAZUCA', 'PLASMA', 'FACA', 'SNIPER', 'ESCOPETA'];
const WEAPON_PROFILES = {
  FUZIL: { range: 85, dmg: 14, bursts: 2, cooldown: 1.1 },
  ESCOPETA: { range: 24, dmg: 38, bursts: 1, cooldown: 1.35 },
  DMR: { range: 100, dmg: 42, bursts: 1, cooldown: 1.5 },
  BAZUCA: { range: 75, dmg: 55, bursts: 1, cooldown: 2.4 },
  PLASMA: { range: 75, dmg: 19, bursts: 2, cooldown: 1.0 },
  SNIPER: { range: 110, dmg: 32, bursts: 1, cooldown: 1.2 }, // leve: rápida, dano menor
  FACA: { range: 2.8, dmg: 24, bursts: 1, cooldown: 1.0 },
};

const shipPos = (t, plan) => {
  const sp = plan.ship;
  const k = Math.min(Math.max(t / sp.flyTime, 0), 1.18);
  return [sp.from[0] + (sp.to[0] - sp.from[0]) * k, sp.alt, sp.from[1] + (sp.to[1] - sp.from[1]) * k];
};

function selectTarget(self, candidates, maxRange) {
  const limit2 = maxRange * maxRange;
  let nearestHuman = null, nearestHumanD2 = Infinity;
  let nearestBot = null, nearestBotD2 = Infinity;
  for (const candidate of candidates) {
    if (!candidate || candidate.id === self.id || !candidate.alive || candidate.spectator || candidate.phase !== 'PLAY') continue;
    if (![self.x, self.z, candidate.x, candidate.z].every(Number.isFinite)) continue;
    const dx = candidate.x - self.x, dz = candidate.z - self.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > limit2) continue;
    if (candidate.isBot) {
      if (d2 < nearestBotD2) { nearestBot = candidate; nearestBotD2 = d2; }
    } else if (d2 < nearestHumanD2) {
      nearestHuman = candidate; nearestHumanD2 = d2;
    }
  }
  return nearestHuman || nearestBot;
}

function isPointInGas(x, z, zone) {
  if (!zone) return false;
  const distance = Math.hypot(x - zone.x, z - zone.z);
  return zone.inversa ? distance < zone.r : distance > zone.r;
}

function chooseWaypoint(zone, rng = Math.random, worldLimit = 490) {
  if (!zone) {
    return [(rng() * 2 - 1) * worldLimit, (rng() * 2 - 1) * worldLimit];
  }
  if (!zone.inversa) {
    const angle = rng() * Math.PI * 2;
    const radius = rng() * Math.max(10, zone.r * 0.75);
    return [zone.x + Math.cos(angle) * radius, zone.z + Math.sin(angle) * radius];
  }
  for (let attempt = 0; attempt < 24; attempt++) {
    const x = (rng() * 2 - 1) * worldLimit;
    const z = (rng() * 2 - 1) * worldLimit;
    if (!isPointInGas(x, z, zone)) return [x, z];
  }
  const corners = [
    [-worldLimit, -worldLimit], [-worldLimit, worldLimit],
    [worldLimit, -worldLimit], [worldLimit, worldLimit],
  ];
  return corners.reduce((best, point) =>
    Math.hypot(point[0] - zone.x, point[1] - zone.z) > Math.hypot(best[0] - zone.x, best[1] - zone.z)
      ? point : best);
}

function movementYaw(dx, dz) {
  return Math.atan2(-dx, -dz);
}

function combatFacingYaw(bot, target, action, moveDx, moveDz) {
  if (target && action && (action.type === 'shoot' || action.type === 'melee'))
    return movementYaw(target.x - bot.x, target.z - bot.z);
  return movementYaw(moveDx, moveDz);
}

function applyLoot(loadout, items) {
  let looseAmmo = 0;
  for (const item of items || []) {
    if (!item || typeof item !== 'object') continue;
    if (item.type === 'weapon' && Number.isInteger(item.weapon) && WEAPONS[item.weapon]) {
      loadout.weapon = WEAPONS[item.weapon];
      loadout.ammo = Math.max(0, Number(item.ammo) || 0);
    } else if (item.type === 'ammo') looseAmmo += Math.max(0, Number(item.amount) || 0);
  }
  if (loadout.weapon !== 'FACA') {
    loadout.ammo += looseAmmo;
    if (loadout.ammo <= 0) { loadout.weapon = 'FACA'; loadout.ammo = Infinity; }
  } else loadout.ammo = Infinity;
  return loadout;
}

function chooseCombatAction(bot, target) {
  if (!target) return { type: 'patrol', distance: Infinity, weapon: bot.weapon || 'FACA' };
  const distance = Math.hypot(target.x - bot.x, target.z - bot.z);
  const hasRanged = bot.weapon && bot.weapon !== 'FACA' && bot.ammo > 0;
  if (hasRanged) {
    const range = (WEAPON_PROFILES[bot.weapon] || WEAPON_PROFILES.FUZIL).range;
    return { type: distance <= range ? 'shoot' : 'chase', distance, weapon: bot.weapon };
  }
  return { type: distance <= 2.8 ? 'melee' : 'chase', distance, weapon: 'FACA' };
}

function canAttemptAttack(bot, target, action, t, jitter = 0) {
  if (!target || !action || (action.type !== 'melee' && action.type !== 'shoot')) return false;
  const profile = WEAPON_PROFILES[action.weapon || bot.weapon] || WEAPON_PROFILES.FACA;
  return t - bot.lastShot > profile.cooldown + jitter;
}

function buildMissShot(bot, target, rng = Math.random) {
  return {
    weapon: bot.weapon,
    fromPos: [bot.x, bot.y + 1.5, bot.z],
    // playerFired eleva toPos em 1 m para mirar no tronco; enviar os pés
    // evita somar a altura duas vezes e desenhar o traçante acima da cabeça.
    toPos: [target.x + (rng() - 0.5) * 4, target.y, target.z + (rng() - 0.5) * 4],
  };
}

async function createBotTerrain(worldSeed) {
  // Os módulos são carregados antes do seed no cliente também; só a construção
  // do SimplexNoise deve consumir a sequência determinística da partida.
  const terrainModule = await import(pathToFileURL(path.join(__dirname, '..', 'js', 'terrain.js')).href);
  const previousRandom = Math.random;
  Math.random = mulberry32(Number(worldSeed) >>> 0);
  try {
    const terrain = terrainModule.createTerrain({
      lerp: (a, b, t) => a + (b - a) * t,
      clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
    });
    terrain.buildHeightGrid(1100);
    return terrain;
  } finally {
    Math.random = previousRandom;
  }
}

function createBotChestSpots(worldSeed, terrain, worldSize = 1100) {
  if (!terrain || typeof terrain.heightAt !== 'function' || typeof terrain.slopeAt !== 'function') return [];
  const rng = mulberry32((Number(worldSeed) ^ 0xC0FFEE) >>> 0);
  const limit = worldSize / 2 - 70;
  const spots = [];
  let tries = 0;
  while (spots.length < 34 && tries < 400) {
    tries++;
    const x = (rng() * 2 - 1) * limit;
    const z = (rng() * 2 - 1) * limit;
    if (terrain.slopeAt(x, z) > 0.5) continue;
    const y = terrain.heightAt(x, z);
    if (y < terrain.WATER_LEVEL + 1.2) continue;
    rng(); // rotação consumida pelo cliente ao criar o mesmo baú
    spots.push({ key: `c${spots.length}`, x, y, z });
  }
  return spots;
}

function resetBotForMatch(bot) {
  bot.alive = true;
  bot.hp = 100;
  bot.phase = 'SHIP';
  bot.diedSent = false;
  bot.lootDropped = false;
  bot.weapon = 'FACA';
  bot.ammo = Infinity;
  bot.pendingDrop = null;
  bot.pendingChest = null;
  bot.lastShot = -Infinity;
  bot.wp = null;
  return bot;
}

/* loot de morte idempotente: TODA morte solta loot (tiro, gás, cidade, AFK),
   mas só uma vez por vida — o servidor também limita com canDrop */
function dropLootOnce(bot, emit) {
  if (bot.lootDropped) return false;
  bot.lootDropped = true;
  const items = [{ type: 'ammo', amount: 60 }, { type: 'armor', amount: 50 }];
  const wi = WEAPONS.indexOf(bot.weapon);
  if (wi >= 0 && bot.weapon !== 'FACA') items.unshift({ type: 'weapon', weapon: wi, ammo: Math.max(0, bot.ammo) });
  emit('deathDrop', { pos: [bot.x, bot.y, bot.z], items });
  return true;
}

function observePlayerUpdate(observed, update) {
  if (!update || !update.id || !Array.isArray(update.pos) || update.pos.length < 3) return null;
  const pos = update.pos.slice(0, 3).map(Number);
  if (!pos.every(Number.isFinite)) return null;
  const previous = observed.get(update.id);
  const player = {
    ...(previous || {}),
    id: update.id,
    x: pos[0], y: pos[1], z: pos[2],
    alive: previous ? previous.alive : true,
    spectator: previous ? previous.spectator : false,
    phase: update.ship ? 'SHIP' : (update.fall || update.chute) ? 'FALL' : 'PLAY',
    isBot: !!update.bot,
  };
  observed.set(update.id, player);
  return player;
}

function startBots(N, URL) {
  let plan = null, t0 = 0;
  const bots = [];
  const observedPlayers = new Map();
  const drops = new Map();
  const chests = new Map();
  let terrain = null, terrainPromise = null, loadedWorldSeed = null;

  function rebuildWorld(worldSeed, openedChests = []) {
    const numericSeed = Number(worldSeed) >>> 0;
    if (terrainPromise && loadedWorldSeed === numericSeed) return terrainPromise;
    loadedWorldSeed = numericSeed;
    terrainPromise = createBotTerrain(numericSeed)
      .then(t => {
        terrain = t;
        const opened = new Set(openedChests);
        chests.clear();
        for (const chest of createBotChestSpots(numericSeed, t)) {
          if (!opened.has(chest.key)) chests.set(chest.key, chest);
        }
        return t;
      })
      .catch(err => { console.warn('[bots] terreno indisponível:', err.message); return null; });
    return terrainPromise;
  }

  for (let i = 0; i < N; i++) {
    const s = io(URL, { transports: ['websocket'] });
    const b = {
      i, s, id: null, alive: false, hp: 100, phase: 'LOBBY',
      x: 0, y: 0, z: 0, wp: null, lastShot: 0, diedSent: false,
      weapon: 'FACA', ammo: Infinity, pendingDrop: null, pendingChest: null,
      jumpAt: 0, mira: 0.4 + Math.random() * 0.5, // "pontaria" varia por bot
    };
    s.on('init', d => {
      b.id = d.id;
      rebuildWorld(d.worldSeed, d.openedChests || []);
      for (const drop of d.drops || []) {
        if (drop && drop.id && Array.isArray(drop.pos)) drops.set(drop.id, { id: drop.id, pos: drop.pos.slice(0, 3) });
      }
      s.emit('hello', { nick: NICKS[i % NICKS.length] + (i >= NICKS.length ? i : ''), bot: true });
    });
    s.on('matchStart', d => {
      plan = d.plan; t0 = d.t0;
      resetBotForMatch(b);
      b.jumpAt = d.plan.ship.flyTime * (0.25 + 0.65 * Math.random());
      console.log(`[bot ${i}] partida começou — pulando aos ${b.jumpAt.toFixed(0)}s`);
    });
    s.on('playerUpdate', d => observePlayerUpdate(observedPlayers, d));
    s.on('roster', d => {
      for (const p of (d && d.players) || []) {
        const observed = observedPlayers.get(p.id);
        if (observed) { observed.alive = !!p.alive; observed.spectator = !!p.spectator; }
      }
    });
    s.on('youWereHit', d => {
      if (!b.alive || b.diedSent) return;
      b.hp -= d.dmg;
      if (b.hp <= 0) {
        b.diedSent = true; b.alive = false;
        dropLootOnce(b, (ev, payload) => s.emit(ev, payload));
        s.emit('died', { killerId: d.shooterId, weapon: d.weapon, cause: { type: 'player' } });
        console.log(`[bot ${i}] morreu`);
      }
    });
    s.on('playerKilled', d => {
      const observed = observedPlayers.get(d.victimId);
      if (observed) observed.alive = false;
      if (d.victimId === b.id) {
        // morte decidida pelo servidor (gás/cidade/AFK) também solta o loot;
        // se a morte veio do próprio youWereHit, o flag já bloqueia o repique
        if (b.alive && !b.diedSent) dropLootOnce(b, (ev, payload) => s.emit(ev, payload));
        b.alive = false; b.diedSent = true;
      }
    });
    s.on('playerLeft', d => observedPlayers.delete(d.id));
    s.on('dropSpawn', d => {
      if (d && d.id && Array.isArray(d.pos)) drops.set(d.id, { id: d.id, pos: d.pos.slice(0, 3) });
    });
    s.on('dropTaken', d => { if (d && d.id) drops.delete(d.id); });
    s.on('chestOpened', d => { if (d && d.key) chests.delete(d.key); });
    s.on('nextMatch', d => {
      b.phase = 'LOBBY'; b.alive = false; observedPlayers.clear(); drops.clear(); chests.clear();
      if (d && Number.isInteger(d.worldSeed)) rebuildWorld(d.worldSeed);
    });
    bots.push(b);
  }

  setInterval(() => {
    if (!plan) return;
    const t = (Date.now() - t0) / 1000;
    const zone = zoneAt(Math.max(t, 0), plan);
    for (const b of bots) {
      if (!b.alive) continue;
      if (b.phase === 'SHIP') {
        [b.x, b.y, b.z] = shipPos(t, plan);
        if (t >= b.jumpAt) b.phase = 'FALL';
        b.s.volatile.emit('state', { pos: [b.x, b.y, b.z], rotY: 0, ship: true, heldWeapon: 'FACA', car: -1 });
      } else if (b.phase === 'FALL') {
        const groundY = terrain ? terrain.heightAt(b.x, b.z) : 4;
        b.y = Math.max(groundY, b.y - 4.2);
        if (b.y <= groundY + 0.01) b.phase = 'PLAY';
        b.s.volatile.emit('state', { pos: [b.x, b.y, b.z], rotY: 0, fall: true, chute: true, heldWeapon: 'FACA', car: -1 });
      } else {
        const botIds = new Set(bots.map(o => o.id));
        const candidates = bots.map(o => ({ ...o, isBot: true, spectator: false }));
        for (const player of observedPlayers.values()) {
          if (!botIds.has(player.id)) candidates.push(player);
        }
        const target = selectTarget(b, candidates, 100);
        const action = chooseCombatAction(b, target);
        if (action.weapon === 'FACA' && b.weapon !== 'FACA' && b.ammo <= 0) {
          b.weapon = 'FACA';
          b.ammo = Infinity;
        }
        let nearestLoot = null, nearestLootD = Infinity;
        if (b.weapon === 'FACA' || b.ammo < 12) for (const drop of drops.values()) {
          const dd = Math.hypot(drop.pos[0] - b.x, drop.pos[2] - b.z);
          if (dd < nearestLootD) { nearestLoot = { type: 'drop', value: drop }; nearestLootD = dd; }
        }
        if (b.weapon === 'FACA' || b.ammo < 12) for (const chest of chests.values()) {
          const dd = Math.hypot(chest.x - b.x, chest.z - b.z);
          if (dd < nearestLootD) { nearestLoot = { type: 'chest', value: chest }; nearestLootD = dd; }
        }
        if (nearestLoot && nearestLootD < 180) {
          const loot = nearestLoot.value;
          const lx = nearestLoot.type === 'drop' ? loot.pos[0] : loot.x;
          const lz = nearestLoot.type === 'drop' ? loot.pos[2] : loot.z;
          b.wp = [lx, lz];
          if (nearestLootD < 2.2 && nearestLoot.type === 'drop' && !b.pendingDrop) {
            b.pendingDrop = loot.id;
            b.y = Number(loot.pos[1]) || b.y;
            b.s.timeout(2000).emit('takeDrop', { id: loot.id }, (err, res) => {
              if (!err && res && res.ok) applyLoot(b, res.items);
              if (!err && res && res.ok) drops.delete(loot.id);
              b.pendingDrop = null;
            });
          } else if (nearestLootD < 2.2 && nearestLoot.type === 'chest' && !b.pendingChest) {
            b.pendingChest = loot.key;
            b.s.timeout(2000).emit('openChest', { key: loot.key }, (err, res) => {
              if (!err && res && res.ok) applyLoot(b, res.items);
              if (!err && res && (res.ok || res.opened)) chests.delete(loot.key);
              b.pendingChest = null;
            });
          }
        } else if (action.type === 'chase') {
          b.wp = [target.x, target.z];
        } else if (action.type === 'shoot') {
          b.wp = action.distance > 28 ? [target.x, target.z] : [b.x, b.z];
        } else if (!b.wp || Math.hypot(b.x - b.wp[0], b.z - b.wp[1]) < 3 || isPointInGas(b.wp[0], b.wp[1], zone)) {
          b.wp = chooseWaypoint(zone);
        }
        const dx = b.wp[0] - b.x, dz = b.wp[1] - b.z, d = Math.hypot(dx, dz);
        if (d > 1e-4) {
          const step = Math.min(0.45, d);
          b.x += (dx / d) * step; b.z += (dz / d) * step;
        }
        if (terrain) b.y = terrain.heightAt(b.x, b.z);
        b.s.volatile.emit('state', {
          pos: [b.x, b.y, b.z], rotY: combatFacingYaw(b, target, action, dx, dz), heldWeapon: b.weapon, car: -1,
        });
        const profile = WEAPON_PROFILES[action.weapon] || WEAPON_PROFILES.FACA;
        if (canAttemptAttack(b, target, action, t, Math.random() * 0.45)) {
          b.lastShot = t;
          const bursts = action.type === 'melee' ? 1 : Math.min(profile.bursts, b.ammo);
          const fromPos = [b.x, b.y + 1.5, b.z];
          if (Math.random() < b.mira) for (let k = 0; k < bursts; k++) b.s.emit('shotHit', {
            targetId: target.id, dmg: profile.dmg,
            weapon: action.weapon,
            fromPos,
          });
          else b.s.emit('shotFired', buildMissShot(b, target));
          if (action.type === 'shoot') {
            b.ammo -= bursts;
            if (b.ammo <= 0) { b.weapon = 'FACA'; b.ammo = Infinity; }
          }
        }
      }
    }
  }, 100);

  /* watchdog: servidor caiu → bots saem sozinhos (sem processos órfãos) */
  setTimeout(() => {
    setInterval(() => {
      if (bots.every(x => x.s.disconnected)) {
        console.log('[bots] servidor fora do ar — encerrando');
        process.exit(0);
      }
    }, 4000);
  }, 12000);

  console.log(`${N} bots conectando em ${URL} — inicie a partida pelo lobby (você é o anfitrião).`);
  console.log('Obs.: bots atiram entre si; quem atirar NELES tira vida deles de verdade.');
}

if (require.main === module) {
  const n = Math.max(1, parseInt(process.argv[2], 10) || 8);
  const url = process.argv[3] || 'http://localhost:3000';
  startBots(n, url);
}

module.exports = {
  startBots, selectTarget, isPointInGas, chooseWaypoint, movementYaw, combatFacingYaw, observePlayerUpdate,
  applyLoot, chooseCombatAction,
  createBotTerrain, createBotChestSpots, resetBotForMatch, canAttemptAttack, buildMissShot, dropLootOnce,
};
