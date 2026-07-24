Original prompt: eu adicionei uns projetos em 3d. local uns carros, quero substituir os carros do jogo por eles, mas com performante e teste, consegue? outra coisa acho que em cada partida reiniciada os baus nao estao resetando, cuidado pra nao criar bugs e faca os testes

## Estado atual

- Identificados três modelos-fonte na raiz: `gumball_car.glb`, `low-poly_truck_car_drifter.glb` e `mazda_rx7_stylised.glb`.
- Diagnóstico do reset: `match.openedChests` só é limpo em `startMatch()`. O evento `nextMatch` recarrega os clientes antes disso; o novo `init` do lobby ainda contém os baús abertos da partida encerrada.
- Perfil dos fontes: Gumball 6,52 MB / 456.052 vértices renderizados; caminhão 1,42 MB / 47.676; RX-7 409 KB / 17.199. O Gumball também usa cerca de 26 MB de texturas descomprimidas na GPU.
- Otimização experimental em `/tmp`: Gumball 1,15 MB / 137.041 vértices; caminhão 421 KB / 46.347; RX-7 80 KB / 14.616, todos sem decoder adicional em runtime (`KHR_mesh_quantization`).

## Próximos passos

- Criar e observar falhar o teste de regressão do baú entre partidas.
- Corrigir a limpeza na transição para o lobby e rodar o teste novamente.
- Gerar derivados otimizados em `assets/models/`, integrar um carregador com cache e fallback e manter as colisões/física existentes.
- Adicionar teste de carregamento/normalização/custo dos modelos e testar direção, colisões e screenshots no navegador.

## Ciclo concluído: reset dos baús

- RED confirmado: o novo teste recebeu `openedChests: ['c1']` no `init` após `nextMatch`.
- GREEN confirmado: `resetRoundState()` agora limpa baús, drops e posse de carros antes de publicar o lobby; o teste focado passou (1 teste, 0 falhas).

## Ciclo concluído: modelos dos carros

- RED confirmado: `test/car-models.test.js` falhou inicialmente porque `Car.ready` não existia.
- Três derivados gerados em `assets/models/` com `KHR_mesh_quantization`, sem decoder extra no navegador.
- O RX-7 foi gerado sem o nó `Floor`; o caminhão foi gerado sem 12 nós de fumaça e sem uma animação que o jogo não executava, permitindo consolidar as malhas.
- `js/car.js` agora carrega/cacheia cada fonte uma vez, clona geometria/material, normaliza X/Z ao collider, apoia o modelo no chão e mantém fallback barato.
- Rodas procedurais duplicadas foram substituídas por proxies `Object3D` invisíveis usados apenas pela física/poeira.
- GREEN confirmado: teste de modelos passou; lint completo passou sem erros.

## Playtest visual

- O cliente oficial de web game entrou numa partida real; `render_game_to_text` confirmou 6 veículos com `model: ready` e não produziu arquivo de erros de console.
- Screenshots individuais foram capturados e abertos para os três arquétipos.
- A inspeção encontrou o RX-7 preto sem contraste; foi aplicado material Standard nas variantes vermelha/azul e o teste passou de RED para GREEN.
- A inspeção também encontrou o RX-7 invertido no eixo de direção; `modelYaw: Math.PI` foi registrado em teste e confirmado visualmente com a dianteira em `+X`.

## Verificação final

- `RANK_FILE=/tmp/fps-final-verification-rank.json npm test`: 139 testes, 139 passaram, 0 falhas, 0 cancelados, 0 ignorados.
- `npm run lint`: concluído com código 0.
- Testes Chrome/WebGL agora rodam com `--test-concurrency=1`; em paralelo o SwiftShader perdia contextos e gerava falsos negativos.
- Assets finais: Gumball 1.147.872 bytes / 31.991 vértices únicos; RX-7 79.564 / 4.038; caminhão 354.612 / 14.303. Total: 1.582.048 bytes e 50.332 vértices únicos compartilhados.
- `br-rank.json` permaneceu fora do escopo; a verificação final redirecionou ranking para `/tmp`.

