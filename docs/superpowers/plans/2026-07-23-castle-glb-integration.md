# Castle GLB and Golem Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILLS: Use test-driven-development, systematic-debugging, develop-web-game and verification-before-completion task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir integralmente o forte procedural pelo castelo GLB fornecido, encaixá-lo no terreno sem penetração ou flutuação, manter o Colosso solo e o Golem BR protegendo a construção e provar visual, física e deterministicamente que a troca não corrompeu o mundo.

**Architecture:** `js/castle.js` é o módulo profundo e a única fonte de verdade do castelo. Ele calcula, sem RNG, um layout síncrono (altura, fundação, rampa, AABBs, plataformas, cobertura, raio de guarda e clareiras) antes de o jogo criar os corpos Cannon; em paralelo, carrega o GLB otimizado e faz uma troca visual atômica entre um proxy novo derivado dos colliders e o modelo validado. `js/structures.js` continua executando todas as operações legadas do forte na mesma ordem para preservar o stream seedado, mas captura sua geometria/efeitos em `bossCastleLegacySource`, sempre oculto e nunca usado como fallback jogável. Os consumidores (`game.js`, `js/boss.js` e `br-game.js`) leem apenas `Structures.castle`, mantendo `FORT_POS` como centro canônico.

**Tech Stack:** JavaScript ES modules, Three.js/GLTFLoader, glTF Transform, Cannon ES, Express/Socket.IO, Node test runner, Puppeteer/Chrome e Playwright.

## Global Constraints

- Preservar a mudança local do usuário em `br-rank.json`.
- Preservar, sem sobrescrever, `castelo_reconstruido_escala_real.glb` e `assets/models/boss-castle.v1.glb`; o segundo é a fonte autoral e ambos têm SHA-256 `fd05cc2fa6aebcd73d16440280b90074624a67bd67e9fc385017ced525e18449`.
- Não alterar `FORT_POS`, a seed nem a ordem/quantidade de chamadas ao RNG global. A seed 424242 deve manter assinatura exata; seeds com candidato inseguro podem escolher outro candidato já amostrado, sem consumir RNG adicional, para respeitar rampa `<=30°`, bases e cidade.
- Não modificar a grade canônica do terreno depois de construída.
- Criar colisores, plataformas e cobertura do castelo de forma síncrona; o callback do GLB só pode alterar a representação visual.
- Manter fallback jogável se o download, parse ou validação espacial do GLB falhar.
- Não depender de Draco ou Meshopt em runtime; aceitar apenas `KHR_mesh_quantization`, já suportado pelo loader atual.
- Executar testes de navegador um por vez (`--test-concurrency=1`) e repetir isoladamente falhas de navegação antes de classificá-las.
- Escrever e observar falhar cada teste novo antes da implementação correspondente.

---

### Task 1: Fixar o contrato do asset e gerar um derivado seguro

**Files:**
- Create: `scripts/build-castle-model.js`
- Create: `assets/models/boss-castle.v2.optimized.glb`
- Modify: `package.json`
- Modify: `test/asset-models.test.js`

**Interfaces:**
- Consumes: `assets/models/boss-castle.v1.glb`.
- Produces: `assets/models/boss-castle.v2.optimized.glb`, determinístico e reconstruível pelo script.

- [x] **Step 1: Escrever o teste de contrato do castelo**

Adicionar ao teste Node de assets verificações de magic/version/length do GLB, ausência de URI externa, bbox X/Z dentro de `0,02 m` da fonte sem as folhas removidas, até 25.000 triângulos, até 14 primitivas, tamanho até 1 MiB, no mínimo oito cores distintas, `MAT_Flag_Red` vermelho, `MAT_Heraldic_Blue` azul, ausência de `RB_GateDoor_Left/Right` e ausência de extensão que exija decoder. O limite inicial de 350 KiB mostrou-se incompatível com dez draws sem decoder: `join` precisa materializar vértices antes compartilhados; a decisão medida prioriza 10 draws e mantém redução de 45,8% nos bytes.

