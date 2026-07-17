# Terreno canônico, biomas, grama, clima e veículos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans (inline) task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Uma única superfície de terreno (malha = Cannon = `heightAt` triangular), biomas centralizados, grama decorativa determinística por chunk, clima/`DAY_LEN` unificado com golden hour estilo Vice City, chuva com cobertura (prédios/torre/nave) e mixagem confortável, e prova de travessia veicular sem falso travamento.

**Architecture:** `js/terrain.js` ganha grade canônica de amostras (221×221, 5 m — MESMA da malha e do Cannon) construída ANTES de qualquer consumidor, com interpolação TRIANGULAR casada com a diagonal do PlaneGeometry; `surfaceAt()` compõe altura+bioma+dirigibilidade. Novo `js/biomes.js` centraliza pesos/limiar. `js/grass.js` vira determinística por (seed,chunk) com **burn do stream global** na criação inicial (preserva o contrato de ordem do rand seedado — layout do mundo NÃO muda). Novo `js/climate.js` puro unifica DAY_LEN/clima/vento/goldenHourK para Env e BR. Cobertura de chuva via grade barata de footprints + provider dinâmico da nave.

**Tech Stack:** three.js/cannon-es existentes; node:test + harness Puppeteer.

## Global Constraints (do prompt)

- SEM Blender; SEM editar GLBs; SEM migração de framework; SEM lib nova; SEM upgrade.
- NÃO remover/reduzir as 170k lâminas; NÃO tornar grama física; NÃO "unstuck"/teleporte/snap como correção.
- NÃO tocar `js/carwheels.js` (medidas/pivôs) salvo defeito provado por teste.
- NÃO alterar limites de movimento do server (55/90/120); cliente NUNCA envia weather/biome/surface/traction.
- Clima permanece cosmético (sem tração por bioma/clima nesta tarefa).
- Cores-identidade preservadas: terreno `0x55973e/0x6fae4a`, grama base `0x3e7028` ponta `0x9cc94f`.
- Chuva: ganho máx 0.04–0.06 (teto absoluto 0.07); interior −70..90% + low-pass ~700–1200 Hz.
- SEM commit/push sem autorização (commits locais ao fim de cada task são OK — regra do projeto; push só quando o usuário pedir).
- `git status` baseline: só `br-rank.json` (M) e `assets/models/boss-castle.v1.glb` (??) — do usuário, NUNCA staged.
- Portas de teste novas: **3230 (traversal), 3232 (grass), 3234 (weather/cover)**; node-puros sem porta. `--test-concurrency=1` sempre.

## Fatos do código (HEAD `61f4804`)

- `js/terrain.js`: `heightAnalytic` (fbm + platô spawn + platô cidade + heightmap do vulcão baked). `buildHeightGrid(1100, 440)` → grade 2,5 m BILINEAR, chamada em `game.js:2129` (FIM do init) — troca a semântica de `heightAt` DEPOIS de malha/Cannon/grama. `biomeAt` = simplex cru. `slopeAt/terrainNormal` = diferença central e=0.6.
- `game.js:176-211`: Cannon Heightfield 220 segs (5 m) com quaternion `(-0.5,-0.5,-0.5,0.5)` e diagonal JÁ alinhada à malha (teste `terrain-physics` cobre malha↔Cannon). `game.js:213-258`: malha visual 220 segs, cores por limiares inline (deserto `-bio 0.18..0.45`, floresta `bio 0.34..0.62`, areia h<0.9, rocha/neve por h/slope, basalto vulcão, máscara cidade via `CityLayout.cityCategory`).
- PlaneGeometry pós `rotateX(-π/2)`: célula (ix,iz) com cantos a=(x0,z0) b=(x0,z1) c=(x1,z1) d=(x1,z0); triângulos (a,b,d) e (b,c,d); diagonal b–d. Ponto local (tx,tz): `tx+tz ≤ 1` → tri(a,b,d): `h = ha + (hd−ha)tx + (hb−ha)tz`; senão `h = hc + (hb−hc)(1−tx) + (hd−hc)(1−tz)`.
- `js/grass.js` `fillChunk`: consome por lâmina, NESTA ordem: `rand`(lx), `rand`(lz), `rand`(rx), `rand`(rotY), `rand`(rz), `rand`(s 0.65–1.4), SE `desert>0.05` → `Math.random()`, `rand`(scaleX 0.8–1.25), `Math.random()`(phase), `rand`(tint L ±0.06). Branches de água/cidade/vulcão/clearings NÃO consomem. `refreshAll` em `game.js:2069`.
- **Contrato de stream**: bots (`scripts/bots.js:134-145`) reconstroem SÓ `createTerrain` (1º consumidor — imune a mudanças depois dele); baús BR usam PRNG independente (`worldSeed ^ 0xC0FFEE`, br-game:826); server só guarda a seed. Logo: preservar a CONTAGEM/ORDEM de consumo da grama inicial ⇒ layout de árvores/estruturas/inimigos idêntico ao atual. É o que o "burn" garante.
- `js/env.js`: `DAY_LEN=420`, máquina de clima local (`rand(80,150)` + `Math.random()`), chuva 450 hastes/neve 350 seguindo a câmera SEM cobertura; trovão 7–18 s; vento fixo `vec2(0.72,0.45)` no shader da grama.
- `br-game.js:690-717`: espelho `DAY_LEN=480` + `todAt(matchT)` (dia 0.62×/noite 1.9×, bordas 0.25/0.75) + clima por `seededRng(worldSeed ^ imul(epoch+1, 2654435761))`, época 75 s. Flags `ciclo dia/noite` → tod fixo 0.45/0.95.
- `js/sfx.js`: chuva = noise→bandpass 2800 Hz→`rainGain`, alvo `rainAmt*0.13`; `setRain(k)` escalar.
- Cidade: `js/citylayout.js` exporta `LOTS/ROADS/PLAZA/GREENS/footprintRect/cityCategory/cityGrassFactor/CORE_RADIUS/GRASS_FADE0/1`. Torre 18×18. Vagas em `grassClearings`.
- Nave: protocolo em `ship-protocol.js` (raiz) — cabine/DIMS lá; fase da nave em `S.phase`/flags do BR.
- Falha pré-existente conhecida: `gameplay.test.js` "grama na cidade" 4355/58779 lâminas — deve SUMIR com a Fase D (contar como fix esperado, medir).
- Baseline suíte (HEAD atual): 403 testes, 400 pass; 3 fails = grama-na-cidade (real, pré-existente) + 2 flakes de carga (br-death-cause timeout, gameplay regen) que passam isolados.