## Correções da 3ª rodada de QA (bugs #40–42 + lacunas da auditoria)

Os bugs #40–42 mapeados acima foram corrigidos e cobertos por testes
(`test/skeletons.test.js`, `test/br-golem.test.js`, `test/animals-combat.test.js`).
Na sequência, as lacunas da auditoria de combate foram fechadas:

- **Protocolo dedicado de explosivos (`explosionHit`)**: granada/bazuca não viajam
  mais por `shotHit` — o servidor valida o PONTO DE IMPACTO (não a arma equipada
  nem a posição do atirador). Granada com FACA equipada funciona; a cobertura da
  vítima parte do impacto; kill segue creditada ao atirador. Tipos fora de
  GRANADA/BAZUCA (ex.: `MÍSSEIS`) são rejeitados — o evento de destruição da
  cidade continua exclusivo do servidor (`byCity`, causa `city`, sem crédito de
  kill). Arquivos: `server.js`, `br-game.js`, `js/grenades.js`, `js/rockets.js`;
  testes: `test/br-explosion-protocol.test.js` (7 casos).
- **Criaturas da noite**: mordida do zumbi/fantasma agora exige linha de visada
  (parede, árvore, pedra, andar de cima/baixo) e o movimento tem guarda de NaN
  quando o jogador está exatamente acima/abaixo. `js/night.js` + `game.js`
  (injeção de `obstaclesNear`); testes: `test/night-combat.test.js`.
- **Loot de bots em morte ambiental**: `dropLootOnce` idempotente — bots mortos
  por gás, cidade ou AFK também soltam loot (antes só morte por tiro).
  `scripts/bots.js`; testes em `test/bots-behavior.test.js`.
- **Tiro humano que ERRA replicado**: `__BR_shotMiss` → `shotFired` (throttle de
  220ms), cobrindo hitscan e projéteis balísticos que morrem em parede/expiram.
  `game.js`, `br-game.js`; teste em `test/br-cover.test.js`.
- **Onda de choque no carro respeita cobertura** (`blastClear` também no impulso).
  `js/grenades.js`; teste em `test/explosives.test.js`. Para o teste unitário,
  `cannon-es@0.20.0` entrou como devDependency (no browser vem do importmap/CDN).
- **Testes desatualizados pelo anti-cheat novo**: arma inexistente (`HACK`) agora é
  descartada inteira (ganhou teste próprio); flag `ship` forjado fora da rota é
  rejeitado e vira INATIVIDADE (ganhou teste próprio); o teste da zona usa um
  jogador parado no gás sem flag forjado. Vazamento de estado entre testes de
  `br-pve-weapons` corrigido (esqueleto vivo na frente da câmera).

## Correções da rodada de playtest (2026-07-13, reports do Renato)

- **Loot lento / "baú sem nada"**: `rollChest` dava só munição em 38% dos baús
  (inútil pra quem nasce de faca). Agora ≥88% entregam ARMA (`server.js`;
  teste de taxa em `test/plan.test.js`).
- **Baú do heliponto vazio**: a caixa no telhado da TORRE NEXUS era decoração
  do modo solo. No BR virou baú de verdade (key `torre`) com recompensa fixa
  do servidor: BAZUCA + colete + kit (`server.js`, `br-game.js`; testes em
  `server.test.js` e `br-cover.test.js`).
- **Atirar do helicóptero**: o gate de tiro bloqueava `state.flying`. Liberado;
  a origem do disparo é o HELI (não a câmera de perseguição, que o servidor
  rejeitaria por ficar ~10m atrás da posição autoritativa) e o HUD de munição
  continua visível a bordo (`game.js`, `js/heli.js`; teste em
  `gameplay.test.js`). Granada segue bloqueada em voo.
- **Carros flutuando/enterrados**: fora da cidade o heightfield físico (grade
  de 4m) diverge do terreno visual; o modelo agora ancora no `heightAt` — na
  cidade mantém as rodas (asfalto acima do terreno). Resolveu também o flake
  do caminhão no `car-models.test.js` (`js/car.js`).
