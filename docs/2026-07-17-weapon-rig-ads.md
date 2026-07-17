# Weapon Rig / ADS / Mecanismos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ADS por eixo óptico real nas 8 armas (GLB como base visual), miras trocáveis visíveis (T), mecanismos animados por classe, bazuca mirando pelo scope lateral com foguete convergindo pro ponto mirado — sem tocar em dano/spread/servidor.

**Architecture:** Novo módulo `js/weaponrig.js` com perfis declarativos por arma (sights com `eye/front/up/eyeRelief/fov/reticle`, âncoras, mecanismos). `game.js` passa a interpolar hip↔ADS com posição + quaternion vindos do rig (slerp), em vez de `gun.adsV` solto. Complementos procedurais (bolt/pump/mag/foguete/célula/miras) são construídos SOBRE o GLB após `WeaponModels.ready`. Sniper Agulha: clips do GLB viram autoridade única (sem reparent). Autoridade de dano intocada (hitscan segue centro da câmera; foguete converge da boca real pro aimPoint central).

**Tech Stack:** three.js (versão travada do projeto), node:test + puppeteer-core (harness existente `test/helpers/harness.js`).

## Global Constraints (copiar do prompt — valem pra TODAS as tasks)

- SEM Blender; SEM editar/reexportar/sobrescrever GLBs; calibração 100% em código.
- Manter Three.js/Cannon-es/Socket.IO; sem upgrades de dependência; sem assets novos externos.
- NÃO alterar balanceamento: `dmg, rpm, pellets, magSize, reserveStart, reloadTime, spreadHip, spreadAds` intocados. (Exceção documentada: `adsFov` da faca — é apresentação, não regra.)
- NÃO alterar índices do arsenal, `WEAPON_CODES`, loot, protocolo de rede. Zero eventos de rede novos; miras/mecanismos = estado visual local.
- Procedural continua como fallback se GLB falhar; fallback também precisa de perfil de mira válido.
- Servidor: nenhuma validação removida/relaxada (`test/security-regression.test.js` continua passando).
- **SEM commit/push/PR** (pedido explícito do prompt — ignorar passos de commit do template).
- Não matar porta 3000. Testes browser: portas fixas exclusivas — usar **3220, 3222, 3224, 3226** (livres; existentes usam 3164–3218). Rodar múltiplos arquivos sempre com `--test-concurrency=1`.
- Ordem de consumo do `Math.random` seedado (worldgen) é contrato — este trabalho não toca worldgen; não introduzir `rand()` seedado novo em módulos de arma.
- `bazooka.optimized.glb` é o runtime; NÃO trocar pelo fonte grande. `ak-47_reddot.glb` só referência, não mapear.

## Fatos do código (levantados 2026-07-17, HEAD `7752f14`, branch `refatoracao`)

- `js/weapons.js` — 8 armas procedurais; `makeWeapon` guarda `hipV/adsV`; `parts.sights` só no fuzil (game.js:1498-1507 troca via T); âncoras `parts.mag/pump/bolt/handR/handL`; `muzzleAnchor` por arma.
- `js/weaponmodels.js` — `DEFS` idx 0,1,2,3,4,6,7; normaliza por Box3 (eixo mais comprido → Z, escala por `len`, centraliza X/Y/Z + `pos`); esconde meshes procedurais exceto mãos; `bind` (idx6) faz `anchor.attach(node)` **← bug de mixer**; mixer em `root`; `update(dt)` dispara `reload`/`bolt_slide`; `status()`.
- `game.js` — `applyFpsCamera` (1050): pose só posição `lerpVectors(hip+offset, gun.adsV, ads)` + `weaponRoot.rotation.set(sway/sprint/lower)` (1111-1121); recarga coreografada (1123-1169); ciclo pump/bolt (1183-1192); `weaponRoot.visible = … scopedK < 0.85` (1197); scope overlay `adsFov < 32` (1067, 1210); crosshair some `adsT > 0.55` (1227); FOV (1214). `fire(t)` (1314): melee early-return; bazuca usa `camera.getWorldDirection` + `muzzle.getWorldPosition` (1343-1347); `if (!gun.auto) gun.cycleT = …` (1334) **← bug rajada/fuzil**; hitscan `camera.getWorldDirection` por pellet (1377); tracer do `_v3` (muzzle world) ao impacto. KeyT (1498). Exports `window.__game` (2042+: `WeaponModels, FpBody, arsenal, switchWeapon, get gun, tick…`).
- `js/fpbody.js` — IK 2-bones segue `gun.parts.handR/handL` (world pos) + `TUNE.fingersR/L` no espaço do `gun.group`; `GRIP` por classe (`pump`→`gun.parts.pump`, `rocket`, `melee`).
- `js/rockets.js` — `fire(from, dir)`; substep fixo 1/120; segmento anti-túnel; UMA detonação.
- `br-game.js` — arma remota = 1 caixa genérica (~90-116, `rp.body.weapon` + `muzzle`); `weaponCode()` linha 20; `heldWeapon` (1309, 1646); `playerFired` (1312); throttle `shotFired` (232-248).
- HUD: `#crosshair` (style.css:33-41, `--gap`), `#scope` (style.css:109+, opacity = scopedK).
- GLBs (inspeção `scripts/inspect-glb.js`):
  - idx0 M4: 7 nós/2 meshes/1 mat, sem clips (soldado).
  - idx1 Shotgun lenta: 10 nós/1 mesh, tem `Light`/`Camera` (já stripados).
  - idx2 Sniper lenta: 11 nós/6 meshes/4 mats, `Magazine_2` separado.
  - idx3 bazooka.optimized: 9 nós/9 meshes/9 mats, nós todos "defaultMaterial" → localizar scope POR MATERIAL (`Scope`, `Glass`…).
  - idx4 Alien: 1 mesh soldado.
  - idx6 sniper rápida: nós `trigger_2, mag_4, bolt_6`; clips `bolt_slide`(2 canais), `reload`(3 canais).
  - idx7 shotgun rápida: 88 nós/42 meshes/10 mats, nomes genéricos `Cube.*/Cylinder.*` → mapear por posição espacial, não por regex de nome.
- Testes existentes a atualizar: `test/asset-models.test.js:82` (só checa `children.some(/mag/)` — substituir por prova de movimento); `test/gameplay.test.js:422` (T só valida mensagem — reforçar). Harness: `bootGame({port})`, `h.play(fn)`, `h.pageErrors`, QA com `tick(n, dt)` manual determinístico.
- Baseline da suíte: rodando em background no início do trabalho (task `ba069ctdg`) — registrar resultado no relatório.

---

### Task 0: Baseline — inspeção espacial dos GLBs + screenshots do bug

**Files:**
- Create: `scripts/inspect-glb-spatial.js`
- Create: `scripts/capture-weapons.js`
- Output (não versionado): `output/weapons-baseline/*.png`, `output/weapon-spatial.json`

**Interfaces:**
- Produces: `output/weapon-spatial.json` — por arma: `{ idx, url, nodes: [{ name, isMesh, material, bboxLocal: {min:[…],max:[…]}, bboxGun: {min,max} }], gunBox: {min,max} }` onde `bboxGun` é o bbox no ESPAÇO DO `gun.group` (após normalização do weaponmodels — reproduzida no script). É a fonte dos números de calibração das Tasks 3-8.

- [ ] **Step 1: escrever `scripts/inspect-glb-spatial.js`** — Node ESM com three de `node_modules` (mesmo import dos testes de módulo; ver como `test/game-modules.test.js` carrega `js/*.js` e copiar o mecanismo de import/loader). Carregar cada GLB com `GLTFLoader` + reproduzir `normalized()` de js/weaponmodels.js (copiar as constantes `DEFS` — importar a função real se exportável; senão duplicar com comentário "espelho de weaponmodels.normalized"). Para cada nó: `new THREE.Box3().setFromObject(node)` no espaço final. Gravar JSON em `output/weapon-spatial.json` e imprimir resumo. GLB em Node: usar `GLTFLoader` com `FileReader` indisponível — carregar via `fs.readFileSync` + `loader.parse(buffer.buffer, '')`. Se `GLTFLoader` exigir DOM (`TextDecoder` ok em Node), stub mínimo: `global.self = global`.
- [ ] **Step 2: rodar** `node scripts/inspect-glb-spatial.js` — esperado: JSON com 7 armas (idx 0-4,6,7), bboxes finitos. Falhou por DOM/decoder → ajustar stubs, não mudar assets.
- [ ] **Step 3: escrever `scripts/capture-weapons.js`** clonando o padrão de `scripts/capture-fp.js` (porta 3213 default): para cada idx 0..7 → `G.arsenal[i].locked=false; G.switchWeapon(i)`, esperar `WeaponModels.ready`, capturar 4 frames: hip; ADS (`QA`: `G.mouse.aiming=true` + `G.tick` ×90); fire (`G.mouse.clicked=true` + tick ×4); reload (`G.gun.reloading` meio, tick até k≈0.5). Salvar `output/weapons-baseline/w{i}-{hip|ads|fire|reload}.png`. Reusar boot do capture-fp (server spawn, swiftshader, 1280×720).
- [ ] **Step 4: rodar captura baseline** `node scripts/capture-weapons.js 3213 output/weapons-baseline` — 32 PNGs. Olhar os ADS: confirmar o diagnóstico (receiver/tubo cobrindo centro). Guardar para comparação final.
- [ ] **Step 5: registrar baseline da suíte** — colher resultado do run background (`ba069ctdg`); anotar pass/fail/skip em `docs/2026-07-17-weapon-rig-ads.md` (seção "Baseline" no fim). Flakes: re-rodar só o arquivo isolado 2-3× antes de contar como falha pré-existente.

