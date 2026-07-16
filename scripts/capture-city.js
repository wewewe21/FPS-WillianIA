/* Captura visual da CIDADE de vários ângulos (dia/noite) + métricas de render
   (draw calls, triângulos) e erros de página. Sobe o próprio servidor.
   Uso: node scripts/capture-city.js [porta] [subdir]
     subdir: pasta em output/ (default: city-before)
   Reutilizável pro antes/depois: node scripts/capture-city.js 3219 city-after */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const puppeteer = require('puppeteer-core');

const CHROME = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.CHROME_PATH || ''].find(p => p && fs.existsSync(p));
const PORT = +(process.argv[2] || 3219);
const SUBDIR = process.argv[3] || 'city-before';
const output = path.join(__dirname, '..', 'output', SUBDIR);

(async () => {
  if (!CHROME) throw new Error('Chrome local não encontrado');
  fs.mkdirSync(output, { recursive: true });
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), WORLD_SEED: '424242' }, stdio: 'ignore',
  });
  await new Promise(r => setTimeout(r, 900));
  const errors = [];
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
      '--use-gl=angle', '--use-angle=swiftshader', '--mute-audio', '--window-size=1280,720'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument(() => { window.requestAnimationFrame = () => 0; });
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => {
      if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text());
    });
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('window.__game && window.__MP', { timeout: 60000, polling: 250 });
    await page.evaluate(async () => {
      const G = window.__game;
      window.__MP_active = true; window.__MP_respawn = () => {};
      G.forceStart();
      G.Env.tod = 0.5; G.tick(1 / 60); // meio-dia, assenta luzes
      await new Promise(r => setTimeout(r, 1500));
      G.state.cinematic = true; // câmera manual
    });
    await page.addStyleTag({ content: 'body > :not(#game) { display:none !important; }' });

    // ângulos relativos ao centro da cidade e ao topo da torre
    const shots = [
      { file: '1-entrada-dia.png',   tod: 0.5, view: 'entrada' },
      { file: '2-cruzamento.png',    tod: 0.5, view: 'cruzamento' },
      { file: '3-praca-torre.png',   tod: 0.5, view: 'praca' },
      { file: '4-fachada-calcada.png', tod: 0.5, view: 'fachada' },
      { file: '5-aerea.png',         tod: 0.5, view: 'aerea' },
      { file: '6-noite.png',         tod: 0.0, view: 'praca' },
    ];
    for (const s of shots) {
      const report = await page.evaluate(({ view, tod }) => {
        const G = window.__game, MP = window.__MP;
        // ajusta hora do dia e deixa Env atualizar luzes/emissive
        G.Env.tod = tod; G.state.cinematic = false; G.tick(1 / 60); G.state.cinematic = true;
        const C = G.Structures.city.center, gy = MP.heightAt(C.x, C.z);
        const cam = (x, y, z, lx, ly, lz) => {
          MP.camera.position.set(x, y, z);
          MP.camera.lookAt(lx, ly, lz);
          MP.camera.updateMatrixWorld(true);
        };
        // teleporta o player junto (LOD/grama seguem o player)
        const tp = (x, z) => { MP.player.pos.set(x, MP.heightAt(x, z), z); };
        if (view === 'entrada') {        // rua ao nível do olho, olhando a torre
          tp(C.x, C.z + 70);
          cam(C.x, gy + 2.6, C.z + 78, C.x, gy + 16, C.z);
        } else if (view === 'cruzamento') {
          tp(C.x + 26, C.z + 26);
          cam(C.x + 40, gy + 3, C.z + 40, C.x, gy + 8, C.z);
        } else if (view === 'praca') {   // praça + torre, 3/4
          tp(C.x + 30, C.z + 30);
          cam(C.x + 46, gy + 22, C.z + 52, C.x, gy + 18, C.z);
        } else if (view === 'fachada') { // baixo, junto de um prédio
          tp(C.x - 34, C.z - 10);
          cam(C.x - 34, gy + 2.2, C.z - 12, C.x - 34, gy + 12, C.z - 28);
        } else if (view === 'aerea') {   // vista alta da cidade inteira
          tp(C.x, C.z);
          cam(C.x + 90, gy + 95, C.z + 90, C.x, gy + 6, C.z);
        }
        MP.renderer.info.reset();
        MP.renderer.render(MP.scene, MP.camera);
        const ri = MP.renderer.info.render;
        return { calls: ri.calls, triangles: ri.triangles, fps: G.fps };
      }, { view: s.view, tod: s.tod });
      await new Promise(r => setTimeout(r, 80));
      await page.$eval('#game', c => { c.style.width = '1280px'; c.style.height = '720px'; });
      const canvas = await page.$('#game');
      await canvas.screenshot({ path: path.join(output, s.file) });
      console.log(`${s.file}  →  calls=${report.calls} tris=${report.triangles}`);
    }
    if (errors.length) { console.error('\nERROS DE PÁGINA:'); for (const e of errors) console.error('  ' + e); }
    else console.log('\nsem erros de página');
  } finally {
    await browser.close();
    srv.kill();
  }
})().catch(e => { console.error(e); process.exit(1); });