- **Física do carro**: teto de velocidade por veículo (buggy 72 / caminhão 84 /
  esportivo 118 km/h) e direção sensível à velocidade (esterço cheio parado,
  ~40% no talo) — sem isso o esportivo saturava o esterço e "não virava"
  (`js/car.js`).
- **Grama sob veículos**: clareiras de grama em todas as vagas de carro + o
  buggy do spawn (`js/grass.js`, `game.js`). ⚠️ Lição: a criação da Grass NÃO
  pode mudar de posição no init — ela consome o `rand` seedado e qualquer
  reordenação muda o layout do mundo inteiro pra mesma seed (3 testes de
  mundo quebraram). Solução: array de clareiras por referência +
  `Grass.refreshAll()` no FIM do init.
- **Modelo do carro re-ancora quando parado**: o chassi continua assentando
  depois do alinhamento inicial; parado e fora da cidade o modelo re-ancora
  no terreno visual continuamente (só aritmética, sem Box3) — `js/car.js`.

## Pendências (arquiteturais, mapeadas — sem correção nesta rodada)

- **Bots não conhecem paredes/árvores/LOS** (`scripts/bots.js`): reconstroem só
  terreno/baús; podem mirar através de cobertura. Exige colisores/nav
  determinísticos no processo dos bots ou autoridade de mundo no servidor.
- **Integridade client-authoritative** (`server.js`): o servidor ainda aceita o
  dano informado pelo atirador e killer/causa informados pela vítima. Mitigado
  por validações de alcance/orçamento/flood, mas sem histórico autoritativo.

---

# Atualização: assets 3D completos (armas, corpo FP, monstros, cenário)

Prompt original: integrar a pasta assets/models/ reorganizada (Armas/, Cenários/,
Personagens/, Veículos/) — trocar personagem principal (mãos rigadas em 1ª pessoa),
monstros, armas e cenário; conferir as melhorias pendentes; publicar no GitHub.

## Correções antes de tudo

- Carros estavam QUEBRADOS: a reorganização em subpastas invalidou os caminhos de
  js/car.js. Corrigidos código + teste; o servidor agora serve assets/models/
  inteiro via express.static restrito (a whitelist manual não escalava pra ~25
  arquivos novos).
- harness de teste acha o Chrome no Windows — a suíte inteira (inclusive
  Chrome/WebGL) roda agora na máquina do Willian igual rodava no cloud.

## Ciclo concluído: armas GLB em primeira pessoa (js/weaponmodels.js)

- 7 modelos integrados no padrão do car.js (cache, normalização por bounding box,
  fallback procedural): M4→FUZIL, shotgun pesada→TROVÃO, sniper pesada→DMR,
  bazooka(otimizada 9,2MB→0,8MB)→BAZUCA, arma do alien→PLASMA, e DUAS ARMAS NOVAS:
  SNIPER "AGULHA" (idx 6) e ESCOPETA "RAJADA" (idx 7), com loot/teclas 7-8/balística.
- Auto-orientação: o eixo mais comprido do modelo deita em Z; muzzleAnchor
  reposicionado pra ponta real (flash/tracer saem do cano do GLB).
- A AGULHA usa as animações EMBUTIDAS do GLB ("reload"/"bolt_slide") encaixadas na
  duração real de recarga/ciclo, e os nós mag_4/bolt_6 do modelo foram religados
  nas âncoras parts.mag/parts.bolt — a coreografia de recarga existente move
  geometria real do modelo.

## Ciclo concluído: corpo rigado em primeira pessoa (js/fpbody.js)

- O helldiver (51 ossos, dedos individuais) fica pendurado na câmera, ancorado por
  bounding box (pescoço no olho, cabeça escondida via scale 0 do osso).
- IK analítico de 2 ossos por braço mirando as MESMAS âncoras (gun.parts.handR/L)
  que a coreografia de recarga já anima — pente saindo, tapa, bombeada e sway
  continuam com o timing original, agora com braços e dedos de verdade.
