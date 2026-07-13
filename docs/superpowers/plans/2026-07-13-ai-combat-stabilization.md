# AI Combat Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir as regressões confirmadas de orientação, ciclo de vida, dano, armas e bots sem quebrar os modos solo e Battle Royale.

**Architecture:** As correções ficam divididas por fronteiras testáveis: cada entidade conserva sua própria locomoção/ataque, `game.js` expõe uma única lista de alvos PvE para as armas BR, e `br-game.js` continua responsável apenas pela ponte multiplayer. A morte recebe uma causa tipada e os bots passam a usar estado observado do servidor, evitando decisões baseadas somente em outros bots ou em zona inexistente.

**Tech Stack:** JavaScript ES modules no navegador, Three.js, Cannon, Node.js `node:test`, Socket.IO, Puppeteer headless.

## Global Constraints

- Não fazer commit.
- Preservar todas as alterações locais existentes e tocar apenas nos trechos necessários.
- Escrever e executar um teste que falhe pelo motivo esperado antes de cada alteração de produção.
- Manter compatibilidade dos modos solo e Battle Royale.
- Validar no navegador real em Chromium headless; usar Puppeteer porque o Playwright Python não está instalado no projeto.

---

### Task 1: Ciclo de vida e orientação dos animais

**Files:**
- Modify: `js/animals.js`
- Modify: `game.js`
- Modify: `br-game.js`
- Create: `test/animals-combat.test.js`

**Interfaces:**
- Consumes: `createAnimals(deps)` e `Structures.obstaclesNear(pos, radius)`.
- Produces: animais cujo eixo visual frontal, hitbox e vetor de movimento coincidem; `setEnabled(boolean)` mantém `alive` e `visible` consistentes; lobos só mordem com linha física livre.

- [ ] **Step 1: Write the failing tests**

```js
test('animal faces its movement and head hitbox', async () => {
  const result = await play(() => QA.animals.orientationProbe());
  assert.ok(result.forwardDotMovement > 0.99);
  assert.ok(result.headDotForward > 0.99);
});

test('BR enable restores visible living animals', async () => {
  const result = await play(() => QA.animals.lifecycleProbe());
  assert.deepEqual(result, { alive: true, visible: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/animals-combat.test.js`

Expected: FAIL mostrando `forwardDotMovement` próximo de `0` e/ou animal vivo invisível.

- [ ] **Step 3: Write minimal implementation**

```js
const yaw = Math.atan2(dir.z, dir.x); // modelo olha para +X
g.rotation.y = yaw;
const fw = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
a.head.position.copy(g.position).addScaledVector(fw, 0.86);

function setEnabled(enabled) {
  for (const a of list) {
    a.enabled = enabled;
    a.group.visible = enabled && a.alive;
  }
}
```

Passar `Structures`, `obstaclesNear` e `SFX` nas dependências; antes da mordida, impedir dano quando `obstaclesNear` indicar bloqueio entre lobo e jogador.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/animals-combat.test.js test/gameplay.test.js`

Expected: PASS.

### Task 2: Esqueletos ativos e separados no Battle Royale

**Files:**
- Modify: `js/skeletons.js`
- Modify: `game.js`
- Modify: `br-game.js`
- Modify: `test/skeletons.test.js`

**Interfaces:**
- Consumes: `Skeletons.update(dt, t)` e `Skeletons.setEnabled(enabled)`.
- Produces: sete spawns com distância mínima de 24 m, visibilidade coerente e atualização durante `PLAY` no BR.

- [ ] **Step 1: Extend the failing spawn/lifecycle tests**

```js
assert.ok(minPairDistance >= 24, `distância mínima ${minPairDistance}`);
assert.deepEqual(brState, { alive: true, visible: true, moved: true });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/skeletons.test.js`

Expected: FAIL com distância atual aproximada de `8.8` m e/ou `moved: false` no BR.

- [ ] **Step 3: Write minimal implementation**

Adicionar ao `drySpot` a rejeição de posições próximas dos esqueletos já colocados; expor `setEnabled`; chamar `Skeletons.update` quando solo ou quando o BR estiver em `PLAY`; não usar `alive=false` para apenas ocultar a entidade.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/skeletons.test.js test/br-flags-novas.test.js`

