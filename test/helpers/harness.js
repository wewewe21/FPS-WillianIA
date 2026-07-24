/* Harness compartilhado dos testes de jogabilidade/colisão:
   sobe servidor com seed fixa + Chrome headless, injeta window.QA
   (tick manual determinístico, reset, mira) e devolve play(). */
'use strict';
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const os = require('node:os');
const path = require('node:path');

const CHROME = [
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
  // Windows (máquina do Willian): mesmos testes, mesmo Chrome headless
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.CHROME_PATH || '',
].find(p => p && fs.existsSync(p));

async function waitForServer(srv, port, bootToken, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (srv.exitCode !== null)
      throw new Error(`servidor de QA encerrou antes do boot (exit ${srv.exitCode})`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      const body = await response.text();
      if (response.status === 200 &&
          response.headers.get('x-qa-boot-token') === bootToken &&
          body.includes('<canvas id="game"></canvas>')) {
        if (srv.exitCode !== null)
          throw new Error(`servidor de QA encerrou durante o boot (exit ${srv.exitCode})`);
        return;
      }
      lastError = new Error(`resposta inesperada HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`servidor de QA não respondeu na porta ${port}: ${lastError || 'timeout'}`);
}

function waitForSocketEvent(socket, event, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.off(event, onEvent);
      socket.off('connect_error', onError);
      if (error) reject(error);
      else resolve(value);
    };
    const onEvent = value => finish(null, value);
    const onError = error => finish(error instanceof Error ? error : new Error(String(error)));
    const timer = setTimeout(
      () => finish(new Error(`socket não recebeu '${event}' em ${timeoutMs}ms`)),
      timeoutMs,
    );
    socket.once(event, onEvent);
    socket.once('connect_error', onError);
  });
}

async function stopServer(srv) {
  if (!srv || srv.exitCode !== null) return;
  await new Promise(resolve => {
    let finished = false;
    let forceTimer, giveUpTimer;
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(forceTimer);
      clearTimeout(giveUpTimer);
      srv.off('exit', done);
      resolve();
    };
    forceTimer = setTimeout(() => {
      if (srv.exitCode === null) srv.kill('SIGKILL');
    }, 1500);
    giveUpTimer = setTimeout(done, 3000);
    srv.once('exit', done);
    srv.kill();
  });
}

async function bootGame({
  port,
  serverPort,
  worldSeed = '424242',
  extraEnv = {},
  blockRequests = [],
  delayRequests = [],
}) {
  const puppeteer = require('puppeteer-core');
  const rankFile = extraEnv.RANK_FILE || path.join(os.tmpdir(),
    `fps-harness-rank-${process.pid}-${serverPort || port}-${Date.now()}.json`);
  const bootToken = randomUUID();
  const removeRankFile = !extraEnv.RANK_FILE;
  const srv = spawn(process.execPath, [path.join(__dirname, '..', '..', 'server.js')], {
    // GAS_DEFAULT clássico: testes determinísticos (o 'auto' de produção sorteia
    // modo por partida; os modos novos têm testes dedicados que setam a flag)
    env: { ...process.env, PORT: String(serverPort || port), WORLD_SEED: worldSeed,
      GAS_DEFAULT: 'classica', RANK_FILE: rankFile, QA_BOOT_TOKEN: bootToken, ...extraEnv },
    stdio: 'ignore',
  });
  let browser = null;
  let closed = false;
  try {
    await waitForServer(srv, serverPort || port, bootToken);
    browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
      '--use-gl=angle', '--use-angle=swiftshader', '--mute-audio', '--window-size=800,600'],
    });
    const page = await browser.newPage();
    // A flag existe antes do primeiro tick: sob máquina carregada, uma morte
    // no boot não pode agendar location.reload e destruir o contexto do QA.
    await page.evaluateOnNewDocument(() => {
      window.__MP_active = true;
      window.__BR_active = true;
      window.__MP_respawn = () => {};
    });
  const pageErrors = [];
  const consoleErrors = [];
  const requestFailures = [];
  page.on('pageerror', e => { pageErrors.push(e.message); console.error('  [pageerror]', e.message); });
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', request => {
    requestFailures.push(`${request.url()} — ${request.failure()?.errorText || 'falha desconhecida'}`);
  });
  if (blockRequests.length || delayRequests.length) {
    await page.setRequestInterception(true);
    page.on('request', async request => {
      if (blockRequests.some(fragment => request.url().includes(fragment))) {
        await request.abort();
        return;
      }
      const delayed = delayRequests.find(item => request.url().includes(item.fragment));
      if (delayed) await new Promise(resolve => setTimeout(resolve, delayed.ms));
      await request.continue();
    });
  }
  await page.goto(`http://localhost:${port}/`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000,
  });
  await page.waitForFunction('!!window.__game && !!window.__MP', { timeout: 90000 });
    await page.evaluate(() => {
      const G = window.__game, MP = window.__MP;
      // Loops manuais longos podem bloquear o heartbeat do socket. Em
      // produção o reconnect recarrega a página de propósito; no QA removemos
      // só esse reload, preservando a reconexão necessária para o boot BR.
      if (MP.socket && MP.socket.io) {
        if (typeof MP.socket.io.off === 'function') MP.socket.io.off('reconnect');
        if (typeof MP.socket.io.reconnection === 'function') MP.socket.io.reconnection(true);
      }
      // morte no solo agenda location.reload — no QA o respawn é neutralizado
    window.__MP_active = true;
    window.__QA_originalRespawn = window.__MP_respawn;
    window.__MP_respawn = () => {};
    // IA fora do caminho: __BR_active desliga Enemies/Night/Boss no tick
    // (o hitscan continua acertando os bonecos parados) e os animais morrem
    window.__BR_active = true;
    // PERF do QA: mecânica não precisa de pixels — render vira no-op
    MP.composer.render = () => {};
    G.forceStart();
    for (const a of (G.Animals && G.Animals.list) || []) a.alive = false;
    window.QA = {
      G, MP,
      tick(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) G.tick(dt); },
      clearInput() {
        for (const k in G.keys) G.keys[k] = false;
        G.mouse.shooting = G.mouse.clicked = G.mouse.aiming = false;
        MP.justPressed.clear();
      },
      reset(x = 30, z = 30) {
        this.clearInput();
        const P = MP.player;
        const y = MP.groundAt(x, z, 999);
        P.pos.set(x, y, z);
        P.vel.set(0, 0, 0);
        P.onGround = true;
        P.dead = false;
        P.health = P.maxHealth;
        P.armor = 0;
        P.healPool = 0;
        P.lastDamageCause = null;
        P.lastDamageT = -Infinity;
        P.invulnUntil = 0;
        P.slideT = -1;
        MP.setTimeScale(1);
        if (G.state.driving || G.state.flying) G.tryToggleCar();
        MP.camera.position.set(P.pos.x, P.pos.y + 1.62, P.pos.z);
        MP.camera.rotation.set(0, 0, 0);
        this.tick(2); // assenta
      },
      aimAt(x, y, z) { window.QA.MP.camera.lookAt(x, y, z); },
      fwdDelta(before) { // deslocamento horizontal desde `before`
        const P = window.QA.MP.player.pos;
        return Math.hypot(P.x - before[0], P.z - before[1]);
      },
      pos() { const P = window.QA.MP.player.pos; return [P.x, P.z, P.y]; },
    };
  });

  return {
    browser, page, srv, port, pageErrors, consoleErrors, requestFailures,
    play: (fn, ...args) => page.evaluate(fn, ...args),
    async close() {
      if (closed) return;
      closed = true;
      let browserError = null;
      try {
        if (browser) await browser.close();
      } catch (error) {
        browserError = error;
      } finally {
        await stopServer(srv);
        if (removeRankFile) fs.rmSync(rankFile, { force: true });
      }
      if (browserError) throw browserError;
    },
  };
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    await stopServer(srv);
    if (removeRankFile) fs.rmSync(rankFile, { force: true });
    throw error;
  }
}

