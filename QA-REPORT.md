# QA — Mapa de bugs do Battle Royale

Auditoria completa (código + testes) do modo Battle Royale, em duas ondas.
Formato BDD: **Dado / Quando / Então**. Suite automatizada em `test/` (`npm test`, 35 cenários de integração + unidade).

## Bugs corrigidos

| # | Sev. | Área | Bug (BDD) | Correção | Teste |
|---|------|------|-----------|----------|-------|
| 1 | 🔴 crítica | cliente | Dado que morri no BR, quando o jogo processava a morte, então caía no `location.reload()` do modo solo (`__MP_active` nunca era setado) — kill não creditada, vítima virava fantasma | `br-game.js` seta `__MP_active`; morte segue o fluxo online | Combate: kill creditada |
| 2 | 🔴 crítica | servidor | Dado um jogador com aba em segundo plano, quando ficava travado fora da safe/flutuando, então nunca morria e a partida não tinha vencedor | Zona autoritativa no servidor: elimina fora-da-zona, flutuante (>120m) e AFK | Zona: 2 cenários |
| 3 | 🔴 crítica | cliente | Dado que o servidor me eliminou (zona/AFK), quando meu cliente ainda me achava vivo, então eu virava fantasma jogando numa partida onde já morri | `playerKilled` com `victimId == eu` força morte local (`forceDeath` aplicado no primeiro frame possível) | manual |
| 4 | 🟠 alta | servidor | Dado um `state` com posição não numérica, quando repassado, então `NaN` envenenava o lerp dos outros clientes (avatar sumia pra sempre) e cegava a zona | Valida `Number.isFinite` + clamp aos limites do mundo; cliente também descarta | Estado: 2 cenários |
| 5 | 🟠 alta | jogabilidade | Dado que atirei granada/bazuca num jogador, quando explodia, então **não causava dano nenhum** (explosão só feria bots do solo) — bazuca lendária inútil | `__BR_splash()` fere remotos+boss; foguete ganhou espoleta de proximidade pra jogadores | manual (lógica client) |
| 6 | 🟠 alta | jogabilidade | Dado um foguete de bazuca, quando atravessava um prédio, então só explodia no terreno (ignorava paredes) | `Structures.segBlocked` no passo do foguete | manual |
| 7 | 🟠 alta | cliente | Dado que morri dirigindo/voando, quando virava espectador, então a câmera ficava presa no veículo | `__MP_respawn` sai do veículo antes do recap | manual |
| 8 | 🟠 alta | servidor | Dado um atirador morto/espectador ou vítima já morta, quando reportava `shotHit`, então o dano passava | Exige partida ativa + atirador e vítima vivos | Combate: 2 cenários |
| 9 | 🟠 alta | servidor | Dado o baú lendário do GOLEM, quando alguém emitia `openChest {key:'boss'}` com o boss vivo, então levava o loot lendário de graça | Só abre com `bossDead` | Loot |
| 10 | 🟡 média | servidor | Dado `deathDrop`, quando emitido repetidamente, então spawnava loot infinito | Um drop por vida (`canDrop`) | Loot |
| 11 | 🟡 média | servidor | Dado `takeDrop`, quando emitido de longe, então funcionava como aspirador de loot à distância | Exige ≤12 m do drop e estar vivo | Loot |
| 12 | 🟡 média | servidor | Dado um espectador apontado como killer, quando a vítima morria, então o espectador ganhava a kill | Espectador não credita | Combate |
| 13 | 🟡 média | servidor | Dada a sala esvaziada durante a contagem, quando a contagem acabava, então rodava partida vazia presa em `PLAYING` | Volta pro LOBBY se não sobrou ninguém | Lobby |
| 14 | 🟡 média | cliente | Dado que dois jogadores entram no mesmo carro, então os dois "dirigem" o mesmo chassi (glitch de posse) | `__BR_takenCars`: carro ocupado por remoto recusa segundo motorista ("Veículo ocupado!") | manual |
| 15 | 🟡 média | cliente | Dado que estou na nave/queda, quando alguém que pulou antes atira em mim, então eu morria a 250 m de altura | Invulnerabilidade rolante durante SHIP/FALL (aplicada pela vítima) | manual |
| 16 | 🟡 média | cliente | Dado que estou caindo de paraquedas, quando passo perto de um carro, então dava pra "entrar" nele no ar | Interação (tecla E) bloqueada enquanto `__BR_freeze` | manual |
| 17 | 🟡 média | UI | Dado o painel de configurações emprestado ao lobby, quando a tela de morte/vitória redesenhava o lobby, então o painel era **destruído** (configurações sumiam pra sempre) | `rescueSettings()` devolve o painel ao menu antes de qualquer `innerHTML` | manual |
| 18 | 🟢 baixa | UI | Dado que digito num campo (nick/chat/código), quando aperto espaço/teclas, então o jogo capturava e bloqueava a digitação | Jogo ignora teclas quando o alvo é INPUT/TEXTAREA | manual |

## Bugs corrigidos — 2ª onda (busca pesada)

