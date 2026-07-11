/* ================================================================
   STRESS — enxame de bots jogando uma partida BR completa.
   Uso: node test/stress.js [nBots=30] [--client]
     --client: adiciona um jogador REAL (Chrome headless) no meio
   Mede: RTT (p50/p95/max), RSS do servidor, taxa de mensagens,
   duração da partida. Verifica invariantes: 1 matchEnd, vencedor
   coerente, colocações únicas, zero erros de socket.
   ================================================================ */
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { io } = require('socket.io-client');
const { zoneAt } = require(path.join(__dirname, '..', 'server.js'));

const N = Math.max(2, parseInt(process.argv[2], 10) || 30);
const WITH_CLIENT = process.argv.includes('--client');
const PORT = 3197;
const URL = `http://localhost:${PORT}`;

const shipPos = (t, plan) => {
  const sp = plan.ship;
  const k = Math.min(Math.max(t / sp.flyTime, 0), 1.18);
  return [sp.from[0] + (sp.to[0] - sp.from[0]) * k, sp.alt,
    sp.from[1] + (sp.to[1] - sp.from[1]) * k];
};
const pct = (arr, p) => arr.length ? arr.slice().sort((a, b) => a - b)[Math.floor(arr.length * p)] : 0;

(async () => {
  console.log(`== STRESS: ${N} bots${WITH_CLIENT ? ' + 1 cliente real' : ''} ==`);
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), HOST_CODE: 'STRESS', COUNTDOWN_S: '2',
      FLY_TIME: '8', BR_FAST: '1', NEXT_IN_S: '60', WORLD_SEED: '99' },
    stdio: 'ignore',
  });
  await new Promise(r => setTimeout(r, 900));

  /* ---------- estado global do teste ---------- */
  const bots = [];
  const problems = [];
  const rtts = [];
  let plan = null, t0 = 0, matchEnds = 0, endData = null, killsFeed = 0;
  let msgsIn = 0; // mensagens recebidas por todos os bots (carga de broadcast)

  const mkBot = (i) => new Promise(resolve => {
    const s = io(URL, { transports: ['websocket'] });
    const b = {
      i, s, id: null, alive: false, hp: 100, phase: 'LOBBY',
      x: 0, y: 0, z: 0, jumpAt: 8 * (0.25 + 0.7 * Math.random()),
      landed: false, afk: Math.random() < 0.05,          // 5% travam (aba oculta)
      quitAt: Math.random() < 0.10 ? 15 + Math.random() * 25 : 0, // 10% caem no meio
      wp: null, lastShot: 0, diedSent: false,
    };
    s.on('connect_error', e => problems.push(`bot${i} connect_error ${e.message}`));
    s.on('init', d => { b.id = d.id; resolve(b); });
    s.onAny(() => { msgsIn++; });
    s.on('matchStart', d => {
      plan = d.plan; t0 = d.t0;
      b.alive = true; b.hp = 100; b.phase = 'SHIP'; b.landed = false; b.diedSent = false;
    });
    s.on('youWereHit', d => {
      if (!b.alive || b.diedSent) return;
      b.hp -= d.dmg;
      if (b.hp <= 0) {
        b.diedSent = true; b.alive = false;
        s.emit('deathDrop', { pos: [b.x, b.y, b.z], items: [{ type: 'ammo', amount: 60 }, { type: 'armor', amount: 50 }] });
        s.emit('died', { killerId: d.shooterId, weapon: d.weapon });
      }
    });
    s.on('playerKilled', d => {
      if (d.victimId === b.id) { b.alive = false; b.diedSent = true; }
    });
    bots.push(b);
  });

  for (let i = 0; i < N; i++) await mkBot(i);
  for (const b of bots) b.s.emit('hello', { nick: 'Bot' + b.i });
  console.log(`${N} bots conectados`);

  /* host começa */
  const started = new Promise(r => bots[0].s.once('matchStart', r));
  await new Promise(r => bots[0].s.timeout(3000).emit('claimHost', { code: 'STRESS' }, r));
  bots[0].s.emit('requestStart');
  await started;

  /* monitor de RTT e eventos globais (entra DEPOIS do início: espectador) */
  const mon = io(URL, { transports: ['websocket'] });
  mon.on('matchEnd', d => { matchEnds++; endData = d; });
  mon.on('playerKilled', () => { killsFeed++; });
  const monIv = setInterval(() => {
    const t = performance.now();
    mon.timeout(5000).emit('pingx', err => { if (!err) rtts.push(performance.now() - t); });
  }, 400);

  /* ---------- loop dos bots (10 Hz) ---------- */
  const step = setInterval(() => {
    if (!plan) return;
    const t = (Date.now() - t0) / 1000;
    const zone = zoneAt(Math.max(t, 0), plan);
    for (const b of bots) {
      if (!b.alive || b.afk && b.landed) continue;
      if (b.quitAt && t > b.quitAt && b.s.connected) { b.s.disconnect(); b.alive = false; continue; }
      if (b.phase === 'SHIP') {
        const sp = shipPos(t, plan);
        [b.x, b.y, b.z] = sp;
        if (t >= b.jumpAt) { b.phase = 'FALL'; }
        b.s.volatile.emit('state', { pos: [b.x, b.y, b.z], rotY: 0, ship: true, car: -1 });
      } else if (b.phase === 'FALL') {
        b.y = Math.max(4, b.y - 4.4); // ~44 m/s
        if (b.y <= 4) { b.phase = 'PLAY'; b.landed = true; }
        b.s.volatile.emit('state', { pos: [b.x, b.y, b.z], rotY: 0, chute: true, car: -1 });
      } else {
        // anda a ~5 m/s pra um waypoint dentro da zona atual
        if (!b.wp || Math.hypot(b.x - b.wp[0], b.z - b.wp[1]) < 3) {
          const a = Math.random() * Math.PI * 2, r = Math.random() * Math.max(10, zone.r * 0.8);
          b.wp = [zone.x + Math.cos(a) * r, zone.z + Math.sin(a) * r];
        }
        const dx = b.wp[0] - b.x, dz = b.wp[1] - b.z, d = Math.hypot(dx, dz) || 1;
        b.x += (dx / d) * 0.5; b.z += (dz / d) * 0.5;
        b.s.volatile.emit('state', { pos: [b.x, b.y, b.z], rotY: 0, car: -1 });
        // combate: rajada a cada ~600ms num alvo vivo aleatório
        if (t - b.lastShot > 0.5 + Math.random() * 0.4) {
          b.lastShot = t;
          const vivos = bots.filter(o => o.alive && o !== b && o.s.connected);
          const alvo = vivos[Math.floor(Math.random() * vivos.length)];
          if (alvo) for (let k = 0; k < 3; k++)
            b.s.emit('shotHit', { targetId: alvo.id, dmg: 18, weapon: 'FUZIL', fromPos: [b.x, b.y + 1.5, b.z] });
        }
        if (Math.random() < 0.002) b.s.emit('openChest', { key: 'c' + Math.floor(Math.random() * 34) }, () => {});
        if (Math.random() < 0.002) b.s.emit('bossHit', { dmg: 100 });
        if (Math.random() < 0.001) b.s.emit('chat', { msg: 'gg bot ' + b.i });
      }
    }
  }, 100);

  /* ---------- cliente real opcional ---------- */
  let clientReport = null;
  if (WITH_CLIENT) {
    const CHROME = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'].find(p => fs.existsSync(p));
    const puppeteer = require('puppeteer-core');
    const browser = await puppeteer.launch({
      executablePath: CHROME, headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
        '--use-gl=angle', '--use-angle=swiftshader', '--mute-audio'],
    });
    const page = await browser.newPage();
    const pageErrs = [];
    page.on('pageerror', e => pageErrs.push(e.message));
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('!!window.__game && !!window.__BR_debug', { timeout: 60000 });
    // espera a partida (bots já começaram) e mede 15s de rAF real
    clientReport = await page.evaluate(async () => {
      const t0 = performance.now();
      while (!window.__BR_debug.S.plan && performance.now() - t0 < 30000)
        await new Promise(r => setTimeout(r, 300));
      if (window.__BR_debug.S.phase === 'SHIP') window.__BR_debug.jump();
      await new Promise(r => setTimeout(r, 3000));
      // FPS LÓGICO: render vira no-op (headless usa GL por software, que
      // distorceria a medida) — sobra tick + física + interpolação dos remotos
      window.__MP.composer.render = () => {};
      let frames = 0;
      const fim = performance.now() + 15000;
      await new Promise(res => {
        (function loop() { frames++; if (performance.now() < fim) requestAnimationFrame(loop); else res(); })();
      });
      return {
        fpsLogico: +(frames / 15).toFixed(1),
        remotos: window.__BR_debug.remotes.size,
        errs: window.__game.errors.map(e => String(e && e.message || e)),
        heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
        gpuMem: window.__MP.renderer.info.memory,
      };
    });
    clientReport.pageErrs = pageErrs;
    await browser.close();
  }

  /* ---------- espera o fim ---------- */
  const deadline = Date.now() + 180000;
  while (matchEnds === 0 && Date.now() < deadline) await new Promise(r => setTimeout(r, 500));
  clearInterval(step); clearInterval(monIv);

  const rssKB = (() => {
    try { return +fs.readFileSync(`/proc/${srv.pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/)[1]; }
    catch (e) { return 0; }
  })();

  /* ---------- invariantes ---------- */
  if (matchEnds !== 1) problems.push(`matchEnd disparou ${matchEnds}x (esperado 1)`);
  if (endData) {
    const places = endData.ranking.map(r => r.placement);
    if (new Set(places).size !== places.length) problems.push('colocações duplicadas no ranking');
    const vivos = bots.filter(b => b.alive && b.s.connected);
    if (endData.winner && vivos.length && !vivos.some(b => b.id === endData.winner.id))
      problems.push('vencedor não está entre os vivos');
  }
  try { srv.kill(0); } catch (e) { problems.push('SERVIDOR MORREU durante o teste'); }

  console.log('--- métricas ---');
  console.log(`partida: ${matchEnds ? 'terminou' : 'NÃO TERMINOU EM 180s'} · vencedor: ${endData && endData.winner ? endData.winner.nick : '(ninguém)'}`);
  console.log(`kills no feed: ${killsFeed} · ranking: ${endData ? endData.ranking.length : 0} entradas`);
  console.log(`RTT ms: p50=${pct(rtts, 0.5).toFixed(1)} p95=${pct(rtts, 0.95).toFixed(1)} max=${Math.max(0, ...rtts).toFixed(1)} (${rtts.length} amostras)`);
  console.log(`servidor RSS: ${(rssKB / 1024).toFixed(1)} MB · mensagens recebidas pelos bots: ${msgsIn}`);
  if (clientReport) console.log('cliente real:', JSON.stringify(clientReport));
  if (pct(rtts, 0.95) > 250) problems.push(`RTT p95 alto: ${pct(rtts, 0.95).toFixed(0)}ms`);
  if (clientReport && clientReport.errs.length) problems.push('erros no cliente: ' + clientReport.errs.join(' | '));
  if (clientReport && clientReport.pageErrs.length) problems.push('pageerrors: ' + clientReport.pageErrs.join(' | '));

  for (const b of bots) b.s.close();
  mon.close();
  srv.kill();

  if (problems.length) {
    console.log('--- PROBLEMAS ---');
    for (const p of problems) console.log('✗', p);
    process.exit(1);
  }
  console.log('STRESS OK — nenhum problema detectado');
  process.exit(0);
})().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