/* inicia uma partida BR de verdade: bot-host conecta, dá o código e inicia;
   a página entra na partida e é jogada direto pro chão em fase PLAY */
async function waitForBRClientReady(h) {
  // O socket pode conectar antes de br-game.js terminar o carregamento
  // dinâmico. Só iniciar a rodada depois que o listener de matchStart e o
  // estado de depuração forem publicados; caso contrário o evento se perde.
  await h.page.waitForFunction(
    'window.__BR_debug && window.__BR_debug.S && window.__BR_debug.S.phase === "LOBBY"' +
      ' && window.__MP_init && window.__MP && window.__MP.socket' +
      ' && window.__MP_init.id === window.__MP.socket.id',
    { timeout: 60000 },
  );
}

async function startBRMatch(h, { hostCode = 'QUEDALIVRE', serverPort } = {}) {
  const { io } = require('socket.io-client');
  let bot = null;
  try {
    await h.play(() => {
      const socket = window.__MP && window.__MP.socket;
      if (socket && !socket.connected) socket.connect();
    });
    await h.page.waitForFunction(
      'window.__MP && window.__MP.socket && window.__MP.socket.connected',
      { timeout: 15000 },
    );
    await waitForBRClientReady(h);
    bot = io(`http://localhost:${serverPort || h.port}`, { transports: ['websocket'] });
    await waitForSocketEvent(bot, 'init');
    bot.emit('hello', { nick: 'BotHost' });
    await new Promise((res, rej) => bot.timeout(4000).emit('claimHost', { code: hostCode },
      (e, d) => (e || !d || !d.ok) ? rej(new Error('claimHost falhou')) : res()));
    bot.emit('requestStart');
    await h.page.waitForFunction('window.__BR_debug && !!window.__BR_debug.S.plan', {
      timeout: 60000,
    });
    await h.play(() => {
      const S = window.__BR_debug.S;
      S.phase = 'PLAY';           // pula nave/queda: direto pro chão
      window.__BR_freeze = false;
      window.QA.reset(30, 30);
    });
    return bot; // fica vivo na partida — quem chamou fecha com bot.close()
  } catch (error) {
    if (bot) bot.close();
    throw error;
  }
}

