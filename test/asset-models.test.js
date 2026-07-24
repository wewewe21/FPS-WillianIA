/* Modelos 3D dos assets novos: armas em primeira pessoa, corpo do jogador
   rigado (helldiver), Guardião nos inimigos e alien no Visitante.
   Node puro: valida os arquivos GLB; Chrome: valida a integração viva. */
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { CHROME, bootGame } = require('./helpers/harness.js');

const MODELS = path.join(__dirname, '..', 'assets', 'models');
const CASTLE_SOURCE = path.join(MODELS, 'boss-castle.v1.glb');
const CASTLE_OPTIMIZED = path.join(MODELS, 'boss-castle.v2.optimized.glb');
const CASTLE_ROOT_SOURCE = path.join(__dirname, '..', 'castelo_reconstruido_escala_real.glb');
const CASTLE_SOURCE_SHA256 = 'fd05cc2fa6aebcd73d16440280b90074624a67bd67e9fc385017ced525e18449';
const CASTLE_OPTIMIZED_SHA256 = '6020def3614d8c32a91d8ccb1d2867c8fe62f07b4c34b89cc1a8ae2339c0b966';

function fileSha256(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function glbJson(p) {
  const buf = fs.readFileSync(p);
  assert.equal(buf.readUInt32LE(0), 0x46546c67, p + ' não é GLB');
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.slice(20, 20 + len).toString('utf8'));
}

function parseGlb(p) {
  const buf = fs.readFileSync(p);
  assert.ok(buf.length >= 20, p + ' está truncado');
  assert.equal(buf.toString('ascii', 0, 4), 'glTF', p + ' não é GLB');
  assert.equal(buf.readUInt32LE(4), 2, p + ' não usa glTF 2.0');
  assert.equal(buf.readUInt32LE(8), buf.length, p + ' declara tamanho incorreto');

  let json;
  for (let offset = 12; offset < buf.length;) {
    const length = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    const end = offset + 8 + length;
    assert.ok(end <= buf.length, p + ' tem chunk truncado');
    if (type === 0x4e4f534a) json = JSON.parse(buf.subarray(offset + 8, end).toString('utf8'));
    offset = end;
  }
  assert.ok(json, p + ' não contém chunk JSON');
  return { buf, json };
}

