/* ================================================================
   PROTOCOLO da nave de entrada — compartilhado entre servidor (CJS)
   e navegador (window.ShipProtocol), no padrão do
   city-destruction-protocol.js: matemática PURA, sem DOM e sem three.

   Fonte única de verdade para:
   - dimensões da nave/cabine (cliente desenha, servidor valida);
   - pose da nave no tempo (bob senoidal IDÊNTICO nos dois lados);
   - conversões local<->mundo (rotação Y na convenção do three.js);
   - slots de spawn em anéis concêntricos (servidor atribui);
   - validação de shipLocal (custo constante, nada do cliente é confiável).
   Plano: docs/plans/2026-07-16-nave-remodelagem.md
   ================================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShipProtocol = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DIMS = {
    outerRadius: 18,      // casco: Ø36 m
    cabinRadius: 13.2,    // parede interna: Ø26.4 m úteis
    floorY: -1.45,        // piso local (pés do jogador)
    ceilingY: 3.25,       // teto local: 4.70 m de pé-direito
    windowRadius: 4.4,    // janela de vidro no centro do piso
    wallMargin: 0.22,     // folga extra jogador<->parede
    playerRadius: 0.42,   // espelho de player.radius em game.js
    walkSpeed: 4.0,       // m/s dentro da cabine
    bobAmp: 0.55,         // nave grande = pesada (a antiga balançava 1.2)
    bobFreq: 0.9,
    floorTol: 0.35,       // tolerância vertical do shipLocal na validação
    // teto de velocidade LOCAL validado no servidor: walkSpeed com folga
    // de rede/lag de 2.25x — específico da nave, não mexe no speedhack global
    maxLocalSpeed: 9,
  };

  /* consoles periféricos: 6 arcos junto à parede; todo volume sólido que
     invade a área caminhável tem collider correspondente (clampToCabin) */
  const CONSOLES = [];
  for (let k = 0; k < 6; k++) {
    CONSOLES.push({ ang: Math.PI / 6 + k * (Math.PI / 3), halfArc: 0.16, innerR: 12.3 });
  }

  function walkRadius() {
    return DIMS.cabinRadius - DIMS.playerRadius - DIMS.wallMargin;
  }

  /* mesma convenção do cliente: nariz da nave aponta do from pro to */
  function routeYaw(ship) {
    return Math.atan2(ship.to[0] - ship.from[0], ship.to[1] - ship.from[1]);
  }

  /* pose no tempo t (segundos de partida). k clampa em [0, 1.18] como hoje:
     a nave segue um pouco além do fim da rota antes de sumir */
  function poseAt(ship, t, out) {
    const o = out || {};
    const k = Math.min(Math.max(t / ship.flyTime, 0), 1.18);
    o.x = ship.from[0] + (ship.to[0] - ship.from[0]) * k;
    o.y = ship.alt + Math.sin(t * DIMS.bobFreq) * DIMS.bobAmp;
    o.z = ship.from[1] + (ship.to[1] - ship.from[1]) * k;
    o.yaw = routeYaw(ship);
    o.k = k;
    return o;
  }

  /* rotação Y na convenção do three.js (Object3D.rotation.y = yaw):
     wx = cos·lx + sin·lz ; wz = -sin·lx + cos·lz */
  function localToWorld(pose, local, out) {
    const o = out || [0, 0, 0];
    const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
    // lê ANTES de escrever: out pode ser o próprio array de entrada
    const lx = local[0], ly = local[1], lz = local[2];
    o[0] = pose.x + c * lx + s * lz;
    o[1] = pose.y + ly;
    o[2] = pose.z - s * lx + c * lz;
    return o;
  }

  function worldToLocal(pose, world, out) {
    const o = out || [0, 0, 0];
    const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
    const dx = world[0] - pose.x, dz = world[2] - pose.z;
    const wy = world[1];
    o[0] = c * dx - s * dz;
    o[1] = wy - pose.y;
    o[2] = s * dx + c * dz;
    return o;
  }

  /* telhado climático da nave: a coordenada MUNDIAL está sob o casco?
     Raio EXTERNO (o casco inteiro faz sombra de chuva) + teto local. */
  const _cvp = [0, 0, 0];
  function coversPoint(pose, x, y, z) {
    _cvp[0] = x; _cvp[1] = y; _cvp[2] = z;
    worldToLocal(pose, _cvp, _cvp);
    return Math.hypot(_cvp[0], _cvp[2]) <= DIMS.outerRadius && _cvp[1] < DIMS.ceilingY + 0.6;
  }

  /* slots em 5 anéis concêntricos ao redor da janela. Índice i é atribuído
     pelo SERVIDOR no início da partida e não muda no voo; a posição de um
     slot só depende do próprio índice (desconexões não realocam ninguém).
     Anel máximo 11.4 m: fora da janela, dentro do walkRadius e fora da
     zona de clamp dos consoles (12.3 - playerRadius). */
  const RING_R = [5.8, 7.2, 8.6, 10.0, 11.4];
  const RING_CAP = RING_R.map(r => Math.floor((2 * Math.PI * r) / 1.25));
  const SLOT_TOTAL = RING_CAP.reduce((a, b) => a + b, 0);

  function slotLocal(i) {
    const idx = ((i % SLOT_TOTAL) + SLOT_TOTAL) % SLOT_TOTAL; // wrap determinístico
    const ring = idx % RING_R.length;
    const seat = Math.floor(idx / RING_R.length) % RING_CAP[ring];
    const volta = Math.floor(Math.floor(idx / RING_R.length) / RING_CAP[ring]);
    const ang = seat * (2 * Math.PI / RING_CAP[ring]) + ring * 0.7 + volta * 0.37;
    return [Math.cos(ang) * RING_R[ring], Math.sin(ang) * RING_R[ring]];
  }

  /* validação de custo constante: comprimento checado ANTES de ler valores */
  function sanitizeLocal(v) {
    if (!Array.isArray(v) || v.length !== 3) return null;
    const x = v[0], y = v[1], z = v[2];
    if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return null;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    return [x, y, z];
  }

  function localInCabin(l) {
    if (Math.hypot(l[0], l[2]) > walkRadius() + 0.05) return false;
    return Math.abs(l[1] - DIMS.floorY) <= DIMS.floorTol;
  }

  /* colisão analítica da cabine em coordenadas locais. Muta {x,z}.
     Clamp radial: remove só a componente pra fora, preserva a tangencial
     (deslizar na parede). Distância zero é no-op — nunca teleporta. */
  function clampToCabin(p, playerRadius) {
    const pr = typeof playerRadius === 'number' ? playerRadius : DIMS.playerRadius;
    const maxR = DIMS.cabinRadius - pr - DIMS.wallMargin;
    let r = Math.hypot(p.x, p.z);
    if (r > maxR && r > 1e-9) {
      const f = maxR / r;
      p.x *= f; p.z *= f;
      r = maxR;
    }
    if (r <= 1e-9) return p;
    const a = Math.atan2(p.z, p.x);
    for (const c of CONSOLES) {
      const d = Math.atan2(Math.sin(a - c.ang), Math.cos(a - c.ang));
      if (Math.abs(d) > c.halfArc) continue;
      const rMax = c.innerR - pr;
      if (r > rMax) { const f = rMax / r; p.x *= f; p.z *= f; r = rMax; }
    }
    return p;
  }

  return {
    DIMS, CONSOLES, SLOT_TOTAL,
    walkRadius, routeYaw, poseAt, localToWorld, worldToLocal, coversPoint,
    slotLocal, sanitizeLocal, localInCabin, clampToCabin,
  };
});
