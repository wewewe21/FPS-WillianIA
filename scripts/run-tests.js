/* ================================================================
   Runner da suíte: enumera test/*.test.js em JS e repassa pro
   node --test. Por quê: `node --test test/` (diretório) não resolve
   no node do Windows, e o glob "test/*.test.js" só existe no node 21+
   (aqui roda 20). Isto funciona em qualquer node >=18, em qualquer SO.
   ================================================================ */
'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'test');
const files = fs.readdirSync(dir)
  .filter(f => f.endsWith('.test.js'))
  .sort()
  .map(f => path.join(dir, f));

if (!files.length) { console.error('nenhum teste em test/'); process.exit(1); }

const r = spawnSync(process.execPath,
  ['--test', '--test-concurrency=1', ...files, ...process.argv.slice(2)],
  { stdio: 'inherit' });
process.exit(r.status == null ? 1 : r.status);
