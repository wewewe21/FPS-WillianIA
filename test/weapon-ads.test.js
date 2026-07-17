/* ================================================================
   QA — ADS por eixo óptico real (js/weaponrig.js + game.js).
   Prova no Chrome que, mirando, cada arma de fogo alinha a mira com
   o centro da tela: erro angular ≤1°, projeção da mira dentro da
   tolerância em pixels, centro NÃO bloqueado pelo corpo da arma,
   câmera fora do modelo, FOV/crosshair/overlay no momento certo.
   ================================================================ */
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { CHROME, bootGame } = require('./helpers/harness.js');

const FIREARMS = [0, 1, 2, 3, 4, 6, 7];

describe('ADS por eixo óptico (Chrome headless)', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h;
  before(async () => {
    h = await bootGame({ port: 3220 });
    await h.play(async () => {
      const G = window.QA.G;
      await G.WeaponModels.ready;
      // corpo FP resolvido também: visibilidade das mãos não pode variar entre runs
      for (let i = 0; i < 200 && !(G.FpBody.ready || G.FpBody.failed); i++)
        await new Promise(rs => setTimeout(rs, 100));
    });
  });
  after(async () => { if (h) await h.close(); });

  /* equipa a arma e leva o ADS até o repouso; devolve métricas do rig */
  async function adsMetrics(width, height) {
    await h.page.setViewport({ width, height, deviceScaleFactor: 1 });
    return h.play((idxs) => {
      const G = window.QA.G;
      window.QA.reset();
      const out = [];
      for (const i of idxs) {
        G.arsenal[i].locked = false;
        G.switchWeapon(i);
        window.QA.tick(40);
        G.mouse.aiming = true;
        window.QA.tick(240); // adsT → ~1 (damp 13/s)
        const m = G.WeaponRig.getAlignmentMetrics(i);
        out.push({ i, sight: m.sight, angle: m.angleErrDeg, ndcFront: m.ndcFront });
        G.mouse.aiming = false;
        window.QA.tick(120);
      }
      return out;
    }, FIREARMS);
  }

  it('dado ADS completo, então eixo óptico ≤1° e mira projetada no centro (3 resoluções)', async () => {
    for (const [w, hh] of [[1280, 720], [1920, 1080], [2560, 1080]]) {
      const r = await adsMetrics(w, hh);
      for (const x of r) {
        const px = Math.hypot(x.ndcFront[0] * w / 2, x.ndcFront[1] * hh / 2);
        const tolPx = Math.max(4, Math.min(w, hh) * 0.005);
        assert.ok(x.angle <= 1,
          `arma ${x.i} (${x.sight}): erro angular ${x.angle.toFixed(2)}° > 1° em ${w}x${hh}`);
        assert.ok(px <= tolPx,
          `arma ${x.i} (${x.sight}): mira a ${px.toFixed(1)}px do centro (tol ${tolPx.toFixed(1)}) em ${w}x${hh}`);
      }
    }
  });

  it('dado ADS, então o corpo da arma não bloqueia o centro e a câmera fica fora do modelo', async () => {
    await h.page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    const r = await h.play((idxs) => {
      const G = window.QA.G, THREE = window.QA.MP.THREE;
      window.QA.reset();
      const ray = new THREE.Raycaster();
      const out = [];
      for (const i of idxs) {
        G.arsenal[i].locked = false;
        G.switchWeapon(i);
        window.QA.tick(40);
        G.mouse.aiming = true;
        window.QA.tick(240);
        G.camera.updateMatrixWorld(true);
        ray.setFromCamera(new THREE.Vector2(0, 0), G.camera);
        ray.far = 1.6;
        const effVisible = o => { // visível DE FATO (nenhum ancestral escondido)
          for (let p = o; p; p = p.parent) if (!p.visible) return false;
          return true;
        };
        const solid = [];
        if (window.QA.MP.weaponRoot.visible) G.gun.group.traverse(o => {
          // lentes/retículos/flash são exceção EXPLÍCITA — o resto da arma
          // não pode cruzar a linha central da mira
          if (o.isMesh && !o.userData.sightGlass && !o.userData.weaponFx && effVisible(o)) solid.push(o);
        });
        const hits = ray.intersectObjects(solid, false).filter(x => x.distance > 0.02);
        // "câmera dentro da arma" de verdade = geometria clipando o near plane:
        // raios pelos 4 cantos do near plane não podem achar superfície sólida
        // antes de ~near (0.08). O Box3 do grupo inteiro SEMPRE contém o olho
        // (coronha na bochecha / tubo no ombro), então não serve de critério.
        let clip = null;
        const corner = new THREE.Vector2();
        for (const [cx, cy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          ray.setFromCamera(corner.set(cx, cy), G.camera);
          ray.far = 0.1;
          const ch = ray.intersectObjects(solid, false).filter(x => x.distance < 0.085);
          if (ch.length) { clip = (ch[0].object.name || 'mesh-sem-nome') + '@' + ch[0].distance.toFixed(3); break; }
        }
        out.push({
          i, blocked: hits.length ? (hits[0].object.name || 'mesh-sem-nome') : null,
          clip,
          diag: { // estado da pose no momento da amostra (depuração de flake)
            wr: window.QA.MP.weaponRoot.position.toArray().map(v => +v.toFixed(3)),
            quat: window.QA.MP.weaponRoot.quaternion.toArray().map(v => +v.toFixed(3)),
            model: G.gun.modelStatus || 'procedural',
          },
        });
        G.mouse.aiming = false;
        window.QA.tick(120);
      }
      return out;
    }, FIREARMS);
    for (const x of r) {
      const diag = JSON.stringify(x.diag);
      assert.equal(x.blocked, null, `arma ${x.i}: corpo da arma bloqueia o centro (${x.blocked}) ${diag}`);
      assert.equal(x.clip, null, `arma ${x.i}: arma clipando o near plane (${x.clip}) ${diag}`);
    }
  });

  it('dado o FOV, então chega no valor da mira ativa e volta ao base ao soltar', async () => {
    const r = await h.play(() => {
      const G = window.QA.G;
      window.QA.reset();
      G.switchWeapon(0);
      window.QA.tick(40);
      G.mouse.aiming = true;
      window.QA.tick(300);
      const fovAds = G.camera.fov;
      G.mouse.aiming = false;
      window.QA.tick(300);
      return { fovAds, fovBase: G.camera.fov, want: G.gun.adsFov };
    });
    assert.ok(Math.abs(r.fovAds - r.want) < 1.5, `FOV no ADS ${r.fovAds} ≠ ${r.want}`);
    assert.ok(Math.abs(r.fovBase - 75) < 1.5, `FOV base não voltou: ${r.fovBase}`);
  });

  it('dado o crosshair, então só some com referência ADS válida — e nunca some na faca', async () => {
    const r = await h.play(() => {
      const G = window.QA.G;
      window.QA.reset();
      G.switchWeapon(0);
      window.QA.tick(40);
      const cross = () => document.getElementById('crosshair').style.opacity;
      G.mouse.aiming = true;
      window.QA.tick(6); // começo da transição: mira ainda não alinhou
      const early = cross();
      window.QA.tick(300);
      const full = cross();
      G.mouse.aiming = false;
      window.QA.tick(200);
      const hip = cross();
      G.arsenal[5].locked = false;
      G.switchWeapon(5);
      window.QA.tick(40);
      G.mouse.aiming = true;
      window.QA.tick(300);
      const knife = cross();
      G.mouse.aiming = false;
      window.QA.tick(120);
      return { early, full, hip, knife };
    });
    assert.notEqual(r.early, '0', 'crosshair sumiu antes de a mira alinhar');
    assert.equal(r.full, '0', 'crosshair deveria sumir no ADS completo');
    assert.notEqual(r.hip, '0', 'crosshair não voltou no hip');
    assert.notEqual(r.knife, '0', 'faca não pode perder o crosshair no botão direito');
  });

  it('dado o overlay de luneta, então aparece só em mira tipo overlay e perto do fim da transição', async () => {
    const r = await h.play(() => {
      const G = window.QA.G;
      window.QA.reset();
      const scopeOp = () => parseFloat(document.getElementById('scope').style.opacity || '0');
      const out = {};
      for (const i of [2, 0]) { // DMR (overlay) vs fuzil alça de ferro (sem overlay)
        G.arsenal[i].locked = false;
        G.switchWeapon(i);
        window.QA.tick(40);
        G.mouse.aiming = true;
        window.QA.tick(4); // adsT ≈ 0.58: transição no meio, overlay ainda não
        const early = scopeOp();
        window.QA.tick(300);
        out[i] = { early, full: scopeOp() };
        G.mouse.aiming = false;
        window.QA.tick(150);
      }
      return out;
    });
    assert.ok(r[2].early < 0.2, 'overlay do DMR apareceu cedo demais: ' + r[2].early);
    assert.ok(r[2].full > 0.9, 'overlay do DMR não completou: ' + r[2].full);
    assert.ok(r[0].full < 0.05, 'fuzil de alça de ferro não pode ter overlay: ' + r[0].full);
  });

  it('dado T no fuzil, então a mira VISÍVEL troca junto com FOV/pose e persiste na troca de arma', async () => {
    const r = await h.play(() => {
      const G = window.QA.G;
      window.QA.reset();
      G.switchWeapon(0);
      window.QA.tick(40);
      const effVisible = o => {
        for (let p = o; p; p = p.parent) if (!p.visible) return false;
        return true;
      };
      const visibleSightMeshes = () => {
        let n = 0;
        G.gun.group.traverse(o => {
          if (o.isMesh && effVisible(o)) {
            for (let p = o; p; p = p.parent) if (p.userData.sightAttachment) { n++; break; }
          }
        });
        return n;
      };
      const snap = () => ({
        id: G.WeaponRig.activeSight(G.gun).id,
        fov: G.gun.adsFov,
        meshes: visibleSightMeshes(),
        pose: G.WeaponRig.adsPose(G.gun).pos.toArray().map(v => +v.toFixed(3)),
      });
      const s0 = snap();                                     // alça de ferro
      window.QA.MP.justPressed.add('KeyT'); window.QA.tick(1);
      const s1 = snap();                                     // red dot (geometria nova)
      G.switchWeapon(1); window.QA.tick(10);
      const emT = (() => { // arma de mira única: T não pode trocar nada
        window.QA.MP.justPressed.add('KeyT'); window.QA.tick(1);
        return G.WeaponRig.activeSight(G.gun).id;
      })();
      G.switchWeapon(0); window.QA.tick(10);
      const s2 = snap();                                     // escolha persistiu
      return { s0, s1, s2, emT };
    });
    assert.notEqual(r.s0.id, r.s1.id, 'T não trocou a mira');
    assert.notEqual(r.s0.fov, r.s1.fov, 'FOV não acompanhou a mira');
    assert.notDeepEqual(r.s0.pose, r.s1.pose, 'pose ADS não acompanhou a mira');
    assert.ok(r.s1.meshes > 0, 'mira trocada não tem NENHUMA mesh visível');
    assert.equal(r.s0.meshes, 0, 'alça de ferro não deveria ter acessório visível no trilho');
    assert.equal(r.s2.id, r.s1.id, 'escolha de mira não persistiu na troca de arma');
    assert.equal(r.emT, 'bead', 'escopeta de mira única não pode ciclar');
  });

  it('dado GLB em fallback, então o perfil fb dá pose ADS válida e o jogo segue jogável', async () => {
    const r = await h.play(() => {
      const G = window.QA.G;
      window.QA.reset();
      G.switchWeapon(0);
      window.QA.tick(30);
      const gun = G.gun;
      // volta pra alça de ferro (a mira do CORPO da arma — é ela que muda de
      // coordenadas no fallback; acessórios carregam a própria referência)
      for (let k = 0; k < 4 && G.WeaponRig.activeSight(gun).id !== 'iron'; k++)
        G.WeaponRig.cycleSight(gun);
      G.WeaponRig.applySightVisibility(gun);
      const statusReal = gun.modelStatus;
      const poseGlb = G.WeaponRig.adsPose(gun).pos.toArray();
      // simula a falha de rede do GLB: fallback procedural assume
      gun.modelStatus = 'fallback';
      if (gun.modelRoot) gun.modelRoot.visible = false;
      G.WeaponRig.invalidatePose(gun);
      G.mouse.aiming = true;
      window.QA.tick(240);
      const m = G.WeaponRig.getAlignmentMetrics(0);
      const pose = G.WeaponRig.adsPose(gun);
      const fine = [...pose.pos.toArray(), ...pose.quat.toArray()].every(Number.isFinite);
      G.mouse.aiming = false;
      // restaura o estado real
      gun.modelStatus = statusReal;
      if (gun.modelRoot) gun.modelRoot.visible = true;
      G.WeaponRig.invalidatePose(gun);
      window.QA.tick(60);
      return { angle: m.angleErrDeg, fine, poseFb: pose.pos.toArray(), poseGlb };
    });
    assert.ok(r.fine, 'pose de fallback com NaN');
    assert.ok(r.angle <= 1, `fallback desalinhado: ${r.angle.toFixed(2)}°`);
    assert.notDeepEqual(r.poseFb, r.poseGlb, 'fallback deveria usar as coordenadas fb do perfil');
  });

  it('rede de segurança: nenhum pageerror durante os cenários de ADS', () => {
    assert.deepEqual(h.pageErrors, [], 'erros de página: ' + h.pageErrors.join(' | '));
  });
});
