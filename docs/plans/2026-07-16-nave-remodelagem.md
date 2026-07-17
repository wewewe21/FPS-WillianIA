# Remodelagem da Nave de Entrada — Plano de Implementação

> **For agentic workers:** Executar tarefa a tarefa, TDD (RED→GREEN). SEM COMMIT — o
> usuário pediu explicitamente para não commitar/push sem autorização.

**Goal:** Nave 3× maior (Ø36 m), cabine caminhável com referencial móvel local,
protocolo `shipLocal` validado no servidor, sem abrir mão do anti-cheat.

**Architecture:** Um helper puro compartilhado (`ship-protocol.js`, mesmo padrão de
`city-destruction-protocol.js`) centraliza dimensões, pose no tempo (com bob senoidal
idêntico cliente/servidor), conversões local↔mundo, slots concêntricos e validação.
O cliente trata a nave como referencial móvel (posição local persistente + clamp
analítico circular); o servidor reconstrói a posição mundial autoritativa a partir
do relógio dele + local validado.

**Tech Stack:** three.js 0.184 (procedural, sem assets externos), socket.io, node:test.

## Global Constraints (da spec)

- Não usar Blender/modelos externos; só geometria procedural three.js.
- Não atualizar three.js; não adicionar dependência nova; não tocar cidade/armas/veículos.
- Não substituir o controlador FPS global (`playerUpdate` continua fora durante SHIP).
- Nenhuma validação de servidor removida; `d.*` do cliente é sempre não-confiável.
- Grupo raiz com escala (1,1,1); dimensões nas geometrias; zero números mágicos duplicados.
- Sem commit/push. Preservar working tree não relacionado (br-rank.json, e2e-shots, glb, investigate-5players.js).
- `npm run lint` limpo (baseline tem 1 erro preexistente em scripts/investigate-5players.js — não é desta tarefa).
- Testes browser: portas fixas, rodar com `--test-concurrency=1`. Porta nova: **3167** (livre).

## Baseline registrada (antes de editar)

- branch `refatoracao`, HEAD `82e11b4`; working tree com modificações não relacionadas (acima).
- `npm run lint`: 1 erro preexistente (`scripts/investigate-5players.js:61 no-unused-vars 'G'`).
- `npm test`: rodando em background; resultado anotado no relatório final.

## Diagnóstico confirmado no HEAD

| Item | Onde | Valor atual |
|---|---|---|
| Casco | br-game.js:359 | `CylinderGeometry(9, 12, 2.4, 24)` (Ø24 m) |
| Cabine | br-game.js:381-392 | r=8, piso Y=-0.95, teto Y=+1.35 → 2.30 m livres |
| Assento | br-game.js:414-416 | hash do id em grade 0.9 m, eixos MUNDIAIS, sem exclusividade |
| Posição no voo | br-game.js:1480 | sobrescrita por frame (`pos.set(centro+seat)`) — sem caminhada |
| Remotos | br-game.js:1410 | lerp em posição mundial absoluta (atrasam vs nave) |
| Colisão jogador-jogador | br-game.js:1454 | só em PLAY |
| Nick | br-game.js:52-54 | sprite y=2.35 (acima do teto 1.35), `depthTest:false` |
| Validação server | server.js:642-646 | `ship:true` aceito com raio horizontal ≤60 m da rota; sem piso/teto/velocidade local |
| Imunidade | server.js:496-500 | `if (p.ship) return true` — booleano cru; cliente que para de mandar estado fica imune até mandar outro |
| Bob vertical | br-game.js:408 vs server.js:435 | cliente `sin(tm*1.7)*1.2`, servidor ignora (diverge) |
| Teste atual | br-drops.test.js:129-139 | só janela + nº de filhos |

## Dimensões novas (fonte única: `ShipProtocol.DIMS`)

```js
const DIMS = {
  outerRadius: 18,        // Ø externo 36 m (34–38 ✓)
  cabinRadius: 13.2,      // Ø útil 26.4 m (≥25 ✓)
  floorY: -1.45, ceilingY: 3.25,   // 4.70 m livres (4.2–4.8 ✓)
  windowRadius: 4.4,
  wallMargin: 0.22, playerRadius: 0.42,   // walkRadius = 13.2-0.42-0.22 = 12.56
  walkSpeed: 4.0,                          // m/s (3.6–4.4 ✓)
  bobAmp: 0.55, bobFreq: 0.9,              // nave pesada; idêntico client/server
  floorTol: 0.35,                          // tolerância vertical do shipLocal
  maxLocalSpeed: 9,                        // 4.0 de caminhada × folga de rede 2.25 (documentada)
};
```

Consoles periféricos: 6 arcos (ângulo k·60°+30°, meia-largura 0.16 rad, face interna
r=12.3) — collider por clamp radial dentro do arco (`clampToCabin` trata parede E consoles).

---

### Task 1: `ship-protocol.js` + `test/ship-protocol.test.js` (puro, TDD)

**Files:** Create `ship-protocol.js`, `test/ship-protocol.test.js`.