- [x] **Step 2: Confirmar RED**

Run: `node --test --test-name-pattern="castelo otimizado" test/asset-models.test.js`

Expected: FAIL porque `boss-castle.v2.optimized.glb` ainda não existe.

- [x] **Step 3: Implementar o builder reproduzível**

Usar `NodeIO` + `ALL_EXTENSIONS`; validar o SHA-256 da fonte; aplicar a paleta explícita por nome antes de deduplicar; remover as duas folhas de porta; manter dupla face apenas nos tecidos; executar `dedup` sem deduplicar materiais, `flatten`, `join`, `prune({keepAttributes:false})` e `quantize({quantizePosition:14,quantizeNormal:10})`; escrever em arquivo versionado.

Paleta:

```js
{
  MAT_Earth_Brown: 0x563a26,
  MAT_Grass_Olive: 0x69733a,
  MAT_Stone_Warm: 0x8f806d,
  MAT_Stone_Dark: 0x4b4742,
  MAT_Stone_Light: 0xb8ad9e,
  MAT_Iron: 0x35383c,
  MAT_Wood_Oak: 0x6b4426,
  MAT_Heraldic_Blue: 0x244c7a,
  MAT_Heraldic_White: 0xece8dc,
  MAT_Flag_Red: 0xa92f2f
}
```

- [x] **Step 4: Gerar, validar e confirmar GREEN**

Run: `node scripts/build-castle-model.js && node --test --test-name-pattern="castelo otimizado" test/asset-models.test.js`

Expected: PASS; o relatório do builder confirma bbox `~38,360 × 20,100 × 38,181 m`, até 14 primitivas e zero extensão de decoder.

### Task 2: Especificar layout vertical, colisão e invariantes de RNG

**Files:**
- Create: `js/castle.js`
- Create: `test/castle-layout.test.js`
- Modify: `test/city-destruction-client.test.js`

**Interfaces:**
- Consumes: `{center, heightAt, scene, csmMat, fallback}`.
- Produces: `castle` com `{status, ready, url, center, originY, floorY, foundationBottom, footprint, guardRadius, clearRadius, rigidClearRadius, gate, ramp, vehicleSurfaces, walls, platforms, roofs, foundationRoot, fallbackRoot, modelRoot, groundAt, excludesDecoration(x,z), dispose()}`.

- [x] **Step 1: Escrever testes RED para o layout**

No Chrome com seeds `424242`, `1`, `123456`, `987654`, `138` e `150`, exigir:

- `originY = max(heightAt(footprint)) + 0,05`;
- `floorY = originY + 0,16`;
- `foundationBottom <= min(heightAt(footprint)) - 0,25`;
- zero amostra do terreno acima do piso por mais de `0,05 m`;
- rampa em `+Z`, largura até `4,0 m`, extremidade externa até `zLocal=26,5`;
- muralhas, torres frontais, keep e fundação marcados `castle:true`;
- gate livre com pelo menos `3,2 m`;
- pátio, rampa, wall-walks e keep consultáveis por `groundAt`;
- antigos santuário central e torres traseiras sem colisores fantasmas;
- cobertura de chuva sobre o keep;
- teste da cidade selecionar um wall `castle:true`, não um wall não urbano arbitrário.

- [x] **Step 2: Fixar a assinatura do mundo seedado**

Gravar no teste os valores atuais da seed 424242 para `FORT_POS`, torres, cabanas, ruínas e bases, com tolerância de `1e-6`; também serializar `carSpots`, `enemyCamps` e `chestSpots`. O teste deve falhar se a separação visual consumir UUID/RNG em quantidade diferente.

- [x] **Step 3: Confirmar RED**

Run: `node --test --test-concurrency=1 test/castle-layout.test.js`

Expected: FAIL porque `Structures.castle` e os novos metadados ainda não existem.

- [x] **Step 4: Implementar a função pura de layout**

Amostrar determinística e densamente `x/z ∈ [-19,18; 19,18]`; calcular:

