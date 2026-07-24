# FPS-WillianIA — Battle Royale multiplayer (Node + socket.io + three.js)

Cliente three.js (`game.js`, `br-game.js`, ES modules em `js/`), servidor
socket.io (`server.js`). Leia os invariantes abaixo ANTES de mexer — cada um já
quebrou o jogo antes.

## Invariantes (quebram o jogo se ignorados)

- **A ordem de consumo do `Math.random` seedado é um contrato.** A geração do mundo
  (`js/terrain.js`, `js/grass.js`, `js/structures.js`, baús) consome `rand` numa
  ordem fixa a partir do seed. Inserir, remover ou reordenar consumo muda o layout
  do mundo E quebra a reconstrução do terreno feita por bots/servidor a partir do
  mesmo seed. Ao mexer em worldgen, preserve a ordem — ou difira a geração pro fim
  (ex.: acumular clareiras e recriar a grama depois).
- **A destruição da cidade é mecânica INTENCIONAL do servidor** (mísseis, causa
  `city`, `city-destruction-protocol.js`). Nunca tratar como bug de colisão/dano;
  correções não podem bloquear os projéteis nem a cinemática.
- **Modelo client-authoritative com anti-cheat no servidor.** `server.js` valida
  dano/acertos (budget de dano, limite de flood, range, crédito de kill via
  `hitBy`). Ao mexer em combate no servidor, não reabra vetores — há
  `test/security-regression.test.js` cobrindo isso. Detalhes sensíveis de exploit
  ficam FORA do repo.
- **A fonte do castelo nunca é asset público.** Os GLBs autorais
  `castelo_reconstruido_escala_real.glb` e
  `assets/models/boss-castle.v1.glb` são locais/ignorados e o servidor bloqueia
  a v1. O runtime é `boss-castle.v2.optimized.glb`, reconstruído por
  `npm run build:castle`. Como recebe cache imutável, qualquer mudança de bytes
  exige uma v3 e a atualização conjunta do loader e dos testes.

## Testes

- **Suíte completa:** `npm test` (`scripts/run-tests.js` já roda sequencial com
  `--test-concurrency=1`; ~15–30 min conforme a carga gráfica).
- **Um arquivo:** `node --test test/<arquivo>.test.js`.
- **Vários arquivos à mão:** SEMPRE `--test-concurrency=1` — testes de browser usam
  portas fixas por arquivo que colidem em paralelo. (Testes de socket usam portas
  dinâmicas altas 21000+/26000+/31000+, sem colisão.)
- **Flake ≠ bug.** Testes de browser (puppeteer-core + Chrome/swiftshader) têm
  portas fixas e o boot da página pode passar de 60 s sob carga. Antes de chamar
  uma falha de regressão: re-rode SÓ aquele arquivo isolado 2–3×. O runner exige
  duas passagens isoladas consecutivas para classificar flake; se continuar
  falhando, é regressão real.
- **Não matar a porta 3000** — costuma ser o servidor ao vivo do dev.
- **e2e:** `npm run test:e2e` (Python, precisa de ambiente/Chrome).
- **TDD:** teste primeiro (RED), implementa (GREEN). `npm run lint` limpo (eslint,
  `no-unused-vars` é erro).

## Commits

- Não expor IP, DNS ou detalhes de infraestrutura/deploy em commits nem em docs.