/* inicia uma partida BR e PERMANECE na fase SHIP (não força PLAY).
   Use FLY_TIME alto no extraEnv do bootGame pra nave não acabar no meio
   do teste. Não mexe no startBRMatch acima: os testes legados dependem
   do pulo direto pro chão. */
async function startBRMatchInShip(h, { hostCode = 'QUEDALIVRE' } = {}) {
  const { io } = require('socket.io-client');
  let bot = null;
  try {
    await h.play(() => {
      const socket = window.__MP && window.__MP.socket;
      if (socket && !socket.connected) socket.connect();
    });
    await h.page.waitForFunction(
      'window.__MP && window.__MP.socket && window.__MP.socket.connected',
      { timeout: 15000 },
    );
    await waitForBRClientReady(h);
    bot = io(`http://localhost:${h.port}`, { transports: ['websocket'] });
    await waitForSocketEvent(bot, 'init');
    bot.emit('hello', { nick: 'BotHost' });
    await new Promise((res, rej) => bot.timeout(4000).emit('claimHost', { code: hostCode },
      (e, d) => (e || !d || !d.ok) ? rej(new Error('claimHost falhou')) : res()));
    bot.emit('requestStart');
    await h.page.waitForFunction(
      'window.__BR_debug && !!window.__BR_debug.S.plan && window.__BR_debug.S.phase === "SHIP"' +
      ' && !!window.__BR_debug.shipDebug.local',
      { timeout: 60000 });
    return bot;
  } catch (error) {
    if (bot) bot.close();
    throw error;
  }
}

module.exports = { CHROME, bootGame, startBRMatch, startBRMatchInShip };