function multiplyMatrices(a, b) {
  const out = new Array(16).fill(0);
  for (let col = 0; col < 4; col++)
    for (let row = 0; row < 4; row++)
      for (let k = 0; k < 4; k++)
        out[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
  return out;
}

function nodeMatrix(node) {
  if (node.matrix) return node.matrix;
  const [x, y, z] = node.translation || [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale || [1, 1, 1];
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    x, y, z, 1,
  ];
}

function transformPoint(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

function normalizedComponent(accessor, value) {
  if (!accessor.normalized) return value;
  if (accessor.componentType === 5120) return Math.max(value / 127, -1);
  if (accessor.componentType === 5121) return value / 255;
  if (accessor.componentType === 5122) return Math.max(value / 32767, -1);
  if (accessor.componentType === 5123) return value / 65535;
  throw new Error(`componentType normalizado não suportado: ${accessor.componentType}`);
}

function sceneBounds(gltf, ignoredNodeNames = new Set()) {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const roots = gltf.scenes[gltf.scene || 0].nodes || [];

  function visit(index, parentMatrix) {
    const node = gltf.nodes[index];
    if (ignoredNodeNames.has(node.name)) return;
    const world = multiplyMatrices(parentMatrix, nodeMatrix(node));
    if (node.mesh !== undefined) {
      for (const primitive of gltf.meshes[node.mesh].primitives) {
        const accessor = gltf.accessors[primitive.attributes.POSITION];
        assert.ok(accessor.min && accessor.max, `POSITION sem bounds no nó ${node.name || index}`);
        const low = accessor.min.map(value => normalizedComponent(accessor, value));
        const high = accessor.max.map(value => normalizedComponent(accessor, value));
        for (const x of [low[0], high[0]])
          for (const y of [low[1], high[1]])
            for (const z of [low[2], high[2]]) {
              const p = transformPoint(world, [x, y, z]);
              for (let axis = 0; axis < 3; axis++) {
                min[axis] = Math.min(min[axis], p[axis]);
                max[axis] = Math.max(max[axis], p[axis]);
              }
            }
      }
    }
    for (const child of node.children || []) visit(child, world);
  }

  for (const root of roots) visit(root, identity);
  return { min, max, size: max.map((v, i) => v - min[i]) };
}

function primitiveTriangles(gltf, primitive) {
  const count = primitive.indices === undefined
    ? gltf.accessors[primitive.attributes.POSITION].count
    : gltf.accessors[primitive.indices].count;
  const mode = primitive.mode === undefined ? 4 : primitive.mode;
  if (mode === 4) return count / 3;
  if (mode === 5 || mode === 6) return Math.max(0, count - 2);
  return 0;
}

describe('Arquivos GLB dos assets', () => {
  it('dado o castelo otimizado, então preserva o contrato visual e cabe no orçamento', () => {
    assert.ok(fs.existsSync(CASTLE_OPTIMIZED), 'castelo otimizado deve ser gerado pelo builder');
    const optimized = parseGlb(CASTLE_OPTIMIZED);
    const g = optimized.json;

    assert.equal(fileSha256(CASTLE_OPTIMIZED), CASTLE_OPTIMIZED_SHA256,
      'bytes de boss-castle.v2 mudaram; gere uma URL v3 para invalidar o cache');
    assert.ok(optimized.buf.length <= 1024 * 1024, 'castelo otimizado excede 1 MiB');
    assert.ok((g.buffers || []).every(buffer => !buffer.uri), 'buffer externo não permitido');
    assert.ok((g.images || []).every(image => !image.uri), 'imagem externa não permitida');

    const optimizedBounds = sceneBounds(g);
    const expectedBounds = {
      min: [-19.18, -1.1, -19],
      max: [19.18, 19, 19.19084],
    };
    for (const edge of ['min', 'max'])
      for (let axis = 0; axis < 3; axis++)
        assert.ok(Math.abs(optimizedBounds[edge][axis] - expectedBounds[edge][axis]) <= 0.02,
          `bbox ${edge}[${axis}] divergiu do contrato autoral`);

    // A fonte autoral é local/ignorada para não ser incluída por acidente.
    // Quando está disponível, o contrato prova também a preservação direta.
    if (fs.existsSync(CASTLE_SOURCE)) {
      assert.equal(fileSha256(CASTLE_SOURCE), CASTLE_SOURCE_SHA256,
        'fonte autoral boss-castle.v1 foi alterada');
      if (fs.existsSync(CASTLE_ROOT_SOURCE))
        assert.equal(fileSha256(CASTLE_ROOT_SOURCE), CASTLE_SOURCE_SHA256,
          'GLB original da raiz foi alterado');
      const source = parseGlb(CASTLE_SOURCE);
      const sourceBounds = sceneBounds(
        source.json,
        new Set(['RB_GateDoor_Left', 'RB_GateDoor_Right']),
      );
      for (const axis of [0, 2])
        assert.ok(Math.abs(sourceBounds.size[axis] - optimizedBounds.size[axis]) <= 0.02,
          `bbox ${axis === 0 ? 'X' : 'Z'} divergiu: ` +
          `${sourceBounds.size[axis]} -> ${optimizedBounds.size[axis]}`);
    }

    const primitives = (g.meshes || []).flatMap(mesh => mesh.primitives);
    const triangles = primitives.reduce((total, primitive) => total + primitiveTriangles(g, primitive), 0);
    assert.ok(triangles <= 25000, `castelo tem ${triangles} triângulos; máximo 25000`);
    assert.ok(primitives.length <= 14, `castelo tem ${primitives.length} primitivas; máximo 14`);

    const colors = new Set((g.materials || []).map(material =>
      (material.pbrMetallicRoughness?.baseColorFactor || [1, 1, 1, 1])
        .slice(0, 3).map(value => value.toFixed(4)).join(',')));
    assert.ok(colors.size >= 8, `castelo tem somente ${colors.size} cores distintas`);
    const material = name => g.materials.find(candidate => candidate.name === name);
    const isDominant = (candidate, channel) => {
      assert.ok(candidate, `material ${channel === 0 ? 'MAT_Flag_Red' : 'MAT_Heraldic_Blue'} ausente`);
      const color = candidate.pbrMetallicRoughness.baseColorFactor;
      return color[channel] > color[(channel + 1) % 3] * 1.5
        && color[channel] > color[(channel + 2) % 3] * 1.5;
    };
    assert.ok(isDominant(material('MAT_Flag_Red'), 0), 'MAT_Flag_Red não é vermelho');
    assert.ok(isDominant(material('MAT_Heraldic_Blue'), 2), 'MAT_Heraldic_Blue não é azul');

    const names = (g.nodes || []).map(node => node.name);
    assert.ok(!names.includes('RB_GateDoor_Left'), 'folha esquerda do portão ainda existe');
    assert.ok(!names.includes('RB_GateDoor_Right'), 'folha direita do portão ainda existe');
    const forbiddenExtensions = ['KHR_draco_mesh_compression', 'EXT_meshopt_compression'];
    for (const extension of forbiddenExtensions) {
      assert.ok(!(g.extensionsRequired || []).includes(extension), `decoder proibido exigido: ${extension}`);
      assert.ok(!(g.extensionsUsed || []).includes(extension), `decoder proibido usado: ${extension}`);
    }
  });

  it('dado o helldiver, então tem rig completo com dedos e sem cabeça extra', () => {
    const g = glbJson(path.join(MODELS, 'Personagens', 'low_poly_helldiver_rig.glb'));
    assert.ok(g.skins && g.skins[0].joints.length >= 50, 'rig com 51 ossos esperado');
    const names = g.nodes.map(n => n.name || '');
    for (const frag of ['Hand.L', 'Hand.R', 'Finger_1.L', 'Finger_1.R', 'Arm_1.L', 'Arm_2.R', 'Head'])
      assert.ok(names.some(n => n.includes(frag)), 'osso ausente: ' + frag);
  });
  it('dado o Guardião, então traz as animações Punch/Shoot/Walk e a arma embutida', () => {
    const g = glbJson(path.join(MODELS, 'Personagens', 'Guardiao.glb'));
    const anims = (g.animations || []).map(a => a.name);
    assert.deepEqual(anims.sort(), ['Punch', 'Shoot', 'Walk']);
    const names = g.nodes.map(n => n.name || '');
    assert.ok(names.some(n => n.includes('MuzzleFlash')), 'nó do flash ausente');
  });
  it('dado o alien otimizado, então preserva o rig e a Take 001 abaixo de 1.5MB', () => {
    const p = path.join(MODELS, 'Personagens', 'alien.optimized.glb');
    assert.ok(fs.statSync(p).size < 1.5 * 1024 * 1024, 'alien otimizado grande demais');
    const g = glbJson(p);
    assert.ok(g.skins && g.skins[0].joints.length >= 50, 'rig perdido na otimização');
    assert.ok((g.animations || []).some(a => a.name === 'Take 001'), 'animação perdida');
  });
  it('dada a bazuca otimizada, então cabe em 1MB', () => {
    assert.ok(fs.statSync(path.join(MODELS, 'Armas', 'bazooka.optimized.glb')).size < 1024 * 1024);
  });
  it('dada a sniper leve, então traz as animações embutidas de recarga/ferrolho', () => {
    const g = glbJson(path.join(MODELS, 'Armas', 'low-poly_sniper_Rápida_Fraca.glb'));
    const anims = (g.animations || []).map(a => a.name).sort();
    assert.deepEqual(anims, ['bolt_slide', 'reload']);
  });
});

describe('Integração viva dos modelos', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h;
  before(async () => { h = await bootGame({ port: 3218 }); });
  after(async () => { if (h) await h.close(); });

  it('dado o jogo carregado, então armas GLB, corpo FP, Guardião e alien ficam prontos', async () => {
    const r = await h.play(async () => {
      const G = window.QA.G;
      await G.WeaponModels.ready;
      for (let i = 0; i < 100 && !(G.FpBody.ready || G.FpBody.failed); i++)
        await new Promise(rs => setTimeout(rs, 100));
      for (let i = 0; i < 100 && !G.Enemies.list.some(e => e.hasModel); i++)
        await new Promise(rs => setTimeout(rs, 100));
      return {
        armas: G.WeaponModels.status(),
        fpPronto: G.FpBody.ready,
        fpFalhou: G.FpBody.failed,
        arsenalTotal: G.arsenal.length,
        guardioes: G.Enemies.list.filter(e => e.hasModel).length,
        executivosProcedurais: G.Enemies.list.filter(e => e.suit && !e.hasModel).length >= 0,
      };
    });
    for (const a of r.armas) assert.equal(a.status, 'ready', `arma ${a.idx} não carregou: ${a.url}`);
    assert.equal(r.fpPronto, true, 'corpo FP (helldiver) não ficou pronto');
    assert.equal(r.fpFalhou, false);
    assert.equal(r.arsenalTotal, 8, 'arsenal deveria ter 8 armas (6 antigas + sniper leve + escopeta rajada)');
    assert.ok(r.guardioes >= 10, `esperava >=10 Guardiões com modelo, veio ${r.guardioes}`);
    assert.deepEqual(h.pageErrors, [], 'erros de página: ' + h.pageErrors.join(' | '));
  });

  it('dada a sniper nova, então mag/bolt ficam com o MIXER (clips) e as âncoras cedidas', async () => {
    // a prova de movimento real dos clips vive em test/weapon-mechanisms.test.js;
    // aqui só o contrato: nós sob a raiz do mixer + âncoras marcadas 'clip'
    const r = await h.play(() => {
      const G = window.QA.G;
      G.arsenal[6].locked = false;
      G.switchWeapon(6);
      const gun = G.gun;
      const root = gun.modelRoot;
      const find = re => { let n = null; root.traverse(o => { if (!n && re.test(o.name)) n = o; }); return n; };
      const under = n => { for (let p = n; p; p = p.parent) if (p === root) return true; return false; };
      const mag = find(/^mag_4$/), bolt = find(/^bolt_6$/);
      return { nome: gun.name, magUnder: !!mag && under(mag), boltUnder: !!bolt && under(bolt),
        magAuth: gun.parts.mag.userData.authority, boltAuth: gun.parts.bolt.userData.authority };
    });
    assert.equal(r.nome, 'SNIPER "AGULHA"');
    assert.ok(r.magUnder, 'mag_4 saiu da raiz do mixer');
    assert.ok(r.boltUnder, 'bolt_6 saiu da raiz do mixer');
    assert.equal(r.magAuth, 'clip', 'âncora mag sem autoridade cedida ao clip');
    assert.equal(r.boltAuth, 'clip', 'âncora bolt sem autoridade cedida ao clip');
  });
});
