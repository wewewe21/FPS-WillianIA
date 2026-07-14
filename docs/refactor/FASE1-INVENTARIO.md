# Fase 1 — Inventário de Redução de Código

Data-base: 2026-07-14 · branch `refatoracao` · Node 20.20 · ESLint 10.

Objetivo do projeto de refatoração: **reduzir código mantido sem alterar
funcionamento, aparência, jogabilidade, protocolo multiplayer ou desempenho.**
Extrair o mesmo código para arquivos novos **não conta** como redução.

## Ferramentas instaladas (devDependencies)

| Ferramenta | Uso | Script |
|---|---|---|
| ESLint 10 | lint + complexidade/tamanho de função (regras ad-hoc) | `npm run lint` |
| Knip 6 | arquivos/exports/deps mortos | `npm run analyze:dead` |
| jscpd 5 | clones (duplicação exata) | `npm run analyze:duplicates` |
| Madge 8 | dependências circulares | `npm run analyze:cycles` |
| cloc 2 | contagem de linhas | `npm run analyze:lines` |

`knip.json` define os entry points reais (index.html carrega `game.js` como
módulo + `multiplayer-client.js` → carrega `br-game.js` dinamicamente;
`server.js` é o main; `scripts/` e `test/` são CLIs; `js/minimap-worker.js` é
Web Worker por string).

## Baseline (fonte própria do projeto, exclui node_modules/.venv/tests-python)

```
JavaScript   74 arquivos   15.783 linhas de código  (952 blank, 1.220 comment)
```

Sem os testes: ~11.947 linhas nos arquivos de runtime.

### 30 maiores arquivos (linhas totais)

| Linhas | Arquivo | | Linhas | Arquivo |
|--:|---|---|--:|---|
| 2055 | game.js            | | 251 | js/grass.js |
| 1581 | br-game.js         | | 249 | scripts/stress.js |
| 973  | server.js          | | 226 | js/alien.js |
| 513  | js/structures.js   | | 213 | js/animals.js |
| 467  | js/enemies.js      | | 210 | js/skeletons.js |
| 466  | multiplayer-client.js | | 192 | js/weaponmodels.js |
| 423  | scripts/bots.js    | | 190 | js/sfx.js |
| 392  | city-destruction-client.js | | 174 | js/amb.js |
| 341  | js/fpbody.js       | | 169 | js/grenades.js |
| 326  | js/boss.js         | | 160 | js/night.js |
| 322  | js/car.js          | | 145 | js/env.js |
| 308  | js/weapons.js      | | 144 | js/terrain.js |

## Código morto — Knip (praticamente zero)

- **0 arquivos mortos.**
- **0 exports não consumidos.**
- **1 devDependency não usada:** `@gltf-transform/cli` — ferramenta manual de
  compressão de GLB, invocada à mão, não referenciada em código. Candidata a
  remover **se** não faz parte do fluxo de build de assets. *(decisão pendente)*
- 2 imports com path `/js/...` (barra inicial) em testes novos
  (`animals-combat.test.js`, `skeletons.test.js`) — knip não resolve; conferir
  se resolvem em runtime do harness.

> A limpeza anterior (`_q1`/`_m1` removidos, `no-unused-vars` como erro no
> ESLint) já zerou o dead-code trivial. **Não há ganho relevante na Fase 2.**

## Duplicação — jscpd (1,82%)

26 clones exatos, **218 linhas duplicadas** (1,82% de 43 arquivos). Maiores:

| Tokens | Bloco A | Bloco B | Natureza |
|--:|---|---|---|
| 285 | night.js 80-99 | skeletons.js 31-50 | build de personagem/inimigo |
| 279 | capture-fp.js | capture-world.js | boilerplate puppeteer (scripts do Will) |
| 166 | capture-fp.js | capture-world.js | idem |
| 125 | charmodels.js 49-62 | fpbody.js 67-82 | modelo de personagem |
| 100 | bots.js 27-33 | stress.js 40-47 | cliente socket.io de teste |
| 89 | charmodels.js 53-60 | scenery.js 95-102 | material/geometria |

Duplicação **exata** é pouca. O ganho maior é **semântico** (jscpd não pega):
comportamento repetido entre sistemas.

## Dependências circulares — Madge

**0 no código do projeto.** (Os 2 achados são bundles do Playwright em `.venv`,
fora de escopo.)

## Funções gigantes (ESLint `max-lines-per-function`)

| Linhas | Função | Arquivo |
|--:|---|---|
| **1432** | `start` | br-game.js *(quase o arquivo inteiro num closure)* |
| 444 | `createStructures` | js/structures.js |
| 415 | `createEnemies` | js/enemies.js |
| 406 | `boot` | server.js |
| 336 | `boot` | game.js |
| 306 | `createBoss` | js/boss.js |
| 280 | `createWeapons` | js/weapons.js |
| 277 | `createFpBody` | js/fpbody.js |
| 276 | `createCar` | js/car.js |
| 214 | `createGrass` | js/grass.js |
| 211 | `createAlien` | js/alien.js |
| 206 | `createAnimals` | js/animals.js |
| 183 | `createSFX` / `createSkeletons` | js/sfx.js / js/skeletons.js |
| 164 | `update` | js/enemies.js |
| 153 | `applyFpsCamera` | game.js |
| 149 | `fire` | game.js |