### Task 1: `js/weaponrig.js` — perfis + matemática de pose + API de QA (TDD)

**Files:**
- Create: `js/weaponrig.js`
- Create: `test/weapon-rig.test.js` (node puro, sem browser)
- Modify: `game.js` (~746: criar rig; ~2045: exportar `WeaponRig`)

**Interfaces:**
- Produces (usado pelas tasks 2-9):
  - `createWeaponRig({ arsenal, camera, weaponRoot }) → WeaponRig`
  - `WeaponRig.adsPose(gun) → { pos: Vector3, quat: Quaternion }` (cacheada; recalcula em `cycleSight`/model-ready)
  - `WeaponRig.hipPose(gun) → { pos, quat }` (hoje: `hipV + [0, .05, .06]`, quat identidade — visual de hip INALTERADO)
  - `WeaponRig.activeSight(gun) → sight|null`, `WeaponRig.cycleSight(gun) → sight|null`
  - `WeaponRig.sightRefK(gun, adsT) → 0..1` (quão "usável" está a referência visual de mira)
  - `WeaponRig.attachComplements(gun)` (Task 5), `WeaponRig.update(dt, t, gun)` (Task 5)
  - `WeaponRig.status() / inspect(idx) / getAlignmentMetrics(idx, sightId?)` — leitura pura, sem setters de gameplay.
  - Perfil: `PROFILES[idx] = { idx, sights: [{ id, label, type:'iron'|'redDot'|'holo'|'scope'|'launcher', eye:[x,y,z], front:[x,y,z], up?:[x,y,z], eyeRelief, fov, reticle:'none'|'dot'|'holo'|'overlay'|'launcher' }], anchors: { muzzle, gripR, supportHand, ejection? }, mechanisms: {…Task 5}, melee?: true }` — coordenadas no espaço local do `gun.group`.

- [ ] **Step 1: teste que falha primeiro** — `test/weapon-rig.test.js` (CommonJS + `import()` dinâmico do módulo ES, mesmo padrão de game-modules.test.js). Casos:

```js
'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert');

let THREE, createWeaponRig;
before(async () => {
  THREE = await import('three');
  ({ createWeaponRig } = await import('../js/weaponrig.js'));
});

function fakeGun(idx) { // esqueleto mínimo compatível com o rig
  return { name: 'w' + idx, group: new THREE.Group(), parts: {}, rigIdx: idx,
    hipV: new THREE.Vector3(0.26, -0.235, -0.5), mag: 5, magSize: 5,
    reloading: false, reloadEnd: 0, reloadTime: 1.5, cycleT: 0, lastShot: -9 };
}

describe('WeaponRig — perfis', () => {
  it('dado o rig, então há perfil válido pros 8 índices e a faca é melee', async () => {
    const camera = new THREE.PerspectiveCamera();
    const arsenal = Array.from({ length: 8 }, (_, i) => fakeGun(i));
    const rig = createWeaponRig({ arsenal, camera, weaponRoot: new THREE.Group() });
    for (let i = 0; i < 8; i++) {
      const p = rig.inspect(i);
      assert.ok(p, 'sem perfil idx ' + i);
      if (i === 5) { assert.equal(p.melee, true); assert.equal(p.sights.length, 0); continue; }
      assert.ok(p.sights.length >= 1, 'arma de fogo sem mira idx ' + i);
      assert.ok(p.anchors.muzzle && p.anchors.gripR && p.anchors.supportHand, 'âncora faltando idx ' + i);
      for (const s of p.sights) {
        for (const v of [...s.eye, ...s.front]) assert.ok(Number.isFinite(v));
        assert.ok(s.eyeRelief > 0.05 && s.eyeRelief < 0.6, 'eyeRelief fora da janela idx ' + i);
        assert.ok(s.fov >= 20 && s.fov <= 70);
        // eixo óptico aponta pra FRENTE da arma (-Z local): front está à frente do eye
        assert.ok(s.front[2] < s.eye[2], 'front não está à frente do eye idx ' + i);
      }
      // muzzle à frente do corpo
      assert.ok(p.anchors.muzzle[2] < -0.3, 'muzzle não está na ponta idx ' + i);
    }
  });
  it('dada a pose ADS, então o eixo óptico mapeia pro -Z da câmera com quat normalizado', () => {
    const camera = new THREE.PerspectiveCamera();
    const arsenal = Array.from({ length: 8 }, (_, i) => fakeGun(i));
    const rig = createWeaponRig({ arsenal, camera, weaponRoot: new THREE.Group() });
    for (const i of [0, 1, 2, 3, 4, 6, 7]) {
      const gun = arsenal[i];
      const pose = rig.adsPose(gun);
      assert.ok(Math.abs(pose.quat.length() - 1) < 1e-6, 'quat não normalizado idx ' + i);
      const s = rig.activeSight(gun);
      const f = new THREE.Vector3().fromArray(s.front).sub(new THREE.Vector3().fromArray(s.eye))
        .normalize().applyQuaternion(pose.quat);
      assert.ok(f.angleTo(new THREE.Vector3(0, 0, -1)) < THREE.MathUtils.degToRad(0.1),
        `eixo óptico não mapeou pro -Z (idx ${i}): ${f.toArray()}`);
      // olho na ocular: eye transformado cai em (0,0,-eyeRelief)
      const eyeCam = new THREE.Vector3().fromArray(s.eye).applyQuaternion(pose.quat).add(pose.pos);
      assert.ok(eyeCam.distanceTo(new THREE.Vector3(0, 0, -s.eyeRelief)) < 1e-6, 'eye fora da ocular idx ' + i);
      for (const v of [...pose.pos.toArray(), ...pose.quat.toArray()]) assert.ok(Number.isFinite(v));
    }
  });
  it('dada uma mira LATERAL (bazuca), então a pose desloca o tubo pro lado', () => {
    const camera = new THREE.PerspectiveCamera();
    const arsenal = Array.from({ length: 8 }, (_, i) => fakeGun(i));
    const rig = createWeaponRig({ arsenal, camera, weaponRoot: new THREE.Group() });
    const s = rig.activeSight(arsenal[3]);
    assert.ok(Math.abs(s.eye[0]) > 0.03, 'mira da bazuca deveria ser lateral (|x| > 3cm)');
    const pose = rig.adsPose(arsenal[3]);
    // centro do tubo (x=0 local) NÃO fica no eixo da câmera: |x câmera| > 2cm
    const tube = new THREE.Vector3(0, 0.02, -0.3).applyQuaternion(pose.quat).add(pose.pos);
    assert.ok(Math.abs(tube.x) > 0.02, 'tubo continua no centro: ' + tube.x);
  });
  it('dado cycleSight, então alterna, persiste por arma e só existe com 2+ miras', () => {
    const camera = new THREE.PerspectiveCamera();
    const arsenal = Array.from({ length: 8 }, (_, i) => fakeGun(i));
    const rig = createWeaponRig({ arsenal, camera, weaponRoot: new THREE.Group() });
    const rifle = arsenal[0];
    const s0 = rig.activeSight(rifle);
    const s1 = rig.cycleSight(rifle);
    assert.notEqual(s0.id, s1.id, 'não alternou');
    assert.equal(rig.activeSight(rifle).id, s1.id, 'não persistiu');
    assert.equal(rig.cycleSight(arsenal[5]), null, 'faca não pode ciclar mira');
    if (rig.inspect(1).sights.length === 1) assert.equal(rig.cycleSight(arsenal[1]), null);
  });
});
```

- [ ] **Step 2: rodar e ver falhar** — `node --test test/weapon-rig.test.js` → FAIL (`Cannot find module '../js/weaponrig.js'`).
- [ ] **Step 3: implementar `js/weaponrig.js`** — núcleo:

