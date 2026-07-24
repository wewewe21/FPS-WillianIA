'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const captureScript = path.join(__dirname, '..', 'scripts', 'capture-world.js');
const { waitForServer, withCaptureResources } = require(captureScript);

test('captura visual exige prontidão autenticada e lifecycle importável', () => {
  const source = fs.readFileSync(captureScript, 'utf8');

  assert.match(source, /QA_BOOT_TOKEN/);
  assert.doesNotMatch(source, /setTimeout\(r,\s*900\)/);
  assert.match(source, /if\s*\(require\.main\s*===\s*module\)/);
});

test('prontidão rejeita servidor antigo e aceita somente o token do processo atual', async t => {
  let responseToken = 'servidor-antigo';
  const server = http.createServer((request, response) => {
    response.setHeader('X-QA-Boot-Token', responseToken);
    response.end('<canvas id="game"></canvas>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const fakeChild = { exitCode: null };
  const port = server.address().port;

  await assert.rejects(
    waitForServer(fakeChild, port, 'processo-atual', 220),
    /não respondeu/,
  );
  responseToken = 'processo-atual';
  await waitForServer(fakeChild, port, 'processo-atual', 1000);
});

test('falha ao abrir Chrome ainda encerra servidor e remove rank temporário', async () => {
  const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fps-capture-lifecycle-'));
  const temporaryRank = path.join(temporaryDir, 'rank.json');
  fs.writeFileSync(temporaryRank, '{}');
  const fakeChild = new EventEmitter();
  fakeChild.exitCode = null;
  let stopCalls = 0;
  let spawnedToken = null;
  let readyToken = null;

  try {
    await assert.rejects(
      withCaptureResources(
        async () => {
          assert.fail('captura não pode iniciar sem navegador');
        },
        {
          bootToken: 'token-unico',
          chromePath: '/chrome-de-teste',
          port: 45678,
          rankFile: temporaryRank,
          spawnImpl(command, args, options) {
            assert.equal(command, process.execPath);
            assert.match(args[0], /server\.js$/);
            spawnedToken = options.env.QA_BOOT_TOKEN;
            return fakeChild;
          },
          async waitForReady(child, port, token) {
            assert.equal(child, fakeChild);
            assert.equal(port, 45678);
            readyToken = token;
          },
          async launchBrowser() {
            throw new Error('Chrome não abriu');
          },
          async stopServerImpl(child) {
            assert.equal(child, fakeChild);
            stopCalls++;
            fakeChild.exitCode = 0;
          },
        },
      ),
      /Chrome não abriu/,
    );
    assert.equal(spawnedToken, 'token-unico');
    assert.equal(readyToken, 'token-unico');
    assert.equal(stopCalls, 1);
    assert.equal(fs.existsSync(temporaryRank), false);
  } finally {
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
});
