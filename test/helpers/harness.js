/* Harness compartilhado dos testes de jogabilidade/colisão:
   sobe servidor com seed fixa + Chrome headless, injeta window.QA
   (tick manual determinístico, reset, mira) e devolve play(). */
'use strict';
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');

const CHROME = [
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
  // Windows (máquina do Willian): mesmos testes, mesmo Chrome headless
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.CHROME_PATH || '',
].find(p => p && fs.existsSync(p));

async function bootGame({ port, serverPort, worldSeed = '424242', extraEnv = {} }) {
  const puppeteer = require('puppeteer-core');
  const ownsRankFile = !extraEnv.RANK_FILE;
  const rankFile = extraEnv.RANK_FILE || path.join(os.tmpdir(), `fps-browser-rank-${process.pid}-${port}.json`);
  const srv = spawn(process.execPath, [path.join(__dirname, '..', '..', 'server.js')], {
    env: {
      ...process.env, PORT: String(serverPort || port), WORLD_SEED: worldSeed,
      RANK_FILE: rankFile, SOCKET_PING_TIMEOUT_MS: '120000', ...extraEnv,
    },
    stdio: 'ignore',
  });
  await new Promise(r => setTimeout(r, 800));
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
      '--use-gl=angle', '--use-angle=swiftshader', '--mute-audio', '--window-size=800,600'],
  });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', e => { pageErrors.push(e.message); console.error('  [pageerror]', e.message); });
  // O runner pode bloquear o event loop por segundos ao avançar centenas de
  // ticks. Isso força reconnect/nextMatch, que em produção recarrega por
  // segurança; no QA destruiria window.QA no meio da suíte.
  await page.evaluateOnNewDocument(() => { window.__QA_DISABLE_RELOAD = true; });
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });
  /* __game/__MP aparecem antes de multiplayer-client terminar o boot. Se o
     transporte reconectar nessa janela, o jogo recarrega de propósito para
     não duplicar o avatar. Só injeta QA depois do BR pronto e de um intervalo
     estável no mesmo documento. */
  let stable = false;
  for (let attempt = 0; attempt < 4 && !stable; attempt++) {
    await page.waitForFunction(
      '!!window.__game && !!window.__MP && !!window.__BR_debug && window.__MP.socket?.connected',
      { timeout: 60000 },
    );
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    await new Promise(resolve => setTimeout(resolve, 700));
    try { stable = timeOrigin === await page.evaluate(() => performance.timeOrigin); }
    catch { stable = false; }
  }
  if (!stable) throw new Error('página do jogo não estabilizou após reconexão');
  await page.evaluate(() => {
    const G = window.__game, MP = window.__MP;
    // morte no solo agenda location.reload — no QA o respawn é neutralizado
    window.__MP_active = true;
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
    browser, page, srv, port, pageErrors,
    play: (fn, ...args) => page.evaluate(fn, ...args),
    async close() {
      if (browser) await browser.close();
      if (srv && srv.exitCode === null) {
        await new Promise(resolve => {
          const timer = setTimeout(resolve, 1000);
          srv.once('exit', () => { clearTimeout(timer); resolve(); });
          srv.kill();
        });
      }
      if (ownsRankFile) {
        try { fs.rmSync(rankFile, { force: true }); } catch { /* temporário já removido */ }
      }
    },
  };
}

/* inicia uma partida BR de verdade: bot-host conecta, dá o código e inicia;
   a página entra na partida e é jogada direto pro chão em fase PLAY */
async function startBRMatch(h, { hostCode = 'QUEDALIVRE', serverPort } = {}) {
  const { io } = require('socket.io-client');
  const bot = io(`http://localhost:${serverPort || h.port}`, { transports: ['websocket'] });
  await new Promise(r => bot.once('init', r));
  bot.emit('hello', { nick: 'BotHost' });
  await new Promise((res, rej) => bot.timeout(4000).emit('claimHost', { code: hostCode },
    (e, d) => (e || !d || !d.ok) ? rej(new Error('claimHost falhou')) : res()));
  bot.emit('requestStart');
  await h.page.waitForFunction('window.__BR_debug && !!window.__BR_debug.S.plan', { timeout: 30000 });
  await h.play(() => {
    const S = window.__BR_debug.S;
    S.phase = 'PLAY';           // pula nave/queda: direto pro chão
    window.__BR_freeze = false;
    window.QA.reset(30, 30);
  });
  return bot; // fica vivo na partida — quem chamou fecha com bot.close()
}

module.exports = { CHROME, bootGame, startBRMatch };
