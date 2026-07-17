/* Clima/dia-noite DETERMINÍSTICO e compartilhado — fonte única usada pelo
   solo (js/env.js, relógio da sessão) e pelo Battle Royale (relógio da
   partida). Funções PURAS de (seed, tempo): mesmo estado em todo cliente,
   late join e reconexão, sem depender de frames, pausa ou Math.random local.
   DAY_LEN canônico = 480 s (o valor que o BR já usava; o espelho de 420 do
   Env morreu aqui). Clima muda por ÉPOCA de 75 s, sorteado por hash de
   (seed ^ época) — o mesmo do BR antigo. */

export const DAY_LEN = 480;
const DAY_SPD = 0.62 / DAY_LEN, NIGHT_SPD = 1.9 / DAY_LEN; // dia ~3x mais longo
export const WEATHER_EPOCH = 75; // segundos por época de clima

function hash01(seed) {
  let s = seed >>> 0;
  s = (s + 0x6D2B79F5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const smooth01 = (x, a, b) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/* horário do dia como função PURA do tempo decorrido (curva do BR:
   0.25–0.75 = dia lento, resto = noite rápida) */
export function todAt(elapsedSeconds, startTod = 0.33) {
  let tod = startTod, rem = Math.max(0, elapsedSeconds);
  for (let guard = 0; rem > 0 && guard < 96; guard++) {
    const day = tod >= 0.25 && tod < 0.75;
    const spd = day ? DAY_SPD : NIGHT_SPD;
    const edge = day ? 0.75 : (tod < 0.25 ? 0.25 : 1.25);
    const toEdge = (edge - tod) / spd;
    if (toEdge > rem) { tod += rem * spd; break; }
    tod = edge >= 1 ? edge - 1 : edge;
    rem -= toEdge;
  }
  return tod % 1;
}

/* avança um tod arbitrário por dt segundos (mesma curva do todAt) — usado
   pelo solo, que integra localmente a partir de um estado ajustável por QA */
export function todStep(tod, dt) {
  const day = tod >= 0.25 && tod < 0.75;
  return (tod + dt * (day ? DAY_SPD : NIGHT_SPD)) % 1;
}

/* clima da época atual + rampa de transição no começo dela */
export function weatherAt(seed, elapsedSeconds) {
  const epoch = Math.floor(Math.max(0, elapsedSeconds) / WEATHER_EPOCH);
  const r = hash01((seed ^ Math.imul(epoch + 1, 2654435761)) >>> 0);
  const type = r < 0.52 ? 'limpo' : r < 0.8 ? 'chuva' : 'neve';
  const tIn = Math.max(0, elapsedSeconds) - epoch * WEATHER_EPOCH;
  return { type, epoch, k: smooth01(tIn, 0, 8) }; // k: rampa de 8 s na virada
}

/* vento: direção gira DEVAGAR (determinística) + respiração senoidal na força */
export function windAt(seed, elapsedSeconds) {
  const t = Math.max(0, elapsedSeconds);
  const base = hash01(seed ^ 0x51ED) * Math.PI * 2;
  const ang = base + t * 0.008 + Math.sin(t * 0.031) * 0.35; // ~13 min por volta
  const strength = 0.8 + Math.sin(t * 0.11 + base) * 0.2;    // 0.6..1.0 (fator)
  return { dirX: Math.cos(ang), dirZ: Math.sin(ang), strength };
}

/* golden hour: fim de tarde quente/rosado (referência: atmosfera Vice City).
   Contínuo, some suavemente antes da noite (0.75 = pôr do sol). */
export function goldenHourK(tod) {
  return smooth01(tod, 0.66, 0.71) * (1 - smooth01(tod, 0.74, 0.79));
}

/* fases de luz (curva atual do Env extraída p/ quem precisar fora dele) */
export function phases(tod) {
  const ang = (tod - 0.25) * Math.PI * 2;
  const elevDeg = Math.sin(ang) * 58;
  const dayK = Math.max(0, Math.min(1, (elevDeg + 4) / 14));
  return { elevDeg, dayK, nightK: 1 - dayK };
}