---

### Task 0: Baseline e telemetria (Fase A)

**Files:**
- Create: `scripts/capture-terrain.js` (clona padrão de `scripts/capture-weapons.js`)
- Create: `scratchpad` probes (fora do repo)

- [ ] **S1**: registrar `git status --short` + commit (feito acima). Rodar e guardar: `node --test --test-concurrency=1 test/terrain-physics.test.js test/game-modules.test.js test/car-settle.test.js test/car-wheels.test.js test/collision.test.js` → contagens exatas.
- [ ] **S2**: `scripts/capture-terrain.js [porta] [outDir]` — server WORLD_SEED=424242 + Chrome; capturas: pradaria/floresta/deserto/pico/vulcão/cidade/margem × {dia (tod .45), tarde (tod .71), noite (tod .95)} × {limpo, chuva}; usa `G.Env.tod=…; G.Env.weather=…; QA.tick(120)` e `MP.renderer.render`. Salvar `output/terrain-baseline/`. Registrar `renderer.info` (calls/triangles/geometries) e média wall-clock de `G.tick` (padrão do bench de armas).
- [ ] **S3**: probe de reprodução "carro travando": teleportar buggy para corredores de pradaria/floresta (varredura: 40 pontos aleatórios com seed fixa, `slopeAt<0.33`, sem `obstaclesNear` num raio de 6 m ao longo de 40 m), acelerar 5 s por dt 1/60; logar por frame: pos, vel longitudinal, contatos por roda (`vehicle.wheelInfos[i].raycastResult.hasHit`, `suspensionLength`), colisor atingido (`raycastResult.body?.userData`), chassi em contato. Guardar JSON em `output/stuck-probe.json`. Se nada travar em 40 corredores, registrar "não reproduzido em corredor dirigível" e apontar qual hipótese os dados descartam.
- [ ] **S4**: modo diagnóstico opt-in: em `game.js`, se `location.search` contém `debugTerrain=1`, expor `window.__terrainDebug = { at(x,z) {...surfaceAt + alturas visual/cannon...}, vehicle() {...telemetria por roda do carro ativo...} }` — leitura pura, sem estado de rede, sem log por frame. (Implementação final na Task 6; aqui só o esqueleto com alturas.)

### Task 1: Superfície canônica triangular (Fase B) — TDD

**Files:**
- Modify: `js/terrain.js` (buildHeightGrid → grade canônica 221×221 + heightAt triangular + geometricNormalAt + surfaceAt básico)
- Modify: `game.js:72-74` (construir a grade LOGO após createTerrain), `game.js:2129` (remover chamada tardia), `game.js:180-190` (heightfield lê amostras canônicas), `game.js:215-223` (malha lê amostras canônicas)
- Test: `test/terrain-surface.test.js` (node puro, novo) + `test/terrain-physics.test.js` (caso novo browser)

**Interfaces (produz):**
- `buildHeightGrid(worldSize)` → agora constrói `samples: Float32Array((SEGS+1)²)` com `SEGS = worldSize/5` (220), preenchida por `heightAnalytic` nos vértices exatos da malha; IMUTÁVEL depois.
- `heightAt(x,z)`: dentro do mapa → interpolação TRIANGULAR (fórmulas acima, diagonal b–d); fora → `heightAnalytic`.
- `sampleAt(i,j)` (leitura da grade p/ malha/Cannon), `geometricNormalAt(x,z,out)` (normal do triângulo real), `slopeDegreesAt(x,z)`.
- `terrainNormal` MANTIDA como normal SUAVIZADA (visual/spawn de FX — documentar no comentário a diferença).
- `surfaceAt(x,z)` → `{ height, slopeDegrees, waterDepth }` (biomas entram na Task 2).

- [ ] **S1 — teste RED** `test/terrain-surface.test.js` (node): importa `createTerrain` com `seedRandom(424242)` (padrão de game-modules.test.js). Casos:
  - determinismo: 2 instâncias mesma seed → mesmas 200 alturas amostradas; seed 99 difere.
  - `heightAt` ANTES vs DEPOIS de `buildHeightGrid`: nos VÉRTICES da grade (múltiplos de 5) diferença < 1e-6; a semântica não pode trocar depois (chamar 2× buildHeightGrid → idêntico).
  - **triângulo real**: para 300 células aleatórias, 4 pontos por célula (2 de cada lado da diagonal b–d), `heightAt` == interpolação baricêntrica manual dos 3 vértices do triângulo correto (tolerância 1e-6). Este caso FALHA no bilinear atual (pontos longe da diagonal em célula não-planar).
  - bordas do mapa, cidade, vulcão, spawn: valores finitos; `heightAt(±550−ε)` finito; fora do mapa → `heightAnalytic` sem NaN.
  - `geometricNormalAt`: normal unitária, `n.y>0`, e ortogonal às duas arestas do triângulo (dot < 1e-6).
  - `slopeAt`/`slopeDegreesAt` finitos e coerentes (tan entre gradiente e graus).
