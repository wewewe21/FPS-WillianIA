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

## Pendências (arquiteturais, mapeadas — sem correção nesta rodada)

- **Bots não conhecem paredes/árvores/LOS** (`scripts/bots.js`): reconstroem só
  terreno/baús; podem mirar através de cobertura. Exige colisores/nav
  determinísticos no processo dos bots ou autoridade de mundo no servidor.
- **Integridade client-authoritative** (`server.js`): o servidor ainda aceita o
  dano informado pelo atirador e killer/causa informados pela vítima. Mitigado
  por validações de alcance/orçamento/flood, mas sem histórico autoritativo.

