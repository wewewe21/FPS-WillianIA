/* ================================================================
   Regras de combate compartilhadas entre o servidor (CommonJS) e o
   navegador (window.MultiplayerRules). O servidor é a autoridade;
   o cliente usa estes mesmos valores apenas para apresentação/predição.
   ================================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MultiplayerRules = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const WEAPONS = [
    { id: 0, name: 'FUZIL "VAGALUME"', auto: true, rpm: 690, dmg: 26, pellets: 1, magSize: 30, reserveStart: 150,
      reloadTime: 1.55, spreadHip: 0.014, spreadAds: 0.0022, recoilP: 0.62, recoilY: 0.16, kick: 0.055,
      adsFov: 55, hip: [0.26, -0.235, -0.5], ads: [0, -0.0915, -0.3], maxRange: 240 },
    { id: 1, name: 'ESCOPETA "TROVÃO"', auto: false, rpm: 78, dmg: 11, pellets: 8, magSize: 6, reserveStart: 30,
      reloadTime: 2.3, spreadHip: 0.05, spreadAds: 0.032, recoilP: 1.9, recoilY: 0.3, kick: 0.15,
      adsFov: 62, hip: [0.27, -0.24, -0.46], ads: [0, -0.075, -0.36], maxRange: 90 },
    { id: 2, name: 'SNIPER "FALCÃO DOURADO"', auto: false, rpm: 48, dmg: 110, pellets: 1, magSize: 5, reserveStart: 20,
      reloadTime: 2.75, spreadHip: 0.024, spreadAds: 0.00035, recoilP: 2.05, recoilY: 0.2, kick: 0.16,
      adsFov: 24, hip: [0.25, -0.23, -0.42], ads: [0, -0.115, -0.2], maxRange: 320,
      boltAction: true, cycleDuration: 1.05 },
    { id: 3, name: 'BAZUCA "TROVOADA"', auto: false, rpm: 30, dmg: 0, pellets: 1, magSize: 1, reserveStart: 4,
      reloadTime: 2.8, spreadHip: 0.02, spreadAds: 0.01, recoilP: 2.4, recoilY: 0.3, kick: 0.3,
      adsFov: 60, hip: [0.3, -0.2, -0.42], ads: [0.1, -0.07, -0.34], maxRange: 240, rocket: true, locked: true,
      rocketSplash: { radius: 9, enemyMax: 180, enemyMin: 20, bossMax: 155,
        extraMax: 170, remoteMax: 150, selfRadius: 7, selfMax: 70 } },
    { id: 4, name: 'PLASMA "VISITANTE"', auto: true, rpm: 430, dmg: 38, pellets: 1, magSize: 42, reserveStart: 210,
      reloadTime: 1.7, spreadHip: 0.012, spreadAds: 0.003, recoilP: 0.4, recoilY: 0.1, kick: 0.04,
      adsFov: 58, hip: [0.26, -0.235, -0.48], ads: [0, -0.083, -0.3], maxRange: 240,
      laser: true, plasma: true, locked: true },
    { id: 5, name: 'MACHADO "AURORA"', auto: false, rpm: 105, dmg: 46, pellets: 1, magSize: 1, reserveStart: 0,
      reloadTime: 0.8, spreadHip: 0, spreadAds: 0, recoilP: 0.3, recoilY: 0.06, kick: 0.07,
      adsFov: 66, hip: [0.3, -0.25, -0.48], ads: [0.16, -0.19, -0.4], maxRange: 3,
      melee: true, meleeDuration: 0.52, locked: true },
    { id: 6, name: 'SNIPER "AGULHA"', auto: false, rpm: 235, dmg: 30, pellets: 1, magSize: 10, reserveStart: 40,
      reloadTime: 1.6, spreadHip: 0.018, spreadAds: 0.0008, recoilP: 1.1, recoilY: 0.18, kick: 0.09,
      adsFov: 30, hip: [0.25, -0.23, -0.42], ads: [0, -0.112, -0.22], maxRange: 300, locked: true },
    { id: 7, name: 'ESCOPETA "RAJADA"', auto: true, rpm: 175, dmg: 7, pellets: 7, magSize: 9, reserveStart: 36,
      reloadTime: 2.1, spreadHip: 0.055, spreadAds: 0.04, recoilP: 1.3, recoilY: 0.24, kick: 0.11,
      adsFov: 62, hip: [0.27, -0.24, -0.46], ads: [0, -0.075, -0.36], maxRange: 85, locked: true },
  ].map(weapon => Object.freeze(weapon));

  const BR_START_WEAPON = 5;
  const MAX_PVP_DAMAGE = 95;
  const BR_INTEREST_RADIUS = 280;
  const ARENA_INTEREST_RADIUS = 105;

  function weaponById(id) {
    return Number.isInteger(id) && WEAPONS[id] && WEAPONS[id].id === id ? WEAPONS[id] : null;
  }

  function fireIntervalMs(weapon) {
    return 60000 / weapon.rpm;
  }

  function hitCounts(weapon, hits, headshots) {
    const hitCount = Math.max(1, Math.min(weapon.pellets, Math.trunc(hits) || 1));
    const heads = Math.max(0, Math.min(hitCount, Math.trunc(headshots) || 0));
    return { hits: hitCount, headshots: heads };
  }

  function damageForHit(weapon, hits, headshots) {
    const counts = hitCounts(weapon, hits, headshots);
    const base = weapon.rocket ? weapon.rocketSplash.remoteMax : weapon.dmg;
    return Math.min(MAX_PVP_DAMAGE, Math.round(base * (counts.hits + counts.headshots)));
  }

  return Object.freeze({
    WEAPONS: Object.freeze(WEAPONS),
    BR_START_WEAPON,
    MAX_PVP_DAMAGE,
    BR_INTEREST_RADIUS,
    ARENA_INTEREST_RADIUS,
    weaponById,
    fireIntervalMs,
    hitCounts,
    damageForHit,
  });
});