```js
originY = terrainMax + 0.05;
floorY = originY + 0.16;
foundationBottom = terrainMin - 0.25 - 0.05;
```

Gerar uma única tabela local de AABBs para contenções perimetrais segmentadas, muralhas, torres frontais, ponte do portão e keep. A fundação nunca pode ser um AABB cheio: a contenção frontal deve ser dividida em esquerda/direita, mantendo livre o corredor `x local ∈ [-2,30; 2,30]`, pois `Structures.collide` expulsaria o Colosso da rampa antes de seus pés atingirem o piso. Gerar plataformas separadas para pátio, rampa C1 com 12 segmentos, wall-walks e teto do keep; gerar `fieldRoofs` do keep. Manter `guardRadius=30`, `clearRadius=28`, `rigidClearRadius=49` e a rampa dentro do raio `26,5`.

- [x] **Step 5: Implementar o loader com swap atômico**

Carregar `/assets/models/boss-castle.v2.optimized.glb`; posicionar exatamente em `(FORT_POS.x, originY, FORT_POS.z)`, escala `1`, yaw `0`; nunca recentralizar. Antes do swap, validar bbox local com tolerância de `0,02 m`, número de meshes e materiais. Em sucesso, esconder fallback/flags/flames antigos e exibir o modelo. Em erro, manter fallback, registrar `castle.status='fallback'` e expor mensagem legível sem lançar erro não tratado.

- [x] **Step 6: Confirmar GREEN**

Run: `node --test --test-concurrency=1 test/castle-layout.test.js test/city-destruction-client.test.js`

Expected: PASS em todas as seeds e assinatura seedada idêntica.

### Task 3: Separar o forte legado sem deslocar o worldgen

**Files:**
- Modify: `js/structures.js`
- Modify: `test/castle-layout.test.js`

**Interfaces:**
- Consumes: `createCastle(...)`.
- Produces: `Structures.castle`, proxy novo jogável e fonte legada isolada/oculta.

- [x] **Step 1: Capturar o forte procedural**

Executar `fort()` exatamente no ponto atual. Durante a execução, direcionar seus `sbox/scone` para `fortGeos`, preservar as quatro chamadas `rand(TAU)` das bandeiras e todas as construções Three/UUID, mas não publicar seus antigos `walls`.

- [x] **Step 2: Criar fallback fora do RNG global**

Preservar `fortGeos`, flags e flames em `bossCastleLegacySource`, sempre oculto, apenas para manter UUID/RNG. Criar o proxy jogável novo a partir do layout sem RNG; só escondê-lo depois de o modelo validado estar pronto.

- [x] **Step 3: Publicar colisão síncrona**

Adicionar os AABBs do layout a `walls`, plataformas a `platforms` e roofs a `fieldRoofs` antes do retorno de `createStructures`, para que o loop Cannon de `game.js` veja o castelo completo.

- [x] **Step 4: Confirmar invariantes**

Run: `node --test --test-concurrency=1 test/castle-layout.test.js test/collision.test.js test/city-destruction-client.test.js`

Expected: PASS; nenhuma duplicação visual e nenhuma mudança nos POIs seedados.

### Task 4: Limpar a implantação sem alterar consumo de RNG

**Files:**
- Modify: `game.js`
- Modify: `test/castle-layout.test.js`

**Interfaces:**
- Consumes: `Structures.castle.excludesDecoration(x,z)` e `Structures.castle.clearRadius`.
- Produces: footprint/rampa sem árvores, pedras, flores, cactos ou grama; órbita do Golem sem obstáculo rígido até 49 m.

- [x] **Step 1: Escrever teste RED de limpeza**

Exigir nenhuma instância visível/obstáculo rígido dentro da fundação ou rampa e nenhuma lâmina de grama com escala Y maior que `0,001` no footprint.

- [x] **Step 2: Confirmar RED**

Run: `node --test --test-concurrency=1 --test-name-pattern="vegetação|grama" test/castle-layout.test.js`

Expected: FAIL porque pedras/flores/cactos não consultam sites e a grama não tem clearing do forte.