```js
/* Rig declarativo das armas em primeira pessoa.
   Fonte única de: pose ADS por mira (eixo óptico eye→front mapeado pro -Z da
   câmera), âncoras de empunhadura/boca, acessórios de mira (tecla T) e
   mecanismos visuais. Nada aqui é autoridade de gameplay: dano, spread e
   validação do servidor não passam por este módulo. */
import * as THREE from 'three';

export function createWeaponRig(deps) {
  const { arsenal, camera, weaponRoot } = deps;
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
  const _m = new THREE.Matrix4();

  /* Perfis por índice do arsenal. Coordenadas no espaço local do gun.group.
     Valores iniciais derivados dos adsV atuais (equivalência exata:
     ads [x,y,z] ⇔ eye [-x,-y,0], eyeRelief=-z) — a Task 4 recalibra pro GLB
     com output/weapon-spatial.json. */
  const PROFILES = [
    { idx: 0, sights: [
        { id: 'iron', label: 'Alça de ferro', type: 'iron', eye: [0, 0.0915, 0.0], front: [0, 0.0915, -0.8], eyeRelief: 0.3, fov: 55, reticle: 'none' },
        { id: 'reddot', label: 'Red Dot', type: 'redDot', eye: [0, 0.131, 0.0], front: [0, 0.131, -0.8], eyeRelief: 0.3, fov: 48, reticle: 'dot' },
        { id: 'scope2x', label: 'Luneta 2x', type: 'scope', eye: [0, 0.137, 0.06], front: [0, 0.137, -0.8], eyeRelief: 0.24, fov: 36, reticle: 'overlay' },
      ],
      anchors: { muzzle: [0, 0.033, -0.47], gripR: [0.02, -0.1, 0.17], supportHand: [0, -0.078, -0.38], ejection: [0.045, 0.02, 0.03] },
      mechanisms: {} },
    { idx: 1, sights: [
        { id: 'bead', label: 'Maçaneta', type: 'iron', eye: [0, 0.075, 0.0], front: [0, 0.075, -0.69], eyeRelief: 0.36, fov: 62, reticle: 'none' },
      ],
      anchors: { muzzle: [0, 0.045, -0.5], gripR: [0.02, -0.09, 0.22], supportHand: [0, -0.052, -0.38], ejection: [0.04, -0.01, 0.04] },
      mechanisms: {} },
    { idx: 2, sights: [
        { id: 'scope', label: 'Luneta', type: 'scope', eye: [0, 0.115, 0.14], front: [0, 0.115, -0.18], eyeRelief: 0.2, fov: 26, reticle: 'overlay' },
      ],
      anchors: { muzzle: [0, 0.03, -0.6], gripR: [0.02, -0.095, 0.22], supportHand: [0, -0.062, -0.42], ejection: [0.045, 0.03, 0.1] },
      mechanisms: {} },
    { idx: 3, sights: [
        // scope LATERAL real do GLB (materiais Scope/Glass) — números da Task 8
        { id: 'launcher', label: 'Visor do lançador', type: 'launcher', eye: [0.07, 0.1, 0.1], front: [0.07, 0.1, -0.5], eyeRelief: 0.26, fov: 55, reticle: 'launcher' },
      ],
      anchors: { muzzle: [0, 0.02, -0.62], gripR: [0.02, -0.16, 0.14], supportHand: [0.02, -0.15, -0.15] },
      mechanisms: {} },
    { idx: 4, sights: [
        { id: 'holo', label: 'Mira holográfica', type: 'holo', eye: [0, 0.09, 0.0], front: [0, 0.09, -0.6], eyeRelief: 0.3, fov: 58, reticle: 'holo' },
      ],
      anchors: { muzzle: [0, 0.01, -0.44], gripR: [0.02, -0.095, 0.19], supportHand: [0, -0.075, -0.3] },
      mechanisms: {} },
    { idx: 5, melee: true, sights: [],
      anchors: { muzzle: [0, 0.02, -0.4], gripR: [0.015, -0.055, 0.03], supportHand: [-0.24, -0.16, 0.28] },
      mechanisms: {} },
    { idx: 6, sights: [
        { id: 'scope', label: 'Luneta', type: 'scope', eye: [0, 0.112, 0.12], front: [0, 0.112, -0.2], eyeRelief: 0.22, fov: 30, reticle: 'overlay' },
      ],
      anchors: { muzzle: [0, 0.028, -0.55], gripR: [0.02, -0.095, 0.22], supportHand: [0, -0.062, -0.42], ejection: [0.045, 0.03, 0.08] },
      mechanisms: {} },
    { idx: 7, sights: [
        { id: 'bead', label: 'Mira aberta', type: 'iron', eye: [0, 0.07, 0.0], front: [0, 0.07, -0.45], eyeRelief: 0.34, fov: 62, reticle: 'none' },
      ],
      anchors: { muzzle: [0, 0.03, -0.45], gripR: [0.02, -0.09, 0.22], supportHand: [0, -0.052, -0.34], ejection: [0.04, -0.01, 0.04] },
      mechanisms: {} },
  ];

  const byGun = new Map(); // gun -> { profile, sightIdx, poseCache: Map(sightId -> {pos,quat}) }
  arsenal.forEach((gun, i) => {
    const profile = PROFILES.find(p => p.idx === i);
    if (profile) byGun.set(gun, { profile, sightIdx: 0, poseCache: new Map() });
  });

  function stateOf(gun) { return byGun.get(gun) || null; }

  /* mapeia o eixo óptico (eye→front, up de referência) pro eixo da câmera:
     forward vira -Z, up vira +Y; o olho fica a eyeRelief da ocular. */
  function computePose(sight) {
    const eye = new THREE.Vector3().fromArray(sight.eye);
    const f = new THREE.Vector3().fromArray(sight.front).sub(eye).normalize();
    const upHint = _v3.fromArray(sight.up || [0, 1, 0]);
    const r = new THREE.Vector3().crossVectors(f, upHint);
    if (r.lengthSq() < 1e-8) r.set(1, 0, 0); else r.normalize();
    const u = new THREE.Vector3().crossVectors(r, f).normalize();
    _m.makeBasis(r, u, _v2.copy(f).negate());
    const quat = new THREE.Quaternion().setFromRotationMatrix(_m).invert();
    const pos = new THREE.Vector3(0, 0, -sight.eyeRelief).sub(eye.applyQuaternion(quat));
    return { pos, quat };
  }

  function activeSight(gun) {
    const st = stateOf(gun);
    if (!st || !st.profile.sights.length) return null;
    return st.profile.sights[st.sightIdx % st.profile.sights.length];
  }
  function adsPose(gun) {
    const st = stateOf(gun);
    const s = activeSight(gun);
    if (!st || !s) return hipPose(gun); // faca/desconhecida: pose de guarda = hip
    if (!st.poseCache.has(s.id)) st.poseCache.set(s.id, computePose(s));
    return st.poseCache.get(s.id);
  }
  const _hip = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  function hipPose(gun) {
    _hip.pos.copy(gun.hipV); _hip.pos.y += 0.05; _hip.pos.z += 0.06;
    _hip.quat.identity();
    return _hip;
  }
  function cycleSight(gun) {
    const st = stateOf(gun);
    if (!st || st.profile.sights.length < 2) return null;
    st.sightIdx = (st.sightIdx + 1) % st.profile.sights.length;
    return activeSight(gun);
  }
  function invalidatePose(gun) { const st = stateOf(gun); if (st) st.poseCache.clear(); }

  /* referência de mira "usável": 0 enquanto não há nada alinhado na tela,
     sobe quando o ADS está quase completo (crosshair só some com isto > 0). */
  function sightRefK(gun, adsT) {
    const s = activeSight(gun);
    if (!s) return 0; // faca: crosshair nunca some
    return THREE.MathUtils.clamp((adsT - 0.75) / 0.2, 0, 1);
  }

  function status() {
    return arsenal.map((gun, idx) => ({
      idx, name: gun.name, model: gun.modelStatus || 'procedural',
      sight: (activeSight(gun) || {}).id || null,
      sights: (stateOf(gun) ? stateOf(gun).profile.sights.length : 0),
    }));
  }
  function inspect(idx) {
    const st = stateOf(arsenal[idx]);
    return st ? st.profile : null;
  }
  /* métricas de alinhamento em MUNDO/da câmera — só leitura, para QA. */
  function getAlignmentMetrics(idx, sightId) {
    const gun = arsenal[idx];
    const st = stateOf(gun);
    if (!st) return null;
    const s = sightId ? st.profile.sights.find(x => x.id === sightId) : activeSight(gun);
    if (!s) return null;
    gun.group.updateWorldMatrix(true, false);
    camera.updateMatrixWorld(true);
    const eyeW = new THREE.Vector3().fromArray(s.eye).applyMatrix4(gun.group.matrixWorld);
    const frontW = new THREE.Vector3().fromArray(s.front).applyMatrix4(gun.group.matrixWorld);
    const axis = frontW.clone().sub(eyeW).normalize();
    const camDir = camera.getWorldDirection(new THREE.Vector3());
    const angleErrDeg = THREE.MathUtils.radToDeg(axis.angleTo(camDir));
    const ndcFront = frontW.clone().project(camera);
    const ndcEye = eyeW.clone().project(camera);
    return {
      sight: s.id, angleErrDeg,
      ndcFront: [ndcFront.x, ndcFront.y], ndcEye: [ndcEye.x, ndcEye.y],
      eyeCam: eyeW.applyMatrix4(camera.matrixWorldInverse).toArray(),
    };
  }

  return { adsPose, hipPose, activeSight, cycleSight, invalidatePose, sightRefK,
    status, inspect, getAlignmentMetrics,
    // preenchidos na Task 5:
    attachComplements() {}, update() {} };
}
```

- [ ] **Step 4: rodar** `node --test test/weapon-rig.test.js` → PASS (4 testes). Nota: `fakeGun` não usa `arsenal` real — o rig só depende de índice/hipV/group.
- [ ] **Step 5: ligar no game.js** — depois da linha 746 (`createWeapons`):

```js
const WeaponRig = createWeaponRig({ arsenal, camera, weaponRoot });
```

com `import { createWeaponRig } from './js/weaponrig.js';` no topo (junto dos outros imports de js/). Exportar em `window.__game` (bloco ~2042): adicionar `WeaponRig,` na lista. Rodar `npm run lint` → limpo.

### Task 2: game.js — pose ADS por quaternion + regras de crosshair/scope

