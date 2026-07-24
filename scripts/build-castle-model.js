#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'assets', 'models', 'boss-castle.v1.glb');
const OUTPUT = path.join(ROOT, 'assets', 'models', 'boss-castle.v2.optimized.glb');
const SOURCE_SHA256 = 'fd05cc2fa6aebcd73d16440280b90074624a67bd67e9fc385017ced525e18449';
const MAX_BYTES = 1024 * 1024;
const MAX_PRIMITIVES = 14;
const MAX_TRIANGLES = 25000;

const PALETTE = {
  MAT_Earth_Brown: 0x563a26,
  MAT_Grass_Olive: 0x69733a,
  MAT_Stone_Warm: 0x8f806d,
  MAT_Stone_Dark: 0x4b4742,
  MAT_Stone_Light: 0xb8ad9e,
  MAT_Iron: 0x35383c,
  MAT_Wood_Oak: 0x6b4426,
  MAT_Heraldic_Blue: 0x244c7a,
  MAT_Heraldic_White: 0xece8dc,
  MAT_Flag_Red: 0xa92f2f,
};

const FABRIC_MATERIALS = new Set([
  'MAT_Heraldic_Blue',
  'MAT_Heraldic_White',
  'MAT_Flag_Red',
]);
const GATE_DOORS = new Set(['RB_GateDoor_Left', 'RB_GateDoor_Right']);
const DECODER_EXTENSIONS = new Set(['KHR_draco_mesh_compression', 'EXT_meshopt_compression']);

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function triangleCount(primitive) {
  const count = (primitive.getIndices() || primitive.getAttribute('POSITION')).getCount();
  const mode = primitive.getMode();
  if (mode === 4) return count / 3;
  if (mode === 5 || mode === 6) return Math.max(0, count - 2);
  return 0;
}

function formatVector(vector) {
  return vector.map(value => value.toFixed(3)).join(' × ');
}

async function build() {
  const sourceBytes = fs.readFileSync(SOURCE);
  const sourceHash = sha256(sourceBytes);
  if (sourceHash !== SOURCE_SHA256)
    throw new Error(`SHA-256 inesperado para a fonte: ${sourceHash}`);

  const { ColorUtils, Logger, NodeIO, PropertyType, Verbosity, getBounds } =
    await import('@gltf-transform/core');
  const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
  const { dedup, flatten, join, prune, quantize } =
    await import('@gltf-transform/functions');

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const document = await io.read(SOURCE);
  document.setLogger(new Logger(Verbosity.WARN));
  const root = document.getRoot();

  const materials = new Map(root.listMaterials().map(material => [material.getName(), material]));
  for (const [name, hex] of Object.entries(PALETTE)) {
    const material = materials.get(name);
    if (!material) throw new Error(`Material obrigatório ausente: ${name}`);
    material
      .setBaseColorFactor([...ColorUtils.hexToFactor(hex, []), 1])
      .setDoubleSided(FABRIC_MATERIALS.has(name));
  }

  const doors = root.listNodes().filter(node => GATE_DOORS.has(node.getName()));
  if (doors.length !== GATE_DOORS.size)
    throw new Error(`Esperava ${GATE_DOORS.size} folhas de portão; encontrei ${doors.length}`);
  for (const door of doors) door.dispose();

  await document.transform(
    dedup({
      propertyTypes: [
        PropertyType.ACCESSOR,
        PropertyType.MESH,
        PropertyType.TEXTURE,
        PropertyType.SKIN,
      ],
    }),
    flatten(),
    join(),
    prune({ keepAttributes: false }),
    quantize({ quantizePosition: 14, quantizeNormal: 10 }),
  );

  const scene = root.getDefaultScene();
  if (!scene) throw new Error('Cena padrão ausente após otimização');
  const bounds = getBounds(scene);
  const size = bounds.max.map((value, index) => value - bounds.min[index]);
  const primitives = root.listMeshes().flatMap(mesh => mesh.listPrimitives());
  const triangles = primitives.reduce((total, primitive) => total + triangleCount(primitive), 0);
  const requiredExtensions = root.listExtensionsRequired().map(extension => extension.extensionName);
  const decoder = requiredExtensions.find(extension => DECODER_EXTENSIONS.has(extension));
  if (decoder) throw new Error(`Extensão com decoder proibida: ${decoder}`);
  if (primitives.length > MAX_PRIMITIVES)
    throw new Error(`${primitives.length} primitivas excedem o limite ${MAX_PRIMITIVES}`);
  if (triangles > MAX_TRIANGLES)
    throw new Error(`${triangles} triângulos excedem o limite ${MAX_TRIANGLES}`);

  const temporary = `${OUTPUT}.tmp-${process.pid}.glb`;
  try {
    await io.write(temporary, document);
    const outputBytes = fs.readFileSync(temporary);
    if (outputBytes.length > MAX_BYTES)
      throw new Error(`${outputBytes.length} bytes excedem o limite ${MAX_BYTES}`);
    fs.renameSync(temporary, OUTPUT);
    console.log(`Castelo: ${formatVector(size)} m`);
    console.log(`Geometria: ${triangles} triângulos, ${primitives.length} primitivas`);
    console.log(`Arquivo: ${outputBytes.length} bytes, SHA-256 ${sha256(outputBytes)}`);
    console.log(`Extensões exigidas: ${requiredExtensions.join(', ') || 'nenhuma'}`);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

build().catch(error => {
  console.error(`Falha ao construir o castelo: ${error.message}`);
  process.exitCode = 1;
});
