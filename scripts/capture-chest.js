/* Captura visual do BAÚ (js/chestmodel.js): fechado + aberto, campo limpo,
   meio-dia. Sobe o próprio servidor. Uso: node scripts/capture-chest.js [porta] */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const puppeteer = require('puppeteer-core');

const CHROME = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
  process.env.CHROME_PATH || ''].find(p => p && fs.existsSync(p));
const PORT = +(process.argv[2] || 3266);
const output = path.join(__dirname, '..', 'output', 'chest');

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
    page.on('console', m => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('window.__game && !!window.__game.buildChest', { timeout: 60000, polling: 250 });
    const report = await page.evaluate(() => {
      const G = window.__game, MP = window.__MP;
      window.__MP_active = true; window.__MP_respawn = () => {};
      window.__BR_active = true;
      G.forceStart();
      G.Env.tod = 0.5; G.state.paused = true;
      const bx = 30, bz = 30, gy = MP.groundAt(bx, bz, 999);
      const closed = G.buildChest(); closed.group.position.set(bx, gy, bz); closed.group.rotation.y = 0.5; MP.scene.add(closed.group);
      const open = G.buildChest(); open.group.position.set(bx + 1.7, MP.groundAt(bx + 1.7, bz, 999), bz); open.group.rotation.y = 0.5; open.lid.rotation.x = -1.15; MP.scene.add(open.group);
      MP.camera.position.set(bx + 0.85, gy + 1.15, bz + 3.1);
      MP.camera.lookAt(bx + 0.85, gy + 0.42, bz);
      MP.camera.updateMatrixWorld(true);
      MP.renderer.render(MP.scene, MP.camera);
      // caixa envolvente do baú fechado (proporção)
      const box = new (MP.THREE.Box3)().setFromObject(closed.group);
      return { size: [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z].map(v => +v.toFixed(2)) };
    });
    await page.addStyleTag({ content: 'body > :not(#game) { display:none !important; }' });
    await new Promise(r => setTimeout(r, 60));
    await page.evaluate(() => { const MP = window.__MP; MP.renderer.render(MP.scene, MP.camera); });
    await page.$eval('#game', c => { c.style.width = '1280px'; c.style.height = '720px'; });
    const canvas = await page.$('#game');
    await canvas.screenshot({ path: path.join(output, 'bau.png') });
    console.log(`bau.png  →  tamanho ${JSON.stringify(report.size)} (larg×alt×prof)`);
    if (errors.length) { console.error('ERROS:'); for (const e of errors) console.error('  ' + e); }
    else console.log('sem erros de página');
  } finally {
    await browser.close();
    srv.kill();
  }
})().catch(e => { console.error(e); process.exit(1); });