**Files:**
- Modify: `game.js:1105-1121` (pose), `game.js:1197` (visibilidade), `game.js:1067` (scopedK), `game.js:1210` (overlay), `game.js:1214` (FOV), `game.js:1227` (crosshair), `game.js:1498-1507` (KeyT)
- Test: `test/weapon-ads.test.js` (novo, porta 3220)

**Interfaces:**
- Consumes: `WeaponRig.adsPose/hipPose/sightRefK/activeSight/cycleSight` (Task 1).
- Produces: comportamento — `weaponRoot.position` E `weaponRoot.quaternion` interpolados; `overlayK` substitui `scopedK` como gate de overlay/hide; crosshair via `sightRefK`.

- [ ] **Step 1: teste browser que falha no código antigo** — `test/weapon-ads.test.js`:

```js
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { CHROME, bootGame } = require('./helpers/harness.js');

describe('ADS por eixo óptico', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h;
  before(async () => { h = await bootGame({ port: 3220 }); });
  after(async () => { if (h) await h.close(); });

  const VIEWPORTS = [[1280, 720], [1920, 1080], [2560, 1080]];

  it('dado ADS completo em cada arma de fogo, então o eixo óptico fica a ≤1° do forward e o eye centrado', async () => {
    for (const [w, hh] of VIEWPORTS) {
      const r = await h.play(async ([w, hh]) => {
        await window.QA.G.WeaponModels.ready;
        window.QA.MP.composer.setSize && window.QA.MP.composer.setSize(w, hh);
        const G = window.QA.G;
        const out = [];
        for (const i of [0, 1, 2, 3, 4, 6, 7]) {
          G.arsenal[i].locked = false;
          G.switchWeapon(i);
          window.QA.tick(30);                    // switchAnim completa
          G.mouse.aiming = true;
          window.QA.tick(240);                   // adsT → ~1
          const m = G.WeaponRig.getAlignmentMetrics(i);
          const tol = Math.min(w, hh) * 0.005;   // 0.5% do menor lado
          const px = Math.hypot(m.ndcFront[0] * w / 2, m.ndcFront[1] * hh / 2);
          out.push({ i, angle: m.angleErrDeg, px, tolPx: Math.max(4, tol) });
          G.mouse.aiming = false;
          window.QA.tick(120);
        }
        return out;
      }, [w, hh]);
      for (const x of r) {
        assert.ok(x.angle <= 1, `arma ${x.i}: erro angular ${x.angle.toFixed(2)}° > 1° em ${w}x${hh}`);
        assert.ok(x.px <= x.tolPx, `arma ${x.i}: front a ${x.px.toFixed(1)}px do centro (tol ${x.tolPx}) em ${w}x${hh}`);
      }
    }
  });

  it('dado ADS, então nenhuma mesh de corpo de arma bloqueia o centro e a câmera não está dentro da arma', async () => {
    const r = await h.play(async () => {
      const G = window.QA.G, THREE = window.QA.MP.THREE;
      await G.WeaponModels.ready;
      const out = [];
      const ray = new THREE.Raycaster();
      for (const i of [0, 1, 2, 3, 4, 6, 7]) {
        G.arsenal[i].locked = false; G.switchWeapon(i);
        window.QA.tick(30);
        G.mouse.aiming = true; window.QA.tick(240);
        G.camera.updateMatrixWorld(true);
        ray.setFromCamera(new THREE.Vector2(0, 0), G.camera);
        ray.far = 1.5;
        const guns = [];
        G.gun.group.traverse(o => { if (o.isMesh && o.visible && !o.userData.sightGlass) guns.push(o); });
        const hits = ray.intersectObjects(guns, false)
          .filter(x => x.distance > 0.02); // ocular encostada não conta
        const box = new THREE.Box3().setFromObject(G.gun.group);
        const camPos = G.camera.getWorldPosition(new THREE.Vector3());
        out.push({ i, blocked: hits.length ? hits[0].object.name || 'mesh' : null,
          inside: box.containsPoint(camPos) });
        G.mouse.aiming = false; window.QA.tick(120);
      }
      return out;
    });
    for (const x of r) {
      assert.equal(x.blocked, null, `arma ${x.i}: corpo da arma bloqueia o centro (${x.blocked})`);
      assert.equal(x.inside, false, `arma ${x.i}: câmera dentro do Box3 da arma`);
    }
    assert.deepEqual(h.pageErrors, [], h.pageErrors.join(' | '));
  });

  it('dado o FOV, então chega no valor da mira ativa e volta ao base ao soltar', async () => {
    const r = await h.play(async () => {
      const G = window.QA.G;
      await G.WeaponModels.ready;
      G.switchWeapon(0); window.QA.tick(30);
      G.mouse.aiming = true; window.QA.tick(300);
      const fovAds = G.camera.fov;
      G.mouse.aiming = false; window.QA.tick(300);
      return { fovAds, fovBase: G.camera.fov, want: G.gun.adsFov };
    });
    assert.ok(Math.abs(r.fovAds - r.want) < 1.5, `FOV ADS ${r.fovAds} ≠ ${r.want}`);
    assert.ok(Math.abs(r.fovBase - 75) < 1.5, `FOV base não voltou: ${r.fovBase}`);
  });

  it('dado o crosshair, então só some quando a referência ADS está válida', async () => {
    const r = await h.play(async () => {
      const G = window.QA.G;
      await G.WeaponModels.ready;
      G.switchWeapon(0); window.QA.tick(30);
      const cross = () => document.getElementById('crosshair').style.opacity;
      const mid = [];
      G.mouse.aiming = true;
      for (let k = 0; k < 300; k++) {
        window.QA.tick(1);
        mid.push({ adsT: G.WeaponRig.sightRefK(G.gun, 1), op: cross() }); // amostra
      }
      const full = cross();
      G.mouse.aiming = false; window.QA.tick(200);
      // faca: nunca some
      G.arsenal[5].locked = false; G.switchWeapon(5); window.QA.tick(30);
      G.mouse.aiming = true; window.QA.tick(300);
      const knife = cross();
      G.mouse.aiming = false; window.QA.tick(120);
      return { full, knife };
    });
    assert.equal(r.full, '0', 'crosshair deveria sumir no ADS completo (mira válida)');
    assert.notEqual(r.knife, '0', 'faca não pode perder o crosshair no botão direito');
  });
});
```

  Nota: `h.play` do harness aceita função + arg serializado? Conferir assinatura em `test/helpers/harness.js` (usa `page.evaluate`); se `play(fn)` não repassa args, embutir os viewports num loop interno via `window.innerWidth` OU usar `h.page.setViewport({width,height})` entre `play`s — preferir `await h.page.setViewport(...)` fora do evaluate (puppeteer padrão) e ler `renderer.domElement.width` dentro. Ajustar o teste à API real do harness ao escrever.
- [ ] **Step 2: rodar e ver falhar** — `node --test test/weapon-ads.test.js` → FAIL nos 4 (código antigo: sem `WeaponRig.getAlignmentMetrics` exportado no jogo? — Task 1 já exportou; falha esperada = erro angular/px e centro bloqueado).
- [ ] **Step 3: implementar pose por quaternion em applyFpsCamera** — substituir game.js:1110-1121 por:

```js
  // hip um tico mais alto/perto: as MÃOS do rig entram no quadro (ADS intacto)
  const hip = WeaponRig.hipPose(gun);
  const adsPose = WeaponRig.adsPose(gun);
  weaponRoot.position.lerpVectors(hip.pos, adsPose.pos, ads);
  weaponRoot.quaternion.slerpQuaternions(hip.quat, adsPose.quat, ads);
  weaponRoot.position.x += (bobX * 0.55 + swayPos.x) * bobScale - sprintPose * 0.055;
  weaponRoot.position.y += (bobY + swayPos.y) * bobScale + Math.sin(t * 1.7) * 0.0035 * (1 - adsT)
                         - lower * 0.3 - sprintPose * 0.02;
  weaponRoot.position.z += sprintPose * 0.07;
  _poseEuler.set(
    swayRot.x + sprintPose * 0.55 - lower * 0.7,
    swayRot.y + sprintPose * 0.24,
    swayRot.y * 0.6 + leanRoll * 2.2 + sprintPose * 0.2);
  _poseQ.setFromEuler(_poseEuler);
  weaponRoot.quaternion.multiply(_poseQ);
```

  com temporários no topo do bloco da câmera (perto de `_euler`, linha 1043): `const _poseEuler = new THREE.Euler(); const _poseQ = new THREE.Quaternion();`. O tilt de recarga (1133-1135) troca `weaponRoot.rotation.x += …` por acumular em `_poseEuler` ANTES do `setFromEuler` — mover o bloco de recarga pra antes, ou aplicar segundo multiply: mais simples, calcular `tilt` antes e somar nos componentes do `_poseEuler` (reordenar: fase de recarga calcula `tilt/magDrop/slap/boltK` primeiro; pose depois). Manter TODAS as fórmulas de tilt/slap/mag idênticas.