- Punho por alinhamento geométrico: o eixo real dos dedos (medido do rig) alinha
  com a direção da empunhadura + uma rolagem calibrável por mão. Dedos com presets
  por arma (indicador no gatilho, pegada de bomba, faca) e afrouxam na recarga.
- Pernas caminham no ritmo da velocidade (visíveis ao olhar pra baixo), capa
  balança, respiração no peito. Na queda/paraquedas a arma some (mãos nas alças).
- Descobertas do caminho: GLTFLoader remove pontos dos nomes de ossos
  ("Arm_1.L"→"Arm_1L"); braços do modelo são curtos (escala 1.18 pra alcançar o
  grip); waitForFunction do puppeteer usa polling por rAF — com rAF congelado pra
  screenshot determinístico é preciso polling por intervalo.

## Ciclo concluído: monstros rigados (js/charmodels.js)

- Guardiao.glb (Punch/Shoot/Walk embutidas) substituiu o corpo procedural dos
  soldados (clone de esqueleto por instância): Walk com peso pela velocidade,
  Shoot a cada rajada, e SOCO novo quando o player cola (9 de dano, telegrafado,
  cooldown 2,4s). Flash religado no nó MuzzleFlash do próprio rig. Executivos
  (suit) continuam procedurais — são civis. FSM/hitbox/balanceamento intactos.
- Alien otimizado (5,5MB→1,2MB, rig+Take 001 preservados) substituiu o corpo do
  VISITANTE, com a animação embutida em loop. Morte/blink/orbes intactos.

## Ciclo concluído: cenário (js/scenery.js)

- Árvores GLB "assadas" em geometria única com vertex colors → continuam
  instanciadas (1 draw call por variante). Variantes: retorcida, bosquete de
  pinheiros, tocos (8%), e a "giant tree" — que na verdade é uma ILHA FLUTUANTE
  com bonsai — virou marco raro (1/40, só em floresta).
- Materiais texturizados (cor-base branca) recebem paleta de fallback no bake —
  sem isso os pinheiros saíam fantasmas.
- POIs novos com colisão (player+veículos) e baús automáticos do BR: MERCADO na
  beira da cidade, REFÚGIO NA ÁRVORE na floresta, barris espalhados.

## Melhorias da lista do Willian (auditoria)

- Já resolvidas em ciclos anteriores: ping no HUD, música/vento removidos, drop de
  munição ao matar, carro visível pros outros, save removido, dia 3x mais longo
  que a noite, salto automático da nave, opções de gráficos/áudio, código de
  anfitrião, cabine interna do OVNI.
- NOVO watchdog de aba oculta: quem alt-tabava na queda ficava pendurado no ar,
  imortal fora da zona, e a partida não terminava — agora um setInterval (roda em
  segundo plano) faz a queda grosseira e aplica o dano do gás quando o rAF morre.
- SFX: variação de pitch por disparo (rajada não vira metrônomo) e som próprio de
  facada (SFX.melee) no lugar do som de troca de arma.

## Verificação

- npm run lint: 0 erros. Suíte completa + test/asset-models.test.js novo (GLBs
  válidos com rig/animações + integração viva no Chrome).
- Playtest visual: output/fp/ (armas nas mãos, recarga, ADS, corpo em 3ª pessoa)
  e output/world/ (Guardião, Visitante, floresta nova, mercado, refúgio) — todos
  capturados sem erros de console.

## Verificação final

- `npm run lint`: 0 erros.
- Suíte completa: **149 testes, 149 passaram, 0 falhas** (Windows + Chrome
  headless/SwiftShader), incluindo os 7 novos de assets 3D.
- Consertos que a suíte puxou: spawn do Visitante (nascia enterrado usando a
  altura do disco), bounding box ciente de pose no charmodels, teste de loot
  atualizado pro arsenal de 8 armas, teste de engajamento da IA determinístico,
  e RNG próprio pros POIs/árvores (o rand() global em bloco assíncrono quebrava
  o mundo compartilhado entre clientes).

## Novo pedido: castelo GLB (2026-07-23)