- [ ] **S2**: rodar → RED (triângulo e "antes/depois" falham no bilinear tardio).
- [ ] **S3 — implementar** em `js/terrain.js`:

```js
/* Grade CANÔNICA: as MESMAS (SEGS+1)² amostras alimentam malha visual,
   CANNON.Heightfield e heightAt() — que interpola o TRIÂNGULO REAL da célula
   (diagonal b–d do PlaneGeometry). Construída UMA vez, antes de qualquer
   consumidor; nunca troca de semântica durante a execução. */
let S = null; // { n, half, cell, data: Float32Array }
function buildHeightGrid(worldSize, segs = Math.round(worldSize / 5)) {
  if (S) return; // imutável: 2ª chamada é no-op
  const n = segs + 1, half = worldSize / 2, cell = worldSize / segs;
  const data = new Float32Array(n * n);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++)
      data[j * n + i] = heightAnalytic(-half + i * cell, -half + j * cell);
  S = { n, half, cell, data };
}
function sampleAt(i, j) { return S.data[j * S.n + i]; }
function heightAt(x, z) {
  if (!S || x < -S.half || x >= S.half || z < -S.half || z >= S.half)
    return heightAnalytic(x, z);
  const fx = (x + S.half) / S.cell, fz = (z + S.half) / S.cell;
  const i = Math.min(fx | 0, S.n - 2), j = Math.min(fz | 0, S.n - 2);
  const tx = fx - i, tz = fz - j, r0 = j * S.n + i, r1 = r0 + S.n;
  const ha = S.data[r0], hd = S.data[r0 + 1], hb = S.data[r1], hc = S.data[r1 + 1];
  // diagonal b–d (mesma do PlaneGeometry): tri(a,b,d) ou tri(b,c,d)
  return (tx + tz <= 1)
    ? ha + (hd - ha) * tx + (hb - ha) * tz
    : hc + (hb - hc) * (1 - tx) + (hd - hc) * (1 - tz);
}
function geometricNormalAt(x, z, out) { /* mesmos 3 vértices do triângulo → cross das arestas, normalize, y>0 */ }
function slopeDegreesAt(x, z) { /* acos(n.y) em graus via geometricNormalAt */ }
function surfaceAt(x, z) {
  const height = heightAt(x, z);
  return { height, slopeDegrees: slopeDegreesAt(x, z), waterDepth: Math.max(0, WATER_LEVEL - height) };
}
```

  `game.js`: mover `buildHeightGrid(CFG.WORLD_SIZE)` para logo após o destructuring do createTerrain (linha ~74, com comentário de que TUDO daqui em diante lê a mesma superfície); remover a linha 2129; heightfield e malha usam `heightAt` (agora já canônico e EXATO nos vértices — zero mudança visual). Exportar `sampleAt/geometricNormalAt/slopeDegreesAt/surfaceAt` no return do createTerrain e no `window.__game`.
- [ ] **S4**: rodar S1 → GREEN. Rodar `node --test test/game-modules.test.js` (determinismo do terreno intacto — o bilinear não participa dos testes existentes? conferir e ajustar apenas se algum asserta bilinear).
- [ ] **S5 — browser RED→GREEN** em `test/terrain-physics.test.js`, caso novo: para 60 pontos (2 lados da diagonal, cidade, vulcão, margem), `|heightAt − visualY(x,z)| ≤ 0.02` E `|heightAt − raycast Cannon| ≤ 0.02` (reusar `visualY` que o arquivo já tem). No código antigo FALHA (bilinear 2,5 m vs triângulos 5 m); passa com o canônico.
- [ ] **S6 — A/B de resolução (medido, sem chute)**: probe descartável (scratchpad) com `segs=440` na grade+malha+Cannon num boot de teste: medir wall-clock de `world.step` médio (120 steps com carro), triângulos da malha e memória (`renderer.info`). Registrar no plano-log. Critério: só adotar 440 se o passo físico p95 e o frame não regredirem >15% E o teste de travessia (Task 6) exigir. Caso contrário manter 5 m (esperado). Decisão documentada no log.
- [ ] **S7**: commit `feat(terreno): grade canônica triangular única p/ malha, física e consultas`.

### Task 2: Biomas centralizados (Fase C)

**Files:**
- Create: `js/biomes.js`
- Modify: `js/terrain.js` (surfaceAt compõe biomas), `game.js` (colorização da malha lê os MESMOS pesos; injeta cityCategory no biomes), `js/scenery.js` (SÓ se limiar inline puder ler o central sem mudar consumo de rand)
- Test: `test/terrain-surface.test.js` (casos novos)