- [ ] **Step 4: gates de overlay/crosshair/hide** — em applyFpsCamera:
  - linha 1067: `const sight = WeaponRig.activeSight(gun); const overlayK = (sight && sight.reticle === 'overlay') ? clamp((adsT - 0.7) / 0.3, 0, 1) : 0;` — usar `overlayK` onde era `scopedK` (breath 1068, hide 1197, overlay 1210). Sensibilidade 1211: manter regra por `gun.adsFov`.
  - linha 1227: `ui.crosshair.style.opacity = (state.driving || WeaponRig.sightRefK(gun, adsT) > 0.5) ? '0' : '1';`
  - FOV 1214: `gun.adsFov` continua a fonte (cycleSight atualiza `gun.adsFov` — Step 5).
- [ ] **Step 5: KeyT via rig** — substituir game.js:1498-1507 por:

```js
  if (justPressed.has('KeyT')) { // troca o acessório de mira (só com 2+ miras)
    const s = WeaponRig.cycleSight(gun);
    if (s) {
      gun.adsFov = s.fov;
      WeaponRig.applySightVisibility(gun); // Task 3: liga a geometria da mira ativa
      centerMsg('Mira: ' + s.label, 1100);
      SFX.switchW();
    }
  }
```

  (Task 3 implementa `applySightVisibility`; até lá, stub no rig que só existe — adicionar `applySightVisibility(){}` no return da Task 1.) Remover a manipulação antiga de `gun.parts.sights`/`gun.adsV`/`gun.sightIdx` — `gun.adsV` fica APENAS como fallback de leitura para código legado; grep `adsV` e migrar todo uso restante para `WeaponRig.adsPose`.
- [ ] **Step 6: rodar** `node --test test/weapon-ads.test.js` — alinhamento/FOV/crosshair devem passar com perfis iniciais (equivalentes aos adsV antigos) para armas PROCEDURAIS; para GLBs o teste de "centro bloqueado" pode ainda falhar em algumas armas → é o gap que a Task 4 (calibração) fecha. Registrar quais índices falham; se falhar SÓ por calibração, marcar expectativa da Task 4. Rodar também `node --test test/gameplay.test.js` (T ainda mostra mensagem) e `npm run lint`.

### Task 3: Miras visíveis por arma (T real) + retículos

**Files:**
- Modify: `js/weaponrig.js` (builders de mira + `applySightVisibility` + retículo 3D)
- Modify: `js/weaponmodels.js` (não esconder meshes marcadas `userData.sightAttachment`; chamar `WeaponRig` hook pós-load)
- Modify: `game.js` (passar `WeaponRig` pra `createWeaponModels` OU expor callback; ordem de criação: weapons → rig → weaponmodels)
- Modify: `test/gameplay.test.js:422` (teste do T: além da mensagem, mira visível)
- Test: `test/weapon-ads.test.js` (caso novo)

**Interfaces:**
- Consumes: `output/weapon-spatial.json` (posição do trilho superior do M4 etc.).
- Produces: `WeaponRig.applySightVisibility(gun)`; cada sight ganha opcional `mesh` (Group construído pelo rig, `userData.sightAttachment = true`; lentes/retículo com `userData.sightGlass = true` — exceção do raycast central).

- [ ] **Step 1: teste (falha antes)** — em `test/weapon-ads.test.js`:

```js
  it('dado T no fuzil, então a mira VISÍVEL troca junto com FOV/pose e persiste', async () => {
    const r = await h.play(async () => {
      const G = window.QA.G;
      await G.WeaponModels.ready;
      G.switchWeapon(0); window.QA.tick(30);
      const visibleSightMeshes = () => {
        let n = 0;
        G.gun.group.traverse(o => { if (o.userData.sightAttachment && o.visible) {
          let vis = true, p = o; while (p) { if (!p.visible) { vis = false; break; } p = p.parent; }
          if (vis) o.traverse(m => { if (m.isMesh) n++; });
        } });
        return n;
      };
      const s0 = { id: G.WeaponRig.activeSight(G.gun).id, fov: G.gun.adsFov, meshes: visibleSightMeshes() };
      window.QA.MP.justPressed.add('KeyT'); window.QA.tick(1);
      const s1 = { id: G.WeaponRig.activeSight(G.gun).id, fov: G.gun.adsFov, meshes: visibleSightMeshes() };
      // troca de arma e volta: escolha persiste
      G.switchWeapon(1); window.QA.tick(10); G.switchWeapon(0); window.QA.tick(10);
      const s2 = G.WeaponRig.activeSight(G.gun).id;
      return { s0, s1, s2 };
    });
    assert.notEqual(r.s0.id, r.s1.id);
    assert.notEqual(r.s0.fov, r.s1.fov);
    assert.ok(r.s1.meshes > 0, 'mira trocada não tem NENHUMA mesh visível');
    assert.equal(r.s2, r.s1.id, 'escolha de mira não persistiu na troca de arma');
  });
```

- [ ] **Step 2: rodar e ver falhar** (mira invisível no GLB hoje).
- [ ] **Step 3: builders no rig** — `buildSightMesh(sight, gun)` dentro do weaponrig:
  - `redDot`: caixinha + anel + dot emissivo (copiar geometria do reddot procedural de js/weapons.js:68-75, materiais próprios do rig — NÃO reusar `wm` pra não criar dependência circular); dot com `userData.sightGlass = true`.
  - `scope2x` (fuzil): tubo `CylinderGeometry(..., openEnded=true)` + anéis torus + plano de retículo emissivo fino no meio (`sightGlass`).
  - `holo` (plasma): moldura + plano circular translúcido emissivo (`transparent, opacity 0.35, depthWrite:false`) + retículo (anel+ponto) — estilo teal do plasma (`0x2ee6c8`).
  - `launcher` (bazuca — Task 8 posiciona): moldura + retículo simples de lançador (chevrons), sem zoom fake.
  - `iron`: sem mesh nova quando o GLB já tem ferro (M4/escopetas); manter `mesh: null`.
  - Posição: `sight.mount` (novo campo por perfil, ex. trilho do M4 do spatial.json). Cada grupo `userData.sightAttachment = true`, adicionado a `gun.group` — SÓ a mira ativa visível.
- [ ] **Step 4: `applySightVisibility(gun)`** — esconde todos os `sightAttachment` da arma, mostra o da mira ativa; chama `invalidatePose(gun)`; garante 1 mira por trilho (attachments trocáveis dividem o MESMO mount — nunca 2 visíveis).
- [ ] **Step 5: ordem de boot + proteção no hide-loop** — em `js/weaponmodels.js` `attach()`: o loop que esconde meshes (linha ~122) ganha `if (o.userData.sightAttachment) return;` no traverse; após `gun.modelStatus = 'ready'`, chamar `deps.onModelReady && deps.onModelReady(gun)`. Em game.js: `createWeaponModels({ arsenal, onModelReady: gun => { WeaponRig.attachComplements(gun); WeaponRig.applySightVisibility(gun); } })`. Rig constrói attachments no `attachComplements` (idempotente: se já construiu, só reposiciona). Para fallback (GLB falhou), `attachComplements` também roda (chamar pra todas as armas após `WeaponModels.ready.finally` em game.js) — miras procedurais antigas (reddot/scopeAtt de js/weapons.js:68-81) são REMOVIDAS de js/weapons.js junto com `parts.sights` (fonte única = rig; menos código morto).
- [ ] **Step 6: atualizar teste antigo do T** — `test/gameplay.test.js:422`: manter verificação da mensagem E acrescentar `G.WeaponRig.activeSight` mudou. Rodar: `node --test test/weapon-ads.test.js`, `node --test test/gameplay.test.js`, `npm run lint`.

### Task 4: Calibração dos 8 perfis contra os GLBs (dados, não chute)

**Files:**
- Modify: `js/weaponrig.js` (números dos perfis: `eye/front/mount/muzzle/gripR/supportHand` por arma)
- Modify: `js/weaponmodels.js` (SÓ se `def.pos/len` precisar de ajuste fino — registrar antes/depois)
- Uses: `output/weapon-spatial.json`, `scripts/capture-weapons.js`

- [ ] **Step 1: derivar números** — para cada arma, do spatial.json: topo do receiver/trilho (linha de mira Y), ponta do cano (muzzle Z), empunhadura. Regra: `eye.y = front.y = altura da linha de mira`; `front.z` = ponta do cano; `eye.z` = ocular/alça. M4: linha do trilho; escopetas: bead; DMR/sniper: centro do tubo da luneta do GLB; plasma: acima do corpo; bazuca: Task 8.
- [ ] **Step 2: iterar com captura** — `node scripts/capture-weapons.js 3213 output/weapons-calib` após cada ajuste; olhar ADS de cada arma (centro livre, linha de mira no centro, sem roll). Máx 3-4 iterações; critério objetivo = teste da Task 2.
- [ ] **Step 3: rodar a régua** — `node --test test/weapon-ads.test.js` → TODOS os índices passando ≤1° / ≤tolerância px nas 3 resoluções, centro desbloqueado, câmera fora do Box3. Se um GLB tiver a janela óptica fisicamente impossível sem clipar (near plane 0.08? conferir `camera.near` no game.js), ajustar `eyeRelief` — NUNCA `camera.near` global; layer de viewmodel só como último recurso comprovado (documentar se precisar).
- [ ] **Step 4: fallback também calibrado** — `node --test test/weapon-ads.test.js` com GLB sabotado: caso novo no teste que roda `G.arsenal[0].modelStatus = 'fallback'`? Não — sabotagem real: novo `bootGame` com `extraEnv` não ajuda; usar page request interception é caro. Alternativa aceita: teste unitário (weapon-rig.test.js) já garante perfil válido independente de GLB + teste browser da Task 2 roda no estado 'ready'. Adicionar caso browser: forçar `gun.modelRoot.visible=false` e verificar que attachments/mecanismos procedurais continuam visíveis e `adsPose` finita (fallback jogável).