- [x] **Step 3: Implementar exclusão pós-amostragem**

Adicionar o clearing do castelo antes do `Grass.refreshAll()` final. Para árvores, pedras, flores e cactos, calcular todos os mesmos valores aleatórios na mesma ordem e só então aplicar `isExcluded`, movendo a instância para `y=-100`, escala mínima e omitindo obstáculo/corpo. Nunca introduzir `continue`, retry ou nova chamada aleatória em função do castelo.

- [x] **Step 4: Identificar corpos Cannon do castelo**

Usar `sourceId:'castle-wall'` para `b.castle`; manter o registro/removal especial da cidade inalterado.

- [x] **Step 5: Confirmar GREEN e RNG**

Run: `node --test --test-concurrency=1 test/castle-layout.test.js test/collision.test.js`

Expected: PASS incluindo assinatura seedada e clareira.

### Task 5: Manter o Colosso solo dentro e ao redor do castelo

**Files:**
- Modify: `js/boss.js`
- Modify: `game.js`
- Create: `test/castle-boss.test.js`

**Interfaces:**
- Consumes: `groundAt` e `Structures.castle.floorY`.
- Produces: spawn, respawn, idle, patrulha, tiros e retorno do Colosso na superfície jogável.

- [x] **Step 1: Escrever testes RED do Colosso**

Iniciar solo, esperar o castelo pronto e exigir:

- spawn/respawn no pátio a `floorY`;
- corpo nunca abaixo de `groundAt - 0,05`;
- saída e retorno pelo portão/rampa, sem atravessar muro/keep; retornos lateral e traseiro seguem arco dentro do raio protegido e centralizam no gate sem depender do solver;
- raio de colisão `1,5 m` passa pelo vão visual sem portas;
- orbe atravessa o gate, mas é bloqueado por muralha e keep;
- morte/afundamento usa a superfície atual, não o terreno enterrado.

- [x] **Step 2: Confirmar RED**

Run: `node --test --test-concurrency=1 test/castle-boss.test.js`

Expected: FAIL porque `js/boss.js` usa `heightAt` no pátio e no movimento.

- [x] **Step 3: Injetar uma única política de chão**

Passar `groundAt` a `createBoss`; criar helper `bossGroundAt(x,z,probeY)` e usá-lo em spawn, respawn, idle, locomoção, impacto/afundamento e colisão de orbes quando estiver sobre plataformas. Manter velocidade, leash, dano, cooldown e IA existentes.

- [x] **Step 4: Confirmar GREEN e regressões de IA**

Run: `node --test --test-concurrency=1 test/castle-boss.test.js test/autonomous-attacks.test.js test/boss-behavior.test.js`

Expected: PASS; se houver falha de navegação, repetir cada arquivo isoladamente até três vezes antes do diagnóstico.

### Task 6: Preservar patrulha e combate do Golem BR

**Files:**
- Modify: `br-game.js`
- Modify: `test/br-golem.test.js`

**Interfaces:**
- Consumes: `Structures.castle.guardRadius`, layout/colliders e `groundAt`.
- Produces: patrulha circular determinística e hook de passo controlado para QA.

- [x] **Step 1: Endurecer o teste existente**

Substituir o raio literal deduzido por `Structures.castle.guardRadius`; amostrar 360 posições e exigir distância do centro do Golem até modelo/fundação/rampa `>=2,2 m`, nenhuma interseção do corpo de raio `1,5 m`, altura finita e zero obstáculo rígido na rota. Exigir ainda que ataques à distância e pisão continuem orientados ao jogador.

- [x] **Step 2: Tornar o passo determinístico**

Expor `__BR_debug.golemDebug.step(dt)` que chama o mesmo `bossStep`; permitir o teste pilotar cooldowns/orbes sem sleeps longos e sem duplicar o passo do rAF.

- [x] **Step 3: Confirmar RED**

Run: `node --test --test-concurrency=1 test/br-golem.test.js`

Expected: FAIL no novo contrato de `castle.guardRadius`/hook determinístico.

