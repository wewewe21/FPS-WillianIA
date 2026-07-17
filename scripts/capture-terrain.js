/* Captura de VALIDAÇÃO do terreno/clima: biomas representativos × horário ×
   clima, na mesma seed/câmera — para comparar antes/depois de mudanças.
   Uso: node scripts/capture-terrain.js [porta] [pastaSaida] */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const puppeteer = require('puppeteer-core');

const CHROME = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.CHROME_PATH || ''].find(p => p && fs.existsSync(p));
const PORT = +(process.argv[2] || 3213);
const output = path.resolve(process.argv[3] || path.join(__dirname, '..', 'output', 'terrain'));

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
    protocolTimeout: 600000, // swiftshader sob carga: screenshot pode passar de 180 s
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
      '--use-gl=angle', '--use-angle=swiftshader', '--mute-audio', '--window-size=1280,720'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument(() => { window.requestAnimationFrame = () => 0; });
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('window.__game && window.__game.WeaponModels', { timeout: 60000, polling: 250 });
    // acha pontos representativos por bioma, deterministicamente
    const spots = await page.evaluate(() => {
      const G = window.__game, MP = window.__MP;
      window.__MP_active = true; window.__MP_respawn = () => {};
      window.__BR_active = true;
      G.forceStart();
      for (const a of (G.Animals && G.Animals.list) || []) a.alive = false;
      const WL = MP.WATER_LEVEL;
      const found = { pradaria: [30, 30] };
      const scan = (accept) => {
        for (let k = 0; k < 4000; k++) {
          const x = ((k * 137.51) % 1000) - 500, z = ((k * 91.17) % 1000) - 500;
          if (accept(x, z)) return [Math.round(x), Math.round(z)];
        }
        return null;
      };
      found.floresta = scan((x, z) => G.biomeAt(x, z) > 0.45 && G.heightAt(x, z) > WL + 2);
      found.deserto = scan((x, z) => G.biomeAt(x, z) < -0.3 && G.heightAt(x, z) > WL + 2);
      found.alpino = scan((x, z) => G.heightAt(x, z) > 21);
      found.margem = scan((x, z) => { const h = G.heightAt(x, z); return h > WL + 0.2 && h < WL + 1.2; });
      found.vulcao = [285, -420];
      found.cidade = [-340, 92];
      return found;
    });
    await page.addStyleTag({ content: 'body > :not(#game) { display:none !important; }' });

    const TIMES = { dia: 0.45, tarde: 0.715, noite: 0.95 };
    const WEATHERS = ['limpo', 'chuva'];
    const stats = [];
    for (const [spot, xz] of Object.entries(spots)) {
      if (!xz) { console.log(`(sem ponto p/ ${spot})`); continue; }
      for (const [tname, tod] of Object.entries(TIMES)) {
        for (const w of WEATHERS) {
          if (w === 'chuva' && tname !== 'dia' && spot !== 'pradaria') continue; // enxuga a matriz
          const info = await page.evaluate(([x, z, tod, w]) => {
            const G = window.__game, MP = window.__MP;
            const P = MP.player;
            P.pos.set(x, G.groundAt(x, z, 999) + 0.1, z);
            P.vel.set(0, 0, 0);
            G.Env.tod = tod;
            G.Env.weather = w;
            G.state.paused = false;
            for (let i = 0; i < 90; i++) G.tick(1 / 60); // clima/luz assentam
            G.state.paused = true;
            MP.camera.rotation.set(-0.12, 0.6, 0);
            MP.camera.updateMatrixWorld(true);
            MP.renderer.render(MP.scene, MP.camera);
            return { calls: MP.renderer.info.render.calls, tris: MP.renderer.info.render.triangles,
              geos: MP.renderer.info.memory.geometries };
          }, [xz[0], xz[1], tod, w]);
          const file = `${spot}-${tname}-${w}.png`;
          await new Promise(r => setTimeout(r, 40));
          const canvas = await page.$('#game');
          await canvas.screenshot({ path: path.join(output, file) });
          stats.push({ file, ...info });
          console.log(`${file}  →  ${JSON.stringify(info)}`);
        }
      }
    }
    fs.writeFileSync(path.join(output, 'stats.json'), JSON.stringify({ spots, stats }, null, 1));
    if (errors.length) { console.error('\nERROS DE PÁGINA:'); for (const e of errors) console.error('  ' + e); }
    else console.log('\nsem erros de página');
  } finally {
    await browser.close();
    srv.kill();
  }
})().catch(e => { console.error(e); process.exit(1); });
