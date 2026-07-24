/* ================================================================
   QA — baús do BR: modelo novo (tampa/fechadura) e placement fora de
   parede (não nascem DENTRO de estrutura). Porta própria 3262.
   ================================================================ */
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { CHROME, bootGame, startBRMatch } = require('./helpers/harness');

describe('Baús do BR — modelo e placement', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h, host;
  const PORT = 3262;

  before(async () => {
    h = await bootGame({ port: PORT, extraEnv: { COUNTDOWN_S: '1', NEXT_IN_S: '300' } });
    host = await startBRMatch(h, { serverPort: PORT });
  });
  after(async () => { if (host) host.close(); if (h) await h.close(); });

  it('todo baú tem o modelo novo (tampa com dobradiça + fechadura que brilha)', async () => {
    const r = await h.play(() => {
      const crates = window.__BR_debug.crates;
      let semLid = 0, semGlow = 0;
      for (const c of crates) {
        if (!c.lid || typeof c.lid.rotation !== 'object') semLid++;
        if (!c.glow || typeof c.glow.emissiveIntensity !== 'number') semGlow++;
      }
      return { total: crates.length, semLid, semGlow };
    });
    assert.ok(r.total >= 34, `poucos baús (${r.total})`);
    assert.equal(r.semLid, 0, `${r.semLid} baús sem tampa articulada`);
    assert.equal(r.semGlow, 0, `${r.semGlow} baús sem fechadura/brilho`);
  });

  it('nenhum baú nasce DENTRO de parede (placement empurrado pra fora)', async () => {
    const r = await h.play(() => {
      const { G, MP } = window.QA;
      let worst = 0, worstKey = null, checked = 0;
      for (const c of window.__BR_debug.crates) {
        if (c.g.position.y > 20) continue;            // torre/boss em laje: fora do teste de chão
        checked++;
        const y = MP.heightAt(c.x, c.z);
        const p = { x: c.x, y: y + 0.3, z: c.z };
        G.Structures.collide(p, 0.45, 0.6);           // oráculo: empurra pra fora de parede
        const push = Math.hypot(p.x - c.x, p.z - c.z);
        if (push > worst) { worst = push; worstKey = c.key; }
      }
      return { worst: +worst.toFixed(2), worstKey, checked };
    });
    assert.ok(r.checked > 0, 'nenhum baú de chão pra checar');
    assert.ok(r.worst < 0.4, `baú "${r.worstKey}" ainda dentro de parede (empurra ${r.worst} m)`);
  });

  it('o baú do heliponto (torre) segue no telhado (y>20) e fechado', async () => {
    const crate = await h.play(() => {
      const c = window.__BR_debug.crates.find(c => c.key === 'torre');
      return c ? { y: c.g.position.y, opened: c.opened } : null;
    });
    assert.ok(crate, 'baú da torre sumiu');
    assert.ok(crate.y > 20, `baú da torre no chão (y=${crate.y})`);
    assert.equal(crate.opened, false);
  });
});