**Padrão dominante:** ~28 módulos `js/` seguem `createX(...) → { update, ... }`.
Cada um monta THREE meshes/materiais/geometrias à mão e roda um `update` por
frame. É aí (estado + comportamento repetidos entre sistemas), e no `start`
monolítico do br-game.js, que mora a redução real.

## Complexidade ciclomática (ESLint `complexity`, top)

| CC | Função | Arquivo |
|--:|---|---|
| 70 | `update` | js/enemies.js |
| 60 | `playerUpdate` | game.js |
| 49 | `update` | js/boss.js |
| 46 | `update` | js/car.js |
| 38 | `update` | js/animals.js |
| 33/31 | `update` / `shootUpdate` | js/skeletons.js / br-game.js |
| 29 | `tick` | game.js |
| 27 | `bossStep` | game.js |
| 25 | `explode` | js/grenades.js |

## Estado global e ciclo de vida

- **~30 globais `window.__*`** (`__BR_active`, `__MP_remotePlayers`, `__FP_pose`,
  `__CityDestruction`, `__game`…): barramento entre os 4 scripts do cliente que
  carregam separados (não é grafo de módulos). Acoplamento **intencional**, não
  morto — **não mexer sem mapear consumidores** (quebra multiplayer).
- **Timers:** game.js 10, br-game.js 8, sfx.js 16 (agendamento de áudio),
  server.js 6. Clears presentes onde importa (game.js 4, server.js 2). Sem
  vazamento observável — jogo SPA, listeners vivem o ciclo da página.
- **Listeners:** game.js 18 `addEventListener`, 0 `removeEventListener` — por
  design (teclado/resize/pointer globais durante toda a sessão).

## Roadmap por (maior redução × menor risco)

Ordem recomendada. Cada etapa: lint + test antes/depois, commit separado,
métricas (arquivo-alvo, linhas transferidas, **redução líquida do repo**,
duplicações eliminadas, arquivos removidos).

1. **[baixo risco]** Remover código morto já identificado (`_q1`/`_m1`,
   `capture-car-models.js`) — pendente, sem impacto de gameplay.
2. **[médio, alto ganho]** Fábrica compartilhada de material/geometria/mesh
   para os `createX` (dedup semântica do padrão dominante). Só extrair com ≥2
   usos concretos e redução líquida comprovada.
3. **[médio]** Unificar helpers de personagem (charmodels/fpbody/skeletons/night)
   — clones de 125/285 tokens + build repetido.
4. **[médio]** `bots.js` × `stress.js`: extrair cliente socket.io de teste comum.
5. **[alto risco, alto ganho]** Fatiar o `start` de 1432 linhas do br-game.js em
   sistemas — **só com testes de compatibilidade de protocolo Socket.IO**.
6. **[opcional]** `capture-fp.js` × `capture-world.js` (scripts do Will):
   boilerplate puppeteer comum — decidir com o dono do upstream.

Regra de ouro (skill): **nunca declarar redução só porque game.js encolheu.**
Reportar sempre a **redução líquida do repositório**.

## Resultado (2026-07-14) — parada consciente

Executado e commitado (5 commits, suíte 278/278 verde, lint limpo):

| Commit | Etapa | Net |
|---|---|---|
| tooling+inventário | 0 | — |
| `_q1`/`_m1` + capture-car-models | 1 (código morto) | ‑71 |
| `meleeBlocked` → `js/aihelpers.js` | 2a | ‑13 |
| `shipPosAt` reusado (3 cópias→1) | 2a | ‑12 |
| `prepRiggedMesh` → `js/meshutils.js` | 2a | ~0 (mata clone 125 tok) |

**Redução líquida ≈ ‑96 linhas (~0,8%).** Modesta **porque a base já está no
piso**: dead code zero, dup exata 1,82%, zero ciclos. As funções grandes são
grandes por fazerem trabalho **distinto**, não por repetição.

**NÃO fazer (decisão registrada pra não reabrir):**

- **Fábrica mesh/material / `capBrightness` centralizado:** é **net-NEGATIVO**.
  Cada site troca 2 linhas do tone-cap por 1 call + 1 linha de `import` → saldo
  **+lines**. O código de material já é terso; extrair só adiciona boilerplate.
  Valor seria single-source da constante `0.72`, não redução. **Não vale.**
- **Fatiar o `start()` de 1432 linhas do br-game.js:** é **extração** (move
  linhas entre arquivos, net ≈ 0), não redução, e carrega risco ALTO de
  protocolo/multiplayer. Só faz sentido como objetivo "organizar", não "reduzir".
- **Unificar deslize-em-obstáculo (skeletons/animals/night):** ~‑12 linhas, mas
  os fatores de slide e raios divergem por criatura de propósito (afinação de
  navegação). Risco médio pra ganho marginal. Adiado.

Ferramentas de análise (`npm run analyze:*`, `refactor:check`) e a skill
`codebase-reduction` ficam pra manter a higiene daqui pra frente.