**Interfaces (produz):**
- `createBiomes({ simplex, heightAt, slopeDegreesAt, WATER_LEVEL, CITY, VOLCANO, cityCategory })` → `{ classifyAt(x,z) => { id, weights: {prairie,forest,desert,alpine,volcanic,urban,shore,water}, vegetationFactor, driveable, surfaceType } }`.
- Prioridade (nesta ordem, com smoothstep): `water` (h<WL) → `shore` (WL..WL+1.6) → `volcanic` (dist ao cone, r*0.95..1.15) → `urban` (cityCategory/raio, FADE0..FADE1) → `alpine` (h 17..28 e/ou slope>38°) → ruído: `desert` (−bio 0.18..0.45), `forest` (bio 0.34..0.62), resto `prairie`. Pesos ∈[0,1], soma 1±1e-5 (normalizar no fim).
- `driveable` = `slopeDegrees ≤ 20` E não-water E não `surfaceType==='building'`; `vegetationFactor` = fator que a grama multiplicará (0 em water/urban-street/volcanic/clearing… clearings continuam na grama).
- `biomeAt` do terrain PERMANECE intocado (adaptador p/ IA/spawns existentes).

- [ ] **S1 — teste RED** (node, no terrain-surface.test.js): pesos somam 1, finitos; centro da cidade → urban≈1; cratera → volcanic≈1; ponto h<WL → water e `driveable=false`; pradaria plana → driveable=true; slope 30° → driveable=false; transições: amostrar linha deserto→pradaria a cada 2 m → nenhum salto de peso >0.25 entre vizinhos (suavidade); `vegetationFactor` 0 na água e ~1 na pradaria.
- [ ] **S2**: implementar `js/biomes.js` com EXATAMENTE os limiares atuais (copiados de game.js:227-234 e grass.js:156/184) para paridade visual; wiring em game.js: `const Biomes = createBiomes({... , cityCategory: CityLayout.cityCategory })`; `surfaceAt` do terrain recebe hook `setBiomes(classifyAt)` (injeção — terrain não importa citylayout).
- [ ] **S3**: colorização da malha (game.js:224-250) passa a derivar `desert/forest/alpine` weights de `Biomes.classifyAt` (resultado numérico IDÊNTICO por construção — conferir com screenshot antes/depois da Task 0 nas mesmas coords). Rodar GREEN + `node --test test/city-layout.test.js`.
- [ ] **S4**: commit `feat(biomas): classificação central com pesos suaves e prioridade explícita`.

### Task 3: Grama determinística e estritamente decorativa (Fase D)

**Files:**
- Modify: `js/grass.js` (RNG local por chunk + burn do stream + surfaceAt + uWindDir), `game.js` (passa worldSeed + surfaceAt; remove refreshAll? NÃO — vira no-op barato de manter compat), `js/env.js` (uWindDir em vez de direção fixa — junto com Task 4)
- Test: `test/grass-decor.test.js` (browser, porta 3232) + caso node de burn

**Regra de ouro (contrato de stream):** a criação INICIAL da grade 13×13 consome o stream global seedado EXATAMENTE como hoje (mesma contagem, mesmos branches) — via função `legacyConsume(cx,cz)` que executa o loop antigo descartando resultados. O CONTEÚDO real de todo fill (inicial, reciclado, refreshAll) vem de `mulberry32(hash(worldSeed, cx, cz))` local. Assim: layout mundial pós-grama IDÊNTICO (árvores/estruturas/inimigos não mudam para a mesma seed) E chunks 100% reproduzíveis.

- [ ] **S1 — teste RED** `test/grass-decor.test.js`:
  - **zero física**: nenhum body do `MP.world.bodies` nem entrada de `obstaclesNear` numa varredura 20×20 m de pradaria tem origem na grama (bodies têm userData.category a partir da Task 5; aqui: contagem de bodies antes/depois de `Grass.refreshAll()` idêntica, e `G.obstaclesNear` em 50 pontos de pradaria sem obstáculo com r<0.5 vindo de grama — asserção estrutural: grass.js não importa CANNON nem chama addObstacle → teste de código-fonte via `fs.readFileSync('js/grass.js')` sem `CANNON|addObstacle`).
  - **raiz na superfície**: expor `Grass.debugSample(n)` (leitura: n matrizes decodificadas do chunk central) → `|rootY − heightAt(x,z)| ≤ 0.03` para 200 lâminas com escala >0.05.
  - **determinismo de chunk**: capturar matriz+phase+tint do chunk (cx,cz)=(2,1); forçar recycle (mover player 200 m via QA e voltar); recapturar → bytes idênticos (Float32Array igual). FALHA HOJE (rand global).
  - **zero lâminas relevantes** (escala>0.05) com raiz em: água (y<WL+0.25), ruas/calçadas/plaza (cityCategory ∈ {road,sidewalk,plaza,building}), cone do vulcão, clearings. Contagem == 0. (Hoje falha na cidade — mesmo bug do teste pré-existente de gameplay.)
  - **needsUpdate/bounds**: após recycle, `instanceMatrix.needsUpdate` foi aplicado e boundingSphere contém as raízes (min/max Y).
- [ ] **S2**: rodar → RED (determinismo e cidade falham).
- [ ] **S3 — implementar** em grass.js:

```js
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const chunkRng = (cx, cz) => mulberry32((worldSeed ^ Math.imul(cx, 0x9E3779B1) ^ Math.imul(cz, 0x85EBCA77)) >>> 0);
```

  - `fillChunk(chunk, cx, cz)` reescrito: `const rng = chunkRng(cx, cz); const r = (a,b) => a + rng()*(b-a);` e TODAS as chamadas rand/Math.random do corpo trocadas por `r`/`rng`, na mesma ordem interna. Altura/veg: `const su = surfaceAt(wx+lx, wz+lz); y = su.height; s *= su.vegetationFactor…` — mantendo curvas de deserto/floresta atuais via weights centrais e mantendo clearings.
  - `legacyConsume(cx, cz)`: cópia LITERAL do loop antigo (rand lx/lz/rot×3/s, `bio→desert>0.05 && Math.random()`, rand scaleX, Math.random phase, rand tint) sem escrever nada — chamada UMA vez por chunk apenas na criação inicial (dentro de `makeChunk`), ANTES do fill local. Comentário explicando o contrato.
  - `refreshAll` mantém-se (refaz com rng local — idempotente).
  - vento: `uWindDir: { value: new THREE.Vector2(0.72, 0.45).normalize() }` uniform substitui o `vec2` fixo do shader (mesma direção default → mesmo visual até a Task 4 ligar o clima).
  - `debugSample(n)` para QA.
