/* helpers de IA compartilhados entre criaturas de corpo-a-corpo */
import * as THREE from 'three';

const _from = new THREE.Vector3(), _to = new THREE.Vector3();

// true quando o corpo-a-corpo da criatura até o jogador está bloqueado por
// altura (andar diferente), parede (Structures.segBlocked) ou obstáculo do grid.
export function meleeBlocked(group, playerPos, Structures, obstaclesNear) {
  _from.set(group.position.x, group.position.y + 1, group.position.z);
  _to.set(playerPos.x, playerPos.y + 0.9, playerPos.z);
  if (Math.abs(_to.y - _from.y) > 1.8) return true; // andar de cima/baixo
  if (Structures && typeof Structures.segBlocked === 'function' &&
      Structures.segBlocked(_from, _to)) return true;
  if (typeof obstaclesNear !== 'function') return false;
  const dx = _to.x - _from.x, dz = _to.z - _from.z;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-8) return false;
  for (const o of obstaclesNear((_from.x + _to.x) * 0.5, (_from.z + _to.z) * 0.5)) {
    const k = Math.max(0, Math.min(1,
      ((o.x - _from.x) * dx + (o.z - _from.z) * dz) / len2));
    const nx = _from.x + dx * k, nz = _from.z + dz * k;
    if ((nx - o.x) ** 2 + (nz - o.z) ** 2 < o.r * o.r) return true;
  }
  return false;
}
