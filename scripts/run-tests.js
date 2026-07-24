/* ================================================================
   Runner da suíte: enumera test/*.test.js em JS e repassa pro
   node --test. Por quê: `node --test test/` (diretório) não resolve
   no node do Windows, e o glob "test/*.test.js" só existe no node 21+
   (aqui roda 20). Isto funciona em qualquer node >=18, em qualquer SO.

   Triagem automática de flake (gap 15): arquivo que falhou na suíte
   re-roda ISOLADO até 3x — dois passes consecutivos = FLAKE (protocolo do
   CLAUDE.md: portas fixas + boot >60s sob carga), continua falhando
   = REGRESSÃO REAL (exit 1). Só flakes = suíte VERDE (exit 0).
   O stdout do node passa por pipe (TAP sempre) pra permitir o parse
   das linhas `location:` que atribuem falha a arquivo.
   ================================================================ */
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const dir = process.env.QA_TEST_DIR || path.join(__dirname, '..', 'test');
const files = fs.readdirSync(dir)
  .filter(f => f.endsWith('.test.js'))
  .sort()
  .map(f => path.join(dir, f));

if (!files.length) { console.error('nenhum teste em ' + dir); process.exit(1); }

function runNode(args, tee) {
  return new Promise(resolve => {
    const p = spawn(process.execPath, args, { stdio: ['inherit', 'pipe', 'inherit'] });
    let buf = '';
    p.stdout.on('data', c => { buf += c; if (tee) process.stdout.write(c); });
    p.on('close', code => resolve({ code: code == null ? 1 : code, out: buf }));
  });
}

(async () => {
  const base = ['--test', '--test-concurrency=1'];
  const main = await runNode([...base, ...files, ...process.argv.slice(2)], true);
  if (main.code === 0) process.exit(0);

  // atribuição de falha por arquivo: linhas "location: '/abs/x.test.js:l:c'"
  const failed = [...new Set(
    [...main.out.matchAll(/location: '([^']+\.test\.js):\d+/g)].map(m => m[1]),
  )].filter(f => files.includes(f));
  if (!failed.length) process.exit(main.code); // crash sem atribuição — não mascarar

  console.log(`\n=== triagem de flake: ${failed.length} arquivo(s) falharam — re-rodando ISOLADO ===`);
  const regress = [];
  for (const f of failed) {
    let consecutivePasses = 0;
    for (let round = 1; round <= 3 && consecutivePasses < 2; round++) {
      console.log(`  → ${path.basename(f)} (isolado, rodada ${round})`);
      const passed = (await runNode([...base, f], false)).code === 0;
      consecutivePasses = passed ? consecutivePasses + 1 : 0;
    }
    const ok = consecutivePasses >= 2;
    console.log(`  ${ok ? 'FLAKE' : 'REGRESSÃO REAL'}: ${path.basename(f)}`);
    if (!ok) regress.push(f);
  }
  if (regress.length) {
    console.error(`\n${regress.length} regressão(ões) real(is): ${regress.map(f => path.basename(f)).join(', ')}`);
    process.exit(1);
  }
  console.log('\nsó flakes — suíte VERDE (2 passes isolados consecutivos)');
  process.exit(0);
})();