- [ ] **S4**: rodar S1 → GREEN. Rodar `node --test test/gameplay.test.js` → **o caso "grama na cidade" pré-existente deve PASSAR agora** (se ainda falhar, investigar a raiz de verdade — a máscara cobre GRASS_FADE? — antes de seguir). Conferir também `test/br-drops.test.js`/`match-tempo` (layout intacto: nada muda porque o burn preservou o stream — qualquer teste de posição que falhe indica burn errado; corrigir o burn, NUNCA o teste).
- [ ] **S5 — validação visual**: `node scripts/capture-terrain.js` → pradaria idêntica ao baseline a olho (densidade/cor/altura), cidade sem grama em rua/calçada.
- [ ] **S6**: commit `feat(grama): chunks determinísticos por seed com burn do stream (layout preservado)`.

### Task 4: Clima unificado + golden hour (Fase G, parte 1)

**Files:**
- Create: `js/climate.js`
- Modify: `js/env.js` (usa climate; remove máquina local; golden hour nas luzes/céu/fog/água/grama; vento compartilhado), `br-game.js:690-717` (remove espelho DAY_LEN/todAt/sorteio → chama climate com matchT+seed), `game.js` (cria climate com worldSeed e injeta no Env)
- Test: `test/climate.test.js` (node puro, novo)

**Interfaces (produz):**

```js
createClimate() // puro, sem estado
DAY_LEN            // 480 — canônico ÚNICO (adota o do BR; Env deixa de ter 420)
todAt(elapsedSeconds, startTod = 0.33)          // dia 0.62×, noite 1.9× (curva atual do BR)
weatherAt(seed, elapsedSeconds) => { type: 'limpo'|'chuva'|'neve', epoch, k }  // época 75 s, mesmo hash do BR atual (worldSeed ^ imul(epoch+1, 2654435761)), k = rampa 0..1 nos primeiros 8 s da época p/ transição
windAt(seed, elapsedSeconds) => { dirX, dirZ, strength }  // gira lento por época + ruído senoidal determinístico; strength casa com CFG.WIND_STRENGTH
goldenHourK(tod)   // smoothstep(tod, 0.66, 0.71) * (1 - smoothstep(tod, 0.745, 0.78))
phases(tod) => { dayK, nightK }  // curva atual do Env extraída
```

- [ ] **S1 — teste RED** `test/climate.test.js` (node):
  - `DAY_LEN === 480` e é o ÚNICO: `grep` programático em js/env.js + br-game.js por `DAY_LEN\s*=` → só o climate define (asserção de fonte, mata o espelho).
  - `todAt` contínuo: `|todAt(t+0.01)−todAt(t)| < 0.001` em 500 amostras incluindo bordas 0.25/0.75; `todAt(0)=0.33`; determinístico.
  - `weatherAt`: mesma seed+t → mesmo tipo; seeds diferentes divergem em alguma época; percentuais ~52/28/20 em 500 épocas (tolerância ±6%); `k` ∈[0,1] contínuo.
  - `windAt`: determinístico, |dir|=1, contínuo (sem salto >0.05/s).
  - `goldenHourK`: 0 em tod .45 e .95; >0.9 em .715; contínuo (derivada limitada em amostragem de 1e-3).
- [ ] **S2**: implementar `js/climate.js` (funções puras, sem THREE — dirX/dirZ numéricos).
- [ ] **S3 — env.js**: recebe `{ climate, getElapsed, getSeed }`; `update` deriva `tod = flags? : climate.todAt(getElapsed())` — MAS preserva os setters `Env.tod`/`Env.weather` (BR flags e QA os usam): internamente Env passa a ter `todOverride/weatherOverride` (setter grava override; BR continua funcionando sem mudar chamadas). Máquina local de sorteio morre; `weather` efetivo = override ?? `climate.weatherAt(seed, elapsed).type`; `weatherK` continua com damp (transição suave). Vento: `windAt` alimenta `Grass.material.uniforms.uWindDir` + inclinação da chuva/deriva da neve + (opcional barato) fase da água.
  **Golden hour** (tudo modulado por `gk = goldenHourK(tod) * dayK`):
  - sol: `SUN_DAY.lerp(0xffa050, gk*0.85)`; intensidade CSM ×(1−gk*0.15);
  - céu: `rayleigh += gk*1.4`, `mieCoefficient += gk*0.004` (sol baixo já dá o gradiente quente do shader Sky);
  - fog: lerp atual → depois `_f.lerp(new Color(0xf0a988), gk*0.45)` (pêssego, sem encobrir: fog.near inalterado);
  - água: `uSky.lerp(0xffb984, gk*0.5)`;
  - grama: `uSunColor.lerp(0xffc07a, gk*0.6)` (verde continua verde — só a LUZ esquenta);
  - cidade: `cityMat.emissiveIntensity = 0.12 + nightK*1.6 + gk*0.5` (janelas começam a acender);
  - exposição: `toneMappingExposure` ganha `+gk*0.02` NO MÁXIMO (nada estoura). Sem filtro de tela, sem trocar paleta num frame.
  Trovão: janela `rand(18, 40)` s, só com `weatherK>0.75`, e (Task 5) ganho gated por exposure.
