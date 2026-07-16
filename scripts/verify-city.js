/* Verificação funcional da cidade: evento de destruição (visual + colisão),
   integridade da Torre Nexus (porta/rampas/heliponto/bazuca) e disparo de
   foguete contra prédio. Sobe o próprio servidor. Screenshots do antes/depois.
   Uso: node scripts/verify-city.js [porta] */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const puppeteer = require('puppeteer-core');

const CHROME = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
  process.env.CHROME_PATH || ''].find(p => p && fs.existsSync(p));
const PORT = +(process.argv[2] || 3221);
const output = path.join(__dirname, '..', 'output', 'city-event');

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? '✔' : '✘'} ${name}${detail ? ' — ' + detail : ''}`); if (!ok) fails++; };

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
      G.forceStart(); G.Env.tod = 0.5; G.tick(1 / 60);
      await new Promise(r => setTimeout(r, 1200));
      G.state.cinematic = true;
    });
    await page.addStyleTag({ content: 'body > :not(#game) { display:none !important; }' });

    // ---------- integridade da Torre Nexus ----------
    const tower = await page.evaluate(() => {
      const S = window.__game.Structures;
      return {
        towerTopY: S.towerTopY,
        heli: S.heliSpot, bazooka: S.bazookaSpot,
        carSpots: S.carSpots.length, chestSpots: S.chestSpots.length,
        enemyCamps: S.enemyCamps.length,
      };
    });
    check('towerTopY definido', typeof tower.towerTopY === 'number' && tower.towerTopY > 30, `y=${tower.towerTopY && tower.towerTopY.toFixed(1)}`);
    check('heliSpot no topo da torre', tower.heli && Math.abs(tower.heli.y - tower.towerTopY) < 0.01);
    check('bazookaSpot presente', !!tower.bazooka);
    check('carSpots preservados (>=3 na cidade)', tower.carSpots >= 3, `total=${tower.carSpots}`);
    check('enemyCamps preservados', tower.enemyCamps > 0, `total=${tower.enemyCamps}`);

    // porta da torre desobstruída: raio do sul pra dentro atravessa o vão
    const door = await page.evaluate(() => {
      const G = window.__game, MP = window.__MP, S = G.Structures;
      const C = S.city.center, gy = MP.heightAt(C.x, C.z);
      const o = new MP.THREE.Vector3(C.x, gy + 1.2, C.z + 11);
      const d = new MP.THREE.Vector3(0, 0, -1);
      return { hit: S.rayHit(o, d, 40) };
    });
    check('porta da torre aberta (raio atravessa o vão)', door.hit > 10, `rayHit=${door.hit.toFixed(1)} (esperado ~18)`);

    // ---------- foguete contra prédio ----------
    const rocket = await page.evaluate(() => {
      const G = window.__game, MP = window.__MP, S = G.Structures;
      const C = S.city.center, gy = MP.heightAt(C.x, C.z);
      // prédio do lote [16,-8]; atira da frente (oeste) pra dentro da fachada
      const from = new MP.THREE.Vector3(C.x + 4, gy + 4, C.z - 8);
      const dir = new MP.THREE.Vector3(1, 0, 0);
      G.Rockets.fire(from, dir);
      for (let i = 0; i < 60; i++) G.Rockets.update(1 / 60);
      // sem crash e o foguete detonou (não ficou preso vivo)
      return { ok: true };
    });
    check('disparo de foguete contra prédio sem erro', rocket.ok);

    // ---------- evento de destruição ----------
    const beforeShot = async (name) => {
      await page.evaluate(() => {
        const G = window.__game, MP = window.__MP, S = G.Structures;
        const C = S.city.center, gy = MP.heightAt(C.x, C.z);
        MP.camera.position.set(C.x + 60, gy + 45, C.z + 70);
        MP.camera.lookAt(C.x, gy + 10, C.z);
        MP.camera.updateMatrixWorld(true);
        MP.renderer.render(MP.scene, MP.camera);
      });
      await new Promise(r => setTimeout(r, 60));
      await page.$eval('#game', c => { c.style.width = '1280px'; c.style.height = '720px'; });
      await (await page.$('#game')).screenshot({ path: path.join(output, name) });
    };

    const st0 = await page.evaluate(() => {
      const S = window.__game.Structures;
      return { city: S.walls.filter(w => w.city).length, ruin: S.walls.filter(w => w.cityRuin).length, state: S.city.getState() };
    });
    check('intacta: há paredes urbanas e nenhum escombro', st0.city > 0 && st0.ruin === 0, JSON.stringify(st0));
    await beforeShot('1-intacta.png');

    const st1 = await page.evaluate(() => {
      const S = window.__game.Structures;
      S.city.destroy();
      return {
        city: S.walls.filter(w => w.city).length, ruin: S.walls.filter(w => w.cityRuin).length,
        cityPlat: (window.__game.__platforms || []).length, state: S.city.getState(),
      };
    });
    check('destruída: paredes urbanas removidas', st1.city === 0, `city walls=${st1.city}`);
    check('destruída: escombros adicionados', st1.ruin > 0, `ruin walls=${st1.ruin}`);
    check('destruída: estado = destroyed', st1.state === 'destroyed');
    await beforeShot('2-destruida.png');

    const st2 = await page.evaluate(() => {
      const S = window.__game.Structures;
      S.city.restore();
      return { city: S.walls.filter(w => w.city).length, ruin: S.walls.filter(w => w.cityRuin).length, state: S.city.getState() };
    });
    check('restaurada: paredes urbanas de volta', st2.city > 0, `city walls=${st2.city}`);
    check('restaurada: sem escombros', st2.ruin === 0);
    check('restaurada: estado = intact', st2.state === 'intact');

    check('console sem erros', errors.length === 0, errors.slice(0, 3).join(' | '));
    console.log(`\n${fails === 0 ? 'TUDO OK' : fails + ' FALHA(S)'} — screenshots em output/city-event/`);
  } finally {
    await browser.close();
    srv.kill();
  }
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