- [x] **Step 4: Implementar consumo do contrato**

Usar `G.Structures.castle.guardRadius` com fallback defensivo `30`; manter a órbita externa no `heightAt` do terreno, pois a rampa termina antes de `26,5 m`. Exigir uma volta angular assinada/monótona completa. Não alterar armas, dano, cadência ou autoridade do servidor.

- [x] **Step 5: Confirmar GREEN**

Run: `node --test --test-concurrency=1 test/br-golem.test.js test/br-pve-weapons.test.js test/br-death-cause.test.js`

Expected: PASS.

### Task 7: Corrigir falso positivo HTTP e observabilidade

**Files:**
- Modify: `test/server.test.js`
- Modify: `test/helpers/harness.js`
- Modify: `game.js`
- Modify: `test/castle-layout.test.js`

**Interfaces:**
- Consumes: rota `/assets/models/boss-castle.v2.optimized.glb`.
- Produces: resposta GLB verificável, captura de console/rede e estado textual do castelo/Golem.

- [x] **Step 1: Demonstrar o falso positivo HTTP**

No teste atual de cache, obter a `Response`, exigir `status===200`, `content-type` GLB e bytes iniciais `glTF`. Manter temporariamente o caminho inexistente `mazda-rx7.optimized.glb`.

- [x] **Step 2: Confirmar RED**

Run: `node --test --test-name-pattern="Cache HTTP" test/server.test.js`

Expected: FAIL com HTTP 404, provando que o teste antigo passava apenas porque o 404 também recebia `Cache-Control`.

- [x] **Step 3: Corrigir o alvo e cobrir o castelo**

Apontar o teste de carro a um asset existente e adicionar o castelo versionado; exigir status 200, MIME, magic e cache longo.

- [x] **Step 4: Capturar erros antes invisíveis**

Fazer o harness armazenar `console.error` e `requestfailed` sem transformar warnings esperados em falha global. Nos testes do castelo, exigir arrays vazios.

- [x] **Step 5: Ampliar `render_game_to_text`**

Adicionar:

```json
{
  "castle": {"status":"ready","x":0,"y":0,"z":0,"guardRadius":30},
  "golem": {"alive":true,"x":0,"y":0,"z":0,"shots":0}
}
```

com valores arredondados e sem histórico.

- [x] **Step 6: Confirmar GREEN**

Run: `node --test --test-concurrency=1 test/server.test.js test/castle-layout.test.js test/br-golem.test.js`

Expected: PASS e nenhum 404/erro de loader oculto.

### Task 8: Playtest visual, desempenho e verificação final

**Files:**
- Modify: `progress.md`

**Interfaces:**
- Consumes: servidor local, cliente Playwright oficial, screenshots, estado textual, console e métricas do renderer.
- Produces: evidência final de encaixe, combate, fallback e ausência de regressão.

- [x] **Step 1: Rodar a suíte focada**

Run:

```bash
node --test --test-concurrency=1 \
  test/asset-models.test.js \
  test/castle-layout.test.js \
  test/castle-boss.test.js \
  test/castle-fallback.test.js \
  test/castle-lifecycle.test.js \
  test/castle-vehicle-surfaces.test.js \
  test/br-golem.test.js \
  test/collision.test.js \
  test/city-destruction-client.test.js \
  test/server.test.js
```

Expected: zero falhas.

- [x] **Step 2: Rodar lint e suíte completa**

Run: `npm run lint && npm test`

Expected: zero erros; qualquer teste de navegador flutuante deve ser repetido isoladamente e documentado com evidência.

- [x] **Step 3: Playtest real com Playwright**

Usar ações curtas e pausas intencionais para:

- entrar em solo, teleportar próximo ao castelo e caminhar da rampa ao pátio/keep/wall-walk;
- observar o Colosso sair, atirar, colidir e retornar;
- iniciar BR e observar uma volta da patrulha/tiro do Golem;
- chamar `render_game_to_text` e `advanceTime`;
- interceptar/bloquear o GLB em uma segunda carga e confirmar fallback funcional.