### Task 5: Mecanismos por classe + máquina de estados visual + pool de estojos

**Files:**
- Modify: `js/weaponrig.js` (mechanisms nos perfis, `attachComplements`, `update(dt, t, gun)`, pool de estojos)
- Modify: `game.js` (fix cycleT linha 1334; delegar mag/pump/bolt pro rig — remover 1136-1148 e 1183-1192 em favor de `WeaponRig.update`; chamar `WeaponRig.update(dt, t, gun)` junto de `WeaponModels.update(dt)` linha 1200; ejetar estojo no `fire()`)
- Test: `test/weapon-mechanisms.test.js` (novo, porta 3222)

**Interfaces:**
- Produces: perfil `mechanisms`: `{ trigger?: {…}, bolt?: {…}, pump?: {…}, magazine?: {…}, shellPort?: bool, loadedRocket?: {…}, energyCell?: {…} }`, cada um `{ node?: 'glb:<nome>'|'anchor:<parts key>'|'build:<builder>', pos:[…], travel:[dx,dy,dz], rot?:[rx,ry,rz], authority:'procedural'|'clip' }`. Registro runtime por arma: `{ kind, obj, basePos, baseQuat, authority }` com bind pose salvo. Delta SEMPRE a partir do bind (nunca acumula).
- Estados dirigidos pelos sinais EXISTENTES (sem rede): `fire` = `t - gun.lastShot < janela`; `cycle` = `gun.cycleT`; fases de reload = mesmo `k` de game.js (`1 - (reloadEnd - t)/reloadTime`); `empty` = `gun.mag === 0`; troca/cancel = `gun.reloading === false` fora da janela → restaura bind.

- [ ] **Step 1: fix do cycleT (TDD)** — teste unitário headless não alcança `fire()`; teste browser em weapon-mechanisms:

```js
  it('dado tiro de arma automática (fuzil/rajada), então o mecanismo cicla a cada disparo', async () => {
    const r = await h.play(async () => {
      const G = window.QA.G;
      await G.WeaponModels.ready;
      const out = {};
      for (const i of [0, 7]) {
        G.arsenal[i].locked = false; G.switchWeapon(i); window.QA.tick(40);
        G.gun.mag = G.gun.magSize;
        G.mouse.shooting = true; window.QA.tick(3); // 1 tiro
        out[i] = G.gun.cycleT;
        G.mouse.shooting = false; window.QA.tick(60);
      }
      return out;
    });
    assert.ok(r[0] > 0, 'fuzil automático não ciclou ferrolho');
    assert.ok(r[7] > 0, 'escopeta rajada não ciclou bomba');
  });
```

  Rodar → FAIL (`!gun.auto` bloqueia). Fix em game.js:1334:

```js
  // ciclo visual a cada disparo, respeitando a cadência (nunca mais longo que o intervalo)
  const cycleBase = gun.pellets > 1 ? 0.55 : 0.32;
  gun.cycleT = Math.min(cycleBase, (60 / gun.rpm) * 0.92);
```

  (semi-autos mantêm exatamente os valores antigos: DMR 150rpm → 0.368>0.32 ✓; escopeta lenta 78rpm → 0.708>0.55 ✓; muda SÓ autos, que era o bug. Curso do pump/bolt no rig usa a duração real `gun.cycleT0 = valor setado` — guardar `gun.cycleDur = gun.cycleT` no fire pra fase correta.)
- [ ] **Step 2: complementos procedurais por arma** (usar spatial.json pra posição; estilo/materiais casando com cada GLB):
  - idx0 M4: alavanca de ferrolho (box pequena, `travel` +Z 0.05), pente (box na posição real do poço — o do GLB é soldado: complemento REPLICA silhueta e o poço fica atrás dele), estojo em `ejection`.
  - idx1: bomba (sleeve cilíndrico envolvendo o guarda-mão do GLB, travel +Z 0.085), porta lateral + cartucho visível na recarga.
  - idx2 DMR: `magazine` usa nó REAL `Magazine_2` (`node: 'glb:Magazine_2'`), bolt complemento, ejection.
  - idx3 bazuca: `loadedRocket` (cone+cilindro na boca, some no tiro), gatilho; Task 8 refina.
  - idx4 plasma: `energyCell` (célula emissiva removível), emissor pulsa no tiro (`emissiveIntensity` por bind delta), SEM estojo.
  - idx5 faca: nada (golpe já existe via cycleT/kick; garantir retorno a bind).
  - idx6 sniper: `authority:'clip'` pra mag/bolt (Task 6) + gatilho procedural.
  - idx7: bomba + porta (mapear nó do guarda-mão pelo spatial.json — posição, não regex).
  - Todos: `trigger` (box 1-2cm, rot -X ao disparar) quando o GLB não tem nó separado (só idx6 tem `trigger_2` — usar o real: `node:'glb:trigger_2'`, authority procedural, clip não o anima).
- [ ] **Step 3: `WeaponRig.update(dt, t, gun)`** — aplica: trigger (janela 90ms pós `lastShot`); pump/bolt via `gun.cycleT/gun.cycleDur` (curva `Math.sin((1-cycleT/dur)*Math.PI)`, igual à atual); mag/célula via fases k da recarga (MESMOS smoothsteps de game.js:1127-1131 — mover as constantes pro rig); `loadedRocket.visible = gun.mag > 0 && !(t - gun.lastShot < 0.4)`; pulso do emissor plasma; restauração: primeiro passo de cada frame reseta todos os nós registrados pro bind (padrão fpbody.js:237) e reaplica deltas — troca/cancel restaura de graça. Ejeção de estojo: game.js `fire()` chama `WeaponRig.ejectShell(gun)` se perfil tem `shellPort` (pool de 16 meshes compartilhadas, TTL 1.2s, gravidade simples SEM corpo cannon, reciclagem zera velocidade/rotação).
- [ ] **Step 4: delegação em game.js** — remover blocos 1136-1148 (mag) e 1183-1192 (pump/bolt) e o `slap`/`boltK` visual de weaponKick? NÃO: `slap`(kick) fica; mover só a animação de PEÇAS. `WeaponRig.update(dt, t, gun)` chamado na linha ~1200. A mão esquerda (1150-1169) segue `gun.parts.mag` — rig continua movendo a âncora `parts.mag` (procedural) OU o complemento é FILHO de `parts.mag` (mais simples: complementos de pente são filhos da âncora existente; rig anima âncora — handL continua funcionando sem mudança).
- [ ] **Step 5: testes de mecanismo** — `test/weapon-mechanisms.test.js` (porta 3222): para cada arma com mecanismo, capturar `obj.position/quaternion/visible` antes (bind), durante (meio do ciclo/reload) e depois → `durante ≠ antes` e `depois == antes` (tolerância 1e-4); pump das DUAS escopetas percorre ≥0.05 local; estojo só em balísticas (0,1,2,6,7 — plasma/faca/bazuca sem estojo) e pool nunca passa de 16 vivos; troca de arma no MEIO da recarga → tudo volta a bind e `gun.reloading === false`; recarga não duplica munição (`mag+reserve` constante, uma atualização no instante `finishReload`).
- [ ] **Step 6: rodar** `node --test test/weapon-mechanisms.test.js` → PASS; `npm run lint`.

### Task 6: Sniper Agulha — autoridade única do clip (sem reparent)

**Files:**
- Modify: `js/weaponmodels.js` (remover `bind` do DEF idx6; marcar authority)
- Modify: `test/asset-models.test.js:82-95` (substituir teste de nome por prova de movimento)

- [ ] **Step 1: teste novo (falha no código antigo)** — substituir o caso `dado um tiro com a sniper nova…`:

```js
  it('dada a sniper Agulha, então mag_4/bolt_6 ficam sob a raiz do mixer e o clip MOVE e devolve', async () => {
    const r = await h.play(async () => {
      const G = window.QA.G, THREE = window.QA.MP.THREE;
      await G.WeaponModels.ready;
      G.arsenal[6].locked = false; G.switchWeapon(6); window.QA.tick(40);
      const gun = G.gun;
      const root = gun.modelRoot;
      const mag = (() => { let n = null; root.traverse(o => { if (!n && /^mag_4/.test(o.name)) n = o; }); return n; })();
      const bolt = (() => { let n = null; root.traverse(o => { if (!n && /^bolt_6/.test(o.name)) n = o; }); return n; })();
      const under = (n) => { let p = n; while (p) { if (p === root) return true; p = p.parent; } return false; };
      const bind = { mag: mag.position.toArray(), bolt: bolt.position.toArray() };
      // dispara reload e amostra no meio
      gun.mag = 1; gun.reserve = 10;
      G.WeaponModels; // mixers atualizam no tick via applyFpsCamera
      window.QA.MP.justPressed.add('KeyR'); window.QA.tick(Math.round(gun.reloadTime * 60 * 0.5));
      const mid = { mag: mag.position.toArray(), bolt: bolt.position.toArray() };
      window.QA.tick(Math.round(gun.reloadTime * 60 * 0.7) + 30);
      const end = { mag: mag.position.toArray() };
      const moved = (a, b) => Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]) > 1e-4;
      return { underMag: under(mag), underBolt: under(bolt),
        magMoved: moved(bind.mag, mid.mag), magBack: !moved(bind.mag, end.mag),
        authority: gun.parts.mag && gun.parts.mag.userData.authority };
    });
    assert.ok(r.underMag && r.underBolt, 'nós saíram da raiz do mixer');
    assert.ok(r.magMoved, 'clip reload não moveu o mag_4');
    assert.ok(r.magBack, 'mag_4 não voltou ao bind pose no fim');
    assert.equal(r.authority, 'clip', 'âncora procedural deveria estar cedida ao clip');
  });
```

  Rodar → FAIL (hoje `anchor.attach` tira da raiz e clip não move de fato).
