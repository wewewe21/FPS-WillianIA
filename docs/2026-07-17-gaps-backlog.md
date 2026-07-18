# Backlog de gaps — consolidado 2026-07-17

Pendências conhecidas das rodadas recentes (armas/ADS, terreno/biomas/clima,
QA do BR). Cada item tem contexto, custo estimado e gatilho. Itens de
segurança ficam propositalmente NEUTROS aqui — detalhes vivem em documento
externo ao repositório.

## Arquitetural (decisão consciente, não esquecimento)

| # | Gap | Estado | Gatilho pra atacar |
|---|---|---|---|
| 1 | Robustez server-side adicional (Tier 1) — servidor validaria geometria/estado além dos limites atuais (budget/range/rate/crédito). Blocker técnico: geometria das structures depende de canvas/DOM + rand global; caminho mapeado em doc externo | **ADIADO por decisão de 2026-07-14** | telemetria de produção acusar evento impossível |
| 2 | Bots não conhecem paredes/LOS (`scripts/bots.js`) — mesmo blocker do item 1; o builder puro de paredes resolveria os dois | aberto | junto com o item 1 |

## Rodada de armas (2026-07-17)

| # | Gap | Custo |
|---|---|---|
| 3 | Silhuetas remotas: DMR e Sniper dividem a mesma; sem animação de recarga/mecanismo nos remotos | M |
| 4 | Red dot: ponto ~4–6 px do centro geométrico do aro (dentro da tolerância do teste) | P |
| 5 | Luneta 2x do fuzil usa retículo 3D sem overlay (decisão registrada no plano) — trocar é 1 campo do perfil | P |
| 6 | Mão do rig fica ~0,65 m da âncora (origem no punho + clamp do IK — pré-existente, idêntico ao baseline); braço estica no hip da bazuca | M |
| 7 | heldWeapon remoto some por flag na nave/queda — sem animação de transição/coldre | P |

## Rodada de terreno/clima (2026-07-17)

| # | Gap | Custo |
|---|---|---|
| 8 | **DOCUMENTADO (2026-07-17)** — causa-raiz MEDIDA não é atrito: o caminhão ENCALHA DE BARRIGA (caixa do chassi toca o terreno ~348/360 frames) em subida DIAGONAL ≥14°; rampa alinhada nunca estola. Dois mecanismos executados e descartados com telemetria (hillAwd e grip de arranque com gate — dist idêntica até com slip 8). Fix real = clearance do collider (half.y/offset) → capotamento/colisão, task própria, DECISÃO PENDENTE do dono. Contrato em `test/car-hillstart.test.js` (it da rampa em `todo`, acusa quando resolver) | decisão |
| 9 | **RESOLVIDO (2026-07-17)** — gota/floco classificado POR FRAME pela posição MUNDIAL (`js/env.js`); chuva externa visível por porta/janela; nave cobre o volume REAL do casco (`ShipProto.coversPoint`); `camExposure` só em som/relâmpago/transição | — |
| 10 | **RESOLVIDO (2026-07-17)** — `Structures.fieldRoofs` (torre + cabana, metadado puro sem RNG) com source `'campo'` no cover; ruína/forte abertos por design; imune ao evento da cidade (testado) | — |
| 11 | **RESOLVIDO (2026-07-17)** — `Grass.stampTrack` + atributo `aTrack` por lâmina; rodas traseiras em contato >2 m/s; some em ~10 s; zera na reciclagem do chunk; zero corpos físicos | — |
| 12 | **INSTRUMENTADO (2026-07-17)** — probe físico node (`scripts/probe-hillstart.mjs`: Δ 5 m×2,5 m desprezível em rampa uniforme) + `?segs=440` no cliente + protocolo/gate de adoção no mapa (`docs/plans/2026-07-17-gaps-8-13-mapa.md`). DECISÃO pendente de medição no Chrome real do Will. Adoção nunca é por cliente (muda layout do mundo pro mesmo seed) | medir |
| 13 | **FECHADO (2026-07-17)** — mantido `DAY_LEN=480`; gatilho de reabertura = playtest do SOLO acusar ritmo (aí é `todRate` do modo solo, nunca segundo relógio) | — |

## Testes / infra

| # | Gap | Custo |
|---|---|---|
| 14 | e2e Python da cidade (`npm run test:e2e`) não rodado nas rodadas de hoje (suíte JS 433/433 ok) | P |
| 15 | Flakes de carga: boot de browser >60 s com processo pesado paralelo — protocolo "isolado 2–3×" documentado, mas custa re-runs | M |
| 16 | `npm test` exige Node 21+ (glob) e quebra no Windows do Will — herdado do merge | P |
| 17 | Validação visual só com screenshots estáticos — sem vídeo/GIF de recarga/golden hour | P |

## Fora de escopo, anotado

| # | Item |
|---|---|
| 18 | `ak-47_reddot.glb` no repo, não mapeado no arsenal (não trocar sem aval) |
| 19 | `br-rank.json` (M) e `assets/models/boss-castle.v1.glb` (??) são do dev — nunca staged |
| 20 | PR pro upstream do Will pendente — rodadas de armas + terreno estão só no fork |

## Ordem sugerida

**20** (PR — barato, destrava o Will) → **8** (sente no gameplay) → **10/9**
(imersão da chuva) → **1/2** somente se o gatilho disparar.
