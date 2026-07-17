/* Investigação: 5 players numa partida real (1 navegador + 4 bots), navegador
   jogando em autopilot. Captura TODO o console do browser (erros/avisos/logs),
   pageerror, requestfailed, window.__game.errors, e snapshots periódicos de
   memória (heap JS + geometrias/texturas/programas do three) pra detectar leak.
   Uso: node scripts/investigate-5players.js [porta] [segundos] */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const puppeteer = require('puppeteer-core');
const { io } = require('socket.io-client');

const CHROME = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
  process.env.CHROME_PATH || ''].find(p => p && fs.existsSync(p));
const PORT = +(process.argv[2] || 3300);
const SECONDS = +(process.argv[3] || 150);

(async () => {
  if (!CHROME) throw new Error('Chrome local não encontrado');
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), WORLD_SEED: '424242', HOST_CODE: 'QUEDALIVRE',
      COUNTDOWN_S: '2', FLY_TIME: '6', GAS_DEFAULT: 'classica' }, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 900));

  // ---------- captura de console do navegador ----------
  const logs = [];          // {type, text}
  const pageErrors = [];
  const reqFailed = [];
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
      '--use-gl=angle', '--use-angle=swiftshader', '--mute-audio', '--window-size=1024,600',
      '--js-flags=--expose-gc'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1024, height: 600, deviceScaleFactor: 1 });
  page.on('console', m => logs.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', e => pageErrors.push(String(e && e.stack || e)));
  page.on('requestfailed', r => {
    const u = r.url();
    if (!u.startsWith('data:')) reqFailed.push(`${r.failure() ? r.failure().errorText : '?'} ${u}`);
  });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__game && window.__MP && window.__BR_debug', { timeout: 60000, polling: 250 });
  await page.evaluate(() => { window.__MP_active = true; window.__MP_respawn = () => {}; });

  // ---------- host bot: reivindica host, liga 4 bots, inicia ----------
  const host = io(`http://localhost:${PORT}`, { transports: ['websocket'] });
  await new Promise((res, rej) => { host.on('connect', res); host.on('connect_error', rej); });
  host.emit('hello', { nick: 'BotHost' });
  await new Promise((res, rej) => host.timeout(4000).emit('claimHost', { code: 'QUEDALIVRE' },
    (e, d) => (e || !d || !d.ok) ? rej(new Error('claimHost falhou')) : res()));
  host.emit('setFlags', { bots: 4 });                 // 4 bots + 1 navegador = 5 players
  await new Promise(r => setTimeout(r, 400));
  host.emit('requestStart');

  // ---------- navegador entra em PLAY e joga (autopilot) ----------
  await page.waitForFunction('window.__BR_debug && !!window.__BR_debug.S.plan', { timeout: 30000 });
  await page.evaluate(() => {
    const MP = window.__MP, S = window.__BR_debug.S;
    S.phase = 'PLAY'; window.__BR_freeze = false;
    const P = MP.player;
    P.pos.set(-20, MP.groundAt(-20, 20, 999), 20); P.vel.set(0, 0, 0);
    P.dead = false; P.health = P.maxHealth;
    // autopilot: anda, gira a câmera e atira em rajadas; respawna se morrer
    let yaw = 0;
    window.__AUTOPILOT = setInterval(() => {
      const g = window.__game, mp = window.__MP;
      if (mp.player.dead) { mp.player.dead = false; mp.player.health = mp.player.maxHealth;
        mp.player.pos.set((Math.random() - 0.5) * 120, 40, (Math.random() - 0.5) * 120); return; }
      yaw += (Math.random() - 0.5) * 0.5;
      mp.camera.rotation.set(0, yaw, 0);
      const k = g.keys; for (const key in k) k[key] = false;
      k['KeyW'] = true; if (Math.random() < 0.3) k[Math.random() < 0.5 ? 'KeyA' : 'KeyD'] = true;
      if (Math.random() < 0.15) k['Space'] = true;
      g.mouse.shooting = Math.random() < 0.5;
    }, 200);
  });

  // ---------- snapshots periódicos (detecção de leak) ----------
  const snaps = [];
  const snap = async (t) => {
    const met = await page.metrics();
    const info = await page.evaluate(() => {
      const MP = window.__MP, G = window.__game;
      const mem = MP.renderer.info.memory, r = MP.renderer.info.render;
      return { geometries: mem.geometries, textures: mem.textures,
        programs: MP.renderer.info.programs ? MP.renderer.info.programs.length : -1,
        calls: r.calls, triangles: r.triangles,
        errors: (G.errors || []).length,
        remotes: (window.__MP_remotePlayers || []).length,
        listeners: 0 };
    });
    snaps.push({ t, heapMB: +(met.JSHeapUsedSize / 1048576).toFixed(1),
      nodes: met.Nodes, listeners: met.JSEventListeners, ...info });
    console.log(`t=${t}s heap=${snaps[snaps.length - 1].heapMB}MB geo=${info.geometries} tex=${info.textures} prog=${info.programs} evL=${met.JSEventListeners} nodes=${met.Nodes} errs=${info.errors} remotos=${info.remotes}`);
  };

  const t0 = Date.now();
  await snap(0);
  while ((Date.now() - t0) / 1000 < SECONDS) {
    await new Promise(r => setTimeout(r, 15000));
    await snap(Math.round((Date.now() - t0) / 1000));
  }

  // ---------- __game.errors detalhado ----------
  const gameErrors = await page.evaluate(() => (window.__game.errors || []).slice(0, 40).map(String));

  // ---------- agregação do console ----------
  const agg = {};
  for (const l of logs) {
    const key = `[${l.type}] ` + l.text.replace(/\d+\.\d+/g, 'N').replace(/\b\d+\b/g, 'N').slice(0, 160);
    agg[key] = (agg[key] || 0) + 1;
  }
  const byType = {}; for (const l of logs) byType[l.type] = (byType[l.type] || 0) + 1;

  console.log('\n================ RELATÓRIO ================');
  console.log('console por tipo:', JSON.stringify(byType));
  console.log(`pageerror: ${pageErrors.length} | requestfailed: ${reqFailed.length} | __game.errors: ${gameErrors.length}`);
  const s0 = snaps[0], sN = snaps[snaps.length - 1];
  console.log('\n--- LEAK (primeiro → último snapshot) ---');
  console.log(`heap:      ${s0.heapMB} → ${sN.heapMB} MB   (Δ ${(sN.heapMB - s0.heapMB).toFixed(1)})`);
  console.log(`geometrias:${s0.geometries} → ${sN.geometries}   texturas:${s0.textures} → ${sN.textures}   programas:${s0.programs} → ${sN.programs}`);
  console.log(`listeners: ${s0.listeners} → ${sN.listeners}   nodes:${s0.nodes} → ${sN.nodes}   __game.errors:${s0.errors} → ${sN.errors}`);

  console.log('\n--- console agregado (top 30, contagem × mensagem normalizada) ---');
  Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 30)
    .forEach(([k, n]) => console.log(`  ${String(n).padStart(5)} × ${k}`));

  if (pageErrors.length) { console.log('\n--- PAGEERRORS (top 8) ---'); pageErrors.slice(0, 8).forEach(e => console.log('  ' + e.split('\n')[0])); }
  if (reqFailed.length) { console.log('\n--- REQUESTS FALHOS (top 8) ---'); reqFailed.slice(0, 8).forEach(e => console.log('  ' + e)); }
  if (gameErrors.length) { console.log('\n--- __game.errors (top 12) ---'); gameErrors.slice(0, 12).forEach(e => console.log('  ' + e)); }

  await browser.close();
  host.close();
  srv.kill();
  process.exit(0);
})().catch(e => { console.error('ERRO', e); process.exit(1); });