Expected: PASS.

### Task 3: Registro único de alvos PvE para todas as armas

**Files:**
- Modify: `game.js`
- Modify: `br-game.js`
- Create: `test/br-pve-weapons.test.js`

**Interfaces:**
- Consumes: `window.__game.extraTargets`, entradas `{ alive, pos(), hitboxes, damage(amount, hitPart) }`.
- Produces: `window.__BR_ballistics` e `window.__BR_melee` testando jogadores remotos e PvE; retorna impacto mais próximo em uma única ordenação por distância.

- [ ] **Step 1: Write the failing weapon matrix test**

```js
for (const weapon of ['FACA', 'FUZIL', 'DMR', 'PLASMA']) {
  const before = target.hp;
  await fireAt(target, weapon);
  assert.ok(target.hp < before, `${weapon} não causou dano PvE`);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/br-pve-weapons.test.js`

Expected: FAIL para faca, fuzil, DMR e plasma.

- [ ] **Step 3: Write minimal implementation**

Expor `extraTargets` somente para leitura no hook do jogo; em `br-game.js`, calcular interseções dos hitboxes PvE com a mesma origem/direção e aplicar apenas o impacto mais próximo. Preservar o envio Socket.IO somente quando o alvo escolhido for jogador remoto.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/br-pve-weapons.test.js test/gameplay.test.js`

Expected: PASS.

### Task 4: Causa tipada de dano e morte

**Files:**
- Modify: `game.js`
- Modify: `br-game.js`
- Modify: `server.js`
- Create: `test/br-death-cause.test.js`

**Interfaces:**
- Consumes: `playerDamage(damage, fromPos, cause?)` com compatibilidade para chamadas de dois argumentos.
- Produces: causa `{ type: 'player'|'gas'|'animal'|'skeleton'|'zombie'|'golem'|'alien'|'environment', attackerId? }` e evento `died` sem atribuir PvE ao gás ou a um atacante antigo.

- [ ] **Step 1: Write the failing attribution tests**

```js
assert.equal(classifyDeath({ type: 'animal' }).byZone, false);
assert.equal(classifyDeath({ type: 'gas' }).byZone, true);
assert.equal(classifyDeath({ type: 'animal' }).killerId, null);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/br-death-cause.test.js`

Expected: FAIL porque toda morte sem `lastHit` vira gás.

- [ ] **Step 3: Write minimal implementation**

Guardar a última causa explícita junto com timestamp em `playerDamage`; limpar atribuição PvP quando a nova causa for PvE; enviar `cause` no evento `died`; no servidor considerar `byZone` somente para `cause.type === 'gas'`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/br-death-cause.test.js test/server.test.js test/gameplay.test.js`

Expected: PASS.

### Task 5: Golem alinhado, com perseguição e ataque à distância

**Files:**
- Modify: `br-game.js`
- Create: `test/br-golem.test.js`

**Interfaces:**
- Consumes: `MP.playerDamage`, `MP.Structures`, `MP.heightAt` e `FX.tracer`.
- Produces: frente visual `-Z` alinhada ao movimento, core hitbox no peito visível, perseguição do jogador e projétil telegráfico com alcance/tempo de vida.

- [ ] **Step 1: Write the failing geometry/attack tests**

```js
assert.ok(probe.frontDotMovement > 0.99);
assert.ok(probe.coreDistanceFromVisibleCore < 0.05);
assert.ok(probe.hasRangedAttack);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/br-golem.test.js`

Expected: FAIL com `frontDotMovement` próximo de `-1` e core deslocado.

- [ ] **Step 3: Write minimal implementation**