- [ ] **Step 2: implementar** — js/weaponmodels.js: no DEF idx6, trocar `bind: {…}` por `clipOwned: ['mag_4', 'bolt_6']`; em `attach()`, remover o bloco `def.bind` e no lugar: `if (def.clipOwned) { for (const k of ['mag','bolt']) if (gun.parts[k]) gun.parts[k].userData.authority = 'clip'; }`. Rig (Task 5) e game.js já pulam âncoras com `userData.authority === 'clip'` (garantir: no rig, filtro no registro; conferir que nenhuma animação procedural escreve em `mag_4/bolt_6`). Mixer continua `new THREE.AnimationMixer(root)` com nós intactos. Recarga da mão esquerda (game.js:1155) usa `gun.parts.mag` (âncora procedural invisível) — segue ok como coreografia de mão.
- [ ] **Step 3: rodar** `node --test test/asset-models.test.js` → PASS. Conferir também `bolt_slide` dispara por tiro (cycleT>prevCycle já cobre — Task 5 setou cycleT pra todos).

### Task 7: Mãos/IK nos anchors do perfil

**Files:**
- Modify: `js/weaponrig.js` (`attachComplements` reposiciona `gun.parts.handR/handL` pros anchors `gripR/supportHand` calibrados)
- Modify: `js/fpbody.js` (NADA estrutural — só conferir; `TUNE.fingersR/L` continuam)
- Test: caso novo em `test/weapon-mechanisms.test.js`

- [ ] **Step 1: teste** — ADS/hip/fire/reload: distância mão→âncora < 0.12m para as duas mãos em todas as armas (fpbody clampa a 99% do alcance; medir `B.haR.getWorldPosition` vs `gun.parts.handR.getWorldPosition`); na bazuca, mãos fora do Box3 do tubo+scope inflado 1cm? Simplificar: mãos a ≥3cm do eixo central do tubo. Rodar → provável FAIL em armas cujo grip do GLB não bate com a âncora procedural antiga.
- [ ] **Step 2: implementar** — `attachComplements` seta `gun.parts.handR.position.fromArray(profile.anchors.gripR)` e `handL.position.fromArray(profile.anchors.supportHand)` + atualizar `handL.userData.base.p` (usado pela coreografia 1150-1169). Durante ações, mão esquerda segue mecanismo correspondente (pump: já é filho da âncora pump — manter convenção de js/weapons.js `addHands(lParent=parts.pump)`; para GLBs, âncora `supportHand` vira filha do grupo do mecanismo quando `kind === 'pump'`).
- [ ] **Step 3: rodar** os casos novos + capturar `node scripts/capture-weapons.js` e olhar mãos (dedos no grip, sem atravessar óptica).

### Task 8: Bazuca — scope lateral real, foguete carregado, convergência

**Files:**
- Modify: `js/weaponrig.js` (perfil idx3 final: sight no scope do GLB via material, `loadedRocket`)
- Modify: `js/weaponmodels.js` (localizar meshes por material `Scope|Glass` no attach da bazuca e gravar em `gun.userData.scopeMeshes` — ou expor pro rig via onModelReady)
- Modify: `game.js:1337-1348` (aimPoint central → direção da boca ao ponto; manter heli)
- Test: `test/weapon-aim.test.js` (novo, porta 3224)

- [ ] **Step 1: teste de convergência (falha antes)** — `test/weapon-aim.test.js`:

```js
  it('dada a bazuca mirando um ponto no centro, então o foguete converge pro ponto (curta/média/longa)', async () => {
    const r = await h.play(async () => {
      const G = window.QA.G, THREE = window.QA.MP.THREE;
      await G.WeaponModels.ready;
      G.arsenal[3].locked = false; G.switchWeapon(3); window.QA.tick(40);
      const out = [];
      for (const dist of [8, 40, 120]) {
        // aponta a câmera pro horizonte plano e registra o ponto central a `dist`
        window.QA.reset && window.QA.reset();
        G.player.pos.set(0, G.heightAt(0, 0) + 40, 0); // no ar: linha limpa
        G.camera.rotation.set(0, 0, 0);
        window.QA.tick(1);
        const origin = G.camera.getWorldPosition(new THREE.Vector3());
        const dir = G.camera.getWorldDirection(new THREE.Vector3());
        const aim = origin.clone().addScaledVector(dir, dist);
        G.gun.mag = 1; G.gun.reloading = false;
        G.mouse.clicked = true; window.QA.tick(1);
        // acha o foguete vivo e integra até passar do plano do alvo
        const rocket = (() => { /* Rockets não expõe pool: medir por proximidade do aim */ return null; })();
        // caminho robusto: amostrar posição do foguete via cena (mesh cone laranja visível)
        let best = Infinity;
        for (let k = 0; k < 600; k++) {
          window.QA.tick(1);
          let live = null;
          G.camera.parent.traverse(o => { if (o.userData && o.userData.__rocket && o.visible) live = o; });
          if (!live) break;
          best = Math.min(best, live.position.distanceTo(aim));
        }
        out.push({ dist, best });
      }
      return out;
    });
    for (const x of r) assert.ok(x.best < 1.2, `foguete não convergiu a ${x.dist}m: min ${x.best.toFixed(2)}m`);
  });
```

  Pré-requisito do teste: marcar o mesh do foguete com `userData.__rocket = true` em js/rockets.js (1 linha no pool; leitura de QA, sem gameplay). Casos extras: parede imediatamente à frente (posicionar player encostado em estrutura da cidade; foguete detona na parede, `best` medido contra a PAREDE, não atravessa — validar `detonate` a < 2m do muzzle); tiro pra cima/baixo; dt de 1/30, 1/60, 1/120 (`QA.tick(n, dt)`) → mesma convergência (substep fixo já garante); UMA explosão (contar chamadas: `G.Grenades.explode` wrap local no play).
- [ ] **Step 2: rodar e ver falhar** (hoje dir = câmera pura, origem = muzzle → paralaxe: a 8m erro ~0.3-0.5m pode até passar… medir; o caso forte é o teste de ADS da Task 2 pro scope lateral + este garante convergência exata). Se o antigo passar em 40/120m, apertar tolerância pra 0.6m em 8m.
- [ ] **Step 3: implementar aimPoint** — game.js bloco rocket (1337-1348):

```js
  if (gun.rocket) {
    SFX.rocket();
    addTrauma(0.5);
    recoil.pitchVel += 2.3;
    recoil.kickZ += 0.28;
    recoil.kickRot += 0.2;
    camera.getWorldPosition(_rayOrig);
    camera.getWorldDirection(_rayDir);
    muzzle.getWorldPosition(_v3);
    if (state.flying) { _v3.copy(Heli.group.position); _v3.y += 1.6; _rayOrig.copy(_v3); }
    // ponto mirado na LINHA CENTRAL: primeiro obstáculo ou zero de 120 m;
    // o foguete nasce na boca real e converge pra esse ponto (sem teleporte)
    const zeroD = Math.max(4, Math.min(rayBlockedAt(_rayOrig, _rayDir, 240), 120));
    _v1.copy(_rayOrig).addScaledVector(_rayDir, zeroD);
    _rayDir.copy(_v1).sub(_v3).normalize();
    Rockets.fire(_v3, _rayDir);
    WeaponRig.notifyRocketFired && WeaponRig.notifyRocketFired(gun);
    return;
  }
```

- [ ] **Step 4: scope lateral** — no attach da bazuca (weaponmodels), traverse coletando meshes cujo `material.name` case `/scope|glass|shade/i`; calcular Box3 conjunto no espaço do gun.group; passar pro rig (`onModelReady`), que ajusta `sights[0].eye/front` pro eixo do scope real (centro do vidro traseiro → frente) e posiciona retículo `launcher` na janela. Se material não bater (renomeado), fallback: manter números do perfil (spatial.json). Validar com `getAlignmentMetrics(3)` ≤1° e captura visual (tubo deslocado do centro, scope no eixo).
- [ ] **Step 5: foguete carregado** — mecanismo `loadedRocket` (Task 5) validado aqui: visível com `mag>0`, some no tiro instantaneamente, reaparece SÓ no `finishReload` (janela: `visible = gun.mag > 0 && !gun.reloading`); troca de arma durante recarga não duplica (bind restore). Caso de teste em weapon-mechanisms.
- [ ] **Step 6: rodar** `node --test test/weapon-aim.test.js test/weapon-mechanisms.test.js --test-concurrency=1`; conferir `test/rockets.test.js`, `test/explosives.test.js`, `test/br-explosion-protocol.test.js` intactos.