**Produces (interface consumida por tudo que segue):**
- `DIMS` (acima) e `CONSOLES` (`[{ang, halfArc, innerR}]`)
- `walkRadius()` → `DIMS.cabinRadius - DIMS.playerRadius - DIMS.wallMargin`
- `routeYaw(ship)` → `Math.atan2(to[0]-from[0], to[1]-from[1])` (espelho do cliente atual)
- `poseAt(ship, t, out?)` → `{x,y,z,yaw,k}`; `y = alt + sin(t*bobFreq)*bobAmp`; k clampado [0,1.18]
- `localToWorld(pose, local, out?)` / `worldToLocal(pose, world, out?)` — arrays `[x,y,z]`,
  rotação Y convenção three.js (`wx = cos·lx + sin·lz; wz = -sin·lx + cos·lz`)
- `slotLocal(i)` → `[x,z]` local; 5 anéis r=5.8..12.2 (passo 1.6), ângulo `floor(i/5)`·(2π/cap(anel)),
  anel `i%5`; ≥64 únicos, dist ≥1.1, todos ≤ walkRadius; determinístico; índice além da
  capacidade total: wrap `i % total` com fase extra (determinístico)
- `sanitizeLocal(v)` → `[x,y,z]` ou `null` (array len===3, todos number finitos — custo constante)
- `localInCabin(l)` → raio ≤ walkRadius()+0.05 E `|y-floorY| ≤ floorTol`
- `clampToCabin(local{x,z} mutável, playerRadius)` → parede circular + arcos de console;
  distância zero segura; clamp radial (preserva tangencial)

Testes (16.1/16.2/16.8/16.10-parcial): faixas de dimensão, NaN-free, round-trip
local↔mundo em vários yaw/rotas, slots 64 únicos/dist/dentro, clamp (fora→walkRadius,
centro exato, console, deslizamento), sanitize (NaN/Inf/curto/enorme/string→null).

### Task 2: servidor — slots, validação `shipLocal`, imunidade (TDD socket)

**Files:** Modify `server.js`; Create `test/ship-security.test.js` (portas dinâmicas 23xxx).

- `require('./ship-protocol.js')`; `PUBLIC` += `'ship-protocol.js'`.
- `startMatch()`: atribui `match.plan.shipSlots = {id: idx}` (ordem de inserção,
  não-espectadores); `p.shipLocalPrev = slotLocal(idx)` (âncora do speed-check), `p.shipLocalT = t0`.
- `socket.on('state')`, ramo `d.ship` (substitui o check de 60 m):
  1. `t > flyTime+8` → strike, return (regra existente preservada);
  2. `pose = poseAt(plan.ship, t)` com **relógio do servidor**;
  3. `d.shipLocal` presente → `sanitizeLocal` (inválido → strike+return, lastState NÃO renova);
     ausente (legado/bot antigo) → `local = worldToLocal(pose, pos)`, `local[1]=floorY`
     (caminho legado NÃO é menos seguro: mesmas checagens abaixo; remoção documentada);
  4. `localInCabin(local)` falha → strike+return;
  5. velocidade local vs `p.shipLocalPrev` (dt mínimo 0.05 s) > `maxLocalSpeed` → strike+return;
  6. aceita: `pos = localToWorld(pose, local)` (posição mundial RECONSTRUÍDA — `d.pos` ignorado),
     `p.shipLocal = local`, broadcast `playerUpdate` ganha `shipLocal`.
- `combatImmune(p)`: `if (p.ship) return !!match.plan && (Date.now()-match.t0)/1000 <= flyTime+8;`
  (mata imortalidade por parar de mandar estado / forjar após o fim).
- Campos extras do cliente (timestamp, slot) são simplesmente ignorados (nunca lidos).

Testes: shipLocal válido aceito+reconstruído; raio/piso/teto/NaN/Inf/curto/enorme/string
rejeitados sem propagar; teleporte local e speedhack local rejeitados; `ship:true` pós-voo
vira INATIVIDADE (existente); parar de mandar estado com p.ship=true não mantém imunidade
após flyTime+8 (youWereHit chega); pos mundial lixo + local válido → reconstruída; local
inválido + mundo válido → rejeitado; slot/timestamp do cliente ignorados.

### Task 3: cliente — remodelagem + controlador cinemático + sync

**Files:** Modify `br-game.js`, `index.html` (script tag antes de multiplayer-client).

- `buildShip()`: grupos nomeados `shipExterior` (casco inferior em camadas, faixa do rim,
  casco superior, cúpula ~r7 32×16 integrada, anel energético torus preservado girando,
  16 luzes laranja `InstancedMesh`, 3 emissores inferiores instanciados, placas segmentadas
  instanciadas) e `shipInterior` (`cabinePiso` com espessura visual + aro da janela,
  `cabineParede` BackSide 64 seg, `cabineTeto`, `cabineJanela` (r=4.4, y=piso-0.02),
  12 nervuras instanciadas, 2 faixas emissivas, 6 consoles instanciados alinhados aos arcos
  do protocolo, marcações no piso, luz teto/janela moderadas). Materiais/geometrias
  compartilhados; zero alocação por frame; retorno `{g, ring}` preservado.