Prompt adicional: "eu tenho um castelo, que fiz em .glb, quero adicionar ele no
lugar do castelo do jogo, mas ele precisa se encaixar perfeitamente, o robô que
atira precisa continuar ao redor protegendo o castelo, isso precisa ser muito bem
implantado e testado, para não quebrar ou corromper, encontre bugs".

- Plano TDD salvo em
  `docs/superpowers/plans/2026-07-23-castle-glb-integration.md`.

### Asset e implantação

- As fontes locais/ignoradas `castelo_reconstruido_escala_real.glb` e
  `assets/models/boss-castle.v1.glb` são cópias byte a byte: 1.716.420 bytes,
  SHA-256 `fd05cc2fa6aebcd73d16440280b90074624a67bd67e9fc385017ced525e18449`.
  O servidor bloqueia a v1; ela nunca é servida nem versionada.
- `npm run build:castle` gera deterministicamente
  `assets/models/boss-castle.v2.optimized.glb`: 930.236 bytes, SHA-256
  `6020def3614d8c32a91d8ccb1d2867c8fe62f07b4c34b89cc1a8ae2339c0b966`,
  10 meshes/primitivas, 24.488 triângulos, 10 materiais, bbox aproximada
  `38,360 × 20,100 × 38,181 m` e somente `KHR_mesh_quantization`.
- `js/castle.js` virou a fonte única de verdade: publica layout, fundação,
  portão, colliders, pisos, coberturas, rampa, clareiras e lifecycle antes do
  carregamento assíncrono. O GLB só substitui o proxy visual depois de validação
  semântica completa; download, parse ou modelo inválido mantêm fallback
  jogável.
- O forte antigo continua sendo construído oculto como
  `bossCastleLegacySource`, apenas para preservar geometrias, UUIDs e a ordem
  exata do RNG. Ele não publica colisores nem aparece como fallback.
- A rampa de entrada usa perfil C1 com 12 segmentos, a mesma função `heightAt`
  no terreno lógico/IA, uma malha visual e um único `CANNON.Trimesh`. A clareira
  visual/grama tem 28 m; obstáculos rígidos são removidos em 49 m para proteger
  o Golem na órbita de 30 m.
- O Colosso nasce/respawna no pátio, usa a superfície do castelo para andar,
  morrer e disparar, e retorna pelo portão em arco
  `rear/front-side → side-front → gate-side → gate → home`. O Golem BR continua
  completando voltas orientadas ao redor do castelo e mantendo ataques/pisão.

### Bugs encontrados e corrigidos

- Nove dos dez materiais autorais renderizavam brancos; o builder aplica paleta
  explícita antes da otimização.
- Fundação de 1,1 m deixava o terreno atravessar o pátio; o encaixe agora mede
  extremos do terreno e cria fundação/piso contínuos.
- Portas autorais deixavam 1,18 m e prendiam o Colosso de raio 1,5 m; as folhas
  foram removidas e o vão/colliders foram alinhados.
- Colliders antigos não correspondiam às torres/keep e criavam paredes
  atravessáveis e obstáculos invisíveis.
- A primeira rampa linear excedia 41,97° na seed 138 e lançava o carro; depois,
  caixas Cannon segmentadas criaram faces internas e o prenderam. O perfil C1,
  a rejeição de sites acima de 30° e o Trimesh único corrigiram ambos.
- `groundAt` ainda interpolava a rampa linearmente e divergia até 24,76 cm da
  malha/física curva; agora consulta `ramp.heightAt`.
- A seed 138 permitia base na órbita e a 150 permitia a cidade destruída sobre
  a rota. Reservas de 30 m para bases e 120 m para cidade corrigiram sem novas
  chamadas RNG; a assinatura completa da seed 424242 continua idêntica.
- Vegetação rígida, grama e chunks interiores podiam invadir fundação/rampa; a
  exclusão pós-amostragem preserva o consumo aleatório.
- O retorno lateral/traseiro usava cantos a 42,4 m e depois tolerância de 2 m no
  portão, penetrando a ombreira em até ~44 cm. A rota agora fica dentro do raio
  reservado, usa tolerância de 20 cm e deslocamento limitado sem depender do
  solver de colisão.
