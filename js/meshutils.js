/* helpers de malha/material compartilhados entre entidades */

// Prepara uma malha de GLB riggado para render barato e coerente:
//  - sem sombra (CSM multiplicaria as draw calls por 4);
//  - sem frustum cull (ossos animados deslocam a malha do bounding original,
//    some da tela na câmera/no chão);
//  - limita o brilho de materiais standard SEM textura, pra não estourar branco.
export function prepRiggedMesh(root) {
  root.traverse(o => {
    if (o.isMesh || o.isSkinnedMesh) {
      o.castShadow = false;
      o.receiveShadow = false;
      o.frustumCulled = false;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m && m.isMeshStandardMaterial && !m.map) {
          const l = m.color.r * 0.299 + m.color.g * 0.587 + m.color.b * 0.114;
          if (l > 0.72) m.color.multiplyScalar(0.72 / l);
        }
      }
    }
  });
}
