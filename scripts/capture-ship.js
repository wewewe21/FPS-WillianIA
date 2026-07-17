/* Testes VISUAIS da nave de entrada remodelada: interior (reto, teto, piso/
   janela, parede/console, multiplayer), exterior (lateral, por baixo — a visão
   de quem cai — e cúpula), duas resoluções e duas rotas (seeds). Sobe o próprio
   servidor, inicia uma partida BR real (host bot) e CONGELA S.matchT() pra nave
   ficar parada durante cada screenshot; state.cinematic libera a câmera.
   Uso: node scripts/capture-ship.js [porta]
   Screenshots em output/ship/NN-nome.png */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const puppeteer = require('puppeteer-core');
const { io } = require('socket.io-client');
const ShipProto = require('../ship-protocol.js');

const CHROME = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
  process.env.CHROME_PATH || ''].find(p => p && fs.existsSync(p));
const PORT = +(process.argv[2] || 3227);
const output = path.join(__dirname, '..', 'output', 'ship');
const F = ShipProto.DIMS.floorY;

async function bootMatch(port, seed) {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port), WORLD_SEED: String(seed), COUNTDOWN_S: '1',
      FLY_TIME: '300', NEXT_IN_S: '600', RANK_FILE: path.join(require('node:os').tmpdir(), `capture-ship-rank-${port}.json`) },
    stdio: 'ignore',
  });
  await new Promise(r => setTimeout(r, 900));
  const host = io(`http://localhost:${port}`, { transports: ['websocket'] });
  await new Promise(r => host.once('init', r));
  host.emit('hello', { nick: 'HostCam' });
  await new Promise((res, rej) => host.timeout(4000).emit('claimHost', { code: 'QUEDALIVRE' },
    (e, d) => (e || !d || !d.ok) ? rej(new Error('claimHost falhou')) : res()));
  host.emit('setFlags', { cidade: false, ciclo: 'dia', golem: false, animais: false });
  return { srv, host };
}

(async () => {
  if (!CHROME) throw new Error('Chrome local não encontrado');
  fs.mkdirSync(output, { recursive: true });
  const errors = [];
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
      '--use-gl=angle', '--use-angle=swiftshader', '--mute-audio', '--window-size=1280,720'],
  });
  let shotN = 0;
  const runSeed = async (port, seed, tag, full) => {
    const { srv, host } = await bootMatch(port, seed);
    const peers = [];
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
      page.on('pageerror', e => errors.push(String(e)));
      await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction('window.__game && window.__MP && window.__BR_debug', { timeout: 60000, polling: 250 });

      // 3 "jogadores" reais nos slots (avatares remotos na cabine)
      let plan = null;
      const gotPlan = new Promise(r => host.once('matchStart', d => r(d.plan)));
      for (let i = 0; i < 3; i++) {
        const s = io(`http://localhost:${port}`, { transports: ['websocket'] });
        await new Promise(r => s.once('init', d => { s.__id = d.id; r(); }));
        s.emit('hello', { nick: 'Tripulante' + (i + 1) });
        peers.push(s);
      }
      host.emit('requestStart');
      plan = await gotPlan;
      await page.waitForFunction(
        'window.__BR_debug.S.phase === "SHIP" && !!window.__BR_debug.shipDebug.local', { timeout: 30000, polling: 250 });
      const sendPeers = setInterval(() => {
        for (const s of peers) {
          const sl = ShipProto.slotLocal(plan.shipSlots[s.__id] ?? 9);
          s.volatile.emit('state', { pos: [0, 0, 0], rotY: Math.PI / 3, ship: true,
            shipLocal: [sl[0], F, sl[1]], heldWeapon: 'FACA', car: -1 });
        }
      }, 100);

      // congela o relógio da partida: nave parada, câmera livre (cinematic)
      await page.evaluate(() => {
        const dbg = window.__BR_debug, MP = window.QA ? window.QA.MP : window.__MP;
        window.__BR_shipManual = true;
        dbg.S.matchT = () => 40;
        MP.state.cinematic = true;
      });
      await new Promise(r => setTimeout(r, 1500)); // remotos convergem, clima assenta

      const camLocal = async (eyeL, lookL) => page.evaluate((eye, look) => {
        const dbg = window.__BR_debug, MP = window.__MP, proto = dbg.shipDebug.proto;
        const g = dbg.ship.g;
        const pose = { x: g.position.x, y: g.position.y, z: g.position.z, yaw: g.rotation.y };
        const e = proto.localToWorld(pose, eye), l = proto.localToWorld(pose, look);
        MP.camera.position.set(e[0], e[1], e[2]);
        MP.camera.lookAt(l[0], l[1], l[2]);
      }, eyeL, lookL);
      const shot = async name => {
        await new Promise(r => setTimeout(r, 400));
        shotN++;
        const file = path.join(output, `${String(shotN).padStart(2, '0')}-${tag}-${name}.png`);
        await page.screenshot({ path: file });
        console.log('  📸', path.basename(file));
      };
      const eyeY = F + 1.62;

      if (full) {
        await camLocal([0, eyeY, -8.5], [0, F + 1.0, 8]); await shot('interior-visao-geral');
        await camLocal([3, eyeY, 3], [3, ShipProto.DIMS.ceilingY + 4, 3.01]); await shot('interior-teto');
        await camLocal([1.2, eyeY, 0], [0, F - 6, 0]); await shot('interior-piso-janela');
        const c0 = ShipProto.CONSOLES[0];
        await camLocal([Math.cos(c0.ang) * 7, eyeY, Math.sin(c0.ang) * 7],
          [Math.cos(c0.ang) * 13, F + 1.0, Math.sin(c0.ang) * 13]); await shot('interior-parede-console');
        await camLocal([-9, eyeY, 4], [5, F + 0.8, -2]); await shot('interior-multiplayer');
        await page.setViewport({ width: 800, height: 600, deviceScaleFactor: 1 });
        await camLocal([0, eyeY, -8.5], [0, F + 1.0, 8]); await shot('interior-800x600');
        await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
        await camLocal([0, eyeY, -8.5], [0, F + 1.0, 8]); await shot('interior-1920x1080');
        await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
        await camLocal([55, 12, 55], [0, 0, 0]); await shot('exterior-lateral');
        await camLocal([12, -55, 12], [0, 0, 0]); await shot('exterior-por-baixo');
        await camLocal([28, 26, 28], [0, 2, 0]); await shot('exterior-cupula');
      } else {
        await camLocal([0, eyeY, -8.5], [0, F + 1.0, 8]); await shot('interior');
        await camLocal([55, 12, 55], [0, 0, 0]); await shot('exterior');
      }
      clearInterval(sendPeers);
      await page.close();
    } finally {
      for (const s of peers) s.close();
      host.close();
      srv.kill();
    }
  };

  try {
    await runSeed(PORT, 424242, 'rota1', true);
    await runSeed(PORT + 1, 777, 'rota2', false);
  } finally {
    await browser.close();
  }
  if (errors.length) { console.error('pageerrors:', errors); process.exit(1); }
  console.log('OK — screenshots em output/ship/');
  process.exit(0);
})();
