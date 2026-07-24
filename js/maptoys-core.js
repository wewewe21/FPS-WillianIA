/* ================================================================
   Atrações do mapa — NÚCLEO PURO (sem THREE/DOM).
   Matemática das 5 brincadeiras: cama elástica, aros de acrobacia,
   xilofone gigante, campo de tiro e fogos. Mesmo código no navegador
   (js/maptoys.js) e nos testes de Node. Reusa pickSpot de cannon-core.
   ================================================================ */
export { pickSpot } from './cannon-core.js';

// ---- Cama Elástica -------------------------------------------------------
// Impulso pra cima ao pousar numa placa. Bem abaixo do teto vertical do
// anti-cheat (120 m/s): quicar encadeado nunca acumula além disso.
export const BOUNCE_UP = 15;         // m/s
export function bounceVelocity(strength = 1) {
  return Math.min(28, BOUNCE_UP * strength); // trava dura de segurança
}

// ---- Aros de Acrobacia ---------------------------------------------------
/* O segmento P0→P1 (posição do frame anterior → atual) cruzou o disco do aro?
   center/normal definem o plano; radius é o raio do buraco. Puro e testável. */
export function passedRing(p0, p1, center, normal, radius) {
  const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
  const denom = dx * normal.x + dy * normal.y + dz * normal.z;
  if (Math.abs(denom) < 1e-9) return false;                 // paralelo ao aro
  const t = ((center.x - p0.x) * normal.x + (center.y - p0.y) * normal.y +
             (center.z - p0.z) * normal.z) / denom;
  if (t < 0 || t > 1) return false;                         // cruzou fora do passo
  const hx = p0.x + dx * t, hy = p0.y + dy * t, hz = p0.z + dz * t;
  const off = Math.hypot(hx - center.x, hy - center.y, hz - center.z);
  return off <= radius;
}

// posição de um aro ao longo de um curso reto que ergue e baixa (arco suave)
export function ringAt(origin, dir, i, n, spacing = 11, arcH = 7) {
  const t = n > 1 ? i / (n - 1) : 0;
  return {
    x: origin.x + dir.x * (i + 1) * spacing,
    z: origin.z + dir.z * (i + 1) * spacing,
    y: origin.y + 3.2 + Math.sin(t * Math.PI) * arcH, // sobe no meio, desce nas pontas
  };
}

// ---- Xilofone Gigante ----------------------------------------------------
/* Índice da placa sob (x,z), ou -1. plates: [{x,z,w,d}] (retângulos no chão). */
export function plateAt(x, z, plates) {
  for (let i = 0; i < plates.length; i++) {
    const p = plates[i];
    if (Math.abs(x - p.x) <= p.w / 2 && Math.abs(z - p.z) <= p.d / 2) return i;
  }
  return -1;
}
// escala pentatônica (Dó maior) — sempre soa alegre, nunca desafinado/sombrio
export const XYLO_NOTES = [523, 587, 659, 784, 880, 1047, 1175, 1319];

// ---- Recordes ------------------------------------------------------------
export function betterMax(prev, v) { const p = Number.isFinite(prev) ? prev : 0; return v > p ? v : p; }
export function betterTime(prev, v) { // menor tempo é melhor; 0/NaN = sem recorde
  const p = Number.isFinite(prev) && prev > 0 ? prev : Infinity;
  return v > 0 && v < p ? v : (Number.isFinite(p) ? p : 0);
}