Usar frente visual `(sin(yaw), 0, -cos(yaw))`, corrigir a posição do core, substituir a órbita rígida por perseguição com distância de segurança e adicionar projéteis removidos por impacto, terreno, estrutura ou tempo de vida.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/br-golem.test.js test/br-flags-novas.test.js`

Expected: PASS.

### Task 6: Bots observam humanos, respeitam fase/zona e mostram combate

**Files:**
- Modify: `scripts/bots.js`
- Modify: `server.js`
- Modify: `br-game.js`
- Create: `test/bots-behavior.test.js`

**Interfaces:**
- Consumes: eventos `playerUpdate`, `shotHit`, `matchPlan`, `beginMatch`, `playerFired`.
- Produces: bot marcado com `bot: true`, aquisição do humano mais próximo em alcance, rotação visual alinhada, navegação segura com gás desligado/inverso e réplica visual de arma/disparo.

- [ ] **Step 1: Write the failing pure behavior tests**

```js
assert.equal(selectTarget(bot, [human, otherBot]).id, human.id);
assert.equal(zonePressure({ gas: 'off' }, bot), null);
assert.equal(isGasDanger({ gas: 'inversa' }, inside), true);
assert.ok(forwardDotMovement(bot) > 0.99);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/bots-behavior.test.js`

Expected: FAIL porque os helpers não existem e o bot atual mira apenas o array local de bots.

- [ ] **Step 3: Write minimal implementation**

Extrair helpers puros de decisão, alimentar o mapa de oponentes com `playerUpdate`, rejeitar tiro fora de `PLAY`/alcance, marcar bots no handshake e replicar `heldWeapon`/`playerFired`. Projetar apenas bots no terreno do cliente para não alterar jogadores humanos em telhados.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/bots-behavior.test.js test/server.test.js`

Expected: PASS.

### Task 7: Colisão e vida útil dos ataques autônomos

**Files:**
- Modify: `js/alien.js`
- Modify: `js/boss.js`
- Modify: `js/enemies.js`
- Create: `test/autonomous-attacks.test.js`

**Interfaces:**
- Consumes: `Structures` e `obstaclesNear` já disponíveis nas fábricas.
- Produces: projéteis removidos por estrutura/terreno/tempo de vida e tiros de soldados originados na arma, não no tórax.

- [ ] **Step 1: Write the failing collision tests**

```js
assert.equal(probe.projectileCrossedWall, false);
assert.equal(probe.expiredProjectileCount, 0);
assert.ok(probe.muzzleDistanceFromGun < 0.15);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/autonomous-attacks.test.js`

Expected: FAIL para travessia de parede e origem visual do tiro.

- [ ] **Step 3: Write minimal implementation**

Adicionar `life` a cada projétil e consultar a estrutura/terreno a cada passo; expor/usar um ponto de muzzle preso ao braço/arma do soldado; manter dano e cadência atuais.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/autonomous-attacks.test.js test/gameplay.test.js`

Expected: PASS.

### Task 8: Regressão completa e playtest real

**Files:**
- Modify: `docs/superpowers/plans/2026-07-13-ai-combat-stabilization.md`

**Interfaces:**
- Consumes: todas as correções anteriores.
- Produces: evidência automatizada e visual, sem commit.

- [ ] **Step 1: Run focused suites**

Run: `node --test --test-concurrency=1 test/animals-combat.test.js test/skeletons.test.js test/br-pve-weapons.test.js test/br-death-cause.test.js test/br-golem.test.js test/bots-behavior.test.js test/autonomous-attacks.test.js`

Expected: PASS sem erros de console.

- [ ] **Step 2: Run the complete suite**

Run: `npm test`

Expected: PASS; se um teste ambiental exceder timeout, registrar o nome e rerodar isoladamente sem mascarar falha funcional.

- [ ] **Step 3: Run static validation**

Run: `npm run lint`

Expected: PASS.

- [ ] **Step 4: Run headless Chromium playtest**

Abrir o servidor existente em `http://127.0.0.1:3000`, entrar em solo e BR, observar movimento/ataques por pelo menos 10 s em cada modo, validar vida decrescendo com causa correta, disparar faca/fuzil/DMR/plasma contra PvE e verificar `window.__game.errors` vazio.

- [ ] **Step 5: Review the final worktree**

Run: `git diff --check && git status --short && git diff -- game.js br-game.js server.js scripts/bots.js js/ test/`

Expected: nenhuma alteração foi commitada; alterações anteriores do usuário permanecem intactas.
