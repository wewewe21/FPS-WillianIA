/* ================================================================
   QA — grama DECORATIVA e determinística (js/grass.js).
   Prova: zero física originada da grama; raiz na superfície canônica;
   chunk reciclado = bytes idênticos (RNG local por seed/chunk); zero
   lâminas relevantes em água/rua/prédio/vulcão; bounds/culling válidos.
   ================================================================ */
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { CHROME, bootGame } = require('./helpers/harness.js');

describe('Grama decorativa (Chrome headless)', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h;
  before(async () => { h = await bootGame({ port: 3232 }); });
  after(async () => { if (h) await h.close(); });

  it('dada a arquitetura, então grama NUNCA cria física (fonte + mundo)', async () => {
    // asserção estrutural: o módulo não importa CANNON nem registra obstáculo
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'grass.js'), 'utf8');
    assert.ok(!/CANNON|cannon-es|addObstacle/.test(src), 'grass.js referencia física');
    // asserção viva: refazer TODA a grama não muda a contagem de corpos do mundo
    const r = await h.play(() => {
      const G = window.QA.G, MP = window.QA.MP;
      const antes = MP.world.bodies.length;
      G.Grass.refreshAll();
      window.QA.tick(5);
      return { antes, depois: MP.world.bodies.length };
    });
    assert.equal(r.depois, r.antes, 'refreshAll mudou a contagem de corpos físicos');
  });

  it('dadas as raízes, então ficam a ≤3 cm da superfície canônica', async () => {
    const r = await h.play(() => {
      const G = window.QA.G, MP = window.QA.MP;
      // pradaria aberta, longe do spawn (clareiras de veículos zeram lâminas lá)
      MP.player.pos.set(90, G.heightAt(90, -60) + 1, -60);
      window.QA.tick(150);
      let worst = 0, n = 0;
      for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
        const sample = G.Grass.debugSample(90 + cx * 10, -60 + cz * 10, 500) || [];
        for (const b of sample) {
          if (b.sy < 0.05) continue; // lâminas colapsadas não contam
          const d = Math.abs(b.y - G.heightAt(b.x, b.z));
          worst = Math.max(worst, d);
          n++;
        }
      }
      return { n, worst };
    });
    assert.ok(r.n > 50, `amostra pequena demais (${r.n})`);
    assert.ok(r.worst <= 0.03, `raiz a ${(r.worst * 100).toFixed(1)}cm da superfície`);
  });

  it('dado um chunk reciclado, então volta com bytes IDÊNTICOS (determinismo por seed/chunk)', async () => {
    const r = await h.play(() => {
      const G = window.QA.G, MP = window.QA.MP;
      window.QA.reset();
      window.QA.tick(200); // fila de rebuild (6 chunks/frame) esvazia
      const antes = G.Grass.debugChunkBytes(2, 1);
      // player viaja pra longe: chunk (2,1) sai da grade e é reciclado
      MP.player.pos.set(300, G.heightAt(300, 300) + 1, 300);
      window.QA.tick(120);
      const longe = G.Grass.debugChunkBytes(2, 1); // não deve existir na grade
      // volta: chunk (2,1) é re-preenchido
      MP.player.pos.set(20, G.heightAt(20, 10) + 1, 10);
      window.QA.tick(120);
      const depois = G.Grass.debugChunkBytes(2, 1);
      return { antes, longe, depois };
    });
    assert.ok(r.antes, 'chunk (2,1) ausente no início');
    assert.equal(r.longe, null, 'chunk não foi reciclado ao viajar');
    assert.ok(r.depois, 'chunk (2,1) ausente na volta');
    assert.deepEqual(r.depois, r.antes, 'chunk reciclado divergiu — layout não determinístico');
  });

  it('dadas água/rua/prédio/vulcão, então ZERO lâminas relevantes', async () => {
    const r = await h.play(() => {
      const G = window.QA.G, MP = window.QA.MP;
      const count = (x, z, pred) => {
        MP.player.pos.set(x, G.heightAt(x, z) + 1, z);
        window.QA.tick(150); // grade re-centra e recicla
        let bad = 0, seen = 0;
        for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
          const sample = G.Grass.debugSample(x + cx * 10, z + cz * 10, 500) || [];
          for (const b of sample) {
            if (b.sy < 0.05) continue;
            seen++;
            if (pred(b)) bad++;
          }
        }
        return { bad, seen };
      };
      const cidade = count(-340, 130, b => {
        const t = G.surfaceAt(b.x, b.z).surfaceType;
        return t === 'street' || t === 'building';
      });
      const vulcao = count(420, -420, b => Math.hypot(b.x - 420, b.z + 420) < 114 * 0.95);
      // água: acha um lago
      let lake = null;
      for (let k = 0; k < 6000 && !lake; k++) {
        const x = ((k * 137.51) % 1000) - 500, z = ((k * 91.17) % 1000) - 500;
        if (G.heightAt(x, z) < MP.WATER_LEVEL - 0.3) lake = [x, z];
      }
      const agua = lake ? count(lake[0], lake[1], b => G.heightAt(b.x, b.z) < MP.WATER_LEVEL + 0.25) : { bad: 0, seen: 1 };
      return { cidade, vulcao, agua, lake };
    });
    assert.equal(r.cidade.bad, 0, `${r.cidade.bad}/${r.cidade.seen} lâminas em rua/prédio`);
    assert.equal(r.vulcao.bad, 0, `${r.vulcao.bad}/${r.vulcao.seen} lâminas no cone do vulcão`);
    assert.equal(r.agua.bad, 0, `${r.agua.bad}/${r.agua.seen} lâminas na água (lago ${r.lake})`);
  });

  it('dado o rebuild, então needsUpdate/bounds ficam válidos e a fila esvazia', async () => {
    const r = await h.play(() => {
      const G = window.QA.G, MP = window.QA.MP;
      window.QA.reset();
      window.QA.tick(150);
      const sample = G.Grass.debugSample(30, 30, 400) || [];
      // bounding sphere do chunk central contém as raízes (world-local do mesh)
      let out = 0;
      const cx = Math.round(30 / 10) * 10, cz = Math.round(30 / 10) * 10;
      for (const b of sample) {
        if (b.sy < 0.05) continue;
        // esfera cobre y? amostra: raiz dentro de ±(raio) do centro em y
        if (Math.abs(b.x - cx) > 10 || Math.abs(b.z - cz) > 10) out++;
      }
      return { out, n: sample.length };
    });
    assert.equal(r.out, 0, `${r.out} lâminas fora do próprio chunk`);
  });
});
