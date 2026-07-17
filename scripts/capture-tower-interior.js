/* Testes VISUAIS do interior da Torre Nexus: percorre lobby, lances, patamares,
   poço, andar intermediário, heliponto, noite e cidade destruída — sempre com a
   câmera na ALTURA DO JOGADOR (não vista aérea). Também imprime renderer.info
   (draw calls / triângulos) e a contagem de colisores/plataformas urbanas, para
   comparar antes/depois. Sobe o próprio servidor. Uso:
     node scripts/capture-tower-interior.js [porta] [--tag before|after]
   Screenshots em output/tower-interior/<tag>-NN-nome.png */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const puppeteer = require('puppeteer-core');

const CHROME = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
  process.env.CHROME_PATH || ''].find(p => p && fs.existsSync(p));
const PORT = +(process.argv[2] || 3223);
const tagArg = process.argv.indexOf('--tag');
const TAG = tagArg >= 0 ? process.argv[tagArg + 1] : 'shot';
const output = path.join(__dirname, '..', 'output', 'tower-interior');

// câmera em coordenadas RELATIVAS ao centro da torre (cx,cz) e ao piso (gy).
// eye:[dx,dy,dz]  look:[dx,dy,dz]  — dy é altura acima de gy (olho do jogador ~1.62).
const SHOTS = [
  { name: '01-entrada-externa', eye: [0, 1.62, 15], look: [0, 2.0, 0], day: true },
  { name: '02-lobby-para-escada', eye: [0, 1.62, 6], look: [-6.8, 1.6, -6], day: true },
  { name: '03-primeiro-lance', eye: [-7.8, 1.9, -3.5], look: [-7.8, 2.4, -7], day: true },
  { name: '04-patamar-intermediario', eye: [-6.9, 3.3, -6.5], look: [-6.0, 3.4, -5], day: true },
  { name: '05-segundo-lance', eye: [-6.0, 3.4, -5.5], look: [-6.0, 4.2, -4.2], day: true },
  { name: '06-saida-primeiro-andar', eye: [-6.0, 5.2, -3.6], look: [3, 5.2, 0], day: true },
  { name: '07-poco-de-escada', eye: [-4.4, 5.4, -3.0], look: [-6.9, 0.5, -6.5], day: true },
  { name: '08-pavimento-intermediario', eye: [3, 18.9, 3], look: [-6, 18.9, -6], day: true },
  { name: '09-ultima-escada', eye: [-6.0, 32.2, -5.5], look: [-6.5, 33.6, -6.5], day: true },
  { name: '10-saida-heliponto', eye: [-3, 35.1, -2], look: [2, 34.6, 3], day: true },
  { name: '11-interior-noite', eye: [0, 1.62, 6], look: [-6.8, 1.6, -6], day: false },
  { name: '12-cidade-destruida', eye: [40, 30, 55], look: [0, 8, 0], day: true, destroy: true },
];

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
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('window.__game && window.__MP', { timeout: 60000, polling: 250 });
    await page.evaluate(async () => {
      const G = window.__game; window.__MP_active = true; window.__MP_respawn = () => {};
      window.__BR_active = true; // IA/NPCs fora: draw calls estáveis (sem bonecos vagando na cena)
      G.forceStart();
      for (const a of (G.Animals && G.Animals.list) || []) a.alive = false;
      G.Env.tod = 0.5; G.tick(1 / 60);
      await new Promise(r => setTimeout(r, 1200));
      G.state.cinematic = true;
    });
    await page.addStyleTag({ content: 'body > :not(#game) { display:none !important; }' });

    // métricas: draw calls / triângulos + colisores/plataformas urbanas
    const metrics = await page.evaluate(() => {
      const G = window.__game, MP = window.__MP, S = G.Structures;
      const C = S.city.center, gy = MP.heightAt(C.x, C.z);
      MP.camera.position.set(C.x, gy + 20, C.z + 30);
      MP.camera.lookAt(C.x, gy + 15, C.z);
      MP.camera.updateMatrixWorld(true);
      MP.renderer.info.reset();
      MP.renderer.render(MP.scene, MP.camera);
      const info = MP.renderer.info.render;
      return {
        drawCalls: info.calls, triangles: info.triangles,
        cityWalls: S.walls.filter(w => w.city).length,
        cityNoColl: S.walls.filter(w => w.city && w.noCollide).length,
        cityPlatforms: (G.platforms || []).filter(p => p.city).length,
        cityRamps: (G.platforms || []).filter(p => p.city && p.ramp).length,
        towerTopY: S.towerTopY, gy,
      };
    });
    console.log(`\n[${TAG}] métricas:`, JSON.stringify(metrics, null, 0));

    const shoot = async (shot) => {
      await page.evaluate((s) => {
        const G = window.__game, MP = window.__MP, S = G.Structures;
        const C = S.city.center, gy = MP.heightAt(C.x, C.z);
        G.Env.tod = s.day ? 0.5 : 0.92;   // noite
        if (s.destroy && S.city.getState() !== 'destroyed') S.city.destroy();
        if (!s.destroy && S.city.getState() !== 'intact') S.city.restore();
        MP.camera.position.set(C.x + s.eye[0], gy + s.eye[1], C.z + s.eye[2]);
        MP.camera.lookAt(C.x + s.look[0], gy + s.look[1], C.z + s.look[2]);
        MP.camera.updateMatrixWorld(true);
        MP.renderer.render(MP.scene, MP.camera);
      }, shot);
      await new Promise(r => setTimeout(r, 50));
      await page.$eval('#game', c => { c.style.width = '1280px'; c.style.height = '720px'; });
      await (await page.$('#game')).screenshot({ path: path.join(output, `${TAG}-${shot.name}.png`) });
      console.log(`  ✔ ${TAG}-${shot.name}.png`);
    };
    for (const s of SHOTS) { try { await shoot(s); } catch (e) { console.log(`  ✘ ${TAG}-${s.name}.png — ${e.message}`); } }

    console.log(`\nconsole errors: ${errors.length}${errors.length ? ' -> ' + errors.slice(0, 3).join(' | ') : ''}`);
  } finally {
    await browser.close();
    srv.kill();
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
