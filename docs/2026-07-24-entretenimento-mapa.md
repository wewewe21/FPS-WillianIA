# Mais entretenimento no mapa — 10 ideias + a entrega desta rodada

Data: 2026-07-24 · Branch: `feat/canhao-circo` (fork nosso, a partir de `refatoracao`)

Contexto: o jogo já está avançado e sólido (game-feel bom, 8 armas, cidade
destrutível, boss, veículos). O que falta é **diversão** — e o pedido foi tom
**leve**, sem medo, funcionando **solo E em grupo**, dentro dos limites de ser
HTML + three.js no navegador. Diagnóstico central da auditoria de código:

- **Solo não persiste nada** — morrer é `location.reload` apagando tudo; não há
  começo/meio/fim nem razão pra voltar.
- **A partida não celebra nada** — matar dá o MESMO "X" branco de raspar de longe.
- **O mapa tem vazios sem função** — cantos e campos abertos que são cenário morto.

---

## As 10 ideias (do maior impacto pro menor)

Levantadas por leitura completa do código (loop BR, solo, combate, mundo,
veículos, loot/HUD, orçamento de perf) e filtradas por viabilidade real +
impacto de diversão + tom leve.

1. **Extração — a run solo acaba quando VOCÊ decide** (M · solo). Ponto de
   resgate no mapa; segura E e sai com seus pontos + recorde salvo. Cria a
   decisão "sair rico ou arriscar mais". Ganchos: cauda do `pack()`, ramo em
   `Interact.current()`, reusa `#deathScreen`. PRNG próprio (nunca o rand seedado).
2. **Entrega Aérea / Piñata** (M · multi). Airdrop anunciado que cai no círculo;
   piñata abre na porrada e cospe loot. Primeira razão POSITIVA pra ir a um lugar.
   Reusa `match.drops` + `io.emit('dropSpawn')`.
3. **Regra Maluca da Rodada** (M · ambos). Modificador sorteado por partida
   ("Gravidade de Lua", "Baús Generosos"). `rollChest` já aceita `luck` que nunca
   recebeu; `skySync` já reescreve clima todo frame.
4. **A Coroa do Castelo** (M · multi). Pegue a coroa no keep e vire o Rei caçado
   por todos; quem te mata rouba. Usa só a API síncrona do castelo (não toca asset).
5. **Som posicional** (P · ambos). `js/sfx.js` não tem UM PannerNode — tiroteio a
   40 m é mudo. Pan + ganho por distância fecha a maior lacuna sensorial.
6. **Saque das Ruínas** (M · multi). Depois dos mísseis, caixas brilhantes nascem
   nas crateras. Vira do avesso o único evento do jogo. 100% aditivo.
7. **Pipoca de Alvos** (M · solo). Campo de tiro de feira com recorde. ⚠️
   `generateUUID` consome o rand seedado — criar geometria fora do stream.
8. **Kill Confirmado** (P · ambos). Hitmarker em 3 sabores + câmera lenta na kill
   que fecha a partida. Retorno positivo puro.
9. **BOING — telhados viram cama elástica** (P · ambos). Verticalidade que já
   existe vira playground. Sem dano de queda, errar é engraçado.
10. **Quadro da Fogueira** (M · solo). Contratos curtos que destravam 3 armas
    órfãs (FACA/SNIPER/RAJADA, idx 5-7, hoje inalcançáveis no solo).

**Cortadas por custo/risco agora:** Caído & Resgate (revive — mexe em
`checkVictory`, superfície de anti-cheat), Bolão de praia (cannon-es sem CCD),
Rampas de carro (colide com o conversor de superfície do castelo em voo).

---

## O que foi ENTREGUE nesta rodada — 🎪 O Canhão de Circo

Escolha para "mais entretenimento num ponto vazio do mapa, funcional e de grande
impacto, solo E em grupo", com **superfície de teste mínima**: não é modo novo,
não toca o servidor, não reabre anti-cheat nem netcode, e não encosta no pipeline
do castelo (que está em integração).

### O que o jogador sente

Numa clareira deserta longe de tudo há um canhão de circo listrado. Você chega,
**mira virando o corpo** (o cano acompanha pra onde você olha), aperta **E** e —
depois de um assobio que sobe — é **CUSPIDO num arco gigante** rumo à cidade, com
confete e um "FIUUU-BUM". Como **não existe dano de queda no jogo**, cair em
qualquer lugar é engraçado, nunca punição. Ao pousar: `🎪 VOOU 63 m · recorde 78 m`.

- **Solo:** brinquedo + viagem rápida pra ação + **recorde de distância** salvo
  (localStorage) — dá "o que fazer" e vontade de repetir/afinar a mira.
- **Grupo:** entrada dramática no tiroteio, revezar no canhão, disputar recorde.
  Os outros te veem voar (posição já é replicada pela rede).

### Como funciona (técnico)

- **`js/cannon-core.js`** — núcleo PURO (sem THREE/DOM): perfil de lançamento,
  guarda anti-cheat, escolha determinística do ponto e recorde. Mesmo código no
  navegador e nos testes de Node.
