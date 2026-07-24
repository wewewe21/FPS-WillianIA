'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { CHROME, bootGame, startBRMatch } = require('./helpers/harness');

describe('Harness BR — prontidão do cliente dinâmico',
  { skip: !CHROME && 'Chrome não encontrado' }, () => {
    it('não inicia a rodada antes de br-game registrar o listener de matchStart', async () => {
      let h, bot;
      try {
        h = await bootGame({
          port: 3299,
          extraEnv: { COUNTDOWN_S: '1', NEXT_IN_S: '120' },
          delayRequests: [{ fragment: '/br-game.js', ms: 60000 }],
        });
        const readyBeforeStart = await h.play(() => !!window.__BR_debug);
        assert.equal(readyBeforeStart, false,
          'pré-condição inválida: br-game terminou antes do início controlado');

        bot = await startBRMatch(h);
        const state = await h.play(() => ({
          phase: window.__BR_debug && window.__BR_debug.S.phase,
          hasPlan: !!(window.__BR_debug && window.__BR_debug.S.plan),
        }));
        assert.deepEqual(state, { phase: 'PLAY', hasPlan: true });
      } finally {
        if (bot) bot.close();
        if (h) await h.close();
      }
    });
  });
