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
| 4 | **NÃO REPRODUZ (2026-07-18)** — ótica exata (0,00 px numérico, ≤1 px renderizado); '4–6 px' era viés de centroide (base do mount oculta o arco inferior do aro). Régua dot↔aro ≤2 px adicionada ao weapon-ads (RED provado por perturbação) | — |
| 5 | **RESOLVIDO (2026-07-18)** — `scope2x` reticle 'cross'→'overlay' (1 campo, weaponrig.js); ADS 8/8 + aim 7/7 | — |
| 6 | Mão do rig fica ~0,65 m da âncora (origem no punho + clamp do IK — pré-existente, idêntico ao baseline); braço estica no hip da bazuca | M |
| 7 | heldWeapon remoto some por flag na nave/queda — sem animação de transição/coldre | P |

## Rodada de terreno/clima (2026-07-17)

| # | Gap | Custo |
|---|---|---|
| 8 | **RESOLVIDO (2026-07-18)** — collider do caminhão em 2 caixas (casco y[0.05..0.85] no footprint + barriga y[-0.25..0.05] só entre eixos, `cfg.shapes`): corredor de estol 1,2→51,4 m, reta 87 km/h, árvore ainda para o carro, crista continua pendurando (por construção). Causa era ENCALHE DE BARRIGA, não atrito — 2 mecanismos de tração descartados por medição antes (`test/car-hillstart.test.js`) | — |
| 9 | **RESOLVIDO (2026-07-17)** — gota/floco classificado POR FRAME pela posição MUNDIAL (`js/env.js`); chuva externa visível por porta/janela; nave cobre o volume REAL do casco (`ShipProto.coversPoint`); `camExposure` só em som/relâmpago/transição | — |
| 10 | **RESOLVIDO (2026-07-17)** — `Structures.fieldRoofs` (torre + cabana, metadado puro sem RNG) com source `'campo'` no cover; ruína/forte abertos por design; imune ao evento da cidade (testado) | — |
| 11 | **RESOLVIDO (2026-07-17)** — `Grass.stampTrack` + atributo `aTrack` por lâmina; rodas traseiras em contato >2 m/s; some em ~10 s; zera na reciclagem do chunk; zero corpos físicos | — |
| 12 | **FECHADO (2026-07-18)** — MEDIDO em Chrome real (GPU): p95 20,0→19,7 ms (vsync), tris +9%, heap +135 MB; benefício físico inexistente após o fix do collider (encalhe de barriga era a causa, resolvido em 5 m). Recusado — 5 m fica; `?segs=440` vira ferramenta de medição. Números no mapa | — |
| 13 | **FECHADO (2026-07-17)** — mantido `DAY_LEN=480`; gatilho de reabertura = playtest do SOLO acusar ritmo (aí é `todRate` do modo solo, nunca segundo relógio) | — |

## Testes / infra

| # | Gap | Custo |
|---|---|---|
| 14 | **FECHADO (2026-07-18)** — e2e rodado 3×: 22-23/24, falhas variam por rodada e todas passam em outra = flake de SwiftShader (documentado no próprio script); zero regressão | — |
| 15 | Flakes de carga: boot de browser >60 s com processo pesado paralelo — protocolo "isolado 2–3×" documentado, mas custa re-runs | M |
| 16 | **OBSOLETO (2026-07-18)** — já resolvido por `scripts/run-tests.js` (enumera testes em JS, roda em node ≥18 em qualquer SO; `engines: >=18`); suíte validada 2× em node 20 | — |
| 17 | Validação visual só com screenshots estáticos — sem vídeo/GIF de recarga/golden hour | P |

## Fora de escopo, anotado

| # | Item |
|---|---|
| 18 | `ak-47_reddot.glb` no repo, não mapeado no arsenal (não trocar sem aval) |
| 19 | `br-rank.json` (M) e `assets/models/boss-castle.v1.glb` (??) são do dev — nunca staged |
| 20 | **MORTO (2026-07-18)** — projeto é PRÓPRIO (decisão do dono): sem upstream do Will; PR/merge interno no nosso repo |

## Ordem sugerida

Rodada 8–13 concluída (2026-07-18): 8/9/10/11 resolvidos, 12 medido e
recusado, 13 mantido. Restam **3–7** (polish de armas), **14–17** (infra) e
**1/2** somente se o gatilho disparar.
