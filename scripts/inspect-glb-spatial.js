/* Inspeção ESPACIAL dos GLBs das armas: roda o jogo real no Chrome headless
   (mesmo pipeline de normalização do js/weaponmodels.js) e salva, por arma,
   o bounding box de CADA nó no espaço local do gun.group + material.
   É a fonte dos números de calibração do js/weaponrig.js (eye/front/muzzle).
   Uso: node scripts/inspect-glb-spatial.js [porta] */
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
const outFile = path.join(__dirname, '..', 'output', 'weapon-spatial.json');

(async () => {
  if (!CHROME) throw new Error('Chrome local não encontrado');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), WORLD_SEED: '424242' }, stdio: 'ignore',
  });
  await new Promise(r => setTimeout(r, 900));
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
      '--use-gl=angle', '--use-angle=swiftshader', '--mute-audio'],
  });
  try {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => { window.requestAnimationFrame = () => 0; });
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('window.__game && window.__game.WeaponModels', { timeout: 60000, polling: 250 });
    const data = await page.evaluate(async () => {
      const G = window.__game, MP = window.__MP, THREE = MP.THREE;
      window.__MP_active = true; window.__MP_respawn = () => {};
      window.__BR_active = true;
      G.forceStart();
      await G.WeaponModels.ready;
      G.tick(1 / 60);
      const out = [];
      const inv = new THREE.Matrix4(), rel = new THREE.Matrix4();
      const box = new THREE.Box3();
      for (let i = 0; i < G.arsenal.length; i++) {
        const gun = G.arsenal[i];
        gun.group.updateWorldMatrix(true, true);
        inv.copy(gun.group.matrixWorld).invert();
        const nodes = [];
        const roots = [['glb', gun.modelRoot], ['proc', gun.group]];
        for (const [src, root] of roots) {
          if (!root) continue;
          root.traverse(o => {
            if (src === 'proc' && gun.modelRoot) {
              // no dump procedural só interessam as âncoras nomeadas, não malhas escondidas
              let p = o; while (p && p !== gun.modelRoot) p = p.parent;
              if (p === gun.modelRoot) return; // já coberto pelo dump do GLB
            }
            const entry = { src, name: o.name || '(sem nome)', type: o.type };
            if (o.isMesh && o.geometry) {
              if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
              rel.copy(inv).multiply(o.matrixWorld);
              box.copy(o.geometry.boundingBox).applyMatrix4(rel);
              entry.material = (Array.isArray(o.material) ? o.material : [o.material])
                .map(m => m && m.name).join(',');
              entry.bboxGun = {
                min: box.min.toArray().map(v => +v.toFixed(4)),
                max: box.max.toArray().map(v => +v.toFixed(4)),
              };
              nodes.push(entry);
            } else if (/mag|bolt|pump|trigger|muzzle|hand|sight/i.test(o.name)) {
              rel.copy(inv).multiply(o.matrixWorld);
              const p = new THREE.Vector3().setFromMatrixPosition(rel);
              entry.posGun = p.toArray().map(v => +v.toFixed(4));
              nodes.push(entry);
            }
          });
        }
        const gb = new THREE.Box3();
        for (const n of nodes) if (n.bboxGun) gb.union(new THREE.Box3(
          new THREE.Vector3(...n.bboxGun.min), new THREE.Vector3(...n.bboxGun.max)));
        out.push({
          idx: i, name: gun.name, model: gun.modelStatus || 'procedural',
          muzzleAnchor: gun.muzzleAnchor.position.toArray().map(v => +v.toFixed(4)),
          gunBox: gb.isEmpty() ? null : {
            min: gb.min.toArray().map(v => +v.toFixed(4)),
            max: gb.max.toArray().map(v => +v.toFixed(4)),
          },
          nodes,
        });
      }
      return out;
    });
    fs.writeFileSync(outFile, JSON.stringify(data, null, 1));
    for (const w of data) {
      console.log(`\n[${w.idx}] ${w.name} (${w.model}) muzzleAnchor=${w.muzzleAnchor}`);
      if (w.gunBox) console.log(`  box ${w.gunBox.min} → ${w.gunBox.max}`);
      for (const n of w.nodes.slice(0, 24)) {
        if (n.bboxGun) console.log(`  mesh ${n.name} [${n.material}] ${n.bboxGun.min} → ${n.bboxGun.max}`);
        else console.log(`  node ${n.name} @ ${n.posGun}`);
      }
      if (w.nodes.length > 24) console.log(`  … +${w.nodes.length - 24} nós`);
    }
    console.log('\nsalvo em ' + outFile);
  } finally {
    await browser.close();
    srv.kill();
  }
})().catch(e => { console.error(e); process.exit(1); });