### Task 9: Faca — guarda sem ADS de firearm

**Files:**
- Modify: `js/weaponrig.js` (perfil idx5), `game.js` (FOV da faca)
- Test: caso em `test/weapon-ads.test.js` (já escrito na Task 2: crosshair da faca não some)

- [ ] **Step 1:** perfil melee: `adsPose == pose de guarda` (usar `gun.adsV` atual [0.16,-0.19,-0.4] como `guardPos` no perfil, quat leve `rz 0.1`); `sightRefK = 0` sempre; FOV: em game.js linha 1214, se `WeaponRig.inspect` da arma é melee → `fovTarget` ignora `gun.adsFov` (usa 75 base). Documentar: `adsFov: 66` da faca vira inerte (apresentação, não balanceamento — spread da faca é 0 e dano é melee via `__BR_melee`).
- [ ] **Step 2:** rodar caso da faca em weapon-ads + captura visual do golpe/guarda.

### Task 10: Silhuetas remotas leves por classe

**Files:**
- Modify: `br-game.js` (~90-116 builder do body; 1309/1316/1646 troca por classe)
- Test: caso em teste MP existente que já sobe 2 clientes (conferir `test/latency.test.js`/`test/br-*.test.js` pelo padrão de 2 sockets+browser; se nenhum couber, caso novo em `test/weapon-aim.test.js` com segundo socket headless via `socket.io-client` como nos testes de servidor)

- [ ] **Step 1:** módulo-local em br-game.js: `buildWeaponSilhouette(code)` com geometrias/materiais COMPARTILHADOS (criados 1×, clonar meshes): FUZIL (box+cano), ESCOPETA (cano grosso+bomba), DMR/SNIPER (cano longo+luneta), BAZUCA (tubo no ombro), PLASMA (corpo+emissor teal), FACA → oculta (regra atual). Muzzle da silhueta por classe (ponta do cano). Cache `Map(code -> template)`; por player, trocar filho quando `rp.heldWeapon` muda (1309/1646). `playerFired`/tracer usa muzzle da silhueta.
- [ ] **Step 2: teste** — dois clientes: A segura DMR → B enxerga silhueta classe 'DMR' (marcar `group.userData.weaponClass = code`) e muzzle ≠ posição da caixa antiga; `heldWeapon` inválido/malicioso (string estranha) → cai no default sem exceção (sanitização atual `weaponCode` preservada). Sem eventos novos (asserção: nenhum `socket.emit` novo — revisar diff).
- [ ] **Step 3:** rodar o teste MP + `test/security-regression.test.js`.

### Task 11: Performance/vazamento + validação visual final + suíte completa

**Files:**
- Test: caso perf em `test/weapon-mechanisms.test.js` (ou `test/weapon-perf.test.js` porta 3226 se ficar grande)
- Output: `output/weapons-final/*.png` + grade comparativa

- [ ] **Step 1: teste de vazamento** — browser: registrar `renderer.info.memory.{geometries,textures}` + contagem de programas + pool ativo; loop simulado: 8 armas × (equipar → ADS → 5 tiros → reload → troca) × 20 rodadas com `QA.tick` (≥2 min de tempo SIMULADO); asserts: geometries/textures estáveis (Δ ≤ 2 após warmup), pool de estojos ≤ limite, sem `pageerror`. Frame-time real: medir média de `tick` wall-clock antes/depois das mudanças na mesma cena (registrar no relatório; regressão relevante = >10% → otimizar).
- [ ] **Step 2: capturas finais** — `node scripts/capture-weapons.js 3213 output/weapons-final`; montar grade lado a lado com baseline (script cola com canvas? suficiente: pastas separadas + inspeção manual). Checklist visual do prompt (centro livre, mãos, lens, retículo, mecanismos, ultrawide 2560×1080 numa passada extra com `setViewport`).
- [ ] **Step 3: régua final** — em sequência:

```bash
npm run lint
node --test test/weapon-rig.test.js test/weapon-ads.test.js test/weapon-mechanisms.test.js test/weapon-aim.test.js test/asset-models.test.js test/gameplay.test.js test/rockets.test.js test/security-regression.test.js --test-concurrency=1
npm test
```

  Triagem de falha: re-rodar arquivo isolado 2-3× (flake vs regressão, regra do CLAUDE.md). `npm run quality` se disponível. Reportar pass/fail/skip EXATOS.
- [ ] **Step 4: relatório final** — responder com os 11 itens do prompt (resumo, causas-raiz, arquivos, tabela por arma, matemática ADS, solução do conflito da sniper, garantias de segurança, testes executados com números, screenshots, medições, pendências).

---

## Self-review (feito na escrita)

- Cobertura vs prompt: ADS/eixo óptico (T1-T4), T/miras (T3), retículo/crosshair (T2/T3), mecanismos+cycleT+estojos (T5), sniper clips (T6), mãos/IK (T7), bazuca completa (T8), faca (T9), remotos (T10), perf+validação visual+suíte (T11), API QA (T1), segurança intocada (constraints + T10/T11). Testes A (T1), B (T2/T4), C (T5/T7), D (T8), E (T10/T11), F (T11).
- Riscos conhecidos: (a) harness `play` pode não aceitar args — adaptar com `setViewport` fora do evaluate; (b) números iniciais de perfil são sementes — a régua é o teste, não o número; (c) mover rotação pra quaternion pode alterar micro-feel do sway — fórmulas mantidas idênticas, só a composição muda; validar com captura; (d) GLTFLoader em Node (T0) pode precisar de stubs — alternativa: rodar a inspeção DENTRO do browser via harness e salvar JSON (fallback documentado).
- Sem placeholder de comportamento: onde há número a calibrar, há procedimento + critério objetivo (teste) definidos.

---

## Execution log (2026-07-17)

**Baseline registrado:** suíte completa em HEAD `7752f14`: 374 testes, 373 pass, 1 fail
pré-existente (`gameplay.test.js:572` — grama dentro da cidade, 4355 lâminas; já
falhava no HEAD, confirmado isolado; consta na memória do projeto). Screenshots
baseline: `output/weapons-baseline/` (32 imagens, código antigo).

**Desvios do plano (com motivo):**
1. Inspeção espacial dos GLBs roda NO BROWSER (`scripts/inspect-glb-spatial.js`,
   harness real) — GLTFLoader em Node exigiria stubs de decode de textura.
   Saída: `output/weapon-spatial.json`.
2. `Magazine_2` do DMR lenta é na VERDADE a mira frontal (bbox y 0..0.068 em cima
   do receiver) — bind revertido; pente visível virou complemento na âncora.
3. Critério "câmera fora do Box3" substituído por "nada clipa o near plane"
   (raios pelos 4 cantos, <0.085m): o AABB do grupo/malhas fundidas SEMPRE
   contém o olho (coronha na bochecha, tubo no ombro) e dava flake por margem.
4. Convergência do foguete testada com erro PERPENDICULAR à linha de mira +
   queda balística esperada (g=2.5, v=34) — o teste original media contra o
   PONTO e capturava o passo de amostragem/gravidade como "erro".
5. Mãos: osso do punho tem offset natural de ~0.65m p/ âncora (origem no punho +
   clamp de alcance do IK — PRÉ-EXISTENTE, medido idêntico no baseline via
   stash). Critério virou tracking (offset estável hip↔ADS, teto 0.8m).
6. heldWeapon malicioso: o SERVIDOR já sanitiza e mantém a última arma válida —
   o lixo nem chega ao cliente (mais forte que o fallback FACA esperado).
7. cycleT: fix aplicado a TODAS as armas com teto na cadência
   (`min(base, 60/rpm*0.92)`); semi-autos mantêm valores antigos exatos.
8. Trovão: GLB tem lâmina de alça alta (topo y 0.221 em z≈0.09) — mira passa por
   CIMA dela (linha 0.226), estilo post soviético; scan de raycast confirmou que
   não há canal livre mais baixo em x=0.
9. Luneta 2x do fuzil: retículo 3D dentro do tubo (`reticle:'cross'`), sem
   overlay full-screen — overlay ficou só p/ DMR/snipers (zoom real).

**Status por task:** 0 ✔ · 1 ✔ · 2 ✔ · 3 ✔ · 4 ✔ (visual final pendente) ·
5 ✔ · 6 ✔ · 7 ✔ · 8 ✔ · 9 ✔ · 10 ✔ · 11 em curso (captures + suíte completa).

**Fechamento (Task 11):** suíte completa pós-mudança: 403 testes — 400 pass,
3 fail; isolados: br-death-cause (timeout) e gameplay-regen passaram 4/4 e 30/31
→ FLAKE de carga (regra do CLAUDE.md); única falha real remanescente = grama na
cidade (pré-existente do baseline). Frame-time (tick manual, swiftshader):
baseline 1.20 ms/tick vs 1.26–1.30 ms/tick (+5–8%, dentro do gate <10%).
Capturas finais: output/weapons-after/ (32 + w3-ads-v2 vidro translúcido +
w0-ads-reddot via T). Vidro do scope da bazuca ficou translúcido (opacity .25)
— sem isso o ADS era um círculo preto.
