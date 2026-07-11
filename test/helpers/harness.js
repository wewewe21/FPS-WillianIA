/* Harness compartilhado dos testes de jogabilidade/colisão:
   sobe servidor com seed fixa + Chrome headless, injeta window.QA
   (tick manual determinístico, reset, mira) e devolve play(). */
'use strict';
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const path = require('node:path');

const CHROME = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium']
  .find(p => fs.existsSync(p));

async function bootGame({ port, worldSeed = '424242' }) {
  const puppeteer = require('puppeteer-core');
  const srv = spawn(process.execPath, [path.join(__dirname, '..', '..', 'server.js')], {
    env: { ...process.env, PORT: String(port), WORLD_SEED: worldSeed }, stdio: 'ignore',
  });
  await new Promise(r => setTimeout(r, 800));
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
      '--use-gl=angle', '--use-angle=swiftshader', '--mute-audio', '--window-size=800,600'],
  });
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('  [pageerror]', e.message));
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('!!window.__game && !!window.__MP', { timeout: 60000 });
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
    browser, page, srv, port,
    play: (fn, ...args) => page.evaluate(fn, ...args),
    async close() {
      if (browser) await browser.close();
      if (srv) srv.kill();
    },
  };
}

module.exports = { CHROME, bootGame };