- **`js/cannon.js`** — `createCannon(deps)`: constrói a atração (geometria em
  `noSeed`, no FIM do init → **nunca desloca o rand seedado do worldgen**),
  escolhe o **ponto mais vazio/seco/plano** num anel ao redor da cidade
  (determinístico, sem rand → igual em todos os clientes), e roda a máquina de
  estado carga→voo→pouso, confete (`FX.confetti`) e som (`SFX.cannon*`).
- **`game.js`** — campo `player.launchT`; ramo **balístico** no `playerUpdate`
  (mantém o momento horizontal em voo, sem controle de solo); cria o canhão pós
  `Grass.refreshAll()`; `Cannon.update` no loop; hook `__game.Cannon` p/ QA.
- **`js/interact.js`** — ramo do canhão em `current()` (funciona no solo E no BR,
  a pé, longe de veículo/baú).
- **`js/fx.js`** — `confetti()` (reaproveita o pool de partículas).
- **`js/sfx.js`** — `cannonWind/cannonFire/cannonLand` (áudio procedural, zero asset).

### Segurança de invariantes

- **Worldgen:** geometria em `noSeed` + criada depois de todo o worldgen; ponto
  escolhido por matemática determinística sobre `Structures.sites` (sem rand).
- **Anti-cheat:** lançamento a 38 m/s @52° → **vh≈23,4 · vy≈29,9 m/s**, com folga
  enorme dos tetos do servidor (strike 55, rejeição 90/120). Testado em voo real.
- **Castelo:** nada tocado — nem asset, nem loader, nem `build:castle`.

### Testes

- `test/cannon-core.test.js` — 12 testes puros (Node, sem porta): perfil dentro
  do anti-cheat, arco divertido (40–90 m, apogeu 12–30 m), `pickSpot`
  determinístico/seco/plano/vazio, recorde.
- `test/cannon.test.js` — 4 testes de browser em **BR ativo** (porta própria
  3260): nasce longe de estruturas, dispara num arco e volta ao chão, NUNCA
  estoura o anti-cheat, sem erros de página.
- Regressão verificada (sem quebra): `gameplay` (31), `collision` (21),
  `br-cover` (4), `terrain-physics` (3). `npm run lint` limpo.

### Integração com `refatoracao`

Feito num worktree isolado (a bateria do castelo rodava na árvore principal).
Consolidado em `feat/canhao-circo` e depois mesclado em `refatoracao` (merge
limpo, sem conflito).

---

## Segunda rodada — 🎪 mais 5 atrações no mapa

Mesma filosofia do canhão (client-side, geometria em `noSeed` pós-worldgen,
pontos espalhados por `pickSpot` evitando estruturas E as outras atrações, tom
leve, solo E grupo). Reúnem-se em `js/maptoys.js` (+ núcleo puro
`js/maptoys-core.js`), com uma única fiação em `game.js` (criação, `update` no
loop, `tryBounce` no pouso) e um ramo no `js/interact.js`.

1. **🤸 Cama Elástica** — 4 placas coloridas; cair numa quica você pra cima
   (15 m/s, encadeável). Gancho: `MapToys.tryBounce()` no bloco de pouso do
   `playerUpdate`. Sem dano de queda, errar é festa.
2. **🎯 Campo de Tiro (Pipoca de Alvos)** — puxe a alavanca (E) e 6 alvos
   pipocam por 30 s; acerte o máximo (recorde salvo). Reusa o contrato de
   `extraTargets` do hitscan — acerto/dano/hitmarker de graça.
3. **🎆 Totem de Fogos** — aperte E e solte uma salva de fogos coloridos no
   céu. Puro deleite cosmético, com recarga. Todos por perto veem.
4. **💫 Aros de Acrobacia** — curso de 6 aros que sobem e descem num arco rumo
   à cidade; atravesse na ordem (a pé, de carro, de heli OU cuspido pelo
   canhão!) contra o relógio. Recorde de tempo. Detecção geométrica pura
   (`passedRing`), com guarda de teleporte pra respawn/pouso não contar.
5. **🎹 Xilofone Gigante** — 8 placas coloridas; pise em cada uma e ela toca
   uma nota da escala (sempre alegre). Faça música sozinho ou em grupo.

### Segurança (idêntica ao canhão)

- **Worldgen:** toda a geometria em `noSeed`, criada depois de todo o worldgen;
  pontos por matemática determinística sobre `Structures.sites` (sem `rand`).
- **Anti-cheat:** o único que mexe em velocidade é a cama elástica (15 m/s,
  travado em 28) — folga enorme dos tetos do servidor.
- **Servidor/castelo:** nada tocado.

### Testes

- `test/maptoys-core.test.js` — 12 testes puros (quica, `passedRing`,
  `plateAt`, recordes, `pickSpot` com `avoid`).
- `test/maptoys.test.js` — 7 testes de browser em BR ativo (porta 3261): as 5
  nascem espalhadas/secas, a cama quica, a alavanca abre sessão e o alvo
  pontua, os fogos recarregam, o aro avança o curso, o xilofone registra a
  placa pisada, sem erros de página.