| # | Sev. | Área | Bug (BDD) | Correção | Teste |
|---|------|------|-----------|----------|-------|
| 19 | 🔴 crítica | UX/áudio | Dado que a partida inicia via socket (sem clique), quando o navegador bloqueia autoplay, então o jogo ficava **MUDO** a partida inteira | `SFX.init()+resume()` no primeiro clique (gesto do usuário) | manual |
| 20 | 🔴 crítica | rede | Dada uma queda de conexão, quando o socket.io reconectava, então o servidor criava um id novo → **avatar duplicado** e identidade quebrada | `reconnect` → `location.reload()` (reentra limpo como espectador) | manual |
| 21 | 🟠 alta | exploit | Dado um tiroteio, quando o jogador aperta ESC (pausa), então ficava **imune a dano** (gas e balas) | No BR, `playerDamage` ignora a pausa; AFK backstop cobre o resto | manual |
| 22 | 🟠 alta | chat | Dado o campo de nick, quando se digita letra a letra, então o chat spammava "**fulano entrou**" a cada tecla (hello por keystroke) | Anúncio de entrada só na primeira `hello` | Lobby |
| 23 | 🟠 alta | jogabilidade | Dado um piloto de helicóptero, quando visto por outro jogador, então o avatar dele aparecia **parado no chão** embaixo do heli (alvo fantasma) | Heli sincronizado igual ao carro (pose + ocupação "Helicóptero ocupado!") | manual |
| 24 | 🟡 média | servidor | Dado um jogador morto (não espectador), quando emitia `state`, então pilotava um avatar-marionete pros outros | Servidor descarta state de morto durante a partida | Estado |
| 25 | 🟡 média | anti-cheat | Dado o roster broadcast, então a **posição de todos** ia pra todo mundo (wallhack de graça via console) | `pos` só no init; broadcast sem posição | manual |
| 26 | 🟡 média | servidor | Dado um item de drop forjado (campos gigantes, índices inválidos, HTML), então era armazenado e re-emitido como veio | Sanitização de formato: só campos conhecidos com limites | Loot |
| 27 | 🟡 média | grief | Dado um espectador, quando emitia `openChest`, então **queimava o baú** dos vivos | Baú exige jogador vivo | Loot |
| 28 | 🟢 baixa | servidor | Dado `fromPos` não numérico no tiro, então a seta de dano da vítima recebia NaN | Validação/fallback [0,0,0] | manual |

## Bugs corrigidos — 3ª onda (reporte do usuário) + anti-cheat

| # | Sev. | Área | Bug (BDD) | Correção | Teste |
|---|------|------|-----------|----------|-------|
| 29 | 🟠 alta | visual | Dada a neve caindo, quando os flocos giravam no eixo Y, então viravam quadrados "de lado" (riscos/formato errado) | Flocos hexagonais (CircleGeometry 6 lados) sempre de frente pra câmera, rodopiando no próprio plano | manual |
| 30 | 🟠 alta | mundo | Dado o ciclo dia/noite, quando cada cliente rodava o próprio relógio (pausa, aba oculta, slow-mo de morte), então **cada jogador via um horário diferente** | Horário = função pura do relógio da partida (`todAt(matchT)`), aplicado todo frame; validado em jogo: tod exato pro tempo decorrido | manual |
| 31 | 🟠 alta | mundo | Dado o clima (chuva/neve), quando cada cliente sorteava o próprio, então um via neve e outro sol | Clima determinístico por `seed ^ época` (troca a cada ~75s), igual em todo cliente; validado: override manual é corrigido em 1s | manual |

### Anti-cheat adicionado (servidor)

| Proteção | Regra | Teste |
|----------|-------|-------|
| Speedhack/teleporte | >90 m/s horizontal ou >120 m/s vertical → posição rejeitada; 10 rejeições seguidas re-ancoram (lag legítimo); >120 strikes → expulso | Anti-cheat |
| Abuso do flag "nave" | Dizer que está na nave fora do tempo/rota real (>60m da rota conhecida) → rejeitado e vira AFK pra zona | Zona |
| Dano infinito | Orçamento de 520 dano/s por atirador (pior caso legítimo: fuzil automático só de headshot ≈ 450/s) | Anti-cheat |
| Dano no boss | Orçamento de 1200/s por jogador (cap por hit continua 150) | Loot (boss) |
| Farm de baús | Intervalo mínimo de 300ms entre aberturas | Anti-cheat |
| Já existentes | 12 hits/s, cap 95/hit, baú single-open, drop por proximidade, 1 drop/vida, formato de item sanitizado | suite |

## Testes de unidade novos (`test/plan.test.js`)

- **300 seeds de plano**: 5 fases de zona, raio sempre encolhe, tempos crescentes, centro dentro do mapa, próximo círculo **contido** no atual (senão a safe teleporta)
- **zoneAt ao longo de 900s**: raio monotônico, zona final dói mais
- **500 baús**: tipos conhecidos, arma 0–3 com munição, limites de valores, todas as raridades aparecem

## Comportamentos verificados pela suite (já corretos)

- Sanitização de nick e chat (HTML removido), anti-spam de chat (1,2 s)
- Anti-flood de tiros (máx. 12/s) e teto de dano por mensagem (95)
- Baú abre uma única vez; corrida entre jogadores resolve no servidor
- Suicídio não credita kill; colocação (#) correta; ranking ordenado no fim
- Só o host inicia; código errado negado; host não migra ao desconectar

## Limitações conhecidas (não corrigidas — decisão de escopo)

- **Anti-cheat é leve**: posição dos baús não é validada no servidor (cliente gera pelo seed); dano é reportado pelo atirador (com teto + flood control)
- **Morte por lobo** aparece no feed como "morreu pro gás" (animais continuam ativos no BR)
- **Ranking global em disco**: some quando o serviço reinicia no free tier (cada navegador guarda espelho em localStorage)
- **Pickups do modo solo** continuam spawnando no BR (loot extra de chão — tratado como feature)
- **Dois cliques rápidos** no mesmo drop por jogadores diferentes: o primeiro ack ganha (comportamento correto, mas o segundo vê o item sumir "na mão")

## Knobs de teste (env vars)

`COUNTDOWN_S`, `NEXT_IN_S`, `FLY_TIME`, `BR_FAST` (acelera a zona autoritativa) — usados pela suite; em produção ficam nos padrões.