- [x] **Step 4: Inspecionar imagens e orçamento**

Capturar dia/noite em quatro ângulos, entrada, pátio, keep, rampa e Golem; inspecionar cada screenshot. Confirmar castelo único, paleta correta, ausência de terreno/vegetação atravessando, portão aberto, sombras coerentes, até 14 draw calls incrementais e console/rede sem erros.

- [x] **Step 5: Registrar bugs e resultados**

Preservar o prompt anterior no topo de `progress.md`, anexar este pedido, os bugs encontrados, decisões, comandos e resultados. Não marcar nada como concluído sem saída recente dos comandos finais.

### Task 9: Endurecer o lifecycle da prova visual

**Files:**
- Modify: `scripts/capture-world.js`
- Create: `test/capture-world-lifecycle.test.js`
- Modify: `progress.md`

- [x] **Step 1: Reproduzir RED**

Exigir que a captura use `QA_BOOT_TOKEN`, não dependa do sleep fixo de 900 ms e
possa ser importada sem iniciar servidor/navegador.

- [x] **Step 2: Autenticar prontidão e centralizar cleanup**

Validar status, marcador HTML e token do processo filho antes de abrir o Chrome.
Manter browser, servidor e rank no mesmo lifecycle; em qualquer falha, fechar o
navegador, encerrar o filho com escalada TERM/KILL e remover o arquivo
temporário.

- [x] **Step 3: Confirmar GREEN e captura real**

Run:

```bash
node --test test/capture-world-lifecycle.test.js
node scripts/capture-world.js 3318
npm run lint
git diff --check
```

Expected: 3/3 testes de lifecycle, GLB pronto/fallback visível sem erros,
nenhum listener ou rank temporário restante e verificações estáticas limpas.

- [x] **Step 4: Repetir a suíte completa no estado final**

Run: `RANK_FILE=/tmp/fps-castle-final-after-audit-rank.json npm test`

Expected: 475/475 testes, zero falhas, cancelamentos ou skips.

### Task 10: Endurecer o artefato de deploy do fork

**Files:**
- Modify: `.dockerignore`
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `test/deployment-context.test.js`
- Modify: `progress.md`

- [x] **Step 1: Reproduzir vazamento e conteúdo indevido**

Criar teste do contexto Docker exigindo que `deploy.env`, `.env*`, saídas de QA,
configuração de agentes e fontes GLB locais nunca sejam copiadas para a imagem.
Confirmar RED primeiro em `deploy.env`.

- [x] **Step 2: Preservar somente o runtime necessário**

Excluir `scripts/*` por padrão, reabrir apenas `scripts/bots.js`, manter o GLB v2
otimizado e bloquear explicitamente as fontes v1/pesadas. Confirmar GREEN no
teste de contrato.

- [x] **Step 3: Corrigir dependência dos bots em produção**

Mover `socket.io-client` para `dependencies`, pois o Docker executa
`npm ci --omit=dev` e o servidor inicia `scripts/bots.js`. Exigir no teste que
script e dependência sejam preservados juntos.

- [x] **Step 4: Construir do zero e provar a imagem**

Run:

```bash
docker build --no-cache --progress=plain -t fps-williania:castle-release-candidate .
```

Expected: build concluído; GLB v2 com SHA esperado; fonte v1, segredos e
artefatos de QA ausentes; bots e `socket.io-client` presentes.

- [x] **Step 5: Executar smoke test do contêiner**

Exigir healthcheck saudável, `/` e Socket.IO em 200, GLB v2 em 200 com bytes
exatos, fonte v1 em 404 e ausência de cabeçalho de QA.

- [x] **Step 6: Verificação de release**

Run: `RANK_FILE=/tmp/fps-castle-release-rank.json npm run quality`

Expected: código 0. Se uma navegação do Chrome destruir o contexto, o runner
deve exigir duas passagens isoladas consecutivas antes de classificá-la como
flake; qualquer falha de contrato continua vermelha.