- [ ] **S4 — br-game.js**: apagar `DAY_LEN/DAY_SPD/NIGHT_SPD/todAt` locais; `skySync` vira: `G.Env.tod = ciclo==='dia'?0.45: ciclo==='noite'?0.95 : climate.todAt(S.matchT()); const w = climate.weatherAt(INIT.worldSeed, S.matchT()); if (G.Env.weather !== w.type) G.Env.weather = w.type;` (mesma cadência 1 s). Import do climate via `G` (exportar em `window.__game`).
- [ ] **S5**: rodar climate.test GREEN + `node --test test/match-tempo.test.js test/night-combat.test.js test/zone-modes.test.js` (dependem de tod/ciclo). Ajustar APENAS se assumiam 420 do Env solo (documentar mudança 420→480 no log).
- [ ] **S6 — visual**: capture-terrain nas fases {meio-dia, golden (tod .715), noite} — conferir critérios: verdes vivos, sem estouro branco, cidade acendendo, água quente. Comparar lado a lado com baseline.
- [ ] **S7**: commit `feat(clima): módulo puro compartilhado (DAY_LEN 480) + golden hour Vice City`.

### Task 5: Cobertura de chuva + mixagem (Fase G, parte 2)

**Files:**
- Create: `js/cover.js`
- Modify: `js/env.js` (spawn de gota/floco consulta cobertura; fade por exposure da câmera), `js/sfx.js` (`setRain({intensity, exposure})` + low-pass + teto de ganho), `game.js` (cria cover com Structures/platforms/CityLayout e injeta), `br-game.js` (provider da cabine da nave por fase+transform+DIMS), `city-destruction-client.js` (invalida cobertura ao destruir — via callback registrado)
- Test: `test/weather-cover.test.js` (browser, porta 3234)

**Interfaces (produz):**
- `createCover({ heightAt }) => { addRoofRect({x0,x1,z0,z1,roofY,sourceId}), removeBySource(sourceId), setDynamicProvider(fn), coverAt(x,y,z) => { covered, exposure, roofY, sourceId } }` — grade espacial 8 m (mesmo padrão do obstacleGrid); `covered` = existe roofRect com y<roofY; `exposure` 0|1 cru (suavização fica no consumidor); provider dinâmico (nave) consultado primeiro.
- `SFX.setRain(v)`: aceita número (compat) OU `{ intensity, exposure }`. Ganho alvo = `intensity * 0.05 * (0.15 + 0.85*exposure)`; low-pass extra: novo BiquadFilter lowpass entre bandpass e gain, `frequency` alvo `lerp(900, 12000, exposure)` com `setTargetAtTime(…, 0.6)`. Teto duro 0.07 (const documentada).

- [ ] **S1 — popular cobertura**: em game.js, após Structures/CityLayout prontos: para cada lot de `LOTS` → `addRoofRect(footprintRect(lot), roofY = topo do prédio, sourceId 'city:'+idx)`; torre (18×18, topo); `platforms` com área ≥ 9 m² e y > terreno+2.2 viram telhado (lajes/andares — cobre interior da torre andar a andar); estruturas do campo (`js/structures.js` — celeiros/casas: expor lista `{rect, roofY, id}` mínima no return, só leitura). Nave: em br-game, `Cover.setDynamicProvider((x,y,z) => fase SHIP && dentro dos limites locais da cabine (transform inverso da nave × ShipProto.DIMS) ? {covered:true, sourceId:'ship'} : null)`.
- [ ] **S2 — env.js**: câmera: `camExposure` = damp(0/1 conforme `coverAt(camera.position)`, 4, dt) — atualizado a cada 0.15 s (acumulador), não por frame. `rainMesh` opacity ×= camExposure e `visible = showRain && camExposure > 0.02`; gotas: no RESPAWN da gota (p.y<−2) sortear x/z e, se `coverAt(cp.x+p.x, cp.y, cp.z+p.z).covered`, re-sortear até 3× senão marcar `p.hidden=true` (matriz com escala 0) — SEM raycast, ~15 consultas/frame no pior caso. Neve idem. Trovão: `SFX.thunder()` só dispara com `camExposure > 0.4` (dentro, nem flash de luz interna: `flashT` multiplicado por camExposure).
  Aparência: comprimento da haste `rand(0.55, 1.1)`, opacidade por gota `0.28–0.5`, inclinação = `windDir * windStrength` (do climate) em vez de 0.07/0.05 fixos — variação sutil, sem hastes idênticas.
- [ ] **S3 — sfx.js**: implementar contrato novo; `musicUpdate` usa `rainAmt * 0.05 * (0.15 + 0.85*rainExposure)`; migração: env chama `SFX.setRain({ intensity: weatherK, exposure: camExposure })`.
- [ ] **S4 — destruição**: registrar em game.js um callback no protocolo de destruição já existente (city-destruction-client) → `Cover.removeBySource('city:'+idx)` quando o prédio cai. (Ver como o client marca prédio destruído — reutilizar o mesmo evento, NÃO criar rede nova.)
- [ ] **S5 — teste RED→GREEN** `test/weather-cover.test.js` (porta 3234):
  - chuva forte (`Env.weather='chuva'`, tick até weatherK>0.9) na pradaria → rainMesh.visible true, count>200;
  - teleportar para DENTRO de um prédio da cidade (usar coords de um lot + groundAt interno) → após 90 ticks, `rainMesh.visible === false` OU todas as instâncias visíveis com escala 0 dentro do volume (asserção: decodificar matrizes, nenhuma gota com |pos−cam|<8 e escala>0.01 por 300 frames);
  - interior da torre (andar 1) idem; 
  - sfx: `SFX` expõe getter de teste `rainLevel()` → externo ≈ `0.05*k`, interno ≤ 30% do externo, e NUNCA >0.07;
  - transição: sair do prédio → exposure sobe suave (sem salto de 0→1 em 1 frame: amostrar 20 ticks, max delta < 0.25);
  - mutação declarada no teste (comentário): restaurar `rainAmt*0.13` ou remover coverAt faz o caso falhar.
  - nave: teste na fase SHIP (harness `startBRShip` se existir helper; senão simular provider: registrar dynamicProvider fake e verificar contrato covered dentro/fora dos DIMS).