- Estado novo: `let shipLocalPos = null` (Vector3 local, y=floorY); inicializa no primeiro
  frame SHIP via `plan.shipSlots[INIT.id]` → `slotLocal` (fallback hash determinístico).
  Remove `seat/seatOx/seatOz` (lint).
- Bloco da nave movido para ANTES do loop de remotos no `brTick`; pose via `poseAt`
  (bob idêntico ao servidor); `rotation.y = pose.yaw`.
- `shipWalk(dt, pose)` (fase SHIP, chat fechado, vivo, não pausado): yaw da câmera via
  Euler YXZ (estável em pitch ±1.55), frente `(-sin,−cos)`, direita `(-fz,fx)` (mesma
  convenção do fallStep); normaliza (diagonal não acelera); mundo→local por rotação
  −pose.yaw; move `walkSpeed·dt`; colisão jogador-jogador local (min 2·raio+0.06,
  empate exato desempatado por comparação de id, sem div/0); `clampToCabin`;
  `y=floorY` sempre; `localToWorld` → `MP.player.pos`; `vel.set(0,0,0)`.
  `__BR_freeze` continua true (playerUpdate/gravidade/terreno ficam fora).
- `jumpFromShip()`: mantém pos mundial exata (já é a reconstruída), `shipLocalPos=null`.
- Envio 10 Hz: fase SHIP adiciona `shipLocal:[x,y,z]`.
- `playerUpdate` remoto: guarda `rp.shipLocalT/rp.shipLocalC` (arrays finitos, ship=true);
  no tick, remoto em nave interpola LOCAL e converte com a pose ATUAL (grupo direto,
  sem lerp mundial → sem atraso); pés em floorY; sem shipLocal (server antigo) cai no
  caminho mundial atual; ao pular (ship=false) volta ao lerp mundial normal.
- `nickSprite`: `depthTest: true` (não vaza por teto/casco); y=2.35 agora < teto 4.7.
- `__BR_debug.ship` (getter) passa a expor também `{dims, walkRadius, local(), slot()}`.
- `index.html`: `<script src="ship-protocol.js"></script>` junto ao city-protocol.

### Task 4: bots + stress no protocolo novo

**Files:** Modify `scripts/bots.js`, `scripts/stress.js`.

Fase SHIP: `local = slotLocal(plan.shipSlots[id] ?? i)`; `pose = poseAt(plan.ship, t)`;
`pos = localToWorld(pose, [lx, floorY, lz])`; emite `{pos, ship:true, shipLocal:[...]}`.

### Task 5: harness + testes de browser

**Files:** Modify `test/helpers/harness.js` (novo export `startBRMatchInShip` — NÃO mexe
no `startBRMatch` que força PLAY); Create `test/ship.test.js` (porta fixa **3167**,
`FLY_TIME: '300'` pra ficar na nave).

Cobre 16.1 (Box3 do casco envolve cilindro da cabine; janela/piso/teto/parede existem),
16.2 (protocolo vs `ship.g.localToWorld` do three), 16.3 (sem input local constante,
mundo acompanha, pés no piso), 16.4 (WASD, diagonal, pitch ±1.55, y local fixo, sem NaN),
16.5 (8 direções → `hypot ≤ walkRadius+1e-3`), 16.6 (dt 1/30, 1/60, 1/144, 0.25),
16.7 (deslizamento tangencial), 16.9 (bot socket manda shipLocal → avatar acompanha a
pose sem atraso, pés no piso, sem sobreposição), 16.11 (Espaço → FALL preservando pos),
16.12 (freeze ativo, sem pageerror), 16.13 (`renderer.info.memory.geometries` estável
em 300 ticks; contagem de meshes/geometrias/draw calls documentada).

### Task 6: teste legado + suíte completa

**Files:** Modify `test/br-drops.test.js:129-139` (de contagem de filhos para checagem
semântica: janela + shipExterior/shipInterior + dims — o count antigo media a geometria
velha).

Rodar: `npm run lint`, `npm test` (sequencial), `npm run quality`, `npm run analyze:cycles`,
`node scripts/stress.js` se o ambiente deixar.

### Task 7: validação visual + relatório

Screenshot headless (padrão `scripts/capture-*.js`): interior reto/cima/baixo/paredes,
janela, exterior na queda, parte de baixo, 800×600 e 1920×1080, rotas diferentes.
Relatório final com os 16 itens exigidos (sem commit).

## Compatibilidade/risco

- Teste server.test.js:658 (nave forjada → INATIVIDADE) continua passando: rejeição agora
  é mais estrita (13.2 m vs 60 m), mesmo efeito observável.
- `shipPosAt` exportado mantém assinatura (usado por bots/stress); passa a delegar ao
  protocolo (ganha o bob — os consumidores mandam shipLocal e o servidor reconstrói).
- Fallback legado (state com ship sem shipLocal) fica documentado aqui: remover quando
  bots/clients externos estiverem todos no protocolo novo (nenhum caminho menos seguro).
