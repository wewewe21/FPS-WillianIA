'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const dockerignore = fs.readFileSync(path.join(__dirname, '..', '.dockerignore'), 'utf8')
  .split(/\r?\n/)
  .map(line => line.trim())
  .filter(line => line && !line.startsWith('#'));
const packageJson = require('../package.json');

test('contexto Docker exclui configuração e credenciais locais de deploy', () => {
  assert.ok(dockerignore.includes('/deploy.env'), 'deploy.env entraria no COPY . .');
  assert.ok(dockerignore.includes('/.env*'), 'arquivos .env entrariam no COPY . .');
});

test('contexto Docker exclui artefatos e configuração exclusiva de QA', () => {
  for (const localPath of ['/output', '/.agents', '/.playwright-mcp'])
    assert.ok(dockerignore.includes(localPath), `${localPath} entraria na imagem`);
});

test('imagem de produção contém o bot gerenciado e sua dependência', () => {
  assert.ok(dockerignore.includes('scripts/*'), 'scripts precisa usar exclusão seletiva');
  assert.ok(dockerignore.includes('!scripts/bots.js'), 'scripts/bots.js não entraria na imagem');
  assert.equal(packageJson.dependencies['socket.io-client'], '^4.7.5',
    'npm ci --omit=dev removeria socket.io-client exigido por scripts/bots.js');
});