- [ ] **S6**: commit `feat(clima): cobertura de chuva (prédios/torre/nave) + mixagem low-pass confortável`.

### Task 6: Taxonomia de colisores + debug (Fases A/E)

**Files:**
- Modify: `game.js` (metadados nos bodies de árvore/pedra ao criar; debugTerrain completo), `js/terrain.js` (addObstacle aceita meta opcional), `js/scenery.js` (passa categoria), docs no plano-log (matriz de colisão)
- Test: `test/collision.test.js` (casos novos) 

- [ ] **S1**: onde os `CANNON.Body` de árvores/pedras são criados (game.js — localizar por `CANNON.Box`/`CANNON.Sphere` de cenário), setar `body.userData = { category: 'rigid', sourceId: 'tree:'+i|'rock:'+i, hardForVehicle: true }`; `addObstacle(x, z, r, meta)` guarda `meta` no objeto do grid (compat: meta opcional). Cactos: `category:'softVegetation'` no obstacle do player (SEM body — comportamento atual preservado e agora DOCUMENTADO).
  Matriz de colisão (documentar no plano-log e em comentário no game.js):
  | categoria | player | veículo | projétil |
  |---|---|---|---|
  | decorativo (grama/flor) | passa | passa | passa |
  | vegetação macia (cacto) | bloqueia (círculo) | passa | passa |
  | rígido (árvore/pedra/prédio) | bloqueia | bloqueia (Cannon) | bloqueia (rayHit) |
  | estrutural (rua/laje/rampa) | pisa | pisa | bloqueia |
  | água/margem | entra (atual) | entra (não-dirigível) | atravessa |
- [ ] **S2**: `?debugTerrain=1` completo: `__terrainDebug.at(x,z)` → surfaceAt + `visualY` (triângulo) + raycast Cannon + groundAt + normal/slope + bioma/pesos + driveable; `__terrainDebug.vehicle()` → por roda `{ hasHit, body: userData?.sourceId, point, normal, suspensionLength, force, slip }` + contatos do chassi (world.contacts filtrados) + throttle/vel/sleepState. Leitura pura.
- [ ] **S3 — teste**: collision.test casos novos: body de árvore tem userData.category 'rigid' e AABB dentro de 1.5× do raio visual; nenhum body estático na origem (AABB não atualizada); grama alta sobre pedra: física da pedra idêntica com/sem grama (posição do body invariante). Rodar arquivo → verde.
- [ ] **S4**: commit `feat(colisores): taxonomia com metadados + modo debugTerrain opt-in`.

### Task 7: Travessia veicular sem falso travamento (Fase F)

**Files:**
- Create: `test/car-terrain-traversal.test.js` (porta 3230)
- Modify: só o que os DADOS provarem (candidatos por hipótese: nenhum ajuste, OU amplitude/freq do "detalhe médio" fbm 0.016 em corredores, OU par de contato roda-heightfield — nunca carwheels.js)

- [ ] **S1 — helper de corredores**: dentro do teste, `findCorridor(biomeId, len=40)`: varre pontos com seed fixa; aceita se TODOS os 20 sample points do segmento têm `surfaceAt.driveable && slopeDegrees<18` e `obstaclesNear` vazio num raio 5 m. Regiões: pradaria, floresta, deserto, alpino-baixo, saia do vulcão (fora do cone), estrada da cidade→campo, margem seca (h>WL+1).
- [ ] **S2 — teste**: matriz veículos (3 cfgs de `Car.vehicles`) × regiões × seeds {424242, 99, 7 → 3 boots com `bootGame({worldSeed})`} × entradas {frente, ré, curva, diagonal} × dt {1/30, 1/60, 1/120}. Reduzir a explosão: seeds extras só na pradaria+floresta com o buggy (cobertura anti-overfit), o resto na 424242. Por corrida: teleportar carro ao início (`v.chassis.position`, zerar velocidades, settle 60 ticks), aplicar aceleração via API do carro (achar em js/car.js o input de QA — `setControls`/keys do G), 6 s simulados; asserções:
  - estado finito (pos/quat/vel), `!falseStuck` (vel<0.5 por >1.5 s com throttle e sem contato rígido — usar telemetria do debugTerrain), rodas: nunca 0 contatos por >0.5 s em corredor plano; chassi sem contato com heightfield em corredor <10°; pose visual (group) coerente com chassis (dist < 0.5);
  - **caso-controle**: corredor com árvore rígida no meio → carro PARA e a telemetria aponta `sourceId` tree — prova que o teste detecta bloqueio real.