- O lifecycle retinha efeitos, materiais CSM e corpos lógicos; o descarte agora
  remove cada recurso uma vez, inclusive se ocorrer durante o loading.
- O teste HTTP de GLB aceitava 404 com `Cache-Control`; agora exige status, MIME
  e magic `glTF`, e a fonte v1 é negada.
- Readiness podia aceitar servidor antigo na mesma porta; um token por processo
  identifica o filho correto. Outro race iniciava a partida antes de
  `br-game.js` registrar `matchStart`; o harness agora espera prontidão e
  identidade do socket. Em QA, o ping timeout maior preserva a identidade
  durante ticks manuais longos; promessas de falha também são limpas.
- O capturador visual ainda esperava 900 ms fixos e abria o Chrome fora do
  lifecycle protegido: boot lento/porta ocupada podia validar um servidor velho
  e falha no `launch` deixava processo/rank temporário órfãos. Agora ele exige o
  token do filho atual, verifica HTML/status, encerra com TERM/KILL e limpa o
  rank mesmo quando o navegador não chega a abrir.
- Os testes continham falsos verdes em bases vazias, chunks de grama,
  publicação atômica, descarte agregado, registries CSM, visual da rampa,
  descarte assíncrono, volta do Golem e impacto do orbe. Todos foram endurecidos.

### Evidência recente

- Builder executado duas vezes com o mesmo tamanho e SHA-256.
- `castle-layout`: 8/8 em seis seeds; `castle-boss`: 6/6; lifecycle 3/3;
  fallback 3/3; veículos 2/2; Golem 6/6.
- Após corrigir os races do harness, `br-death-cause` passou 3× 4/4 e
  `br-drops` passou 3× 5/5. O teste determinístico que atrasa `br-game.js` por
  60 s também passou.
- O teste do capturador reproduziu RED e depois passou 3/3: rejeita processo
  antigo, aceita apenas o token correto e prova limpeza após falha do Chrome.
- `npm run lint` e `git diff --check`: limpos.
- `npm run quality` final terminou com código 0: **478 testes descobertos**,
  477 passaram na rodada principal e `castle-layout.test.js` perdeu o contexto
  do Chrome durante uma navegação. Não houve falha de contrato; o runner
  repetiu o arquivo isoladamente e só classificou como flake depois de
  **duas passagens consecutivas**.
- Capturas inspecionadas:
  `output/world/castelo-frente.png`, `castelo-patio.png`,
  `castelo-rampa-fundacao.png`, `castelo-keep-lateral.png`,
  `castelo-noite.png`, `castelo-fallback.png` e
  `output/castle/golem-patrulha-castelo-atual.png`; sem erros de
  página/console/rede. O capturador endurecido foi executado novamente na porta
  3318, confirmou GLB `ready` com 10 meshes e fallback jogável, e deixou a porta
  e o rank temporário limpos.

### Endurecimento da imagem de produção

- Um teste de contrato do contexto Docker reproduziu e bloqueou três falhas:
  `deploy.env`/`.env*` podiam entrar no `COPY . .`; diretórios de QA e agentes
  inchavam a imagem; e a regra que excluía `scripts/` também removia
  `scripts/bots.js`, embora o servidor o execute em produção.
- `.dockerignore` agora exclui configuração local, saídas e fontes pesadas,
  inclui somente o script de bots necessário e mantém o GLB v2 de runtime.
  `socket.io-client`, exigido pelos bots, passou a ser dependência de produção.
- Build Docker limpo, sem cache: concluído. O contrato interno confirmou o GLB
  v2 com SHA-256
  `6020def3614d8c32a91d8ccb1d2867c8fe62f07b4c34b89cc1a8ae2339c0b966`,
  fonte v1/configuração/QA ausentes, bot presente e carregamento de
  `socket.io-client` funcional.
- Smoke test do contêiner local: healthcheck saudável, `/` e Socket.IO em 200,
  GLB v2 em 200 com 930.236 bytes e SHA esperado, fonte v1 em 404 e nenhum
  cabeçalho de QA exposto.
