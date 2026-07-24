/* ================================================================
   CORES DO PERSONAGEM — fonte única de verdade, no padrão de
   ship-protocol.js: compartilhada entre servidor (CJS require), cliente
   (window.BRColors) e avatar remoto. Sem DOM, sem three, pura.

   4 papéis, nesta ordem: corpo, roupa, detalhe, visor. sanitizeColors
   valida cada cor (allowlist hex) e cai no default do índice se for lixo —
   antes disso, uma cor invalida virava avatar BRANCO silencioso (THREE.Color
   nao lanca em 'garbage') e um br_colors craftado quebrava o <input> do lobby.
   ================================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BRColors = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const DEFAULT_COLORS = ['#4da6ff', '#2b3a4d', '#8a5a2b', '#ffd76a'];
  const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/;
  // Sempre devolve EXATAMENTE 4 cores hex válidas (#rgb ou #rrggbb, minúsculo).
  // Item ausente/invalido → default daquele papel. Seguro pra atributo HTML e
  // pra new THREE.Color (nunca vira branco por lixo).
  function sanitizeColors(arr) {
    const src = Array.isArray(arr) ? arr : [];
    return DEFAULT_COLORS.map((def, i) => {
      const c = typeof src[i] === 'string' ? src[i].trim().toLowerCase() : '';
      return HEX.test(c) ? c : def;
    });
  }
  return { DEFAULT_COLORS, HEX, sanitizeColors };
});