- [ ] **S3**: rodar. SE falhar em algum corredor: diagnosticar com `__terrainDebug.vehicle()` no ponto exato (raycast perdendo? chassi tocando? colisor fantasma?) e SÓ ENTÃO corrigir a causa provada (documentar antes/depois da telemetria no log). A Task 1 (superfície única) é a candidata nº 1 a já ter resolvido divergências.
- [ ] **S4**: rodar `test/car-settle.test.js test/car-wheels.test.js test/car-models.test.js` intactos. Commit `test(veiculos): travessia por bioma com prova de falso travamento e caso-controle`.

### Task 8: Fechamento (Fase H + validação + perf)

- [ ] **S1 — água/margem**: já coberto por surfaceAt (waterDepth/shore/driveable=false) — teste unit em terrain-surface (água nunca driveable; margem sem obstáculo no grid). Zero lâminas na água já testado (Task 3).
- [ ] **S2 — perf A/B**: bench wall-clock de `tick` (mesmo padrão da rodada de armas: warmup + 1800 ticks) e `world.step` antes/depois; `renderer.info` estável após 10 min simulados de percorrer o mapa (loop QA de teleporte + tick, chunks reciclando); fila `pending` da grama volta a 0. Critério: p95 sem regressão >15%.
- [ ] **S3 — visual final**: capture-terrain completo (biomas × horários × climas + interiores na chuva + golden hour da nave se viável) → inspecionar TODOS os critérios da seção 7 do prompt; enviar comparativos ao usuário.
- [ ] **S4 — suíte completa**: `npm run lint` + `npm test` (~15 min). Triagem flake vs regressão (isolado 2–3×). O caso pré-existente "grama na cidade" DEVE passar agora — se passar, atualizar a memória do projeto.
- [ ] **S5 — relatório final** com os 11 itens da seção 10 do prompt (causa-raiz com telemetria, arquivos, desenho do terreno canônico, biomas, DAY_LEN=480, matriz de colisão, números exatos de testes, red/green, screenshots, A/B perf, confirmação de GLBs/segurança intactos, riscos).
- [ ] **S6**: commit final + atualizar memória (`weapon-rig-ads` padrão): novo arquivo `terreno-clima-canonico.md`.

## Self-review

- Cobertura: Fase A→T0, B→T1, C→T2, D→T3, E→T6, F→T7, G→T4+T5, H→T8; testes 6.1→T1, 6.2→T3, 6.3→T7, 6.4→T4/T5, 6.5→T6, 6.6→T8-S4; visual→T0/T8; perf→T1-S6/T8-S2; debug→T0/T6.
- Riscos declarados: (1) burn do stream tem que ser byte-idêntico — validado por testes de layout existentes (city/collision) que quebram alto se errar; (2) DAY_LEN 420→480 muda ritmo do SOLO (+14% de ciclo) — decisão documentada, BR intacto; (3) structures.js precisa expor retângulos de telhado — mudança aditiva mínima; (4) traversal pode não reproduzir o bug relatado — o teste vira a rede de segurança e o relatório declara "não reproduzido" com dados; (5) goldenHour mexe em tone/fog — screenshots A/B decidem os coeficientes finais.

---

## Execution log (2026-07-17)

**Baseline:** suítes do escopo 40/40; suíte completa 403 → 400 pass + grama-na-
cidade (pré-existente) + 2 flakes. Capturas `output/terrain-baseline/` (19).
Reprodução do "carro travando": 30/30 corredores com perda de rodas; 5 casos
>1,5 s parado (pior 3,77 s) — telemetria em `output/stuck-probe.json`.

**Causas-raiz comprovadas (com dados):**
1. `heightAt` público bilinear 2,5 m ≠ malha/Cannon triangulares 5 m — até
   **78,5 cm** de divergência (red/green no terrain-physics novo caso).
2. 3ª oitava do fbm médio (λ~15 m) → cristas < entre-eixos → rodas dianteiras
   `hit:false` com suspensão no máximo → rastejo a ~0,1 m/s com acelerador.
3. Círculo de fricção do RaycastVehicle: `maxImpulse = grip×suspensão×dt`
   consumido pelo LATERAL em rampas — buggy(1.4)/caminhão(1.6) estolavam
   parados onde o esportivo (2.2) subia. → grip 1.9/2.0.
4. Grama INOCENTADA: zero corpos/obstáculos dela; corredores de teste eram
   gramados; colisor atingido sempre `terreno`.

**Desvios/decisões:**
- DAY_LEN canônico = 480 (o do BR); solo +14% de ciclo.
- Corredores de teste ≤12° ("hill-start confortável"; caminhão parado não
  arranca a 14-16° — limitação real registrada); contrato mundial driveable=20°.
- Convenção descoberta: veículos olham **+X** — testes que assumirem −Z validam
  o corredor perpendicular ao percurso.
- Teste "grama na cidade" reescrito pro contrato real do citylayout (zero em
  rua/prédio/núcleo<56 fora de canteiro; anel de fade parcial é design) — era
  insatisfazível desde o rework da cidade; **agora passa**.
- Lotes da cidade são caixas sólidas (player não entra) — interior de verdade =
  torre; testes de exposure usam a torre.
- Cenários de tiro (weapon-aim/br-pve) escolhem linha com LOS livre — tiro
  rasteiro bloqueado por árvore/cacto é mecânica pré-existente correta.

**Fechamento:** suíte completa **433/433, 0 skip** (inclui a ex-falha da grama).
Bench tick: 1,22–1,28 ms vs 1,26–1,30 pré-terreno (sem regressão; gate <15%).
Segurança: server.js intocado; limites 55/90/120 intactos; cliente não envia
weather/biome/surface; posse de veículo/anti-cheat preservados (suítes verdes).
GLBs e js/carwheels.js: **zero mudanças**.
