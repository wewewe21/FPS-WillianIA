/* Captura visual do MUNDO renovado: Guardião (inimigos), Visitante (alien),
   árvores GLB, mercado/refúgio e barris. Sobe o próprio servidor.
   Uso: node scripts/capture-world.js [porta] */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const puppeteer = require('puppeteer-core');

const CHROME = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.CHROME_PATH || ''].find(p => p && fs.existsSync(p));
const PORT = +(process.argv[2] || 3217);
const output = path.join(__dirname, '..', 'output', 'world');
const rankFile = path.join(os.tmpdir(), `fps-capture-world-rank-${process.pid}.json`);

async function waitForServer(srv, port, bootToken, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (srv.exitCode !== null)
      throw new Error(`servidor de captura encerrou antes do boot (exit ${srv.exitCode})`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      const body = await response.text();
      if (response.status === 200 &&
          response.headers.get('x-qa-boot-token') === bootToken &&
          body.includes('<canvas id="game"></canvas>')) {
        if (srv.exitCode !== null)
          throw new Error(`servidor de captura encerrou durante o boot (exit ${srv.exitCode})`);
        return;
      }
      lastError = new Error(`resposta inesperada HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(
    `servidor de captura não respondeu na porta ${port}: ${lastError || 'timeout'}`,
  );
}

async function stopServer(srv) {
  if (!srv || srv.exitCode !== null) return;
  await new Promise(resolve => {
    let finished = false;
    let forceTimer;
    let giveUpTimer;
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

async function withCaptureResources(run, options = {}) {
  const port = options.port ?? PORT;
  const chromePath = options.chromePath ?? CHROME;
  const targetRankFile = options.rankFile ?? rankFile;
  const bootToken = options.bootToken ?? randomUUID();
  const spawnImpl = options.spawnImpl ?? spawn;
  const waitForReady = options.waitForReady ?? waitForServer;
  const launchBrowser = options.launchBrowser ?? (settings => puppeteer.launch(settings));
  const stopServerImpl = options.stopServerImpl ?? stopServer;
  const srv = spawnImpl(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      WORLD_SEED: '424242',
      RANK_FILE: targetRankFile,
      QA_BOOT_TOKEN: bootToken,
    },
    stdio: 'ignore',
  });
  let browser = null;
  let primaryError = null;
  let result;
  try {
    await waitForReady(srv, port, bootToken);
    browser = await launchBrowser({
      executablePath: chromePath,
      headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
        '--use-gl=angle', '--use-angle=swiftshader', '--mute-audio', '--window-size=1280,720'],
    });
    result = await run(browser);
  } catch (error) {
    primaryError = error;
  }
  let cleanupError = null;
  if (browser) {
    try {
      await browser.close();
    } catch (error) {
      cleanupError = error;
    }
  }
  try {
    await stopServerImpl(srv);
  } catch (error) {
    cleanupError ||= error;
  }
  try {
    fs.rmSync(targetRankFile, { force: true });
  } catch (error) {
    cleanupError ||= error;
  }
  if (primaryError) throw primaryError;
  if (cleanupError) throw cleanupError;
  return result;
}

async function main() {
  if (!CHROME) throw new Error('Chrome local não encontrado');
  fs.mkdirSync(output, { recursive: true });
  const errors = [];
  await withCaptureResources(async browser => {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument(() => { window.requestAnimationFrame = () => 0; });
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => {
      if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text());
    });
    page.on('requestfailed', request => {
      const failure = request.failure();
      errors.push(`requestfailed ${request.url()}: ${failure ? failure.errorText : 'erro desconhecido'}`);
    });
    page.on('response', response => {
      if (response.status() >= 400)
        errors.push(`HTTP ${response.status()} ${response.url()}`);
    });
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('window.__game && window.__MP', { timeout: 60000, polling: 250 });
    const castleState = await page.evaluate(async () => {
      const G = window.__game;
      window.__MP_active = true; window.__MP_respawn = () => {};
      G.forceStart();
      G.Env.tod = 0.5; // meio-dia
      await Promise.all([
        G.Structures.castle.ready,
        new Promise(r => setTimeout(r, 5000)), // demais GLBs de mundo carregam
      ]);
      G.state.cinematic = true; // câmera manual
      const c = G.Structures.castle;
      return {
        status: c.status,
        modelRoot: !!c.modelRoot,
        modelVisible: !!c.modelRoot && c.modelRoot.visible,
        fallbackVisible: !!c.fallbackRoot && c.fallbackRoot.visible,
        meshes: c.modelMetrics && c.modelMetrics.meshes,
      };
    });
    if (castleState.status !== 'ready' || !castleState.modelRoot ||
        !castleState.modelVisible || castleState.fallbackVisible ||
        !Number.isFinite(castleState.meshes) || castleState.meshes < 1)
      throw new Error(`castelo GLB não ficou pronto: ${JSON.stringify(castleState)}`);
    await page.addStyleTag({ content: 'body > :not(#game) { display:none !important; }' });

    const shots = [
      { file: 'castelo-frente.png', target: 'castle-front' },
      { file: 'castelo-patio.png', target: 'castle-courtyard' },
      { file: 'castelo-rampa-fundacao.png', target: 'castle-ramp' },
      { file: 'guardiao-inimigo.png', target: 'enemy' },
      { file: 'visitante-alien.png', target: 'alien' },
      { file: 'floresta-arvores.png', target: 'forest' },
      { file: 'mercado-poi.png', target: 'mercado' },
      { file: 'refugio-poi.png', target: 'refúgio' },
      { file: 'castelo-keep-lateral.png', target: 'castle-keep' },
      { file: 'castelo-noite.png', target: 'castle-night' },
    ];
    for (const s of shots) {
      const report = await page.evaluate(target => {
        const G = window.__game, MP = window.__MP;
        const cam = (x, y, z, lx, ly, lz) => {
          MP.camera.position.set(x, y, z);
          MP.camera.lookAt(lx, ly, lz);
          MP.camera.updateMatrixWorld(true);
        };
        let info;
        if (target.startsWith('castle-')) {
          const c = G.Structures.castle;
          G.Env.tod = target === 'castle-night' ? 0 : 0.5;
          MP.player.pos.set(c.center.x, c.floorY, c.center.z);
          G.state.cinematic = false; G.tick(0.1); G.state.cinematic = true;
          if (target === 'castle-front')
            cam(c.center.x + 48, c.originY + 26, c.center.z + 55,
              c.center.x, c.originY + 6, c.center.z);
          else if (target === 'castle-courtyard')
            cam(c.center.x + 12, c.originY + 9, c.center.z + 13,
              c.center.x, c.originY + 4.5, c.center.z - 7);
          else if (target === 'castle-ramp')
            cam(c.center.x + 13, c.originY + 8, c.center.z + 33,
              c.center.x, c.floorY + 1, c.center.z + 20);
          else if (target === 'castle-keep')
            cam(c.center.x - 40, c.originY + 24, c.center.z - 44,
              c.center.x, c.originY + 8, c.center.z - 5);
          else
            cam(c.center.x + 48, c.originY + 22, c.center.z + 55,
              c.center.x, c.originY + 6, c.center.z);
          info = {
            status: c.status,
            originY: +c.originY.toFixed(2),
            floorY: +c.floorY.toFixed(2),
            rampaGraus: +c.ramp.slopeDegrees.toFixed(1),
            meshes: c.modelMetrics && c.modelMetrics.meshes,
          };
        } else if (target === 'enemy') {
          const e = G.Enemies.list.find(e => e.alive && e.hasModel) || G.Enemies.list[0];
          const p = e.group.position;
          G.tick(1 / 30); G.tick(1 / 30); // mixer anda um pouco
          cam(p.x + 3.4, MP.heightAt(p.x + 3.4, p.z + 3.4) + 1.7, p.z + 3.4, p.x, p.y + 1.2, p.z);
          info = { nome: e.name, temModelo: !!e.hasModel, vivo: e.alive };
        } else if (target === 'alien') {
          const a = G.Alien;
          const p = a.pos();
          cam(p.x + 4.5, MP.heightAt(p.x + 4.5, p.z + 4.5) + 2.4, p.z + 4.5, p.x, p.y + 2, p.z);
          info = { vivo: a.alive, site: a.SITE };
        } else if (target === 'forest') {
          // acha uma área de floresta e olha pra ela
          let fx = 120, fz = 120;
          for (let i = 0; i < 400; i++) {
            const x = (Math.random() * 2 - 1) * 400, z = (Math.random() * 2 - 1) * 400;
            if (G.biomeAt(x, z) > 0.4 && MP.heightAt(x, z) > 2) { fx = x; fz = z; break; }
          }
          // o LOD das árvores segue o JOGADOR: teleporta ele junto da câmera
          MP.player.pos.set(fx, MP.heightAt(fx, fz), fz);
          G.state.cinematic = false; G.tick(0.5); G.tick(0.5); G.state.cinematic = true;
          cam(fx + 24, MP.heightAt(fx + 24, fz + 24) + 8, fz + 24, fx, MP.heightAt(fx, fz) + 4, fz);
          info = { em: [fx | 0, fz | 0] };
        } else {
          const site = G.Structures.sites.find(s => s.type === target);
          if (!site) return { erro: 'site não existe: ' + target };
          cam(site.x + site.r + 6, MP.heightAt(site.x + site.r + 6, site.z + site.r + 6) + 5,
            site.z + site.r + 6, site.x, MP.heightAt(site.x, site.z) + 3, site.z);
          info = { site: { x: site.x | 0, z: site.z | 0, r: +site.r.toFixed(1) } };
        }
        // A arma e o corpo em primeira pessoa escondiam quase metade da prova.
        MP.weaponRoot.visible = false;
        if (window.__FP && window.__FP.bodyRoot) window.__FP.bodyRoot.visible = false;
        MP.renderer.render(MP.scene, MP.camera);
        return info;
      }, s.target);
      await new Promise(r => setTimeout(r, 80));
      await page.$eval('#game', c => { c.style.width = '1280px'; c.style.height = '720px'; });
      const canvas = await page.$('#game');
      await canvas.screenshot({ path: path.join(output, s.file) });
      console.log(`${s.file}  →  ${JSON.stringify(report)}`);
    }

    const fallbackPage = await browser.newPage();
    const fallbackErrors = [];
    await fallbackPage.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    await fallbackPage.evaluateOnNewDocument(() => { window.requestAnimationFrame = () => 0; });
    await fallbackPage.setRequestInterception(true);
    fallbackPage.on('request', request => {
      if (request.url().includes('boss-castle.v2.optimized.glb')) request.abort();
      else request.continue();
    });
    fallbackPage.on('pageerror', e => fallbackErrors.push(String(e)));
    fallbackPage.on('console', message => {
      if (message.type() === 'error' &&
          message.text() !== 'Failed to load resource: net::ERR_FAILED')
        fallbackErrors.push(message.text());
    });
    fallbackPage.on('requestfailed', request => {
      if (!request.url().includes('boss-castle.v2.optimized.glb')) {
        const failure = request.failure();
        fallbackErrors.push(
          `requestfailed ${request.url()}: ${failure ? failure.errorText : 'erro desconhecido'}`,
        );
      }
    });
    await fallbackPage.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await fallbackPage.waitForFunction('window.__game && window.__MP', {
      timeout: 60000,
      polling: 250,
    });
    const fallbackState = await fallbackPage.evaluate(async () => {
      const G = window.__game, MP = window.__MP;
      window.__MP_active = true; window.__MP_respawn = () => {};
      G.forceStart();
      const c = G.Structures.castle;
      await c.ready;
      G.Env.tod = 0.5;
      MP.player.pos.set(c.center.x, c.floorY, c.center.z);
      G.state.cinematic = false; G.tick(0.1); G.state.cinematic = true;
      MP.camera.position.set(c.center.x + 48, c.originY + 26, c.center.z + 55);
      MP.camera.lookAt(c.center.x, c.originY + 6, c.center.z);
      MP.camera.updateMatrixWorld(true);
      MP.weaponRoot.visible = false;
      if (window.__FP && window.__FP.bodyRoot) window.__FP.bodyRoot.visible = false;
      MP.renderer.render(MP.scene, MP.camera);
      return {
        status: c.status,
        modelRoot: !!c.modelRoot,
        fallbackVisible: !!c.fallbackRoot && c.fallbackRoot.visible,
      };
    });
    if (fallbackState.status !== 'fallback' || fallbackState.modelRoot ||
        !fallbackState.fallbackVisible || fallbackErrors.length) {
      throw new Error(
        `fallback visual inválido: ${JSON.stringify({ fallbackState, fallbackErrors })}`,
      );
    }
    await fallbackPage.addStyleTag({ content: 'body > :not(#game) { display:none !important; }' });
    await fallbackPage.$eval('#game', canvas => {
      canvas.style.width = '1280px';
      canvas.style.height = '720px';
    });
    const fallbackCanvas = await fallbackPage.$('#game');
    await fallbackCanvas.screenshot({ path: path.join(output, 'castelo-fallback.png') });
    await fallbackPage.close();
    console.log(`castelo-fallback.png  →  ${JSON.stringify(fallbackState)}`);

    if (errors.length)
      throw new Error(`erros de página/rede:\n${errors.map(e => `  ${e}`).join('\n')}`);
    console.log('\nsem erros de página/rede; castelo GLB validado');
  });
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { main, stopServer, waitForServer, withCaptureResources };
